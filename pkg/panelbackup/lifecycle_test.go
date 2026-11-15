package panelbackup

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestCompletedBackupWaitsForDurableRecord(t *testing.T) {
	source, db := testSource(t)
	m, e := New(db, source)
	require.NoError(t, e)
	defer m.Close()
	target, key, _ := testReceiver(t, m.installation)
	saved, e := m.SaveTarget(TargetInput{Target: target, PrivateKey: key})
	require.NoError(t, e)
	require.NoError(t, m.SavePlan(Plan{Mode: "interval", IntervalMinutes: 10, TargetIDs: []uint64{saved.ID}}, ""))
	m.prepare = func(context.Context, Source, func(string)) (*Snapshot, error) {
		return &Snapshot{At: time.Now(), Total: 1}, nil
	}
	m.transfer = func(_ context.Context, t Target, _, _ string, _ *Snapshot, _ uint64, report func(Delivery)) (Delivery, error) {
		return Delivery{TargetID: t.ID, Name: t.Name, State: "success", Phase: "completed"}, nil
	}
	require.NoError(t, db.Exec("CREATE TRIGGER fail_backup_record BEFORE UPDATE ON panel_backup_runs WHEN NEW.state != 'running' BEGIN SELECT RAISE(ABORT, 'fixture record unavailable'); END").Error)
	id, e := m.Start("manual", nil, 0)
	require.NoError(t, e)
	require.Eventually(t, func() bool { v, e := m.Overview(); return e == nil && v.Active != nil && v.Active.Phase == "recording" }, time.Second*5, time.Millisecond*10)
	v, e := m.Overview()
	require.NoError(t, e)
	require.Equal(t, "warning", v.Active.State)
	require.Contains(t, v.Active.Error, "记录暂时无法保存")
	_, e = m.Start("manual", nil, 0)
	require.Error(t, e)
	require.Error(t, m.Cancel(id))
	require.NoError(t, db.Exec("DROP TRIGGER fail_backup_record").Error)
	m.tick(time.Now())
	h := waitBackup(t, m)
	require.Equal(t, int64(1), h.Total)
	require.Equal(t, "success", h.Items[0].State)
}
func TestReceiverSetupLifecycleAndUniquePublicCommands(t *testing.T) {
	source, db := testSource(t)
	m, e := New(db, source)
	require.NoError(t, e)
	defer m.Close()
	input := TargetInput{Target: Target{Name: "receiver", Host: "192.0.2.10", Port: 2022, Directory: "/var/lib/ddnezha-backup/backups"}}
	first, command, e := m.PrepareKey(input)
	require.NoError(t, e)
	second, command2, e := m.PrepareKey(input)
	require.NoError(t, e)
	require.NotEqual(t, first.User, second.User)
	require.NotEqual(t, command, command2)
	require.NotContains(t, command, "PRIVATE KEY")
	shell := exec.Command("sh", "-n")
	shell.Stdin = strings.NewReader(command)
	require.NoError(t, shell.Run())
	require.Error(t, m.SavePlan(Plan{Mode: "interval", IntervalMinutes: 5, TargetIDs: []uint64{first.ID}}, ""))
	require.NoError(t, m.BeginSetup(first.ID))
	require.Error(t, m.BeginSetup(first.ID))
	require.Error(t, m.DeleteTarget(first.ID))
	_, e = m.SaveTarget(TargetInput{Target: first})
	require.Error(t, e)
	require.NoError(t, m.FinishSetup(first.ID, "", errors.New("Agent 已关闭远程命令")))
	current, e := m.Target(first.ID)
	require.NoError(t, e)
	require.Equal(t, "failed", current.SetupState)
	require.Contains(t, current.SetupError, "Agent")
	require.NoError(t, m.BeginSetup(first.ID))
	require.NoError(t, m.FinishSetup(first.ID, "SHA256:verified", nil))
	current, e = m.Target(first.ID)
	require.NoError(t, e)
	require.Equal(t, "success", current.SetupState)
	require.Equal(t, "SHA256:verified", current.Fingerprint)
	require.NoError(t, m.BeginSetup(first.ID))
	restarted, e := New(db, source)
	require.NoError(t, e)
	defer restarted.Close()
	current, e = restarted.Target(first.ID)
	require.NoError(t, e)
	require.Equal(t, "interrupted", current.SetupState)
	require.Contains(t, current.SetupError, "重启")
}
func TestScheduleUsesPanelTimezone(t *testing.T) {
	source, db := testSource(t)
	source.Location = time.FixedZone("PanelTZ", 8*3600)
	m, e := New(db, source)
	require.NoError(t, e)
	defer m.Close()
	now := time.Date(2026, 11, 15, 20, 0, 0, 0, time.UTC)
	next := m.nextTime(Plan{Mode: "daily", DailyTime: "05:00"}, now)
	require.Equal(t, 16, next.Day())
	require.Equal(t, 5, next.Hour())
	require.True(t, next.Equal(now.Add(time.Hour)))
}

func TestInstallerChecksumMatchesPinnedCommand(t *testing.T) {
	data, err := os.ReadFile("../../backup/scripts/install.sh")
	require.NoError(t, err)
	require.Equal(t, receiverInstallerSHA256, fmt.Sprintf("%x", sha256.Sum256(data)))
	cmd := exec.Command("sh", "-n")
	cmd.Stdin = strings.NewReader(string(data))
	require.NoError(t, cmd.Run())
}
