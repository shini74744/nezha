package panelbackup

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/ssh"
)

func shellQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'" }
func (m *Manager) PrepareKey(input TargetInput) (Target, string, error) {
	t := input.Target
	t.Transport = "sftp"
	t.AuthType = "key"
	nonce := make([]byte, 8)
	if _, e := rand.Read(nonce); e != nil {
		return t, "", e
	}
	t.User = "ddnb_" + m.installation + "_" + hex.EncodeToString(nonce)
	t.Receiver = true
	t.Fingerprint = "SHA256:pending"
	if err := ValidateTarget(t); err != nil {
		return t, "", err
	}
	if t.ID != 0 {
		return t, "", errors.New("请新建专用备份连接；已有连接可以直接重新测试")
	}
	_, private, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return t, "", err
	}
	block, err := ssh.MarshalPrivateKey(private, "DDnezha backup")
	if err != nil {
		return t, "", err
	}
	input.Target = t
	input.PrivateKey = string(pem.EncodeToMemory(block))
	target, err := m.SaveTarget(input)
	if err != nil {
		return t, "", err
	}
	command, err := m.SetupCommand(target.ID)
	return target, command, err
}
func (m *Manager) SetupCommand(id uint64) (string, error) {
	var t Target
	if err := m.db.First(&t, id).Error; err != nil {
		return "", errors.New("备份目标不存在")
	}
	if t.AuthType != "key" || !strings.HasPrefix(t.User, "ddnb_"+m.installation+"_") {
		return "", errors.New("此连接使用已有账号，请手动配置")
	}
	secret, err := unseal(m.cipher, t.Secret)
	if err != nil {
		return "", err
	}
	signer, err := ssh.ParsePrivateKey([]byte(secret))
	if err != nil {
		return "", err
	}
	publicKey := strings.TrimSpace(string(ssh.MarshalAuthorizedKey(signer.PublicKey())))
	if err = ValidateTarget(t); err != nil {
		return "", err
	}

	return receiverInstallCommand(t.User, t.Directory, publicKey, t.Port), nil
}

const ReceiverVersion = "v0.1.1"
const receiverInstallerSHA256 = "6833898f70931089ba9152038080f41a6486ce977af87e517df060b0b7c34229"

func receiverInstallCommand(user, directory, publicKey string, port int) string {
	return fmt.Sprintf(`sh <<'DDNEZHA_BACKUP_INSTALL'
set -eu
umask 077
command -v sha256sum >/dev/null 2>&1 || { echo '缺少 sha256sum，无法校验安装脚本'; exit 1; }
task_script=$(mktemp /tmp/ddnezha-backup-setup.XXXXXX)
trap 'rm -f -- "$task_script"' EXIT
trap 'exit 130' INT TERM HUP
if command -v curl >/dev/null 2>&1; then
 curl -fL --proto '=https' --tlsv1.2 --connect-timeout 15 --max-time 60 %s -o "$task_script"
elif command -v wget >/dev/null 2>&1; then
 wget -T 60 -O "$task_script" %s
else
 echo '缺少 curl 或 wget，无法下载安装脚本'; exit 1
fi
printf '%%s  %%s\n' %s "$task_script" | sha256sum -c -
env DDNZ_BACKUP_USER=%s DDNZ_BACKUP_DIRECTORY=%s DDNZ_BACKUP_PUBLIC_KEY=%s DDNZ_BACKUP_PORT=%s sh "$task_script"
DDNEZHA_BACKUP_INSTALL`, shellQuote("https://raw.githubusercontent.com/shini74744/nezha/backup-"+ReceiverVersion+"/backup/scripts/install.sh"), shellQuote("https://raw.githubusercontent.com/shini74744/nezha/backup-"+ReceiverVersion+"/backup/scripts/install.sh"), shellQuote(receiverInstallerSHA256), shellQuote(user), shellQuote(directory), shellQuote(publicKey), shellQuote(fmt.Sprint(port)))
}
