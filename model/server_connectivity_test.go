package model

import (
	"encoding/json"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"testing"
)

func TestConnectivitySwitchDefaultPersistenceOldClients(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	// Simulate an old installation before the new column exists.
	require.NoError(t, db.Exec("CREATE TABLE servers (id integer primary key, name text, uuid text)").Error)
	require.NoError(t, db.Exec("INSERT INTO servers (id,name,uuid) VALUES (1,'old','old')").Error)
	require.NoError(t, db.AutoMigrate(&Server{}))
	var server Server
	require.NoError(t, db.First(&server, 1).Error)
	require.False(t, server.ConnectivityDisabled)
	require.NoError(t, db.Model(&server).Update("connectivity_disabled", true).Error)
	require.NoError(t, db.First(&server, 1).Error)
	require.True(t, server.ConnectivityDisabled)
	require.True(t, server.RuntimeCopy(server.RuntimeSnapshot()).ConnectivityDisabled)
	var form ServerForm
	require.NoError(t, json.Unmarshal([]byte("{}"), &form))
	require.Nil(t, form.ConnectivityDisabled)
	require.NoError(t, json.Unmarshal([]byte("{\"connectivity_disabled\":false}"), &form))
	require.NotNil(t, form.ConnectivityDisabled)
	require.False(t, *form.ConnectivityDisabled)
}
