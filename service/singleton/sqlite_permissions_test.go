package singleton

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func requirePrivateSQLiteFile(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	require.NoError(t, err)
	require.True(t, info.Mode().IsRegular())
	if runtime.GOOS != "windows" {
		require.Equal(t, os.FileMode(0600), info.Mode().Perm())
	}
}

func TestPrepareSQLiteFilesCreatesPrivateDatabase(t *testing.T) {
	dir := t.TempDir()
	before, err := os.Stat(dir)
	require.NoError(t, err)
	path := filepath.Join(dir, "sqlite.db")
	require.NoError(t, prepareSQLiteFiles(path))
	requirePrivateSQLiteFile(t, path)
	after, err := os.Stat(dir)
	require.NoError(t, err)
	require.Equal(t, before.Mode(), after.Mode(), "do not change asset directory permissions")
	for _, suffix := range []string{"-journal", "-wal", "-shm"} {
		_, err := os.Stat(path + suffix)
		require.ErrorIs(t, err, os.ErrNotExist, "do not manufacture sidecars")
	}
}

func TestPrepareSQLiteFilesSecuresExistingFilesWithoutChangingContents(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sqlite.db")
	for _, suffix := range []string{"", "-journal", "-wal", "-shm"} {
		require.NoError(t, os.WriteFile(path+suffix, []byte("preserve "+suffix), 0644))
	}
	require.NoError(t, prepareSQLiteFiles(path))
	for _, suffix := range []string{"", "-journal", "-wal", "-shm"} {
		requirePrivateSQLiteFile(t, path+suffix)
		data, err := os.ReadFile(path + suffix)
		require.NoError(t, err)
		require.Equal(t, "preserve "+suffix, string(data))
	}
}

func TestPrepareSQLiteFilesRejectsNonRegularTargets(t *testing.T) {
	dir := t.TempDir()
	require.Error(t, prepareSQLiteFiles(dir))
	if runtime.GOOS == "windows" {
		return // Creating symlinks requires additional Windows privileges.
	}
	target := filepath.Join(dir, "target")
	require.NoError(t, os.WriteFile(target, []byte("unchanged"), 0644))
	before, err := os.Stat(target)
	require.NoError(t, err)
	link := filepath.Join(dir, "sqlite.db")
	require.NoError(t, os.Symlink(target, link))
	require.ErrorContains(t, prepareSQLiteFiles(link), "not a symlink")
	after, err := os.Stat(target)
	require.NoError(t, err)
	require.Equal(t, before.Mode(), after.Mode())
}

func TestPrivateSQLiteRemainsWritableAndJournalsStayPrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sqlite.db")
	require.NoError(t, prepareSQLiteFiles(path))
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, sqlDB.Close()) })
	require.NoError(t, db.Exec("CREATE TABLE permission_probe (value TEXT)").Error)
	tx := db.Begin()
	require.NoError(t, tx.Error)
	require.NoError(t, tx.Exec("INSERT INTO permission_probe VALUES ('saved')").Error)
	requirePrivateSQLiteFile(t, path+"-journal")
	require.NoError(t, tx.Commit().Error)
	var value string
	require.NoError(t, db.Raw("SELECT value FROM permission_probe").Scan(&value).Error)
	require.Equal(t, "saved", value)
	require.NoError(t, prepareSQLiteFiles(path), "repeat startup remains compatible")
}
