package logolibrary

import (
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"path/filepath"
	"testing"
)

func TestSeedNeverResurrectsDeletedOrOverwritesEdits(t *testing.T) {
	dir := t.TempDir()
	db, e := gorm.Open(sqlite.Open(filepath.Join(dir, "test.db")), &gorm.Config{})
	require.NoError(t, e)
	require.NoError(t, db.AutoMigrate(&model.Server{}, &model.LogoLibraryEntry{}))
	require.NoError(t, Seed(db, filepath.Join(dir, "logos")))
	var count int64
	require.NoError(t, db.Model(&model.LogoLibraryEntry{}).Count(&count).Error)
	require.Greater(t, count, int64(2000))
	require.NoError(t, db.Model(&model.LogoLibraryEntry{}).Where("id = ?", "carrier-ntt").Updates(map[string]any{"name": "自定义 NTT", "deleted": true}).Error)
	require.NoError(t, Seed(db, filepath.Join(dir, "logos")))
	var entry model.LogoLibraryEntry
	require.NoError(t, db.First(&entry, "id = ?", "carrier-ntt").Error)
	require.Equal(t, "自定义 NTT", entry.Name)
	require.True(t, entry.Deleted)
}
