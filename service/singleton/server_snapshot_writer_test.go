package singleton

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type snapshotCommitPool struct {
	*sql.DB
	delay   time.Duration
	before  func() error
	commits atomic.Int64
}

type snapshotCommitTx struct {
	*sql.Tx
	ctx  context.Context
	pool *snapshotCommitPool
}

func (pool *snapshotCommitPool) GetDBConn() (*sql.DB, error) { return pool.DB, nil }

func (pool *snapshotCommitPool) BeginTx(ctx context.Context, options *sql.TxOptions) (gorm.ConnPool, error) {
	tx, err := pool.DB.BeginTx(ctx, options)
	if err != nil {
		return nil, err
	}
	return &snapshotCommitTx{Tx: tx, ctx: ctx, pool: pool}, nil
}

func (tx *snapshotCommitTx) Commit() error {
	tx.pool.commits.Add(1)
	if tx.pool.before != nil {
		if err := tx.pool.before(); err != nil {
			return err
		}
	}
	if tx.pool.delay > 0 {
		timer := time.NewTimer(tx.pool.delay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-tx.ctx.Done():
			return tx.ctx.Err()
		}
	}
	return tx.Tx.Commit()
}

func snapshotBatchFixture(t *testing.T, servers int) *snapshotCommitPool {
	t.Helper()
	setupPermanentDeleteTest(t)
	require.NoError(t, DB.AutoMigrate(&model.ServerSnapshot{}, &model.PlanTrafficCheckpoint{}, &model.PlanTrafficDay{}))
	for id := 1; id <= servers; id++ {
		require.NoError(t, DB.Create(&model.Server{Common: model.Common{ID: uint64(id)}, UUID: fmt.Sprint(id)}).Error)
	}
	sqlDB, err := DB.DB()
	require.NoError(t, err)
	pool := &snapshotCommitPool{DB: sqlDB}
	DB.Config.ConnPool = pool
	DB.Statement.ConnPool = pool
	return pool
}

func snapshotBatchRequest(t *testing.T, id uint64, ctx context.Context) *snapshotWriteRequest {
	t.Helper()
	sample := sampleAt(100000)
	payload, err := json.Marshal(sample)
	require.NoError(t, err)
	return &snapshotWriteRequest{db: DB, ctx: ctx, id: id, uuid: fmt.Sprint(id), sample: sample, payload: string(payload), result: make(chan error, 1)}
}

func TestSnapshotSlowCommitFleetWrites(t *testing.T) {
	pool := snapshotBatchFixture(t, 118)
	pool.delay = 50 * time.Millisecond
	start := make(chan struct{})
	errs := make(chan error, 118)
	var wg sync.WaitGroup
	for id := 1; id <= 118; id++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			<-start
			for sample := 0; sample < 5; sample++ {
				if err := PersistServerSnapshot(uint64(id), fmt.Sprint(id), sampleAt(100000+int64(sample)*1000)); err != nil {
					errs <- fmt.Errorf("server %d sample %d: %w", id, sample, err)
					return
				}
			}
		}(id)
	}
	started := time.Now()
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}
	var count int64
	require.NoError(t, DB.Model(&model.ServerSnapshot{}).Count(&count).Error)
	require.EqualValues(t, 590, count)
	require.Less(t, pool.commits.Load(), int64(60), "concurrent reports must share disk commits")
	t.Logf("590 samples with 50ms commit latency: %s, commits=%d", time.Since(started), pool.commits.Load())
}

func TestSnapshotBatchIsolatesReportFailure(t *testing.T) {
	pool := snapshotBatchFixture(t, 3)
	require.NoError(t, DB.Exec(`CREATE TRIGGER reject_checkpoint BEFORE INSERT ON plan_traffic_checkpoints
WHEN NEW.uuid = '2' BEGIN SELECT RAISE(ABORT, 'checkpoint rejected'); END`).Error)
	batch := []*snapshotWriteRequest{snapshotBatchRequest(t, 1, t.Context()), snapshotBatchRequest(t, 2, t.Context()), snapshotBatchRequest(t, 3, t.Context())}
	persistSnapshotBatch(batch)
	require.NoError(t, <-batch[0].result)
	require.ErrorContains(t, <-batch[1].result, "checkpoint rejected")
	require.NoError(t, <-batch[2].result)
	var snapshots []model.ServerSnapshot
	require.NoError(t, DB.Order("server_id").Find(&snapshots).Error)
	require.Len(t, snapshots, 2)
	require.EqualValues(t, 1, snapshots[0].ServerID)
	require.EqualValues(t, 3, snapshots[1].ServerID)
	var checkpoints []model.PlanTrafficCheckpoint
	require.NoError(t, DB.Order("uuid").Find(&checkpoints).Error)
	require.Len(t, checkpoints, 2)
	require.Equal(t, "1", checkpoints[0].UUID)
	require.Equal(t, "3", checkpoints[1].UUID)
	require.EqualValues(t, 1, pool.commits.Load())
}

