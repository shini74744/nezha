//go:build linux

package dashboard

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestIsolatedDatabaseDisablesOnlyFixtureAutomation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "dashboard.sqlite")
	require.NoError(t, prepareIsolatedDatabase(path))
	info, err := os.Stat(path)
	require.NoError(t, err)
	require.Equal(t, os.FileMode(0600), info.Mode().Perm())
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	require.NoError(t, err)
	raw, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, raw.Close()) })
	connectivityPolicy, err := (connectivity.Store{DB: db}).Policy()
	require.NoError(t, err)
	require.False(t, connectivityPolicy.Enabled)
	require.NoError(t, connectivityPolicy.Validate())
	require.Equal(t, connectivity.DefaultPolicy().IntervalHours, connectivityPolicy.IntervalHours)
	bgpPolicy, err := networkinsight.ReadBGPPolicy(db)
	require.NoError(t, err)
	require.False(t, bgpPolicy.Enabled)
	require.NoError(t, bgpPolicy.Validate())
	require.Equal(t, networkinsight.DefaultBGPPolicy().IntervalHours, bgpPolicy.IntervalHours)
	require.True(t, connectivity.DefaultPolicy().Enabled, "production defaults must not change")
	require.True(t, networkinsight.DefaultBGPPolicy().Enabled)
}

func TestIsolatedDatabaseNeverOverwritesAnExistingFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "existing.sqlite")
	require.NoError(t, os.WriteFile(path, []byte("preserve"), 0600))
	require.ErrorIs(t, prepareIsolatedDatabase(path), os.ErrExist)
	content, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, "preserve", string(content))
	require.Error(t, prepareIsolatedDatabase(filepath.Join(t.TempDir(), "missing", "dashboard.sqlite")))
}
