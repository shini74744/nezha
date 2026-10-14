package controller

import (
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

type rejectedAgentCredential struct {
	ID             string `json:"id"`
	UUID           string `json:"uuid"`
	Name           string `json:"name"`
	Fingerprint    string `json:"fingerprint"`
	LastIP         string `json:"last_ip"`
	FirstReportAt  int64  `json:"first_report_at"`
	LastReportAt   int64  `json:"last_report_at"`
	ReportCount    uint64 `json:"report_count"`
	BindingVersion uint64 `json:"binding_version"`
	BlockVersion   uint64 `json:"block_version"`
	Existing       bool   `json:"existing"`
	CanAdmit       bool   `json:"can_admit"`
	Reason         string `json:"reason"`
	Hash           string `json:"-"`
}

func listRejectedAgentCredentials(c *gin.Context) (*model.Value[[]rejectedAgentCredential], error) {
	limit, offset := operationPage(c)
	query := singleton.DB.Table("agent_credential_rejections AS r").
		Joins("LEFT JOIN servers AS s ON s.uuid=r.uuid").
		Joins("LEFT JOIN agent_credentials AS k ON k.uuid=r.uuid").
		Joins("LEFT JOIN server_deletion_tombstones AS d ON d.uuid=r.uuid").
		Where("r.accepted_at = 0")
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, err
	}
	rows := make([]rejectedAgentCredential, 0)
	err := query.Select(`r.id,r.uuid,COALESCE(s.name,d.name,'') AS name,r.fingerprint,r.secret_hash AS hash,r.last_ip,
 r.first_report_at,r.last_report_at,r.report_count,COALESCE(k.version,0) AS binding_version,
 COALESCE(d.block_version,0) AS block_version,s.id IS NOT NULL AS existing,
 length(r.secret_sealed)>0 AND length(r.uuid)=36 AS can_admit`).
		Order("r.last_report_at DESC,r.id").Limit(limit).Offset(offset).Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for i := range rows {
		row := &rows[i]
		row.Reason = "未登记或不匹配的认证信息"
		if !row.CanAdmit {
			row.Reason = "认证信息不完整，不能放行"
			continue
		}
		if current, ok := singleton.AgentCredentialByUUID(row.UUID); ok && current.SecretHash != row.Hash {
			row.Reason = "此 UUID 已有其他密钥；放行将替换原认证"
		}
		var collision int64
		if err := singleton.DB.Model(&model.AgentCredential{}).Where("secret_hash = ? AND uuid <> ?", row.Hash, row.UUID).Count(&collision).Error; err != nil {
			return nil, err
		}
		if collision > 0 {
			row.CanAdmit = false
			row.Reason = "密钥已绑定其他 UUID，不能放行"
		}
		singleton.UserLock.RLock()
		for secret := range singleton.AgentSecretToUserId {
			if singleton.AgentCredentialHash(secret) == row.Hash {
				row.CanAdmit = false
				row.Reason = "旧共享密钥不能用于新增节点"
			}
		}
		singleton.UserLock.RUnlock()
	}
	c.Header("Cache-Control", "no-store")
	return &model.Value[[]rejectedAgentCredential]{Value: rows, Pagination: model.Pagination{Total: total, Offset: offset, Limit: limit}}, nil
}
