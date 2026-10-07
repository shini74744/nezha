package controller

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/mattn/go-sqlite3"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestDetectionPersistenceRetriesOnlySQLiteContention(t *testing.T) {
	for _, code := range []sqlite3.ErrNo{sqlite3.ErrBusy, sqlite3.ErrLocked} {
		t.Run(code.Error(), func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				attempts := 0
				err := retryDetectionPersistence(context.Background(), func(context.Context) error {
					attempts++
					if attempts < 3 {
						return fmt.Errorf("wrapped: %w", sqlite3.Error{Code: code})
					}
					return nil
				})
				require.NoError(t, err)
				require.Equal(t, 3, attempts)
			})
		})
	}
	for _, err := range []error{sqlite3.Error{Code: sqlite3.ErrReadonly}, sqlite3.Error{Code: sqlite3.ErrFull}, errors.New("validation failed"), errDetectionIdentityChanged} {
		attempts := 0
		got := retryDetectionPersistence(context.Background(), func(context.Context) error { attempts++; return err })
		require.ErrorIs(t, got, err)
		require.Equal(t, 1, attempts)
	}
	require.True(t, sqliteContention(&sqlite3.Error{Code: sqlite3.ErrBusy}))
	require.False(t, sqliteContention(errors.New("database is locked")), "do not classify errors by text")
}

func TestDetectionPersistenceHasBoundedRetriesAndCancellation(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		attempts := 0
		err := retryDetectionPersistence(context.Background(), func(context.Context) error {
			attempts++
			return sqlite3.Error{Code: sqlite3.ErrBusy}
		})
		require.True(t, sqliteContention(err))
		require.Equal(t, 3, attempts)
		ctx, cancel := context.WithCancel(context.Background())
		attempts = 0
		err = retryDetectionPersistence(ctx, func(context.Context) error {
			attempts++
			cancel()
			return sqlite3.Error{Code: sqlite3.ErrBusy}
		})
		require.ErrorIs(t, err, context.Canceled)
		require.Equal(t, 1, attempts)
		started := time.Now()
		err = retryDetectionPersistence(context.Background(), func(ctx context.Context) error {
			<-ctx.Done()
			return ctx.Err()
		})
		require.ErrorIs(t, err, context.DeadlineExceeded)
		require.Equal(t, 20*time.Second, time.Since(started))
	})
}

func detectionPersistenceDB(t *testing.T, busyMS int) *gorm.DB {
	t.Helper()
	path := filepath.Join(t.TempDir(), "detection.db")
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("%s?_busy_timeout=%d", path, busyMS)), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	raw, err := db.DB()
	require.NoError(t, err)
	raw.SetMaxOpenConns(4)
	t.Cleanup(func() { require.NoError(t, raw.Close()) })
	require.NoError(t, db.AutoMigrate(&connectivity.Record{}, &connectivity.Policy{}, &networkinsight.Record{}))
	return db
}

func TestDetectionPersistenceSurvivesRealSQLiteWriteContention(t *testing.T) {
	for _, kind := range []string{"connectivity", "bgp", "streaming"} {
		t.Run(kind, func(t *testing.T) {
			db := detectionPersistenceDB(t, 100)
			tx := db.Begin()
			require.NoError(t, tx.Error)
			require.NoError(t, tx.Create(&connectivity.Policy{ID: 1, RetentionDays: 1}).Error)
			snapshot := connectivity.Snapshot{State: "complete", FinishedAt: 1000, ScheduledAt: 500, Full: true}
			record := networkinsight.Record{Identity: "node", Kind: kind, FinishedAt: 1000, ScheduledAt: 500, Payload: "{}"}
			attempted := make(chan struct{})
			var once sync.Once
			notify := func() { once.Do(func() { close(attempted) }) }
			save := func() error {
				if kind == "connectivity" {
					return persistConnectivityRecord(context.Background(), db, "node", snapshot, func() bool { notify(); return true })
				}
				return persistNetworkInsightRecord(context.Background(), db, record, func(*gorm.DB) error { notify(); return nil })
			}
			done := make(chan error, 1)
			go func() { done <- save() }()
			<-attempted
			time.Sleep(300 * time.Millisecond) // longer than the first SQLite busy timeout
			require.NoError(t, tx.Commit().Error)
			require.NoError(t, <-done)
			require.NoError(t, save(), "repeated delivery is idempotent")
			var count int64
			if kind == "connectivity" {
				require.NoError(t, db.Model(&connectivity.Record{}).Count(&count).Error)
				got, found, err := (connectivity.Store{DB: db}).Latest("node", 0)
				require.NoError(t, err)
				require.True(t, found)
				require.Equal(t, snapshot.FinishedAt, got.FinishedAt)
				require.Equal(t, snapshot.ScheduledAt, got.ScheduledAt)
				require.True(t, got.Full)
			} else {
				require.NoError(t, db.Model(&networkinsight.Record{}).Count(&count).Error)
				var got networkinsight.Record
				require.NoError(t, db.First(&got).Error)
				require.Equal(t, record.Payload, got.Payload)
				require.Equal(t, record.ScheduledAt, got.ScheduledAt)
			}
			require.EqualValues(t, 1, count)
		})
	}
}

