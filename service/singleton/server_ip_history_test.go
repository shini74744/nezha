package singleton

import (
	"fmt"
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestIPHistoryRetentionRestartAndIsolation(t *testing.T) {
	previousDB, previousConf, previousLoc := DB, Conf, Loc
	defer func() { DB = previousDB; Conf = previousConf; Loc = previousLoc }()
	Conf = &ConfigClass{Config: &model.Config{}}
	Loc = time.FixedZone("CST", 8*3600)
	path := filepath.Join(t.TempDir(), "history.db")
	var err error
	DB, err = gorm.Open(openSQLiteDialector(path), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := DB.DB()
	require.NoError(t, err)
	defer sqlDB.Close()
	require.NoError(t, DB.AutoMigrate(&model.Server{}, &model.ServerIPHistory{}))
	s := &model.Server{Common: model.Common{ID: 1, UserID: 10}, UUID: "history-one", Name: "one"}
	other := &model.Server{Common: model.Common{ID: 2, UserID: 20}, UUID: "history-two", Name: "two"}
	require.NoError(t, DB.Create(s).Error)
	require.NoError(t, DB.Create(other).Error)
	addr := func(i int) model.IP {
		return model.IP{IPv4Addr: fmt.Sprintf("192.0.2.%d", i), IPv6Addr: fmt.Sprintf("2001:db8::%d", i)}
	}
	at := time.Date(2026, 9, 28, 6, 0, 0, 0, time.UTC)
	_, h, changed, err := RecordServerIPChange(s, addr(1), at)
	require.NoError(t, err)
	require.False(t, changed)
	require.Empty(t, h)
	for i := 2; i <= 12; i++ {
		old, h, changed, err := RecordServerIPChange(s, addr(i), at.Add(time.Duration(i)*time.Minute))
		require.NoError(t, err)
		require.True(t, changed)
		require.Equal(t, addr(i-1), old)
		require.LessOrEqual(t, len(h), 7)
		require.Equal(t, addr(i-1), h[0].IP)
	}
	_, h, changed, err = RecordServerIPChange(s, addr(12), at)
	require.NoError(t, err)
	require.False(t, changed)
	require.Len(t, h, 7)
	require.Equal(t, addr(5), h[6].IP)
	require.Equal(t, at.Add(12*time.Minute), h[0].ChangedAt.UTC())
	_, _, changed, err = RecordServerIPChange(other, addr(90), at)
	require.NoError(t, err)
	require.False(t, changed)
	separate, err := ReadServerIPHistory(other.UUID)
	require.NoError(t, err)
	require.Empty(t, separate)
	// Reopen the actual SQLite file, with no previous runtime GeoIP.
	DB, err = gorm.Open(openSQLiteDialector(path), &gorm.Config{})
	require.NoError(t, err)
	reopened, err := DB.DB()
	require.NoError(t, err)
	defer reopened.Close()
	old, h, changed, err := RecordServerIPChange(&model.Server{Common: s.Common, UUID: s.UUID}, addr(13), at.Add(time.Hour))
	require.NoError(t, err)
	require.True(t, changed)
	require.Equal(t, addr(12), old)
	require.Len(t, h, 7)
	// Changing a visible server ID does not lose its UUID-associated history.
	require.NoError(t, DB.Model(s).Update("id", 3).Error)
	s.ID = 3
	old, h, changed, err = RecordServerIPChange(s, addr(14), at.Add(2*time.Hour))
	require.NoError(t, err)
	require.True(t, changed)
	require.Equal(t, addr(13), old)
	masked := FormatIPHistory(h)
	require.NotContains(t, masked, "192.0.2.13")
	require.Contains(t, masked, "2026-09-28 16:00:00 +0800")
	Conf.EnablePlainIPInNotification = true
	require.Contains(t, FormatIPHistory(h), "192.0.2.13/2001:db8::13")
	// Concurrent duplicate reports produce one transition, not seven duplicates.
	var wg sync.WaitGroup
	var changes atomic.Int32
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, c, e := RecordServerIPChange(s, addr(15), at)
			if e == nil && c {
				changes.Add(1)
			}
		}()
	}
	wg.Wait()
	require.Equal(t, int32(1), changes.Load())
	_, _, changed, err = RecordServerIPChange(s, model.IP{}, at)
	require.NoError(t, err)
	require.False(t, changed)
	require.NoError(t, DB.Delete(s).Error)
	_, _, changed, err = RecordServerIPChange(s, addr(16), at)
	require.ErrorIs(t, err, gorm.ErrRecordNotFound)
	require.False(t, changed)
}
func TestIPHistoryRuntimeBaselineIsPersisted(t *testing.T) {
	prev := DB
	defer func() { DB = prev }()
	var err error
	DB, err = gorm.Open(openSQLiteDialector(filepath.Join(t.TempDir(), "history.db")), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, _ := DB.DB()
	defer sqlDB.Close()
	require.NoError(t, DB.AutoMigrate(&model.Server{}, &model.ServerIPHistory{}))
	ip := model.IP{IPv6Addr: "2001:db8::1"}
	s := &model.Server{Common: model.Common{ID: 1}, UUID: "runtime", GeoIP: &model.GeoIP{IP: ip}}
	require.NoError(t, DB.Create(s).Error)
	_, _, changed, err := RecordServerIPChange(s, ip, time.Now())
	require.NoError(t, err)
	require.False(t, changed)
	var row model.ServerIPHistory
	require.NoError(t, DB.First(&row, "server_uuid = ?", s.UUID).Error)
	require.Equal(t, ip, row.CurrentIP)
	s.GeoIP = nil
	old, h, changed, err := RecordServerIPChange(s, model.IP{IPv6Addr: "2001:db8::2"}, time.Now())
	require.NoError(t, err)
	require.True(t, changed)
	require.Equal(t, ip, old)
	require.Len(t, h, 1)
}

func TestIPHistoryDeletedWithServer(t *testing.T) {
	setupPermanentDeleteTest(t)
	require.NoError(t, DB.AutoMigrate(&model.ServerIPHistory{}))
	s := &model.Server{Common: model.Common{ID: 11, UserID: 1}, UUID: "history-delete"}
	require.NoError(t, DB.Create(s).Error)
	require.NoError(t, DB.Create(&model.ServerIPHistory{ServerUUID: s.UUID, CurrentIP: model.IP{IPv4Addr: "192.0.2.1"}}).Error)
	require.NoError(t, PermanentlyDeleteServers([]uint64{11}))
	var count int64
	require.NoError(t, DB.Model(&model.ServerIPHistory{}).Where("server_uuid = ?", s.UUID).Count(&count).Error)
	require.Zero(t, count)
}

func TestIPHistoryRetriesRealSQLiteWriterContention(t *testing.T) {
	prev := DB
	defer func() { DB = prev }()
	var err error
	DB, err = gorm.Open(openSQLiteDialector(filepath.Join(t.TempDir(), "busy.db")+"?_busy_timeout=0"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, _ := DB.DB()
	defer sqlDB.Close()
	require.NoError(t, DB.AutoMigrate(&model.Server{}, &model.ServerIPHistory{}))
	s := &model.Server{Common: model.Common{ID: 1}, UUID: "busy-server"}
	require.NoError(t, DB.Create(s).Error)
	_, _, _, err = RecordServerIPChange(s, model.IP{IPv4Addr: "192.0.2.1"}, time.Now())
	require.NoError(t, err)
	writer, err := sqlDB.Begin()
	require.NoError(t, err)
	_, err = writer.Exec("UPDATE servers SET name='busy' WHERE id=1")
	require.NoError(t, err)
	done := make(chan error, 1)
	go func() { time.Sleep(80 * time.Millisecond); done <- writer.Commit() }()
	old, h, changed, err := RecordServerIPChange(s, model.IP{IPv4Addr: "192.0.2.2"}, time.Now())
	require.NoError(t, <-done)
	require.NoError(t, err)
	require.True(t, changed)
	require.Equal(t, "192.0.2.1", old.IPv4Addr)
	require.Len(t, h, 1)
}
func TestIPHistoryDoesNotRetryPermanentErrors(t *testing.T) {
	calls := 0
	err := retryIPHistoryWrite(func() error { calls++; return fmt.Errorf("permanent error") })
	require.Error(t, err)
	require.Equal(t, 1, calls)
}
