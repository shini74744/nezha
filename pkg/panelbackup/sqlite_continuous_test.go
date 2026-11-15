package panelbackup

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestSQLiteSnapshotCompletesWithContinuousWrites(t *testing.T) {
	for _, mode := range []string{"DELETE", "WAL"} {
		t.Run(mode, func(t *testing.T) {
			source, db := testSource(t)
			var actual string
			require.NoError(t, db.Raw("PRAGMA journal_mode="+mode).Scan(&actual).Error)
			require.NoError(t, db.Exec("CREATE TABLE snapshot_payload (id INTEGER PRIMARY KEY, payload BLOB)").Error)
			require.NoError(t, db.Transaction(func(tx *gorm.DB) error {
				for i := 0; i < 512; i++ {
					if e := tx.Exec("INSERT INTO snapshot_payload VALUES (?,randomblob(65536))", i).Error; e != nil {
						return e
					}
				}
				return nil
			}))
			stop := make(chan struct{})
			done := make(chan error, 1)
			var writes atomic.Int64
			go func() {
				tick := time.NewTicker(time.Millisecond)
				defer tick.Stop()
				for {
					select {
					case <-stop:
						done <- nil
						return
					case <-tick.C:
						n := writes.Load() + 1
						if e := db.Exec("UPDATE application_data SET value=? WHERE id=1", fmt.Sprintf("generation-%d", n)).Error; e != nil {
							done <- e
							return
						}
						writes.Add(1)
					}
				}
			}()
			stopWriter := sync.OnceFunc(func() { close(stop); require.NoError(t, <-done) })
			t.Cleanup(stopWriter)
			require.Eventually(t, func() bool { return writes.Load() > 0 }, 5*time.Second, time.Millisecond)
			before := writes.Load()
			destination := filepath.Join(t.TempDir(), "snapshot.db")
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			require.NoError(t, SQLiteSnapshot(ctx, source.Database, destination))
			require.Eventually(t, func() bool { return writes.Load() > before }, 5*time.Second, time.Millisecond)
			stopWriter()
			restored, e := gorm.Open(sqlite.Open(destination), &gorm.Config{})
			require.NoError(t, e)
			connection, e := restored.DB()
			require.NoError(t, e)
			defer connection.Close()
			var count int64
			require.NoError(t, restored.Raw("SELECT count(*) FROM snapshot_payload").Scan(&count).Error)
			require.Equal(t, int64(512), count)
			var value string
			require.NoError(t, restored.Raw("SELECT value FROM application_data WHERE id=1").Scan(&value).Error)
			require.Contains(t, value, "generation-")
			require.NoError(t, db.Raw("PRAGMA journal_mode").Scan(&actual).Error)
			require.Equal(t, mode, strings.ToUpper(actual))
		})
	}
}
