package singleton

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/mattn/go-sqlite3"
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func lockTestDB(t *testing.T) (*gorm.DB, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "write-lock.sqlite")
	db, err := gorm.Open(openSQLiteDialector(path), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	pool, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, pool.Close()) })
	require.NoError(t, db.AutoMigrate(&model.Server{}, &model.ServerOperationLog{}, &model.ServerInventoryBaseline{}, &model.ServerIPHistory{}, &model.ServerSnapshot{}, &model.PlanTrafficCheckpoint{}, &model.PlanTrafficDay{}))
	require.NoError(t, db.Create(&model.Server{Common: model.Common{ID: 1}, UUID: "lock-test", Name: "before"}).Error)
	return db, path
}

// An independent connection must not be able to take the writer reservation
// between our baseline read and history INSERT (the production failure).
func TestSQLiteTransactionReservesWriterBeforeReading(t *testing.T) {
	db, path := lockTestDB(t)
	external, err := sql.Open("sqlite3", path+"?_busy_timeout=0")
	require.NoError(t, err)
	defer external.Close()
	conn, err := external.Conn(context.Background())
	require.NoError(t, err)
	defer conn.Close()
	var reservationErr error
	require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
		var server model.Server
		if err := tx.First(&server, 1).Error; err != nil {
			return err
		}
		_, reservationErr = conn.ExecContext(context.Background(), "BEGIN IMMEDIATE")
		if reservationErr == nil {
			if _, err := conn.ExecContext(context.Background(), "ROLLBACK"); err != nil {
				return err
			}
		}
		return model.RecordServerInventory(tx, &server, map[string]string{"disk_total": "100"})
	}))
	var busy sqlite3.Error
	require.ErrorAs(t, reservationErr, &busy, "another writer acquired the reservation after the history baseline read")
	require.Equal(t, sqlite3.ErrBusy, busy.Code)
	var rows int64
	require.NoError(t, db.Model(&model.ServerOperationLog{}).Count(&rows).Error)
	require.EqualValues(t, 1, rows)
}

func TestSQLiteWriteDSNPreservesOptions(t *testing.T) {
	for _, path := range []string{
		"/tmp/with spaces 中文.sqlite",
		"file:/tmp/db.sqlite?cache=private&_busy_timeout=73&_foreign_keys=on",
		":memory:",
		"file:shared?mode=memory&cache=shared&_timeout=19&_txlock=deferred",
	} {
		dsn := sqliteWriteDSN(path)
		name, query, _ := strings.Cut(dsn, "?")
		original, oldQuery, _ := strings.Cut(path, "?")
		require.Equal(t, original, name)
		params, err := url.ParseQuery(query)
		require.NoError(t, err)
		old, err := url.ParseQuery(oldQuery)
		require.NoError(t, err)
		old.Set("_txlock", "immediate")
		require.Equal(t, old, params)
		require.Equal(t, dsn, sqliteWriteDSN(dsn))
	}
	require.Equal(t, "file:bad?x=%xx", sqliteWriteDSN("file:bad?x=%xx"))
}

func TestSQLiteWriterReservationStillAllowsReads(t *testing.T) {
	db, _ := lockTestDB(t)
	tx := db.Begin()
	require.NoError(t, tx.Error)
	defer tx.Rollback()
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	var server model.Server
	require.NoError(t, db.WithContext(ctx).First(&server, 1).Error)
	require.Equal(t, "before", server.Name)
	var mode string
	require.NoError(t, db.Raw("PRAGMA journal_mode").Scan(&mode).Error)
	require.Equal(t, "delete", mode, "do not change database format/journal settings")
}

