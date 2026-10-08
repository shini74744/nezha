package singleton

import (
	"github.com/stretchr/testify/require"
	"os"
	"path/filepath"
	"testing"
)

func TestTerminalCommandEncryptionAndKey(t *testing.T) {
	path := filepath.Join(t.TempDir(), "terminal-commands.key")
	old := TerminalCommandCipher
	defer func() { TerminalCommandCipher = old }()
	aead, err := loadTerminalCommandCipher(path, false)
	require.NoError(t, err)
	TerminalCommandCipher = aead
	info, err := os.Stat(path)
	require.NoError(t, err)
	assertPrivateTerminalKey(t, path)
	require.Equal(t, int64(32), info.Size())
	encrypted, err := EncryptTerminalCommand(7, "printf 'hello'")
	require.NoError(t, err)
	require.NotContains(t, encrypted, "hello")
	second, err := EncryptTerminalCommand(7, "printf 'hello'")
	require.NoError(t, err)
	require.NotEqual(t, encrypted, second)
	plain, err := DecryptTerminalCommand(7, encrypted)
	require.NoError(t, err)
	require.Equal(t, "printf 'hello'", plain)
	_, err = DecryptTerminalCommand(8, encrypted)
	require.Error(t, err)
	_, err = DecryptTerminalCommand(7, encrypted[:len(encrypted)-4]+"AAAA")
	require.Error(t, err)
	TerminalCommandCipher, err = loadTerminalCommandCipher(path, true)
	require.NoError(t, err)
	plain, err = DecryptTerminalCommand(7, encrypted)
	require.NoError(t, err)
	require.Equal(t, "printf 'hello'", plain)
	other, err := loadTerminalCommandCipher(filepath.Join(t.TempDir(), "other.key"), false)
	require.NoError(t, err)
	TerminalCommandCipher = other
	_, err = DecryptTerminalCommand(7, encrypted)
	require.Error(t, err)
	_, err = loadTerminalCommandCipher(filepath.Join(t.TempDir(), "missing.key"), true)
	require.Error(t, err)
	require.NoError(t, os.WriteFile(path, []byte("bad"), 0600))
	_, err = loadTerminalCommandCipher(path, false)
	require.Error(t, err)
}
