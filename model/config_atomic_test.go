package model

import (
	"encoding/json"
	"github.com/stretchr/testify/require"
	"os"
	"path/filepath"
	"testing"
)

func TestConfigAtomicWrite(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "config.yaml")
	c := Config{filePath: target}
	require.NoError(t, c.write([]byte("before")))
	require.NoError(t, c.write([]byte("after")))
	data, err := os.ReadFile(target)
	require.NoError(t, err)
	require.Equal(t, "after", string(data))
	info, err := os.Stat(target)
	require.NoError(t, err)
	require.Equal(t, os.FileMode(0600), info.Mode().Perm())
	entries, err := os.ReadDir(dir)
	require.NoError(t, err)
	require.Len(t, entries, 1)
	blocked := filepath.Join(dir, "directory")
	require.NoError(t, os.Mkdir(blocked, 0700))
	c.filePath = blocked
	require.Error(t, c.write([]byte("cannot rename")))
	entries, err = os.ReadDir(dir)
	require.NoError(t, err)
	require.Len(t, entries, 2)
}

func TestAppearancePersistedWithoutPublicArchive(t *testing.T) {
	target := filepath.Join(t.TempDir(), "config.yaml")
	c := Config{filePath: target}
	c.AppearanceConfig = "{\"version\":1,\"enabled\":true,\"features\":{}}"
	c.AppearanceLegacyCode = "<script>original backup</script>"
	require.NoError(t, c.Save())
	raw, err := os.ReadFile(target)
	require.NoError(t, err)
	require.Contains(t, string(raw), "appearance_legacy_code:")
	var loaded Config
	require.NoError(t, loaded.Read(target, []FrontendTemplate{{Path: "user-dist", Name: "Official"}}))
	require.Equal(t, c.AppearanceConfig, loaded.AppearanceConfig)
	require.Equal(t, c.AppearanceLegacyCode, loaded.AppearanceLegacyCode)
}

func TestAppearanceSaveRetainsAuthenticationSecretsOnRestart(t *testing.T) {
	t.Setenv(JWTSecretEnvKey, "")
	target := filepath.Join(t.TempDir(), "config.yaml")
	c := Config{filePath: target}
	c.JWTSecretKey = "synthetic-signing-key"
	c.AgentSecretKey = "synthetic-agent-key"
	c.FrontendPasswordHash = "synthetic-password-hash"
	for i := 0; i < 2; i++ {
		require.NoError(t, c.Save())
		var loaded Config
		require.NoError(t, loaded.Read(target, []FrontendTemplate{{Path: "user-dist", Name: "Official"}}))
		require.Equal(t, c.JWTSecretKey, loaded.JWTSecretKey)
		require.Equal(t, c.AgentSecretKey, loaded.AgentSecretKey)
		require.Equal(t, c.FrontendPasswordHash, loaded.FrontendPasswordHash)
		c = loaded
	}
	public, err := json.Marshal(c)
	require.NoError(t, err)
	require.NotContains(t, string(public), "synthetic-signing-key")
	require.NotContains(t, string(public), "synthetic-password-hash")
	c.jwtSecretFromEnv = true
	c.JWTSecretKey = "synthetic-env-only-key"
	require.NoError(t, c.Save())
	raw, err := os.ReadFile(target)
	require.NoError(t, err)
	require.NotContains(t, string(raw), "synthetic-env-only-key")
	require.Contains(t, string(raw), "frontend_password_hash")
}
