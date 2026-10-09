package connectivity

import (
	"context"
	"encoding/json"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestStoredResultsRestartIdentityExpiryAndPrivateURLs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.db")
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Record{}, &Policy{}))
	store := Store{db}
	p, err := store.Policy()
	require.NoError(t, err)
	require.Equal(t, DefaultPolicy(), p)
	m := NewManager()
	done := make(chan struct{})
	m.SetCompletionHandler(func(key string, s Snapshot) { require.NoError(t, store.Save(key, s)); close(done) })
	selected := Targets()[:2]
	_, err = m.Start("1:uuid:owner", func(context.Context, Target) Sample { return Sample{Status: "ok"} }, selected)
	require.NoError(t, err)
	<-done
	original := m.Get("1:uuid:owner", selected)
	sqlDB, _ := db.DB()
	require.NoError(t, sqlDB.Close())
	db, err = gorm.Open(sqlite.Open(path), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, _ = db.DB()
	defer sqlDB.Close()
	store.DB = db
	saved, ok, err := store.Latest("1:uuid:owner", 0)
	require.NoError(t, err)
	require.True(t, ok)
	reloaded := NewManager()
	reloaded.Restore("1:uuid:owner", saved)
	require.Equal(t, original, reloaded.Get("1:uuid:owner", selected))
	raw, _ := json.Marshal(saved)
	require.NotContains(t, string(raw), selected[0].URL)
	_, ok, err = store.Latest("1:uuid:new-owner", 0)
	require.NoError(t, err)
	require.False(t, ok)
	require.NoError(t, store.Prune(time.Now().Add(25*time.Hour), p))
	_, ok, err = store.Latest("1:uuid:owner", 0)
	require.NoError(t, err)
	require.False(t, ok)
	for _, bad := range []Policy{{IntervalHours: 0, RetentionDays: 1}, {IntervalHours: 25, RetentionDays: 1}, {IntervalHours: 2, RetentionDays: 0}, {IntervalHours: 2, RetentionDays: 31}} {
		require.Error(t, bad.Validate())
	}
}
func TestSingleTargetPreservesOtherResultsAndSharesLimits(t *testing.T) {
	m := NewManager()
	m.cooldown = 0
	selected := Targets()[:3]
	_, err := m.Start("node", func(context.Context, Target) Sample { return Sample{Status: "ok"} }, selected)
	require.NoError(t, err)
	require.Eventually(t, func() bool { return m.Get("node", selected).State == "complete" }, time.Second, time.Millisecond)
	before := m.Get("node", selected)
	var count atomic.Int32
	_, err = m.StartTarget("node", selected[1].ID, func(_ context.Context, target Target) Sample {
		require.Equal(t, selected[1].ID, target.ID)
		count.Add(1)
		return Sample{Status: "timeout"}
	}, selected)
	require.NoError(t, err)
	require.Eventually(t, func() bool { return m.Get("node", selected).State == "complete" }, time.Second, time.Millisecond)
	after := m.Get("node", selected)
	require.EqualValues(t, MeasuredRounds+WarmupRounds, count.Load())
	require.Equal(t, before.Results[0].Samples, after.Results[0].Samples)
	require.Equal(t, "timeout", after.Results[1].Status)
	require.Equal(t, before.Results[2].Samples, after.Results[2].Samples)
	require.False(t, after.Full)
	_, err = m.StartTarget("node", "missing", func(context.Context, Target) Sample { panic("must not run") }, selected)
	require.Error(t, err)
	expired := after
	expired.Results[0].CheckedAt = time.Now().Add(-25 * time.Hour).UnixMilli()
	require.Empty(t, retainSamples(expired, time.Now().Add(-24*time.Hour).UnixMilli()).Results[0].Samples)
}
func TestAutomaticScheduleIsBoundedRespectsIntervalAndPolicy(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 1, 0, 0, time.FixedZone("CST", 8*3600))
	p := DefaultPolicy()
	scheduler := Scheduler{}
	nodes := []Candidate{{Key: "a", ID: 8}, {Key: "b", ID: 16}}
	history := map[string]int64{}
	calls := []string{}
	last := func(key string) (int64, error) { return history[key], nil }
	start := func(n Candidate) error { calls = append(calls, n.Key); history[n.Key] = now.UnixMilli(); return nil }
	require.NoError(t, scheduler.Tick(now, p, nodes, last, start))
	require.Equal(t, []string{"a"}, calls)
	now = now.Add(15 * time.Second)
	require.NoError(t, scheduler.Tick(now, p, nodes, last, start))
	require.Equal(t, []string{"a", "b"}, calls)
	now = now.Add(time.Hour)
	require.NoError(t, scheduler.Tick(now, p, nodes, last, start))
	require.Len(t, calls, 2)
	// Reducing the interval must take effect without waiting for the previous timer.
	p.IntervalHours = 1
	require.NoError(t, scheduler.Tick(now, p, nodes, last, start))
	require.Len(t, calls, 3)
	p.Enabled = false
	now = now.Add(24 * time.Hour)
	require.NoError(t, scheduler.Tick(now, p, nodes, last, start))
	require.Len(t, calls, 3)
	p.Enabled = true
	require.NoError(t, scheduler.Tick(now, p, nil, last, start))
	require.Len(t, calls, 3)
	require.NoError(t, scheduler.Tick(now, p, nodes, last, func(Candidate) error { return ErrBusy }))
	require.Len(t, calls, 3)
	require.NoError(t, scheduler.Tick(now, p, nodes, last, start))
	require.Len(t, calls, 4)
}
func TestCustomCatalogNotOverwrittenByNewDefaults(t *testing.T) {
	items := []CatalogItem{{ID: "naver", Name: "my name", Group: "global", URL: "https://www.naver.com/favicon.ico", Icon: "naver", Enabled: false}}
	raw, _ := json.Marshal(items)
	parsed, err := ParseCatalog(string(raw))
	require.NoError(t, err)
	require.Equal(t, items, parsed)
	for _, region := range []string{"singapore", "malaysia", "indonesia", "korea", "uk", "germany", "france", "canada", "australia", "india", "brazil", "russia"} {
		items[0].Group = region
		require.NoError(t, ValidateCatalog(items))
	}
}
func TestStoredSingleResultDoesNotKeepExpiredSamples(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Record{}, &Policy{}))
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	now := time.Now()
	snapshot := empty(3, Targets()[:2])
	snapshot.State = "complete"
	snapshot.FinishedAt = now.UnixMilli()
	for i := range snapshot.Results {
		snapshot.Results[i].Samples = []Sample{{Status: "ok"}}
		snapshot.Results[i].Status = "ok"
		snapshot.Results[i].CheckedAt = now.UnixMilli()
	}
	snapshot.Results[0].CheckedAt = now.Add(-25 * time.Hour).UnixMilli()
	store := Store{DB: db}
	require.NoError(t, store.Save("node", snapshot))
	saved, ok, err := store.Latest("node", 0)
	require.NoError(t, err)
	require.True(t, ok)
	require.Empty(t, saved.Results[0].Samples)
	require.Len(t, saved.Results[1].Samples, 1)
}

func TestScheduledSlotPersistsAndDrivesRestartDeadline(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Record{}, &Policy{}))
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	slot := ClockSlot(time.Now(), 2).UnixMilli()
	snapshot := empty(3, Targets()[:1])
	snapshot.State = "complete"
	snapshot.Full = true
	snapshot.ScheduledAt = slot
	snapshot.StartedAt = slot + 30000
	snapshot.FinishedAt = slot + 127000
	store := Store{DB: db}
	require.NoError(t, store.Save("node", snapshot))
	saved, ok, err := store.Latest("node", 0)
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, slot, saved.ScheduledAt)
	require.Equal(t, snapshot.FinishedAt, saved.FinishedAt)
	last, err := store.LastFull("node")
	require.NoError(t, err)
	require.Equal(t, slot, last)
	// A newer manual result must not postpone the automatic clock.
	snapshot.ScheduledAt = 0
	snapshot.FinishedAt += 60000
	require.NoError(t, store.Save("node", snapshot))
	last, err = store.LastFull("node")
	require.NoError(t, err)
	require.Equal(t, slot, last)
}