func TestSnapshotBatchCommitFailureRollsBackAllReports(t *testing.T) {
	pool := snapshotBatchFixture(t, 2)
	commitErr := errors.New("injected disk commit failure")
	pool.before = func() error { return commitErr }
	batch := []*snapshotWriteRequest{snapshotBatchRequest(t, 1, t.Context()), snapshotBatchRequest(t, 2, t.Context())}
	for id := uint64(1); id <= 2; id++ {
		next := snapshotBatchRequest(t, id, t.Context())
		next.sample.At += 1000
		next.sample.State.NetOutTransfer += 50
		payload, err := json.Marshal(next.sample)
		require.NoError(t, err)
		next.payload = string(payload)
		batch = append(batch, next)
	}
	persistSnapshotBatch(batch)
	for _, request := range batch {
		require.ErrorIs(t, <-request.result, commitErr)
	}
	for _, table := range []string{"server_snapshots", "plan_traffic_checkpoints", "plan_traffic_days"} {
		var count int64
		require.NoError(t, DB.Table(table).Count(&count).Error)
		require.Zero(t, count, table)
	}
}

func TestSnapshotBatchSkipsExpiredReport(t *testing.T) {
	snapshotBatchFixture(t, 2)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	batch := []*snapshotWriteRequest{snapshotBatchRequest(t, 1, ctx), snapshotBatchRequest(t, 2, t.Context())}
	persistSnapshotBatch(batch)
	require.ErrorIs(t, <-batch[0].result, context.Canceled)
	require.NoError(t, <-batch[1].result)
	var rows []model.ServerSnapshot
	require.NoError(t, DB.Find(&rows).Error)
	require.Len(t, rows, 1)
	require.EqualValues(t, 2, rows[0].ServerID)
}

func TestSnapshotWaitsForCommitBeforeReturning(t *testing.T) {
	pool := snapshotBatchFixture(t, 1)
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	pool.before = func() error {
		close(entered)
		<-release
		return nil
	}
	done := make(chan error, 1)
	go func() { done <- PersistServerSnapshot(1, "1", sampleAt(100000)) }()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("commit was not reached")
	}
	select {
	case err := <-done:
		t.Fatalf("returned before commit completed: %v", err)
	default:
	}
	unblock()
	require.NoError(t, <-done)
	var count int64
	require.NoError(t, DB.Model(&model.ServerSnapshot{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
}

func TestSnapshotWriterQueueDeadlineLeavesNoRows(t *testing.T) {
	snapshotBatchFixture(t, 1)
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Millisecond)
	defer cancel()
	request := snapshotBatchRequest(t, 1, ctx)
	snapshotWriteGate <- struct{}{}
	defer func() { <-snapshotWriteGate }()
	writer := &snapshotBatchWriter{}
	require.ErrorIs(t, writer.persist(request), context.DeadlineExceeded)
	var count int64
	require.NoError(t, DB.Model(&model.ServerSnapshot{}).Count(&count).Error)
	require.Zero(t, count)
}

func TestSnapshotBatchTrafficCountsOnceAndRejectsWrongIdentity(t *testing.T) {
	pool := snapshotBatchFixture(t, 1)
	var batch []*snapshotWriteRequest
	for _, entry := range []struct {
		at   int64
		out  uint64
		uuid string
	}{
		{100000, 100, "1"},
		{101000, 150, "1"},
		{100000, 100, "1"}, // Replayed and out-of-order reports add no traffic.
		{101000, 150, "1"},
		{102000, 500, "old-identity"},
		{102000, 200, "1"},
	} {
		request := snapshotBatchRequest(t, 1, t.Context())
		request.uuid = entry.uuid
		request.sample.At = entry.at
		request.sample.State.NetOutTransfer = entry.out
		request.sample.State.Uptime = uint64(entry.at / 1000)
		payload, err := json.Marshal(request.sample)
		require.NoError(t, err)
		request.payload = string(payload)
		batch = append(batch, request)
	}
	persistSnapshotBatch(batch)
	for _, request := range batch {
		require.NoError(t, <-request.result)
	}
	var days []model.PlanTrafficDay
	require.NoError(t, DB.Find(&days).Error)
	require.Len(t, days, 1)
	require.EqualValues(t, 100, days[0].Out)
	var checkpoints []model.PlanTrafficCheckpoint
	require.NoError(t, DB.Find(&checkpoints).Error)
	require.Len(t, checkpoints, 1)
	require.EqualValues(t, 200, checkpoints[0].Out)
	var snapshots []model.ServerSnapshot
	require.NoError(t, DB.Find(&snapshots).Error)
	require.Len(t, snapshots, 3)
	require.EqualValues(t, 1, pool.commits.Load())
}
