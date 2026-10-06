package model

import (
	"encoding/json"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"testing"
)

func TestNetworkInsightSwitchesMigrateAndPreserveOldClients(t *testing.T) {
	db, e := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, e)
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	require.NoError(t, db.Exec("CREATE TABLE servers (id integer primary key, name text, uuid text)").Error)
	require.NoError(t, db.Exec("INSERT INTO servers (id,name,uuid) VALUES (1,'old','old')").Error)
	require.NoError(t, db.AutoMigrate(&Server{}))
	var s Server
	require.NoError(t, db.First(&s, 1).Error)
	require.False(t, s.BGPDisabled)
	require.False(t, s.StreamingDisabled)
	require.NoError(t, db.Model(&s).Updates(map[string]any{"bgp_disabled": true, "streaming_disabled": true}).Error)
	require.NoError(t, db.First(&s, 1).Error)
	copy := s.RuntimeCopy(s.RuntimeSnapshot())
	require.True(t, copy.BGPDisabled)
	require.True(t, copy.StreamingDisabled)
	var f ServerForm
	require.NoError(t, json.Unmarshal([]byte("{}"), &f))
	require.Nil(t, f.BGPDisabled)
	require.Nil(t, f.StreamingDisabled)
	before := &Server{}
	changes := ServerOperationChanges(before, &s)
	found := map[string]bool{}
	for _, c := range changes {
		found[c.Field] = true
	}
	require.True(t, found["bgp_disabled"])
	require.True(t, found["streaming_disabled"])
}
