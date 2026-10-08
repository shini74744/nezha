package singleton

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
)

const snapshotBatchSize = 128

type snapshotWriteRequest struct {
	db      *gorm.DB
	ctx     context.Context
	id      uint64
	uuid    string
	sample  model.RecordedServerState
	payload string
	result  chan error
}

type snapshotBatchWriter struct {
	mu      sync.Mutex
	pending []*snapshotWriteRequest
	running bool
}

var serverSnapshotWriter snapshotBatchWriter

func (writer *snapshotBatchWriter) persist(request *snapshotWriteRequest) error {
	writer.mu.Lock()
	writer.pending = append(writer.pending, request)
	if !writer.running {
		writer.running = true
		go writer.drain()
	}
	writer.mu.Unlock()
	// Do not return merely because the deadline fires: the transaction must
	// finish or roll back first. RPC admission/identity leases therefore remain
	// held until persistence settles, including during graceful shutdown.
	return <-request.result
}

func (writer *snapshotBatchWriter) drain() {
	for {
		writer.mu.Lock()
		if len(writer.pending) == 0 {
			writer.pending = nil
			writer.running = false
			writer.mu.Unlock()
			return
		}
		n := 1
		for n < len(writer.pending) && n < snapshotBatchSize && writer.pending[n].db == writer.pending[0].db {
			n++
		}
		batch := append([]*snapshotWriteRequest(nil), writer.pending[:n]...)
		clear(writer.pending[:n])
		writer.pending = writer.pending[n:]
		writer.mu.Unlock()
		persistSnapshotBatch(batch)
	}
}

func persistSnapshotBatch(batch []*snapshotWriteRequest) {
	active := make([]*snapshotWriteRequest, 0, len(batch))
	deadline := time.Now().Add(5 * time.Second)
	for _, request := range batch {
		if err := request.ctx.Err(); err != nil {
			request.result <- err
			continue
		}
		if limit, ok := request.ctx.Deadline(); ok && limit.Before(deadline) {
			deadline = limit
		}
		active = append(active, request)
	}
	if len(active) == 0 {
		return
	}
	ctx, cancel := context.WithDeadline(context.Background(), deadline)
	defer cancel()
	itemErrors := make([]error, len(active))
	batchErr := func() error {
		select {
		case snapshotWriteGate <- struct{}{}:
		case <-ctx.Done():
			return fmt.Errorf("snapshot writer queue: %w", ctx.Err())
		}
		defer func() { <-snapshotWriteGate }()
		return active[0].db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			for index, request := range active {
				// Keep a rejected report from rolling back healthy neighbours.
				// Every successful report still commits snapshot + traffic together.
				if err := tx.SavePoint("snapshot_report").Error; err != nil {
					return err
				}
				itemErrors[index] = persistSnapshotTx(tx, request)
				if itemErrors[index] != nil {
					if err := tx.RollbackTo("snapshot_report").Error; err != nil {
						return errors.Join(itemErrors[index], err)
					}
				}
				if err := tx.Exec("RELEASE SAVEPOINT snapshot_report").Error; err != nil {
					return err
				}
			}
			return nil
		})
	}()
	for index, request := range active {
		// A commit failure invalidates every successful item in the batch.
		request.result <- errors.Join(itemErrors[index], batchErr)
	}
}

func persistSnapshotTx(tx *gorm.DB, request *snapshotWriteRequest) error {
	sample := request.sample
	result := tx.Exec(`INSERT INTO server_snapshots(server_id,slot,uuid,recorded_at,payload)
   SELECT id,?,?,?,? FROM servers WHERE id=? AND uuid=?
   ON CONFLICT(server_id,slot) DO UPDATE SET uuid=excluded.uuid,
   recorded_at=excluded.recorded_at,payload=excluded.payload
   WHERE excluded.recorded_at>server_snapshots.recorded_at`,
		sample.At/1000, request.uuid, sample.At, request.payload, request.id, request.uuid)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return nil
	}
	if err := tx.Exec(`DELETE FROM server_snapshots WHERE server_id=? AND recorded_at <
   (SELECT MAX(recorded_at)-60000 FROM server_snapshots WHERE server_id=?)`, request.id, request.id).Error; err != nil {
		return err
	}
	return recordPlanTrafficTx(tx, request.id, request.uuid, sample)
}
