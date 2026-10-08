//go:build !windows

package singleton

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func assertPrivateTerminalKey(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	require.NoError(t, err)
	require.Equal(t, os.FileMode(0600), info.Mode().Perm())
}

func TestTerminalKeyRejectsPublicUnixPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "key")
	_, err := loadTerminalCommandCipher(path, false)
	require.NoError(t, err)
	require.NoError(t, os.Chmod(path, 0644))
	_, err = loadTerminalCommandCipher(path, true)
	require.Error(t, err)
}
