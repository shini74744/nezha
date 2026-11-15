package panelbackup

import (
	"archive/tar"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nezhahq/nezha/pkg/backupformat"
	"github.com/nezhahq/nezha/pkg/backuprestore"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func runNow(t *testing.T, m *Manager) Run {
	t.Helper()
	_, err := m.Start("manual", nil, 0)
	require.NoError(t, err)
	// Two targets each perform age's full-strength scrypt; race instrumentation
	// can exceed the legacy 20-second fixture budget even with tiny input files.
	return waitBackup(t, m, 90*time.Second).Items[0]
}
func unpackDownload(t *testing.T, m *Manager, d Delivery) string {
	t.Helper()
	download, err := m.OpenDownload(context.Background(), d.ID)
	require.NoError(t, err)
	defer download.Close()
	var data bytes.Buffer
	require.NoError(t, download.Write(context.Background(), &data))
	require.EqualValues(t, download.Size, data.Len())
	dir := t.TempDir()
	if d.ParentID == 0 {
		require.NoError(t, os.WriteFile(filepath.Join(dir, filepath.Base(d.Archive)), data.Bytes(), 0600))
		body, _ := json.Marshal(backupformat.Bundle{Format: 1, Archives: []backupformat.Archive{{Name: filepath.Base(d.Archive), Size: d.SentBytes, SHA256: d.SHA256}}})
		require.NoError(t, os.WriteFile(filepath.Join(dir, "bundle.json"), body, 0600))
	} else {
		tr := tar.NewReader(&data)
		for {
			h, err := tr.Next()
			if err == io.EOF {
				break
			}
			require.NoError(t, err)
			require.Equal(t, filepath.Base(h.Name), h.Name)
			b, err := io.ReadAll(tr)
			require.NoError(t, err)
			require.NoError(t, os.WriteFile(filepath.Join(dir, h.Name), b, 0600))
		}
	}
	return filepath.Join(dir, "bundle.json")
}
func TestIncrementalTransferDownloadRestoreAndRetention(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			source, db := testSource(t)
			m, err := New(db, source)
			require.NoError(t, err)
			defer m.Close()
			target, key, _ := testReceiver(t, m.installation)
			target.RetainCount = 3
			target, err = m.SaveTarget(TargetInput{Target: target, PrivateKey: key})
			require.NoError(t, err)
			plan := Plan{Mode: "manual", BackupType: "incremental", Encrypt: encrypted, TargetIDs: []uint64{target.ID}}
			password := "test-incremental-password"
			require.NoError(t, m.SavePlan(plan, password))
			first := runNow(t, m)
			require.Equal(t, "success", first.State)
			require.Equal(t, "full", first.Deliveries[0].BackupType)
			require.NoError(t, db.Exec("DELETE FROM application_data WHERE id=1").Error)
			require.NoError(t, db.Exec("INSERT INTO application_data VALUES(2,'new row')").Error)
			require.NoError(t, os.Remove(filepath.Join(source.DataDir, "logos", "picture.bin")))
			require.NoError(t, os.WriteFile(filepath.Join(source.DataDir, "new-file"), []byte("new content"), 0600))
			require.NoError(t, os.WriteFile(source.Config, []byte("site_name: changed"), 0600))
			second := runNow(t, m)
			require.Equal(t, "success", second.State)
			d := second.Deliveries[0]
			require.Equal(t, "incremental", d.BackupType)
			require.Equal(t, first.Deliveries[0].ID, d.ParentID)
			bundle := unpackDownload(t, m, d)
			out := filepath.Join(t.TempDir(), "restored")
			if binary := os.Getenv("DDNZ_RESTORE_BINARY"); binary != "" && !encrypted {
				cliOut := filepath.Join(t.TempDir(), "cli-restored")
				output, err := exec.Command(binary, "-bundle", bundle, "-output", cliOut).CombinedOutput()
				require.NoError(t, err, string(output))
				require.FileExists(t, filepath.Join(cliOut, "data", "sqlite.db"))
			}
			require.NoError(t, backuprestore.Restore(context.Background(), bundle, out, func() (string, error) { return password, nil }))
			require.NoFileExists(t, filepath.Join(out, "data", "logos", "picture.bin"))
			content, err := os.ReadFile(filepath.Join(out, "data", "new-file"))
			require.NoError(t, err)
			require.Equal(t, "new content", string(content))
			content, err = os.ReadFile(filepath.Join(out, "data", "config.yaml"))
			require.NoError(t, err)
			require.Equal(t, "site_name: changed", string(content))
			restored, err := gorm.Open(sqlite.Open(filepath.Join(out, "data", "sqlite.db")), &gorm.Config{})
			require.NoError(t, err)
			var check string
			require.NoError(t, restored.Raw("PRAGMA integrity_check").Scan(&check).Error)
			require.Equal(t, "ok", check)
			var ids []int
			require.NoError(t, restored.Raw("SELECT id FROM application_data").Scan(&ids).Error)
			require.Equal(t, []int{2}, ids)
			connection, _ := restored.DB()
			connection.Close()
			require.Error(t, backuprestore.Restore(context.Background(), bundle, out, nil))
			if encrypted {
				require.Error(t, backuprestore.Restore(context.Background(), bundle, filepath.Join(t.TempDir(), "wrong"), func() (string, error) { return "wrong password", nil }))
			}
			// Full checkpoints bound dependency chains. A chain's base survives expiry.
			third := runNow(t, m)
			require.Equal(t, "incremental", third.Deliveries[0].BackupType)
			fourth := runNow(t, m)
			require.Equal(t, "full", fourth.Deliveries[0].BackupType)
			require.FileExists(t, first.Deliveries[0].Archive)
			fifth := runNow(t, m)
			require.Equal(t, "success", fifth.State)
			require.FileExists(t, first.Deliveries[0].Archive)
			sixth := runNow(t, m)
			require.Equal(t, "success", sixth.State)
			require.NoFileExists(t, first.Deliveries[0].Archive)
			require.NoFileExists(t, second.Deliveries[0].Archive)
			require.NoFileExists(t, third.Deliveries[0].Archive)
			_, err = m.OpenDownload(context.Background(), d.ID)
			require.Error(t, err)
			out2 := filepath.Join(t.TempDir(), "restore-last")
			require.NoError(t, backuprestore.Restore(context.Background(), unpackDownload(t, m, sixth.Deliveries[0]), out2, func() (string, error) { return password, nil }))
		})
	}
}
func TestBackupDefaultsMigrationAndValidation(t *testing.T) {
	source, db := testSource(t)
	m, err := New(db, source)
	require.NoError(t, err)
	m.Close()
	require.NoError(t, db.Model(&Plan{}).Where("id=1").Updates(map[string]any{"mode": "realtime", "backup_type": "", "interval_minutes": 17}).Error)
	m, err = New(db, source)
	require.NoError(t, err)
	defer m.Close()
	view, err := m.Overview()
	require.NoError(t, err)
	require.Equal(t, "interval", view.Plan.Mode)
	require.Equal(t, 17, view.Plan.IntervalMinutes)
	require.Equal(t, "full", view.Plan.BackupType)
	require.Error(t, ValidatePlan(Plan{Mode: "realtime"}))
	require.Error(t, ValidatePlan(Plan{Mode: "manual", BackupType: "wrong"}))
	target, key, _ := testReceiver(t, m.installation)
	target, err = m.SaveTarget(TargetInput{Target: target, PrivateKey: key})
	require.NoError(t, err)
	require.Equal(t, 15, target.RetainCount)
	target.RetainCount = -1
	_, err = m.SaveTarget(TargetInput{Target: target})
	require.Error(t, err)
	target.RetainCount = 1001
	_, err = m.SaveTarget(TargetInput{Target: target})
	require.Error(t, err)
}
func TestRetentionDownloadLeasesAndFailedDelivery(t *testing.T) {
	source, db := testSource(t)
	m, err := New(db, source)
	require.NoError(t, err)
	defer m.Close()
	target, key, _ := testReceiver(t, m.installation)
	target.RetainCount = 1
	target, err = m.SaveTarget(TargetInput{Target: target, PrivateKey: key})
	require.NoError(t, err)
	require.NoError(t, m.SavePlan(Plan{Mode: "manual", TargetIDs: []uint64{target.ID}}, ""))
	first := runNow(t, m).Deliveries[0]
	lease, err := m.OpenDownload(context.Background(), first.ID)
	require.NoError(t, err)
	second := runNow(t, m).Deliveries[0]
	require.FileExists(t, first.Archive)
	var data bytes.Buffer
	require.NoError(t, lease.Write(context.Background(), &data))
	lease.Close()
	original := m.transfer
	m.transfer = func(context.Context, Target, string, string, *Snapshot, uint64, func(Delivery)) (Delivery, error) {
		return Delivery{TargetID: target.ID, Name: target.Name}, errors.New("fixture transfer failed")
	}
	failed := runNow(t, m)
	require.Equal(t, "failed", failed.State)
	require.FileExists(t, first.Archive)
	require.FileExists(t, second.Archive)
	m.transfer = original
	last := runNow(t, m)
	require.Equal(t, "success", last.State)
	require.NoFileExists(t, first.Archive)
	require.NoFileExists(t, second.Archive)
	// Unrelated files survive retention even inside the dedicated namespace.
	unrelated := filepath.Join(filepath.Dir(last.Deliveries[0].Archive), "keep-me.txt")
	require.NoError(t, os.WriteFile(unrelated, []byte("business unrelated"), 0600))
	runNow(t, m)
	require.FileExists(t, unrelated)
}
func TestIncrementalMissingBaseAndTargetChanges(t *testing.T) {
	source, db := testSource(t)
	m, err := New(db, source)
	require.NoError(t, err)
	defer m.Close()
	target, key, _ := testReceiver(t, m.installation)
	target, err = m.SaveTarget(TargetInput{Target: target, PrivateKey: key})
	require.NoError(t, err)
	plan := Plan{Mode: "manual", BackupType: "incremental", TargetIDs: []uint64{target.ID}}
	require.NoError(t, m.SavePlan(plan, ""))
	first := runNow(t, m).Deliveries[0]
	require.NoError(t, os.Remove(first.Archive))
	next := runNow(t, m)
	require.Equal(t, "full", next.Deliveries[0].BackupType)
	target.Fingerprint = "SHA256:changed"
	_, err = m.SaveTarget(TargetInput{Target: target})
	require.NoError(t, err)
	_, err = m.OpenDownload(context.Background(), next.Deliveries[0].ID)
	require.ErrorContains(t, err, "连接或目录已更改")
}
func TestStreamDetectsCorruptionBeforeCompleting(t *testing.T) {
	content := strings.Repeat("x", 200000)
	var out bytes.Buffer
	err := copyVerified(context.Background(), &out, strings.NewReader(content), int64(len(content)), strings.Repeat("0", 64))
	require.Error(t, err)
	require.Less(t, out.Len(), len(content))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	require.Error(t, copyVerified(ctx, &out, strings.NewReader(""), 0, strings.Repeat("0", 64)))
}
func TestIncrementalNoChangeAndDeletedFiles(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "x")
	require.NoError(t, os.WriteFile(file, []byte("same"), 0600))
	snap := &Snapshot{At: time.Now(), Entries: []Entry{{Name: "data/x", Size: 4, file: file}}, Total: 4}
	require.NoError(t, snap.HashFiles(context.Background()))
	index, _ := json.Marshal(snap.Index)
	old := Delivery{ID: 1, FileIndex: string(index), Archive: "backup-20261115T120000.000000000Z-000001.tar.gz", SHA256: strings.Repeat("1", 64)}
	next, err := deltaSnapshot(snap, old)
	require.NoError(t, err)
	require.Empty(t, next.Entries)
	require.Zero(t, next.Total)
	empty := &Snapshot{}
	require.NoError(t, empty.HashFiles(context.Background()))
	next, err = deltaSnapshot(empty, old)
	require.NoError(t, err)
	require.Equal(t, []string{"data/x"}, next.Deleted)
}
