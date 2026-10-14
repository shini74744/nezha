package latency

import (
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"net"
	"testing"
	"time"
)

func TestDefaultCatalogAndValidation(t *testing.T) {
	s := Defaults()
	require.False(t, s.Enabled)
	require.Len(t, s.Targets, 93)
	require.NoError(t, s.Validate())
	require.Len(t, s.Probes(), 93)
	regions, provinces := map[string]bool{}, map[string]bool{}
	for _, v := range s.Targets {
		regions[v.Region] = true
		provinces[v.Province] = true
		require.Equal(t, 80, v.Port)
	}
	require.Len(t, regions, 7)
	require.Len(t, provinces, 31)
	for _, host := range []string{"127.0.0.1", "169.254.169.254", "10.0.0.1", "::1", "100.64.1.1", "https://example.com", "a.local", "a.com/x", "a.com;ls"} {
		s = Defaults()
		s.Targets[0].Host = host
		require.Error(t, s.Validate(), host)
	}
	for _, host := range []string{"8.8.8.8", "2606:4700:4700::1111", "example.com"} {
		s = Defaults()
		s.Targets[0].Host = host
		require.NoError(t, s.Validate(), host)
	}
	for _, value := range []int{0, 25} {
		s = Defaults()
		s.IntervalHours = value
		require.Error(t, s.Validate())
	}
	s = Defaults()
	s.Targets[1].ID = s.Targets[0].ID
	require.Error(t, s.Validate())
	s = Defaults()
	s.Targets[0].Enabled = false
	require.Len(t, s.Probes(), 92)
	require.False(t, PublicIP(net.ParseIP("::ffff:127.0.0.1")))
}
func TestStoreIdentityRetentionAndIndependentPolicy(t *testing.T) {
	db, e := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, e)
	require.NoError(t, db.AutoMigrate(&Settings{}, &Record{}, &connectivity.Record{}, &connectivity.Policy{}))
	s, e := Read(db)
	require.NoError(t, e)
	require.False(t, s.Enabled)
	target := s.Probes()[0]
	delay := 42.0
	snapshot := connectivity.Snapshot{State: "complete", Full: true, ScheduledAt: time.Now().Add(-time.Minute).UnixMilli(), FinishedAt: time.Now().UnixMilli(), Results: []connectivity.Result{{Target: target, Status: "ok", DelayMS: &delay}}}
	require.NoError(t, Save(db, "1:test:9", snapshot))
	require.NoError(t, Save(db, "1:test:9", snapshot))
	var count int64
	require.NoError(t, db.Model(&Record{}).Count(&count).Error)
	require.EqualValues(t, 1, count)
	got, ok, e := Latest(db, "1:test:9", 1)
	require.NoError(t, e)
	require.True(t, ok)
	require.Equal(t, target.URL, got.Results[0].URL)
	_, ok, e = Latest(db, "1:replacement:9", 1)
	require.NoError(t, e)
	require.False(t, ok)
	_, ok, e = Latest(db, "1:test:10", 1)
	require.NoError(t, e)
	require.False(t, ok)
	require.NoError(t, (connectivity.Store{DB: db}).Prune(time.Now().Add(48*time.Hour), connectivity.DefaultPolicy()))
	_, ok, e = Latest(db, "1:test:9", 1)
	require.NoError(t, e)
	require.True(t, ok)
	require.NoError(t, db.Model(&Record{}).Where("id > 0").Update("finished_at", time.Now().Add(-48*time.Hour).UnixMilli()).Error)
	_, ok, e = Latest(db, "1:test:9", 1)
	require.NoError(t, e)
	require.False(t, ok)
}

func TestDualStackTargetsPreserveLegacyAndExplicitOverrides(t *testing.T) {
	s := Defaults()
	both := s.Probes([]string{"IPv4", "IPv6"})
	require.Len(t, both, 186)
	require.Equal(t, "IPv4", both[0].Family)
	require.Equal(t, "IPv6", both[1].Family)
	require.Equal(t, "ah-ct@IPv6", both[1].ID)
	require.Equal(t, "ah-ct-v6.ip.zstaticcdn.com:80", both[1].URL)
	require.Equal(t, s.Probes()[0], both[0])
	require.Len(t, s.Probes([]string{"IPv6"}), 93)
	empty := ""
	s.Targets[0].IPv6Host = &empty
	require.Len(t, s.Probes([]string{"IPv6"}), 92)
	require.NoError(t, s.Validate())
	for _, bad := range []string{"127.0.0.1", "8.8.8.8", "fc00::1", "::1", "https://example.com", "foo.local", "a.com/x"} {
		s.Targets[0].IPv6Host = &bad
		require.Error(t, s.Validate(), bad)
	}
	good := "2606:4700:4700::1111"
	s.Targets[0].IPv6Host = &good
	require.NoError(t, s.Validate())
	require.Equal(t, "[2606:4700:4700::1111]:80", s.Probes([]string{"IPv6"})[0].URL)
	s.Targets[0].IPv6Host = nil
	s.Targets[0].Host = "custom.example.com"
	require.Empty(t, s.Targets[0].IPv6Address())
	require.Len(t, s.Probes([]string{"IPv4", "IPv6"}), 185)
}

func TestLegacyIPv6LiteralCatalogRemainsUsable(t *testing.T) {
	s := Defaults()
	s.Targets = s.Targets[:1]
	s.Targets[0].Host = "2606:4700:4700::1111"
	require.NoError(t, s.Validate())
	require.Empty(t, s.Probes([]string{"IPv4"}))
	got := s.Probes([]string{"IPv4", "IPv6"})
	require.Len(t, got, 1)
	require.Equal(t, "IPv6", got[0].Family)
	require.Equal(t, "[2606:4700:4700::1111]:80", got[0].URL)
}

func TestOnlyAutomaticRunsAreRetainedAndRestored(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Record{}))
	now := time.Now().UnixMilli()
	key := "1:automatic-only:9"
	manual := connectivity.Snapshot{State: "complete", Full: true, FinishedAt: now}
	require.NoError(t, Save(db, key, manual))
	var count int64
	require.NoError(t, db.Model(&Record{}).Count(&count).Error)
	require.Zero(t, count)
	automatic := manual
	automatic.ScheduledAt = now - 1000
	require.NoError(t, Save(db, key, automatic))
	// Old manual rows must never be restored even before one-off cleanup.
	var row Record
	require.NoError(t, db.First(&row).Error)
	row.ID, row.ScheduledAt, row.FinishedAt = 0, 0, now+1
	require.NoError(t, db.Create(&row).Error)
	got, ok, err := Latest(db, key, 1)
	require.NoError(t, err)
	require.True(t, ok)
	require.Equal(t, automatic.FinishedAt, got.FinishedAt)
	require.Equal(t, automatic.ScheduledAt, got.ScheduledAt)
	manual.FinishedAt = now + 2
	require.NoError(t, Save(db, key, manual))
	require.NoError(t, db.Model(&Record{}).Count(&count).Error)
	require.EqualValues(t, 2, count)
}
