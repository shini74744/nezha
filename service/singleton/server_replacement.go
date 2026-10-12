package singleton

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"github.com/nezhahq/nezha/model"
	"gorm.io/gorm"
	"strings"
	"sync"
	"time"
)

const replacementPrefix = "nzreplace_"

func replacementHash(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}
func IsReplacementSecret(secret string) bool { return strings.HasPrefix(secret, replacementPrefix) }
func IssueServerReplacement(uuid string, actor model.ServerOperationActor) (string, time.Time, error) {
	ServerMutationMu.Lock()
	defer ServerMutationMu.Unlock()
	if ServerIDReassignmentInProgress.Load() {
		return "", time.Time{}, errors.New("服务器 ID 正在调整")
	}
	var server model.Server
	if err := DB.Where("uuid = ?", uuid).First(&server).Error; err != nil {
		return "", time.Time{}, err
	}
	if ServerTransferShared != nil {
		if _, ok := ServerTransferShared.LookupPending(server.ID); ok {
			return "", time.Time{}, errors.New("请先完成服务器归属转移")
		}
	}
	token := make([]byte, 32)
	if _, err := rand.Read(token); err != nil {
		return "", time.Time{}, err
	}
	secret := replacementPrefix + hex.EncodeToString(token)
	expires := time.Now().Add(2 * time.Hour)
	err := DB.Transaction(func(tx *gorm.DB) error {
		var clearing int64
		if err := tx.Model(&model.ServerReplacement{}).Where("server_uuid = ? AND state = ?", uuid, "clearing").Count(&clearing).Error; err != nil {
			return err
		}
		if clearing > 0 {
			return errors.New("换机清理正在进行，请等待完成")
		}
		if err := tx.Where("server_uuid = ? AND state = ?", uuid, "pending").Delete(&model.ServerReplacement{}).Error; err != nil {
			return err
		}
		return tx.Create(&model.ServerReplacement{ServerUUID: uuid, OwnerID: server.GetUserID(), TokenHash: replacementHash(secret), State: "pending", ExpiresAt: expires, ActorID: actor.ID, ActorName: actor.Name}).Error
	})
	return secret, expires, err
}
func AuthorizeServerReplacement(secret, uuid string) (*model.ServerReplacement, *model.Server, error) {
	if !IsReplacementSecret(secret) {
		return nil, nil, nil
	}
	var row model.ServerReplacement
	if DB == nil {
		return nil, nil, errors.New("replacement credential unavailable")
	}
	if err := DB.Where("token_hash = ? AND server_uuid = ?", replacementHash(secret), uuid).First(&row).Error; err != nil {
		return nil, nil, errors.New("换机凭据无效")
	}
	if row.State != "active" && row.State != "clearing" && (row.State != "pending" || time.Now().After(row.ExpiresAt)) {
		return nil, nil, errors.New("换机命令已过期，请重新生成")
	}
	id, ok := ServerShared.UUIDToID(uuid)
	if !ok {
		return nil, nil, errors.New("服务器不存在")
	}
	server, ok := ServerShared.Get(id)
	if !ok || server.GetUserID() != row.OwnerID {
		return nil, nil, errors.New("服务器归属已变化")
	}
	return &row, server, nil
}

var replacementClearing sync.Map

func ServerReplacementClearing(uuid string) bool { _, ok := replacementClearing.Load(uuid); return ok }
func initReplacementClearing() error {
	var rows []model.ServerReplacement
	if err := DB.Where("state = ?", "clearing").Find(&rows).Error; err != nil {
		return err
	}
	replacementClearing.Clear()
	for _, row := range rows {
		replacementClearing.Store(row.ServerUUID, true)
	}
	return nil
}
