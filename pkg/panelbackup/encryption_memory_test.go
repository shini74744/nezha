package panelbackup

import (
	"context"
	"github.com/stretchr/testify/require"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"testing"
	"time"
)

func TestEncryptedSnapshotReleasesPasswordDerivationMemoryBeforeStreaming(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fixture")
	require.NoError(t, os.WriteFile(path, []byte("backup memory fixture"), 0600))
	snap := Snapshot{At: time.Now(), Version: "test", Password: "memory-regression-password", Entries: []Entry{{Name: "data/fixture", Size: 21, file: path}}, Total: 21}
	// Keep ordinary application data live while checking the additional backup heap.
	application := make([]byte, 32<<20)
	for i := range application {
		application[i] = byte(i)
	}
	debug.FreeOSMemory()
	var before, streaming runtime.MemStats
	runtime.ReadMemStats(&before)
	called := false
	require.NoError(t, snap.Write(context.Background(), io.Discard, func(int64) {
		if !called {
			runtime.ReadMemStats(&streaming)
			called = true
		}
	}))
	runtime.KeepAlive(application)
	require.True(t, called)
	extra := int64(streaming.HeapAlloc) - int64(before.HeapAlloc)
	t.Logf("additional heap during archive streaming: %d bytes", extra)
	require.Less(t, extra, int64(64<<20), "password derivation memory must be released before streaming")
}
