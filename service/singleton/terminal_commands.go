package singleton

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/nezhahq/nezha/model"
)

// Dedicated at-rest key. Back up this file together with sqlite.db.
var TerminalCommandCipher cipher.AEAD

func loadTerminalCommandCipher(path string, hasRows bool) (cipher.AEAD, error) {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		if hasRows {
			return nil, errors.New("terminal command key missing; restore terminal-commands.key from backup")
		}
		key := make([]byte, 32)
		if _, err = rand.Read(key); err != nil {
			return nil, err
		}
		file, createErr := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if createErr != nil {
			return nil, createErr
		}
		_, err = file.Write(key)
		if err == nil {
			err = file.Sync()
		}
		closeErr := file.Close()
		if err != nil {
			return nil, err
		}
		if closeErr != nil {
			return nil, closeErr
		}
	} else if err != nil {
		return nil, err
	} else if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("terminal command key must be a regular private file (0600)")
	}
	key, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(key) != 32 {
		return nil, errors.New("invalid terminal command key length")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
func initTerminalCommandCipher(dbPath string) error {
	var count int64
	if err := DB.Model(&model.TerminalCommand{}).Count(&count).Error; err != nil {
		return err
	}
	aead, err := loadTerminalCommandCipher(filepath.Join(filepath.Dir(dbPath), "terminal-commands.key"), count > 0)
	if err != nil {
		return fmt.Errorf("initialize terminal command encryption: %w", err)
	}
	TerminalCommandCipher = aead
	return nil
}
func terminalCommandAAD(uid uint64) []byte {
	return []byte("nezha-terminal-command:v1:" + strconv.FormatUint(uid, 10))
}
func EncryptTerminalCommand(uid uint64, command string) (string, error) {
	if TerminalCommandCipher == nil {
		return "", errors.New("快捷命令加密服务未就绪")
	}
	nonce := make([]byte, TerminalCommandCipher.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", errors.New("快捷命令加密失败")
	}
	sealed := TerminalCommandCipher.Seal(nonce, nonce, []byte(command), terminalCommandAAD(uid))
	return "v1:" + base64.RawStdEncoding.EncodeToString(sealed), nil
}
func DecryptTerminalCommand(uid uint64, ciphertext string) (string, error) {
	failure := errors.New("快捷命令解密失败，请检查服务端加密密钥及备份")
	if TerminalCommandCipher == nil || !strings.HasPrefix(ciphertext, "v1:") {
		return "", failure
	}
	payload, err := base64.RawStdEncoding.DecodeString(strings.TrimPrefix(ciphertext, "v1:"))
	size := TerminalCommandCipher.NonceSize()
	if err != nil || len(payload) < size+TerminalCommandCipher.Overhead() {
		return "", failure
	}
	plain, err := TerminalCommandCipher.Open(nil, payload[:size], payload[size:], terminalCommandAAD(uid))
	if err != nil {
		return "", failure
	}
	return string(plain), nil
}
