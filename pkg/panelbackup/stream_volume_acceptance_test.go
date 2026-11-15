package panelbackup

import (
	"context"
	"crypto/rand"
	"fmt"
	"github.com/stretchr/testify/require"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestEncryptedVolumeAcceptance(t *testing.T) {
	if os.Getenv("DDNZ_VOLUME_ACCEPTANCE") != "1" {
		t.Skip("manual bounded volume acceptance")
	}
	file := filepath.Join(t.TempDir(), "data.bin")
	f, err := os.Create(file)
	require.NoError(t, err)
	_, err = io.CopyN(f, rand.Reader, 32<<20)
	require.NoError(t, err)
	require.NoError(t, f.Close())
	snap := &Snapshot{At: time.Now(), Version: "volume-acceptance", Password: "synthetic-volume-acceptance-password"}
	for i := 0; i < 64; i++ {
		snap.Entries = append(snap.Entries, Entry{Name: fmt.Sprintf("data/volume-%02d.bin", i), Size: 32 << 20, file: file})
		snap.Total += 32 << 20
	}
	source, db := testSource(t)
	m, err := New(db, source)
	require.NoError(t, err)
	defer m.Close()
	target, secret, _ := testReceiver(t, m.installation)
	target, err = m.SaveTarget(TargetInput{Target: target, PrivateKey: secret})
	require.NoError(t, err)
	var last int64
	result, err := Transfer(context.Background(), target, secret, m.installation, snap, 1, func(d Delivery) {
		if d.ProcessedBytes-last >= 256<<20 {
			last = d.ProcessedBytes
			t.Logf("processed=%d sent=%d", d.ProcessedBytes, d.SentBytes)
		}
	})
	require.NoError(t, err)
	require.Equal(t, "success", result.State)
	require.Equal(t, snap.Total, result.ProcessedBytes)
	require.Equal(t, result.SentBytes, result.VerifiedBytes)
	t.Logf("encrypted verified bytes=%d source=%d", result.SentBytes, result.ProcessedBytes)
	require.NoError(t, db.Create(&result).Error)
	download, err := m.OpenDownload(context.Background(), result.ID)
	require.NoError(t, err)
	defer download.Close()
	var downloaded int64
	require.NoError(t, download.Write(context.Background(), countWriter{io.Discard, func(n int) { downloaded += int64(n) }}))
	require.Equal(t, result.SentBytes, downloaded)
	t.Logf("large archive downloaded and verified bytes=%d", downloaded)
}

func TestLowMemoryEncryptedVolumeAcceptance(t *testing.T) {
	if os.Getenv("DDNZ_LOW_MEMORY_ACCEPTANCE") != "1" {
		t.Skip("manual low-memory acceptance")
	}
	snap := Snapshot{At: time.Now(), Version: "memory-limit-test", Password: "low-memory-acceptance-password"}
	err := snap.Write(context.Background(), io.Discard, func(int64) { t.Fatal("must reject before streaming") })
	require.ErrorContains(t, err, "可用内存不足")
	t.Log(err)
}
