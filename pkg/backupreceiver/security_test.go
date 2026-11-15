package backupreceiver

import (
	"crypto/ed25519"
	"crypto/rand"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pkg/sftp"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/ssh"
)

func publicKey(t *testing.T) string {
	t.Helper()
	pub, _, e := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, e)
	key, e := ssh.NewPublicKey(pub)
	require.NoError(t, e)
	return strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key)))
}
func TestConfigureIdentityPreservedAndBusinessDataUntouched(t *testing.T) {
	dir := t.TempDir()
	config := filepath.Join(dir, "config", "receiver.json")
	host := filepath.Join(dir, "config", "host-key")
	data := filepath.Join(dir, "backups")
	user := "ddnb_123456789abc_11223344"
	pub := publicKey(t)
	fp, e := Configure(config, host, user, data, pub, 2022)
	require.NoError(t, e)
	require.True(t, strings.HasPrefix(fp, "SHA256:"))
	first, e := os.ReadFile(host)
	require.NoError(t, e)
	again, e := Configure(config, host, user, data, pub, 2022)
	require.NoError(t, e)
	require.Equal(t, fp, again)
	after, e := os.ReadFile(host)
	require.NoError(t, e)
	require.Equal(t, first, after)
	loaded, e := ReadConfig(config)
	require.NoError(t, e)
	require.Equal(t, ":2022", loaded.Listen)
	require.Equal(t, pub, loaded.Users[user].PublicKey)
	_, e = Configure(config, host, "ddnb_123456789abc_aabbccdd", data, publicKey(t), 2022)
	require.ErrorContains(t, e, "其他备份目标")
	business := filepath.Join(dir, "business")
	require.NoError(t, os.Mkdir(business, 0755))
	require.NoError(t, os.Chmod(business, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(business, "keep"), []byte("untouched"), 0644))
	_, e = Configure(config, host, "ddnb_123456789abc_aabbccdd", business, pub, 2022)
	require.ErrorContains(t, e, "已有其他文件")
	content, e := os.ReadFile(filepath.Join(business, "keep"))
	require.NoError(t, e)
	require.Equal(t, "untouched", string(content))
	info, e := os.Stat(business)
	require.NoError(t, e)
	require.Equal(t, os.FileMode(0755), info.Mode().Perm())
	_, e = Configure(config, host, user, data, pub, 22)
	require.Error(t, e)
	_, e = Configure(config, host, user, data, pub, 2023)
	require.ErrorContains(t, e, "其他端口")
	require.NoError(t, os.Remove(host))
	_, e = Configure(config, host, user, data, pub, 2022)
	require.ErrorContains(t, e, "身份密钥")
}
func TestRootBoundariesSymlinksAndOldBackups(t *testing.T) {
	root := t.TempDir()
	user := "ddnb_123456789abc_11223344"
	folder := "ddnezha-123456789abc"
	fs, e := NewFilesystem(root, user)
	require.NoError(t, e)
	defer fs.Close()
	require.NoError(t, os.Mkdir(filepath.Join(root, folder), 0700))
	external := filepath.Join(t.TempDir(), "business-secret")
	require.NoError(t, os.WriteFile(external, []byte("outside"), 0600))
	require.NoError(t, os.Symlink(external, filepath.Join(root, folder, "escape")))
	for _, p := range []string{"/etc/passwd", root + "/../outside", root + "/" + folder + "/escape", root + "/ddnezha-other/file"} {
		_, e = fs.Fileread(sftp.NewRequest("Get", p))
		require.Error(t, e, p)
	}
	old := filepath.Join(root, folder, "old.tar.gz")
	require.NoError(t, os.WriteFile(old, []byte("keep"), 0600))
	require.Error(t, fs.Filecmd(sftp.NewRequest("Remove", old)))
	require.Error(t, fs.Filecmd(&sftp.Request{Method: "Rename", Filepath: old, Target: old + ".new"}))
	require.Error(t, fs.Filecmd(&sftp.Request{Method: "Symlink", Filepath: external, Target: root + "/" + folder + "/link"}))
	require.Error(t, fs.Filecmd(&sftp.Request{Method: "Link", Filepath: external, Target: root + "/" + folder + "/link"}))
	require.Error(t, fs.Filecmd(sftp.NewRequest("Remove", root)))
	r, e := fs.Fileread(sftp.NewRequest("Get", old))
	require.NoError(t, e)
	defer r.(io.Closer).Close()
	buf := make([]byte, 4)
	_, e = r.ReadAt(buf, 0)
	require.NoError(t, e)
	require.Equal(t, "keep", string(buf))
}
func TestConfigureRejectsEscapingPaths(t *testing.T) {
	dir := t.TempDir()
	pub := publicKey(t)
	for _, root := range []string{"/", "/etc", "/etc/backup", "relative", "/tmp/../etc", "/var/backups\nExecStart=evil"} {
		_, e := Configure(filepath.Join(dir, "config"), filepath.Join(dir, "key"), "ddnb_123456789abc_11223344", root, pub, 2022)
		require.Error(t, e)
	}
	link := filepath.Join(dir, "linked")
	require.NoError(t, os.Symlink(t.TempDir(), link))
	_, e := Configure(filepath.Join(dir, "config"), filepath.Join(dir, "key"), "ddnb_123456789abc_11223344", filepath.Join(link, "backups"), pub, 2022)
	require.ErrorContains(t, e, "符号链接")
}
