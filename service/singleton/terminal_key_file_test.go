package singleton

import (
	"bytes"
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestTerminalKeyNeverOverwritesExistingOrMissingData(t *testing.T) {
	for _, size := range []int{0, 3, 31, 33, 4096} {
		t.Run(strconv.Itoa(size), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "key")
			file, err := openPrivateTerminalKey(path, true)
			require.NoError(t, err)
			content := bytes.Repeat([]byte{42}, size)
			_, err = file.Write(content)
			require.NoError(t, err)
			require.NoError(t, file.Close())
			_, err = loadTerminalCommandCipher(path, false)
			require.Error(t, err)
			actual, err := os.ReadFile(path)
			require.NoError(t, err)
			require.Equal(t, content, actual)
			_, err = openPrivateTerminalKey(path, true)
			require.ErrorIs(t, err, os.ErrExist)
		})
	}
	path := filepath.Join(t.TempDir(), "missing")
	_, err := loadTerminalCommandCipher(path, true)
	require.Error(t, err)
	_, err = os.Stat(path)
	require.ErrorIs(t, err, os.ErrNotExist)
	_, err = loadTerminalCommandCipher(t.TempDir(), false)
	require.Error(t, err)
}