func TestSQLiteHistoryWaitsForExistingWriter(t *testing.T) {
	db, path := lockTestDB(t)
	prev := DB
	DB = db
	t.Cleanup(func() { DB = prev })
	require.NoError(t, RecordServerInventory(1, "lock-test", map[string]string{"disk_total": "100"}))
	external, err := sql.Open("sqlite3", path)
	require.NoError(t, err)
	defer external.Close()
	tx, err := external.Begin()
	require.NoError(t, err)
	defer tx.Rollback()
	_, err = tx.Exec("UPDATE servers SET name='external' WHERE id=1")
	require.NoError(t, err)
	done := make(chan error, 1)
	go func() { done <- RecordServerInventory(1, "lock-test", map[string]string{"disk_total": "200"}) }()
	select {
	case err := <-done:
		t.Fatalf("history returned while writer still held its reservation: %v", err)
	case <-time.After(80 * time.Millisecond):
	}
	require.NoError(t, tx.Commit())
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("history did not recover after writer commit")
	}
	var rows []model.ServerOperationLog
	require.NoError(t, db.Order("id").Find(&rows).Error)
	require.Len(t, rows, 2)
	require.Equal(t, []model.ServerOperationChange{{Field: "disk_total", Before: "100", After: "200"}}, rows[1].Changes)
}

