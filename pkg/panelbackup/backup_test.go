package panelbackup

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"filippo.io/age"
	"github.com/nezhahq/nezha/pkg/backupreceiver"
	"github.com/pkg/sftp"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/ssh"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func testSource(t *testing.T) (Source, *gorm.DB) {
	t.Helper()
	root := t.TempDir()
	dbPath := filepath.Join(root, "sqlite.db")
	db, err := gorm.Open(sqlite.Open(dbPath+"?_busy_timeout=3000"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { sqlDB.Close() })
	require.NoError(t, db.Exec("CREATE TABLE application_data (id INTEGER PRIMARY KEY, value TEXT)").Error)
	require.NoError(t, db.Exec("INSERT INTO application_data VALUES (1, '完整历史测试数据')").Error)
	cfg := filepath.Join(root, "config.yaml")
	require.NoError(t, os.WriteFile(cfg, []byte("site_name: backup-test\nsecret: fixture-only\n"), 0600))
	require.NoError(t, os.WriteFile(filepath.Join(root, "terminal-commands.key"), bytes.Repeat([]byte{7}, 32), 0600))
	require.NoError(t, os.Mkdir(filepath.Join(root, "logos"), 0700))
	require.NoError(t, os.WriteFile(filepath.Join(root, "logos", "picture.bin"), bytes.Repeat([]byte("upload"), 9000), 0600))
	return Source{Database: dbPath, Config: cfg, DataDir: root, Version: "test"}, db
}
func testIdentity(t *testing.T) (ssh.Signer, string) {
	t.Helper()
	_, key, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	signer, err := ssh.NewSignerFromKey(key)
	require.NoError(t, err)
	block, err := ssh.MarshalPrivateKey(key, "test")
	require.NoError(t, err)
	return signer, string(pem.EncodeToMemory(block))
}
func testReceiver(t *testing.T, installation string) (Target, string, func()) {
	t.Helper()
	host, _ := testIdentity(t)
	client, secret := testIdentity(t)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	user := "ddnb_" + installation + "_11223344"
	directory := t.TempDir()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	config := backupreceiver.Config{Listen: listener.Addr().String(), Users: map[string]backupreceiver.User{user: {PublicKey: string(ssh.MarshalAuthorizedKey(client.PublicKey())), Directory: directory}}}
	go func() {
		defer close(done)
		_ = backupreceiver.Serve(ctx, listener, host, func() (backupreceiver.Config, error) { return config, nil })
	}()
	stop := func() {
		cancel()
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Error("receiver did not stop")
		}
	}
	t.Cleanup(stop)
	return Target{Name: "test receiver", Transport: "sftp", Receiver: true, Host: "127.0.0.1", Port: listener.Addr().(*net.TCPAddr).Port, User: user, Directory: directory, Fingerprint: ssh.FingerprintSHA256(host.PublicKey()), AuthType: "key"}, secret, stop
}
func readArchive(t *testing.T, file, password string) map[string][]byte {
	t.Helper()
	input, err := os.Open(file)
	require.NoError(t, err)
	defer input.Close()
	var reader io.Reader = input
	if password != "" {
		identity, err := age.NewScryptIdentity(password)
		require.NoError(t, err)
		reader, err = age.Decrypt(input, identity)
		require.NoError(t, err)
	}
	gz, err := gzip.NewReader(reader)
	require.NoError(t, err)
	defer gz.Close()
	tr := tar.NewReader(gz)
	contents := map[string][]byte{}
	for {
		h, e := tr.Next()
		if errors.Is(e, io.EOF) {
			break
		}
		require.NoError(t, e)
		require.NotContains(t, h.Name, "..")
		b, e := io.ReadAll(tr)
		require.NoError(t, e)
		contents[h.Name] = b
		require.Equal(t, int64(0600), h.Mode)
	}
	var manifest struct {
		Files []Entry `json:"files"`
	}
	require.NoError(t, json.Unmarshal(contents["manifest.json"], &manifest))
	for _, e := range manifest.Files {
		sum := sha256.Sum256(contents[e.Name])
		require.Equal(t, e.SHA256, hex.EncodeToString(sum[:]), e.Name)
		require.Equal(t, e.Size, int64(len(contents[e.Name])))
	}
	return contents
}
func TestFullSnapshotTransferEncryptedRestoreAndIsolation(t *testing.T) {
	source, _ := testSource(t)
	snapshot, err := Prepare(context.Background(), source, func(string) {})
	require.NoError(t, err)
	defer snapshot.Close()
	snapshot.Password = "fixture-strong-backup-password"
	target, secret, _ := testReceiver(t, "123456789abc")
	var reports []Delivery
	result, err := Transfer(context.Background(), target, secret, "123456789abc", snapshot, 1, func(d Delivery) { reports = append(reports, d) })
	require.NoError(t, err)
	require.Equal(t, "success", result.State)
	require.Equal(t, result.SentBytes, result.VerifiedBytes)
	require.Greater(t, result.SentBytes, int64(0))
	require.Equal(t, snapshot.Total, result.ProcessedBytes)
	require.True(t, strings.HasSuffix(result.Archive, ".tar.gz.age"))
	content := readArchive(t, result.Archive, snapshot.Password)
	require.Contains(t, string(content["data/config.yaml"]), "fixture-only")
	require.Len(t, content["data/terminal-commands.key"], 32)
	require.Len(t, content["data/logos/picture.bin"], 54000)
	restored := filepath.Join(t.TempDir(), "restored.db")
	require.NoError(t, os.WriteFile(restored, content["data/sqlite.db"], 0600))
	db, err := gorm.Open(sqlite.Open(restored), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	var check, value string
	require.NoError(t, db.Raw("PRAGMA integrity_check").Scan(&check).Error)
	require.Equal(t, "ok", check)
	require.NoError(t, db.Raw("SELECT value FROM application_data WHERE id = 1").Scan(&value).Error)
	require.Equal(t, "完整历史测试数据", value)
	raw, err := os.ReadFile(result.Archive)
	require.NoError(t, err)
	require.NotContains(t, string(raw), "fixture-only")
	wrong, err := age.NewScryptIdentity("wrong-fixture-password")
	require.NoError(t, err)
	_, err = age.Decrypt(bytes.NewReader(raw), wrong)
	require.Error(t, err)
	require.FileExists(t, result.Archive+".sha256")
	require.NoFileExists(t, result.Archive+".partial")
	sawVerify := false
	for _, r := range reports {
		if r.Phase == "verifying" {
			sawVerify = true
		}
	}
	require.True(t, sawVerify)
	// A backup credential cannot execute a shell or access paths outside its own directory.
	connection, _, err := connect(context.Background(), target, secret, false)
	require.NoError(t, err)
	defer connection.Close()
	_, err = connection.client.Open("/etc/passwd")
	require.Error(t, err)
	err = connection.client.Symlink("/etc/passwd", filepath.Join(target.Directory, "ddnezha-123456789abc", "escape"))
	require.Error(t, err)
	_, err = connection.client.OpenFile(result.Archive, os.O_WRONLY|os.O_TRUNC)
	require.Error(t, err)
	require.Error(t, connection.client.Remove(result.Archive))
	session, err := connection.ssh.NewSession()
	if err == nil {
		_, err = session.CombinedOutput("id")
		session.Close()
	}
	require.Error(t, err)
}
func TestPlainBackupHostIdentityAndInterruptedTransfer(t *testing.T) {
	source, _ := testSource(t)
	snap, err := Prepare(context.Background(), source, func(string) {})
	require.NoError(t, err)
	defer snap.Close()
	target, key, _ := testReceiver(t, "112233445566")
	result, err := Transfer(context.Background(), target, key, "112233445566", snap, 2, func(Delivery) {})
	require.NoError(t, err)
	require.Contains(t, readArchive(t, result.Archive, ""), "data/sqlite.db")
	wrong := target
	wrong.Fingerprint = "SHA256:wrong"
	_, err = Probe(context.Background(), wrong, key)
	require.ErrorContains(t, err, "指纹")
	_, wrongKey := testIdentity(t)
	_, err = Probe(context.Background(), target, wrongKey)
	require.Error(t, err)
	require.NotContains(t, err.Error(), wrongKey)
	// Cancellation must remove a partial file and never advertise completion.
	ctx, cancel := context.WithCancel(context.Background())
	_, err = Transfer(ctx, target, key, "112233445566", snap, 3, func(d Delivery) {
		if d.Phase == "transferring" {
			cancel()
		}
	})
	require.Error(t, err)
	files, err := os.ReadDir(filepath.Join(target.Directory, "ddnezha-112233445566"))
	require.NoError(t, err)
	for _, f := range files {
		require.NotContains(t, f.Name(), "000003.tar.gz")
	}
}
func waitBackup(t *testing.T, m *Manager) History {
	t.Helper()
	require.Eventually(t, func() bool { view, e := m.Overview(); return e == nil && view.Active == nil }, 20*time.Second, 10*time.Millisecond)
	history, err := m.History(1, 10)
	require.NoError(t, err)
	return history
}
func TestMultiTargetPartialFailureRetryNoSecretDisclosure(t *testing.T) {
	source, db := testSource(t)
	m, err := New(db, source)
	require.NoError(t, err)
	defer m.Close()
	good, key, stop := testReceiver(t, m.installation)
	good.ID = 0
	saved, err := m.SaveTarget(TargetInput{Target: good, PrivateKey: key})
	require.NoError(t, err)
	bad := good
	bad.ID = 0
	bad.Name = "offline"
	bad.Port = 1
	savedBad, err := m.SaveTarget(TargetInput{Target: bad, PrivateKey: key})
	require.Error(t, err) // Receiver ports cannot target SSH/system ports.
	bad.Port = 65534
	savedBad, err = m.SaveTarget(TargetInput{Target: bad, PrivateKey: key})
	require.NoError(t, err)
	plan := Plan{Mode: "manual", TargetIDs: []uint64{saved.ID, savedBad.ID}}
	require.NoError(t, m.SavePlan(plan, ""))
	first, err := m.Start("manual", nil, 0)
	require.NoError(t, err)
	history := waitBackup(t, m)
	require.Equal(t, "partial", history.Items[0].State)
	require.Len(t, history.Items[0].Deliveries, 2)
	require.Equal(t, "success", history.Items[0].Deliveries[0].State)
	require.Equal(t, "failed", history.Items[0].Deliveries[1].State)
	require.NotEmpty(t, history.Items[0].Deliveries[1].Error)
	_, err = m.Start("retry", []uint64{saved.ID}, first)
	require.Error(t, err)
	_, err = m.Start("retry", []uint64{savedBad.ID}, first)
	require.NoError(t, err)
	history = waitBackup(t, m)
	require.Equal(t, first, history.Items[0].RetryOf)
	require.Len(t, history.Items[0].Deliveries, 1)
	view, err := m.Overview()
	require.NoError(t, err)
	body, err := json.Marshal(view)
	require.NoError(t, err)
	require.NotContains(t, string(body), key)
	require.NotContains(t, string(body), saved.Secret)
	var persisted Target
	require.NoError(t, db.First(&persisted, saved.ID).Error)
	require.NotContains(t, persisted.Secret, "PRIVATE KEY")
	stop()
}
func TestConcurrentRunsCancellationScheduleAndRestart(t *testing.T) {
	source, db := testSource(t)
	m, err := New(db, source)
	require.NoError(t, err)
	target, key, _ := testReceiver(t, m.installation)
	saved, err := m.SaveTarget(TargetInput{Target: target, PrivateKey: key})
	require.NoError(t, err)
	require.NoError(t, m.SavePlan(Plan{Mode: "interval", IntervalMinutes: 10, TargetIDs: []uint64{saved.ID}}, ""))
	entered := make(chan struct{})
	m.prepare = func(ctx context.Context, _ Source, _ func(string)) (*Snapshot, error) {
		close(entered)
		<-ctx.Done()
		return nil, ctx.Err()
	}
	id, err := m.Start("manual", nil, 0)
	require.NoError(t, err)
	<-entered
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); _, e := m.Start("manual", nil, 0); require.Error(t, e) }()
	}
	wg.Wait()
	require.Error(t, m.DeleteTarget(saved.ID))
	require.NoError(t, m.Cancel(id))
	history := waitBackup(t, m)
	require.Equal(t, "cancelled", history.Items[0].State)
	view, err := m.Overview()
	require.NoError(t, err)
	require.NotNil(t, view.Plan.NextAt)
	require.WithinDuration(t, time.Now().Add(10*time.Minute), *view.Plan.NextAt, time.Second*5)
	before := view.Plan.NextAt
	require.NoError(t, m.SavePlan(view.Plan, ""))
	view, _ = m.Overview()
	require.Equal(t, before, view.Plan.NextAt)
	m.Close()
	stale := Run{State: "running", StartedAt: time.Now(), Deliveries: []Delivery{{TargetID: saved.ID, State: "queued"}}}
	require.NoError(t, db.Create(&stale).Error)
	restarted, err := New(db, source)
	require.NoError(t, err)
	defer restarted.Close()
	history, err = restarted.History(1, 10)
	require.NoError(t, err)
	require.Equal(t, "interrupted", history.Items[0].State)
	require.Equal(t, "interrupted", history.Items[0].Deliveries[0].State)
	require.NotEmpty(t, history.Items[0].Error)
}
func TestSnapshotFailureAndSymlinkCleanup(t *testing.T) {
	source, _ := testSource(t)
	outside := filepath.Join(t.TempDir(), "outside")
	require.NoError(t, os.WriteFile(outside, []byte("must-not-read"), 0600))
	require.NoError(t, os.Symlink(outside, filepath.Join(source.DataDir, "escaped")))
	_, err := Prepare(context.Background(), source, func(string) {})
	require.ErrorContains(t, err, "符号链接")
	entries, err := os.ReadDir(source.DataDir)
	require.NoError(t, err)
	for _, e := range entries {
		require.False(t, strings.HasPrefix(e.Name(), ".ddnz-backup-"))
	}
}
func TestPlanValidationAndKeyLoss(t *testing.T) {
	for _, p := range []Plan{{Mode: "unknown"}, {Mode: "daily", DailyTime: "25:00"}, {Mode: "interval", IntervalMinutes: 0}, {Mode: "manual", TargetIDs: []uint64{1, 1}}} {
		require.Error(t, ValidatePlan(p))
	}
	now := time.Date(2026, 11, 15, 22, 0, 0, 0, time.FixedZone("CST", 8*3600))
	next := NextTime(Plan{Mode: "daily", DailyTime: "03:00"}, now)
	require.Equal(t, 16, next.Day())
	require.Equal(t, 3, next.Hour())
	source, db := testSource(t)
	m, err := New(db, source)
	require.NoError(t, err)
	defer m.Close()
	require.NoError(t, m.SavePlan(Plan{Mode: "manual", Encrypt: true}, "fixture-secret-encryption-password"))
	require.NoError(t, os.Remove(filepath.Join(source.DataDir, "backup-credentials.key")))
	_, err = New(db, source)
	require.Error(t, err)
}