func TestDetectionPersistenceRejectsStaleIdentityDuringRetry(t *testing.T) {
	db := detectionPersistenceDB(t, 50)
	tx := db.Begin()
	require.NoError(t, tx.Create(&connectivity.Policy{ID: 1, RetentionDays: 1}).Error)
	defer tx.Rollback()
	attempts := 0
	err := persistConnectivityRecord(context.Background(), db, "node", connectivity.Snapshot{State: "complete", FinishedAt: 1000}, func() bool {
		attempts++
		return attempts == 1
	})
	require.ErrorIs(t, err, errDetectionIdentityChanged)
	require.Equal(t, 2, attempts)
	record := networkinsight.Record{Identity: "node", Kind: "bgp", FinishedAt: 1000, Payload: "{}"}
	attempts = 0
	err = persistNetworkInsightRecord(context.Background(), db, record, func(*gorm.DB) error {
		attempts++
		if attempts == 1 {
			return nil
		}
		return errDetectionIdentityChanged
	})
	require.ErrorIs(t, err, errDetectionIdentityChanged)
	require.Equal(t, 2, attempts)
}

func TestDetectionPersistenceRecoversBeyondSQLiteDefaultBusyTimeout(t *testing.T) {
	db := detectionPersistenceDB(t, 5000)
	tx := db.Begin()
	require.NoError(t, tx.Create(&connectivity.Policy{ID: 1, RetentionDays: 1}).Error)
	t.Cleanup(func() { tx.Rollback() })
	var started sync.WaitGroup
	started.Add(2)
	results := make(chan error, 2)
	go func() {
		var once sync.Once
		results <- persistConnectivityRecord(context.Background(), db, "long-lock", connectivity.Snapshot{State: "complete", FinishedAt: 2000}, func() bool { once.Do(started.Done); return true })
	}()
	go func() {
		var once sync.Once
		results <- persistNetworkInsightRecord(context.Background(), db, networkinsight.Record{Identity: "long-lock", Kind: "bgp", FinishedAt: 2000, Payload: "{}"}, func(*gorm.DB) error { once.Do(started.Done); return nil })
	}()
	started.Wait()
	time.Sleep(6 * time.Second)
	require.NoError(t, tx.Commit().Error)
	require.NoError(t, <-results)
	require.NoError(t, <-results)
}

func TestNetworkInsightPersistenceConcurrentDeliveryDoesNotDuplicate(t *testing.T) {
	db := detectionPersistenceDB(t, 5000)
	record := networkinsight.Record{Identity: "same-batch", Kind: "streaming", FinishedAt: 3000, Payload: "{}"}
	results := make(chan error, 4)
	for range 4 {
		go func() {
			results <- persistNetworkInsightRecord(context.Background(), db, record, func(*gorm.DB) error { return nil })
		}()
	}
	for range 4 {
		require.NoError(t, <-results)
	}
	var count int64
	require.NoError(t, db.Model(&networkinsight.Record{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
}
