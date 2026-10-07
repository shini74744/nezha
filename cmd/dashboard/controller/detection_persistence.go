package controller

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/mattn/go-sqlite3"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/networkinsight"
	"gorm.io/gorm"
)

var errDetectionIdentityChanged = errors.New("detection identity changed or disabled")

// Retry only transient SQLite contention, with a deadline independent of the
// completed network probe. Never rerun probes or retry permanent write failures.
func retryDetectionPersistence(parent context.Context, save func(context.Context) error) error {
	ctx, cancel := context.WithTimeout(parent, 20*time.Second)
	defer cancel()
	delays := [...]time.Duration{250 * time.Millisecond, time.Second}
	for attempt := 0; ; attempt++ {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := save(ctx)
		if err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if !sqliteContention(err) || attempt == len(delays) {
			return fmt.Errorf("save detection after %d attempt(s): %w", attempt+1, err)
		}
		timer := time.NewTimer(delays[attempt])
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

func sqliteContention(err error) bool {
	var value sqlite3.Error
	if errors.As(err, &value) {
		return value.Code == sqlite3.ErrBusy || value.Code == sqlite3.ErrLocked
	}
	var pointer *sqlite3.Error
	return errors.As(err, &pointer) && pointer != nil &&
		(pointer.Code == sqlite3.ErrBusy || pointer.Code == sqlite3.ErrLocked)
}

// One completed snapshot has one identity even if a write is retried. A single
// conditional INSERT is atomic and avoids a deferred read-to-write transaction
// upgrade (which can fail immediately instead of observing SQLite's busy timeout).
func persistNetworkInsightRecord(ctx context.Context, db *gorm.DB, record networkinsight.Record, validate func(*gorm.DB) error) error {
	return retryDetectionPersistence(ctx, func(attempt context.Context) error {
		database := db.WithContext(attempt)
		if err := validate(database); err != nil {
			return err
		}
		return database.Exec(
			"INSERT INTO network_insight_records (identity, kind, finished_at, scheduled_at, payload) "+
				"SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS "+
				"(SELECT 1 FROM network_insight_records WHERE identity = ? AND kind = ? AND finished_at = ?)",
			record.Identity, record.Kind, record.FinishedAt, record.ScheduledAt, record.Payload,
			record.Identity, record.Kind, record.FinishedAt,
		).Error
	})
}

func persistConnectivityRecord(ctx context.Context, db *gorm.DB, key string, snapshot connectivity.Snapshot, valid func() bool) error {
	return retryDetectionPersistence(ctx, func(attempt context.Context) error {
		if !valid() {
			return errDetectionIdentityChanged
		}
		return (connectivity.Store{DB: db.WithContext(attempt)}).Save(key, snapshot)
	})
}
