package singleton

import (
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"sync"
)

var agentCredentials = struct {
	sync.RWMutex
	db     *gorm.DB
	ready  bool
	aead   cipher.AEAD
	byUUID map[string]model.AgentCredential
	byHash map[string]string
}{}

func AgentCredentialsReady() bool {
	agentCredentials.RLock()
	defer agentCredentials.RUnlock()
	return agentCredentials.ready && agentCredentials.db == DB
}
func AgentCredentialHash(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}
func credentialDB() *gorm.DB {
	return DB.Session(&gorm.Session{Logger: logger.Default.LogMode(logger.Silent)})
}
func InitAgentCredentials(keyPath string) error {
	var count, rejected int64
	if err := credentialDB().Model(&model.AgentCredential{}).Count(&count).Error; err != nil {
		return err
	}
	if err := credentialDB().Model(&model.AgentCredentialRejection{}).Where("length(secret_sealed) > 0").Count(&rejected).Error; err != nil {
		return err
	}
	aead, err := loadTerminalCommandCipher(keyPath, count+rejected > 0)
	if err != nil {
		return err
	}
	var rows []model.AgentCredential
	if err = credentialDB().Find(&rows).Error; err != nil {
		return err
	}
	agentCredentials.Lock()
	defer agentCredentials.Unlock()
	agentCredentials.db = DB
	agentCredentials.aead = aead
	agentCredentials.byUUID = make(map[string]model.AgentCredential, len(rows))
	agentCredentials.byHash = make(map[string]string, len(rows))
	for _, row := range rows {
		agentCredentials.byUUID[row.UUID] = row
		agentCredentials.byHash[row.SecretHash] = row.UUID
	}
	agentCredentials.ready = true
	return nil
}
func agentCredentialCipher() (cipher.AEAD, error) {
	agentCredentials.RLock()
	defer agentCredentials.RUnlock()
	if agentCredentials.aead == nil {
		return nil, errors.New("credential cipher unavailable")
	}
	return agentCredentials.aead, nil
}
func SealAgentSecret(secret string) ([]byte, error) {
	aead, err := agentCredentialCipher()
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return nil, err
	}
	return aead.Seal(nonce, nonce, []byte(secret), []byte("nezha-agent-credential-v1")), nil
}
func OpenAgentSecret(sealed []byte) (string, error) {
	aead, err := agentCredentialCipher()
	if err != nil {
		return "", err
	}
	if len(sealed) < aead.NonceSize() {
		return "", errors.New("credential unavailable")
	}
	plain, err := aead.Open(nil, sealed[:aead.NonceSize()], sealed[aead.NonceSize():], []byte("nezha-agent-credential-v1"))
	if err != nil {
		return "", errors.New("credential unavailable")
	}
	return string(plain), nil
}
func AgentCredentialByUUID(uuid string) (model.AgentCredential, bool) {
	agentCredentials.RLock()
	defer agentCredentials.RUnlock()
	if !agentCredentials.ready || agentCredentials.db != DB {
		return model.AgentCredential{}, false
	}
	row, ok := agentCredentials.byUUID[uuid]
	return row, ok
}
func AgentCredentialBySecret(secret string) (model.AgentCredential, bool) {
	hash := AgentCredentialHash(secret)
	agentCredentials.RLock()
	defer agentCredentials.RUnlock()
	if !agentCredentials.ready || agentCredentials.db != DB {
		return model.AgentCredential{}, false
	}
	value, ok := agentCredentials.byHash[hash]
	if !ok {
		return model.AgentCredential{}, false
	}
	return agentCredentials.byUUID[value], true
}
func publishAgentCredential(row model.AgentCredential) {
	agentCredentials.Lock()
	defer agentCredentials.Unlock()
	if previous, ok := agentCredentials.byUUID[row.UUID]; ok {
		delete(agentCredentials.byHash, previous.SecretHash)
	}
	agentCredentials.byUUID[row.UUID] = row
	agentCredentials.byHash[row.SecretHash] = row.UUID
}
