package singleton

import (
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
)

func TestInstallationCommandServerName(t *testing.T) {
	for _, tc := range []struct {
		name string
		at   time.Time
		want string
	}{
		{"Beijing midnight", time.Date(2026, 10, 18, 16, 0, 59, 0, time.UTC), "2026/10/19/00:00"},
		{"year rollover", time.Date(2026, 12, 31, 16, 5, 0, 0, time.UTC), "2027/01/01/00:05"},
		{"foreign offset", time.Date(2026, 10, 18, 9, 0, 0, 0, time.FixedZone("west", -7*3600)), "2026/10/19/00:00"},
		{"legacy missing time", time.Time{}, "新服务器"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, installationCommandServerName(tc.at))
		})
	}
}

func TestAgentCredentialNewNameUsesIssuanceAndPreservesExistingName(t *testing.T) {
	keyPath := setupCredentialTest(t)
	actor := model.ServerOperationActor{ID: 1}
	pair, err := IssueAgentCredential("", 1, actor)
	require.NoError(t, err)
	createdAt := time.Date(2026, 10, 18, 16, 0, 42, 0, time.UTC)
	require.NoError(t, DB.Model(&model.AgentCredential{}).Where("uuid = ?", pair.UUID).Update("created_at", createdAt).Error)
	require.NoError(t, InitAgentCredentials(keyPath))
	reused, err := UnusedAgentCredentialPair(pair.UUID, pair.Version, 1, false, actor)
	require.NoError(t, err)
	require.Equal(t, pair, reused)
	id, err := AuthenticateAgentCredential(pair.Secret, pair.UUID)
	require.NoError(t, err)
	var saved model.Server
	require.NoError(t, DB.First(&saved, id).Error)
	require.Equal(t, "2026/10/19/00:00", saved.Name)
	server, ok := ServerShared.Get(id)
	require.True(t, ok)
	require.Equal(t, saved.Name, server.Name)
	// Generating an ordinary reinstall command and reconnecting are not rename operations.
	require.NoError(t, DB.Model(&model.Server{}).Where("id = ?", id).Update("name", "我的电脑").Error)
	server.Name = "我的电脑"
	again, err := IssueAgentCredential(pair.UUID, 1, actor)
	require.NoError(t, err)
	require.Equal(t, pair, again)
	againID, err := AuthenticateAgentCredential(pair.Secret, pair.UUID)
	require.NoError(t, err)
	require.Equal(t, id, againID)
	require.NoError(t, DB.First(&saved, id).Error)
	require.Equal(t, "我的电脑", saved.Name)
}
