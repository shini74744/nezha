package controller

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"time"
)

type unusedAgentCredential struct {
	UUID        string    `json:"uuid"`
	Version     uint64    `json:"version"`
	CreatedAt   time.Time `json:"created_at"`
	Fingerprint string    `json:"fingerprint"`
}

func issueAgentCredential(c *gin.Context) (*singleton.AgentCredentialPair, error) {
	var request struct {
		UUID string `json:"uuid"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		return nil, err
	}
	user := c.MustGet(model.CtxKeyAuthorizedUser).(*model.User)
	owner := user.ID
	if request.UUID != "" {
		id, ok := singleton.ServerShared.UUIDToID(request.UUID)
		if !ok {
			return nil, errors.New("服务器不存在")
		}
		server, ok := singleton.ServerShared.Get(id)
		if !ok || server == nil || !server.HasPermission(c) {
			return nil, errors.New("无权访问服务器")
		}
		owner = server.GetUserID()
	}
	c.Header("Cache-Control", "no-store")
	return singleton.IssueAgentCredential(request.UUID, owner, model.ServerOperationActorFromContext(c))
}
func listUnusedAgentCredentials(c *gin.Context) (*model.Value[[]unusedAgentCredential], error) {
	user := c.MustGet(model.CtxKeyAuthorizedUser).(*model.User)
	limit, offset := operationPage(c)
	query := singleton.DB.Model(&model.AgentCredential{}).Where("owner_id = ? AND verified_at = 0", user.ID).
		Where("NOT EXISTS (SELECT 1 FROM servers s WHERE s.uuid = agent_credentials.uuid)").
		Where("NOT EXISTS (SELECT 1 FROM server_deletion_tombstones d WHERE d.uuid = agent_credentials.uuid AND d.released_at = 0)")
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	rows := make([]unusedAgentCredential, 0)
	if err := query.Select("uuid,version,created_at,substr(secret_hash,1,12) AS fingerprint").Order("created_at DESC,uuid ASC").Limit(limit).Offset(offset).Scan(&rows).Error; err != nil {
		return nil, err
	}
	c.Header("Cache-Control", "no-store")
	return &model.Value[[]unusedAgentCredential]{Value: rows, Pagination: model.Pagination{Total: total, Limit: limit, Offset: offset}}, nil
}
func reuseUnusedAgentCredential(c *gin.Context) (*singleton.AgentCredentialPair, error) {
	return handleUnusedAgentCredential(c, false)
}
func deleteUnusedAgentCredential(c *gin.Context) (*singleton.AgentCredentialPair, error) {
	return handleUnusedAgentCredential(c, true)
}
func handleUnusedAgentCredential(c *gin.Context, remove bool) (*singleton.AgentCredentialPair, error) {
	var request struct {
		UUID    string `json:"uuid" binding:"required"`
		Version uint64 `json:"version" binding:"required"`
	}
	if err := c.ShouldBindJSON(&request); err != nil {
		return nil, err
	}
	user := c.MustGet(model.CtxKeyAuthorizedUser).(*model.User)
	c.Header("Cache-Control", "no-store")
	return singleton.UnusedAgentCredentialPair(request.UUID, request.Version, user.ID, remove, model.ServerOperationActorFromContext(c))
}
func admitAgentCredential(c *gin.Context) (*model.Server, error) {
	var request singleton.AgentCredentialAdmission
	if err := c.ShouldBindJSON(&request); err != nil {
		return nil, err
	}
	if token := APITokenFromContext(c); token != nil && len(token.ServerIDs()) > 0 {
		return nil, errors.New("不能使用限定服务器的令牌放行未登记节点")
	}
	return singleton.AdmitAgentCredential(request, model.ServerOperationActorFromContext(c))
}

type credentialMigrationRow struct {
	ID      uint64 `json:"id"`
	UUID    string `json:"uuid"`
	Name    string `json:"name"`
	Status  string `json:"status"`
	Message string `json:"message"`
}

func listAgentCredentialMigrations(c *gin.Context) ([]credentialMigrationRow, error) {
	var servers []*model.Server
	if err := singleton.DB.Select("id,uuid,name,user_id").Order("display_index DESC,id ASC").Find(&servers).Error; err != nil {
		return nil, err
	}
	rows := make([]credentialMigrationRow, 0, len(servers))
	for _, server := range servers {
		if !server.HasPermission(c) {
			continue
		}
		row := credentialMigrationRow{ID: server.ID, UUID: server.UUID, Name: server.Name, Status: "legacy", Message: "待迁移"}
		if key, ok := singleton.AgentCredentialByUUID(server.UUID); ok {
			if key.VerifiedAt > 0 {
				row.Status, row.Message = "active", "独立密钥已生效"
			} else {
				row.Status, row.Message = "pending", "等待连接验证"
				if key.LastError != "" {
					row.Message = key.LastError
				}
			}
		}
		rows = append(rows, row)
	}
	return rows, nil
}
func migrateAgentCredentials(c *gin.Context) (int, error) {
	var ids []uint64
	if err := c.ShouldBindJSON(&ids); err != nil {
		return 0, err
	}
	if len(ids) == 0 || len(ids) > 500 {
		return 0, errors.New("每次请选择 1–500 台服务器")
	}
	var servers []*model.Server
	if err := singleton.DB.Where("id IN ?", ids).Find(&servers).Error; err != nil {
		return 0, err
	}
	for _, server := range servers {
		if !server.HasPermission(c) {
			return 0, errors.New("无权修改服务器")
		}
	}
	count := 0
	for _, server := range servers {
		pair, err := singleton.IssueAgentCredential(server.UUID, server.GetUserID(), model.ServerOperationActorFromContext(c))
		if err != nil {
			return count, err
		}
		if err = singleton.RequestAgentCredentialMigration(pair.UUID, pair.Version); err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}
