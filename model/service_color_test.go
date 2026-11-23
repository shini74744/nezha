package model

import (
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"testing"
)

func TestServiceColorAllocationBackfillAndPersistence(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/colors.db"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&Service{}))
	for i := 0; i < 128; i++ {
		require.NoError(t, db.Create(&Service{Name: "legacy", Type: TaskTypeTCPPing}).Error)
	}
	require.NoError(t, db.Create(&Service{Type: TaskTypeTCPPing, Name: "custom", ChartColor: "#abcdef"}).Error)
	require.NoError(t, BackfillServiceColors(db))
	var rows []Service
	require.NoError(t, db.Order("id").Find(&rows).Error)
	seen := map[string]bool{}
	for _, row := range rows {
		require.Regexp(t, "^#[0-9a-f]{6}$", row.ChartColor)
		require.False(t, seen[row.ChartColor], "colors must not cycle")
		seen[row.ChartColor] = true
	}
	require.Equal(t, "#abcdef", rows[len(rows)-1].ChartColor)
	require.NoError(t, BackfillServiceColors(db))
	var reread []Service
	require.NoError(t, db.Order("id").Find(&reread).Error)
	for i := range rows {
		require.Equal(t, rows[i].ChartColor, reread[i].ChartColor)
	}
	color, err := AllocateServiceColor(db)
	require.NoError(t, err)
	require.False(t, seen[color])
	normalized, err := NormalizeServiceColor(" #AABBCc ")
	require.NoError(t, err)
	require.Equal(t, "#aabbcc", normalized)
	for _, bad := range []string{"red", "#abc", "#aabbcc00", "url(x)", "<script>"} {
		_, err = NormalizeServiceColor(bad)
		require.Error(t, err)
	}
}

func TestServerServiceSelectionAndColorInheritance(t *testing.T) {
	a := &Service{Common: Common{ID: 1}, Type: TaskTypeTCPPing, Cover: ServiceCoverAll, ChartColor: "#112233", DisplayIndex: 90}
	b := &Service{Common: Common{ID: 2}, Type: TaskTypeTCPPing, Cover: ServiceCoverIgnoreAll, ChartColor: "#445566", SkipServers: map[uint64]bool{}}
	s := &Server{Common: Common{ID: 7}}
	require.True(t, a.CoversServer(s))
	require.False(t, b.CoversServer(s))
	s.ServicePreferencesRaw = `[{"service_id":2},{"service_id":1,"color":"#abcdef"}]`
	require.True(t, b.CoversServer(s))
	require.True(t, a.CoversServer(s))
	pos, color := s.ServicePresentation(b)
	require.Equal(t, 2, pos)
	require.Equal(t, "#445566", color)
	b.ChartColor = "#998877"
	_, color = s.ServicePresentation(b)
	require.Equal(t, b.ChartColor, color)
	pos, color = s.ServicePresentation(a)
	require.Equal(t, 1, pos)
	require.Equal(t, "#abcdef", color)
	s.ServicePreferencesRaw = `[{"service_id":999}]`
	require.False(t, a.CoversServer(s), "deleted last selection must not enable all services")
	s.ServicePreferencesRaw = "broken"
	require.False(t, a.CoversServer(s))
	s.ServicePreferencesRaw = "[]"
	require.True(t, a.CoversServer(s))
	require.False(t, b.CoversServer(s))
	for _, rows := range [][]ServerServicePreference{{{ServiceID: 0}}, {{ServiceID: 1}, {ServiceID: 1}}, {{ServiceID: 1, Color: "invalid"}}} {
		_, err := NormalizeServerServices(rows)
		require.Error(t, err)
	}
}