// A failure after the history INSERT must undo it as well as the baseline.
// Retrying the next report must record exactly one complete transition.
func TestSQLiteHistoryBaselineFailureRollsBackWithoutLoss(t *testing.T) {
	db, _ := lockTestDB(t)
	prev := DB
	DB = db
	t.Cleanup(func() { DB = prev })
	require.NoError(t, RecordServerInventory(1, "lock-test", map[string]string{"disk_total": "100"}))
	require.NoError(t, db.Exec("CREATE TRIGGER reject_baseline BEFORE UPDATE ON server_inventory_baselines BEGIN SELECT RAISE(ABORT,'injected baseline failure'); END").Error)
	require.ErrorContains(t, RecordServerInventory(1, "lock-test", map[string]string{"disk_total": "200"}), "injected baseline failure")
	var count int64
	require.NoError(t, db.Model(&model.ServerOperationLog{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
	var baseline model.ServerInventoryBaseline
	require.NoError(t, db.First(&baseline).Error)
	require.Equal(t, "100", baseline.Values["disk_total"])
	require.NoError(t, db.Exec("DROP TRIGGER reject_baseline").Error)
	require.NoError(t, RecordServerInventory(1, "lock-test", map[string]string{"disk_total": "200"}))
	require.NoError(t, RecordServerInventory(1, "lock-test", map[string]string{"disk_total": "200"}))
	require.NoError(t, db.Model(&model.ServerOperationLog{}).Count(&count).Error)
	require.EqualValues(t, 2, count)
}

type sqliteLockCounter struct {
	logger.Interface
	locks atomic.Int64
}

func (l *sqliteLockCounter) Trace(ctx context.Context, at time.Time, fc func() (string, int64), err error) {
	if err != nil && strings.Contains(strings.ToLower(err.Error()), "locked") {
		l.locks.Add(1)
	}
}

// Mix actual history/operation/IP writers with the 118-node snapshot batch
// queue. Verify every transition, exact traffic totals, old rows and reopen.
func TestSQLiteMixedFleetWritesPreserveHistory(t *testing.T) {
	db, path := lockTestDB(t)
	prev := DB
	DB = db
	t.Cleanup(func() { DB = prev })
	counter := &sqliteLockCounter{Interface: logger.Default.LogMode(logger.Silent)}
	db.Config.Logger = counter
	for id := 2; id <= 118; id++ {
		require.NoError(t, db.Create(&model.Server{Common: model.Common{ID: uint64(id)}, UUID: fmt.Sprintf("fleet-%d", id), Name: "before"}).Error)
	}
	uuid := func(id int) string {
		if id == 1 {
			return "lock-test"
		}
		return fmt.Sprintf("fleet-%d", id)
	}
	for id := 1; id <= 8; id++ {
		require.NoError(t, RecordServerInventory(uint64(id), uuid(id), map[string]string{"disk_total": "0", "ipv4": "192.0.2.1", "ipv6": "2001:db8::1"}))
	}
	var oldRows []model.ServerOperationLog
	require.NoError(t, db.Order("id").Find(&oldRows).Error)
	oldJSON, err := json.Marshal(oldRows)
	require.NoError(t, err)
	start := make(chan struct{})
	errs := make(chan error, 400)
	var wg sync.WaitGroup
	run := func(f func() error) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			if err := f(); err != nil {
				errs <- err
			}
		}()
	}
	for id := 1; id <= 118; id++ {
		run(func() error {
			for step := 0; step < 5; step++ {
				sample := sampleAt(100000 + int64(step)*1000)
				sample.State.NetInTransfer = 0
				sample.State.NetOutTransfer = uint64(100 + step*50)
				sample.State.Uptime = uint64(100 + step)
				if err := PersistServerSnapshot(uint64(id), uuid(id), sample); err != nil {
					return fmt.Errorf("snapshot %d/%d: %w", id, step, err)
				}
			}
			return nil
		})
	}
	for id := 1; id <= 8; id++ {
		run(func() error {
			for step := 1; step <= 10; step++ {
				if err := RecordServerInventory(uint64(id), uuid(id), map[string]string{"disk_total": fmt.Sprint(step)}); err != nil {
					return err
				}
			}
			return nil
		})
		run(func() error {
			for step := 1; step <= 10; step++ {
				if err := model.WithServerOperation(db, model.ServerOperationActor{Name: "test", Source: "test"}, "edit", []uint64{uint64(id)}, func(tx *gorm.DB) error {
					return tx.Model(&model.Server{}).Where("id=?", id).Update("public_note", fmt.Sprintf("note-%d", step)).Error
				}); err != nil {
					return err
				}
			}
			return nil
		})
		run(func() error {
			server := &model.Server{Common: model.Common{ID: uint64(id)}, UUID: uuid(id)}
			for step := 1; step <= 5; step++ {
				_, _, _, err := RecordServerIPChange(server, model.IP{IPv4Addr: fmt.Sprintf("192.0.2.%d", step), IPv6Addr: "2001:db8::1"}, time.Unix(100+int64(step), 0))
				if err != nil {
					return err
				}
			}
			return nil
		})
	}
	started := time.Now()
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}
	require.Zero(t, counter.locks.Load(), "do not just hide/retry the original contention")
	reopened, err := gorm.Open(openSQLiteDialector(path), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	pool, err := reopened.DB()
	require.NoError(t, err)
	defer pool.Close()
	var oldAgain []model.ServerOperationLog
	require.NoError(t, reopened.Where("id<=?", oldRows[len(oldRows)-1].ID).Order("id").Find(&oldAgain).Error)
	oldAgainJSON, err := json.Marshal(oldAgain)
	require.NoError(t, err)
	require.Equal(t, string(oldJSON), string(oldAgainJSON), "pre-existing history must be unchanged")
	var snapshots int64
	require.NoError(t, reopened.Model(&model.ServerSnapshot{}).Count(&snapshots).Error)
	require.EqualValues(t, 590, snapshots)
	var traffic uint64
	require.NoError(t, reopened.Model(&model.PlanTrafficDay{}).Select("SUM(out)").Scan(&traffic).Error)
	require.EqualValues(t, 118*200, traffic, "traffic is counted once, without losing samples")
	var allRows int64
	require.NoError(t, reopened.Model(&model.ServerOperationLog{}).Count(&allRows).Error)
	require.EqualValues(t, 8+80+80, allRows)
	for id := 1; id <= 8; id++ {
		var changes []model.ServerOperationLog
		require.NoError(t, reopened.Where("server_uuid=? AND action='inventory_change'", uuid(id)).Order("id").Find(&changes).Error)
		require.Len(t, changes, 10)
		for index, row := range changes {
			require.Equal(t, []model.ServerOperationChange{{Field: "disk_total", Before: fmt.Sprint(index), After: fmt.Sprint(index + 1)}}, row.Changes)
		}
		var edits []model.ServerOperationLog
		require.NoError(t, reopened.Where("server_uuid=? AND action='edit'", uuid(id)).Order("id").Find(&edits).Error)
		require.Len(t, edits, 10)
		for index, row := range edits {
			before := ""
			if index > 0 {
				before = fmt.Sprintf("note-%d", index)
			}
			require.NotNil(t, row.Details)
			require.Equal(t, &model.ServerOperationTextSnapshot{Before: before, After: fmt.Sprintf("note-%d", index+1)}, row.Details.PublicNote)
		}
		var ips model.ServerIPHistory
		require.NoError(t, reopened.First(&ips, "server_uuid=?", uuid(id)).Error)
		require.Len(t, ips.History, 4)
		require.Equal(t, "192.0.2.5", ips.CurrentIP.IPv4Addr)
		require.Equal(t, "2001:db8::1", ips.CurrentIP.IPv6Addr)
	}
	var integrity string
	require.NoError(t, reopened.Raw("PRAGMA integrity_check").Scan(&integrity).Error)
	require.Equal(t, "ok", integrity)
	t.Logf("118 nodes: 590 snapshots + 168 operation rows + 40 IP reports, no lock errors, elapsed=%s", time.Since(started))
}

func TestSQLiteHistoryRetriesCommitBlockedByExternalReader(t *testing.T) {
	db, path := lockTestDB(t)
	prev := DB
	DB = db
	t.Cleanup(func() { DB = prev })
	require.NoError(t, RecordServerInventory(1, "lock-test", map[string]string{"disk_total": "100"}))
	short, err := gorm.Open(openSQLiteDialector(path+"?_busy_timeout=30"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	pool, err := short.DB()
	require.NoError(t, err)
	defer pool.Close()
	DB = short
	reader, err := sql.Open("sqlite3", path)
	require.NoError(t, err)
	defer reader.Close()
	tx, err := reader.Begin()
	require.NoError(t, err)
	defer tx.Rollback()
	var name string
	require.NoError(t, tx.QueryRow("SELECT name FROM servers WHERE id=1").Scan(&name))
	done := make(chan error, 1)
	go func() { done <- RecordServerInventory(1, "lock-test", map[string]string{"disk_total": "200"}) }()
	select {
	case err := <-done:
		t.Fatalf("history completed before shared reader released: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	require.NoError(t, tx.Commit())
	select {
	case err := <-done:
		require.NoError(t, err)
	case <-time.After(2 * time.Second):
		t.Fatal("commit retries did not recover")
	}
	var rows []model.ServerOperationLog
	require.NoError(t, db.Order("id").Find(&rows).Error)
	require.Len(t, rows, 2, "failed commits must not duplicate or drop history")
	require.Equal(t, []model.ServerOperationChange{{Field: "disk_total", Before: "100", After: "200"}}, rows[1].Changes)
	var baseline model.ServerInventoryBaseline
	require.NoError(t, db.First(&baseline).Error)
	require.Equal(t, "200", baseline.Values["disk_total"])
}

func TestSQLiteCancelledHistoryTransactionLeavesNoPartialRows(t *testing.T) {
	db, _ := lockTestDB(t)
	prev := DB
	DB = db
	t.Cleanup(func() { DB = prev })
	require.NoError(t, RecordServerInventory(1, "lock-test", map[string]string{"disk_total": "100"}))
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var server model.Server
		if err := tx.First(&server, 1).Error; err != nil {
			return err
		}
		if err := model.RecordServerInventory(tx, &server, map[string]string{"disk_total": "200"}); err != nil {
			return err
		}
		cancel()
		return nil
	})
	require.Error(t, err)
	require.NoError(t, RecordServerInventory(1, "lock-test", map[string]string{"disk_total": "200"}))
	var rows []model.ServerOperationLog
	require.NoError(t, db.Order("id").Find(&rows).Error)
	require.Len(t, rows, 2)
	require.Equal(t, []model.ServerOperationChange{{Field: "disk_total", Before: "100", After: "200"}}, rows[1].Changes)
}
