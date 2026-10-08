package singleton

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/nezhahq/nezha/model"
)

// Dedicated at-rest key. Back up this file together with sqlite.db.
var TerminalCommandCipher cipher.AEAD

func loadTerminalCommandCipher(path string, hasRows bool) (cipher.AEAD, error) {
	file, err := openPrivateTerminalKey(path, false)
	var key []byte
	if errors.Is(err, os.ErrNotExist) {
		if hasRows {
			return nil, errors.New("terminal command key missing; restore terminal-commands.key from backup")
		}
		key = make([]byte, 32)
		if _, err = rand.Read(key); err != nil {
			return nil, err
		}
		file, err = openPrivateTerminalKey(path, true)
		if err != nil {
			return nil, err
		}
		_, err = file.Write(key)
		if err == nil {
			err = file.Sync()
		}
	} else if err != nil {
		return nil, err
	} else {
		// Read only the checked, open file; reject oversized keys without unbounded allocation.
		key, err = io.ReadAll(io.LimitReader(file, 33))
	}
	closeErr := file.Close()
	if err != nil {
		return nil, err
	}
	if closeErr != nil {
		return nil, closeErr
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
