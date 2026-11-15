package backupreceiver

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"golang.org/x/crypto/ssh"
)

var userPattern = regexp.MustCompile("^ddnb_[a-f0-9]{12}_[a-f0-9]{8,16}$")

func validRoot(directory string) error {
	if !filepath.IsAbs(directory) || filepath.Clean(directory) != directory || directory == "/" || strings.ContainsAny(directory, "\x00\r\n\\") {
		return errors.New("请选择独立的绝对备份路径")
	}
	for _, base := range []string{"/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64", "/dev", "/proc", "/sys", "/boot", "/root"} {
		if directory == base || strings.HasPrefix(directory, base+"/") {
			return errors.New("不能将系统目录用作备份位置")
		}
	}
	for p := directory; p != "/"; p = filepath.Dir(p) {
		info, err := os.Lstat(p)
		if err == nil && info.Mode()&os.ModeSymlink != 0 {
			return errors.New("备份路径中存在符号链接")
		}
		if err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
func WritePrivate(file string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(file), ".ddnezha-write-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if err = f.Chmod(0600); err != nil {
		return err
	}
	if _, err = f.Write(data); err != nil {
		return err
	}
	if err = f.Sync(); err != nil {
		return err
	}
	if err = f.Close(); err != nil {
		return err
	}
	if err = os.Rename(f.Name(), file); err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(file))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
func Configure(configFile, keyFile, user, directory, publicKey string, port int) (string, error) {
	if !userPattern.MatchString(user) {
		return "", errors.New("备份账号格式错误")
	}
	key, _, _, _, err := ssh.ParseAuthorizedKey([]byte(publicKey))
	if err != nil || key.Type() != ssh.KeyAlgoED25519 {
		return "", errors.New("备份公钥格式错误")
	}
	if err = validRoot(directory); err != nil {
		return "", err
	}
	listen, err := ListenAddress(port)
	if err != nil {
		return "", err
	}
	if err = os.MkdirAll(filepath.Dir(configFile), 0700); err != nil {
		return "", err
	}
	lock, err := os.OpenFile(configFile+".lock", os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", errors.New("已有接收端配置任务正在执行，请稍后重试")
	}
	defer os.Remove(configFile + ".lock")
	defer lock.Close()
	config, err := ReadConfig(configFile)
	if os.IsNotExist(err) {
		config = Config{Listen: listen, Users: map[string]User{}}
	} else if err != nil {
		return "", err
	}
	if config.Listen != listen {
		return "", errors.New("接收端已使用其他端口，请填写原端口；本次未修改端口")
	}
	for name, u := range config.Users {
		if name == user {
			if u.Directory != directory {
				return "", errors.New("此备份账号已绑定其他目录，请新建备份目标")
			}
			continue
		}
		if directory == u.Directory || strings.HasPrefix(directory, u.Directory+"/") || strings.HasPrefix(u.Directory, directory+"/") {
			return "", errors.New("此目录已分配给其他备份目标，请选择独立目录")
		}
	}
	_, registered := config.Users[user]
	if info, e := os.Lstat(directory); e == nil {
		if !info.IsDir() {
			return "", errors.New("备份位置不是目录")
		}
		if !registered {
			entries, e := os.ReadDir(directory)
			if e != nil {
				return "", e
			}
			if len(entries) != 0 {
				return "", errors.New("目录已有其他文件，请选择空目录")
			}
		}
	} else if !os.IsNotExist(e) {
		return "", e
	}
	if err = os.MkdirAll(directory, 0700); err != nil {
		return "", err
	}
	// No recursive chmod/chown: only the selected empty/new backup directory.
	if err = os.Chmod(directory, 0700); err != nil {
		return "", err
	}
	hostPEM, err := os.ReadFile(keyFile)
	if os.IsNotExist(err) {
		if len(config.Users) > 0 {
			return "", errors.New("已有接收端缺少身份密钥，已停止，不能静默替换身份")
		}
		_, private, e := ed25519.GenerateKey(rand.Reader)
		if e != nil {
			return "", e
		}
		block, e := ssh.MarshalPrivateKey(private, "DDnezha backup receiver")
		if e != nil {
			return "", e
		}
		hostPEM = pem.EncodeToMemory(block)
		if err = WritePrivate(keyFile, hostPEM); err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	}
	signer, err := ssh.ParsePrivateKey(hostPEM)
	if err != nil {
		return "", fmt.Errorf("接收端身份密钥损坏")
	}
	config.Users[user] = User{PublicKey: strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key))), Directory: directory}
	body, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return "", err
	}
	if err = WritePrivate(configFile, body); err != nil {
		return "", err
	}
	return ssh.FingerprintSHA256(signer.PublicKey()), nil
}