func TestReceiverRejectsNonBackupCapabilities(t *testing.T) {
	target, key, _ := testReceiver(t, "123456789abc")
	signer, err := ssh.ParsePrivateKey([]byte(key))
	require.NoError(t, err)
	dial := func() *ssh.Client {
		c, e := ssh.Dial("tcp", net.JoinHostPort(target.Host, fmt.Sprint(target.Port)), &ssh.ClientConfig{
			User: target.User, Auth: []ssh.AuthMethod{ssh.PublicKeys(signer)}, Timeout: 3 * time.Second,
			HostKeyCallback: func(_ string, _ net.Addr, k ssh.PublicKey) error {
				if ssh.FingerprintSHA256(k) != target.Fingerprint {
					return errors.New("identity mismatch")
				}
				return nil
			},
		})
		require.NoError(t, e)
		t.Cleanup(func() { c.Close() })
		return c
	}
	for _, kind := range []string{"shell", "exec", "pty", "forward-local", "forward-remote", "extra-session"} {
		t.Run(kind, func(t *testing.T) {
			c := dial()
			defer c.Close()
			timer := time.AfterFunc(3*time.Second, func() { c.Close() })
			defer timer.Stop()
			switch kind {
			case "forward-local":
				_, e := c.Dial("tcp", "127.0.0.1:22")
				require.Error(t, e)
			case "forward-remote":
				_, e := c.Listen("tcp", "127.0.0.1:0")
				require.Error(t, e)
			case "extra-session":
				s, e := sftp.NewClient(c)
				require.NoError(t, e)
				defer s.Close()
				_, e = c.NewSession()
				require.ErrorContains(t, e, "SFTP only")
			default:
				s, e := c.NewSession()
				require.NoError(t, e)
				defer s.Close()
				switch kind {
				case "shell":
					require.Error(t, s.Shell())
				case "exec":
					require.Error(t, s.Run("id"))
				case "pty":
					require.Error(t, s.RequestPty("xterm", 80, 24, ssh.TerminalModes{}))
				}
			}
		})
	}
}
