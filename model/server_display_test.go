package model

import (
	"encoding/json"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"testing"
)

func TestDisplayHiddenPersistenceAndCompatibility(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	defer sqlDB.Close()
	require.NoError(t, db.AutoMigrate(&Server{}))
	s := Server{Common: Common{ID: 1}, Name: "fixture", UUID: "fixture", HideForDisplay: true}
	require.NoError(t, db.Create(&s).Error)
	var got Server
	require.NoError(t, db.First(&got, 1).Error)
	require.True(t, got.HideForDisplay)
	require.False(t, got.HideForGuest)
	require.True(t, got.RuntimeCopy(got.RuntimeSnapshot()).HideForDisplay)
	var f ServerForm
	require.NoError(t, json.Unmarshal([]byte("{}"), &f))
	require.Nil(t, f.HideForDisplay)
	require.NoError(t, json.Unmarshal([]byte("{\"hide_for_display\":false}"), &f))
	require.NotNil(t, f.HideForDisplay)
	require.False(t, *f.HideForDisplay)
	require.NoError(t, db.Model(&got).Update("hide_for_display", false).Error)
	require.NoError(t, db.First(&got, 1).Error)
	require.False(t, got.HideForDisplay)
}
