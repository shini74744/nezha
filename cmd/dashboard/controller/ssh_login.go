package controller

import (
	"fmt"
	"net/http"
	"net/netip"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type sshLoginRow struct {
	ID     uint64               `json:"id"`
	Name   string               `json:"name"`
	Policy model.SSHLoginPolicy `json:"policy"`
	Status model.SSHLoginStatus `json:"status"`
}

func listSSHLogin(c *gin.Context) ([]sshLoginRow, error) {
	var servers []model.Server
	if err := singleton.DB.Select("id", "uuid", "name").Order("display_index DESC, id").Find(&servers).Error; err != nil {
		return nil, err
	}

	permitted := make([]model.Server, 0, len(servers))
	uuids := make([]string, 0, len(servers))
	for _, server := range servers {
		if patAllowsServer(c, server.ID) {
			permitted = append(permitted, server)
			uuids = append(uuids, server.UUID)
		}
	}
	policies := make(map[string]model.SSHLoginPolicy, len(uuids))
	for start := 0; start < len(uuids); start += 500 {
		var batch []model.SSHLoginPolicy
		if err := singleton.DB.Omit("block_data").Where("uuid IN ?", uuids[start:min(start+500, len(uuids))]).Find(&batch).Error; err != nil {
			return nil, err
		}
		for _, policy := range batch {
			policies[policy.UUID] = policy
		}
	}
	rows := make([]sshLoginRow, 0, len(permitted))
	summary := c.Query("summary") == "1"
	for _, server := range permitted {
		policy, ok := policies[server.UUID]
		if !ok {
			policy = model.DefaultSSHLoginPolicy()
			policy.UUID = server.UUID
		}
		st := singleton.SSHLoginStatusFor(server.UUID)
		if summary {
			// The paged endpoint reads the full Agent state separately. Keep the
			// legacy response unchanged unless this client explicitly opts in.
			st.BanTotal = max(st.BanTotal, len(st.Banned))
			st.Banned = []string{}
		}
		rows = append(rows, sshLoginRow{ID: server.ID, Name: server.Name, Policy: policy, Status: st})
	}

	return rows, nil
}
func saveSSHLogin(c *gin.Context) (any, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 262144)
	var f struct {
		ServerIDs []uint64             `json:"server_ids"`
		Policy    model.SSHLoginPolicy `json:"policy"`
	}
	if err := c.ShouldBindJSON(&f); err != nil {
		return nil, err
	}
	if len(f.ServerIDs) == 0 || len(f.ServerIDs) > 1000 {
		return nil, fmt.Errorf("请选择服务器")
	}
	for _, id := range f.ServerIDs {
		if id == 0 || !patAllowsServer(c, id) {
			return nil, fmt.Errorf("服务器选择无效或无权访问")
		}
	}
	if err := f.Policy.Validate(); err != nil {
		return nil, err
	}
	if err := singleton.CompileSSHBlacklist(c.Request.Context(), &f.Policy); err != nil {
		return nil, err
	}
	singleton.SSHLoginMu.Lock()
	defer singleton.SSHLoginMu.Unlock()
	err := singleton.DB.Transaction(func(tx *gorm.DB) error {
		var servers []model.Server
		if err := tx.Select("id", "uuid").Where("id IN ?", f.ServerIDs).Find(&servers).Error; err != nil {
			return err
		}
		if len(servers) != len(f.ServerIDs) {
			return fmt.Errorf("服务器选择无效或已被删除")
		}
		if f.Policy.Enabled && (f.Policy.Success || f.Policy.Failure) {
			var count int64
			if err := tx.Table("notification_group_notifications AS m").Joins("JOIN notifications AS n ON n.id=m.notification_id").Where("m.notification_group_id = ?", f.Policy.NotificationGroupID).Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				return fmt.Errorf("请选择包含通知方式的通知组")
			}
		}
		for i := range servers {
			s := &servers[i]
			var old model.SSHLoginPolicy
			if err := tx.Where("uuid = ?", s.UUID).Limit(1).Find(&old).Error; err != nil {
				return err
			}
			p := f.Policy
			if p.Engine() == "fail2ban" && old.Engine() != "fail2ban" {
				st := singleton.SSHLoginStatusFor(s.UUID)
				if !st.BackendSelection || time.Now().Unix()-st.UpdatedAt > 45 {
					return fmt.Errorf("请先升级并连接支持 Fail2ban 的 Linux Agent")
				}
			}
			p.UUID = s.UUID
			p.KeepSSHBlockTimes(old, time.Now().UnixMilli())
			p.Revision = old.Revision + 1
			if err := tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&p).Error; err != nil {
				return err
			}
		}
		return nil
	})
	return nil, err
}
func unbanSSHLogin(c *gin.Context) (any, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var f struct {
		ServerID uint64 `json:"server_id"`
		IP       string `json:"ip"`
	}
	if err := c.ShouldBindJSON(&f); err != nil {
		return nil, err
	}
	if f.ServerID == 0 || !patAllowsServer(c, f.ServerID) {
		return nil, fmt.Errorf("服务器选择无效或无权访问")
	}
	ip, err := netip.ParseAddr(f.IP)
	if err != nil || ip.Zone() != "" {
		return nil, fmt.Errorf("IP 地址无效")
	}
	var s model.Server
	if err = singleton.DB.Select("id", "uuid").First(&s, f.ServerID).Error; err != nil {
		return nil, err
	}

	singleton.SSHLoginMu.Lock()
	defer singleton.SSHLoginMu.Unlock()
	var pending []model.SSHUnbanCommand
	if err = singleton.DB.Where("uuid = ? AND done = ? AND created_at > ?", s.UUID, false, time.Now().Add(-10*time.Minute).Unix()).Find(&pending).Error; err != nil {
		return nil, err
	}
	for _, cmd := range pending {
		if cmd.IP == ip.Unmap().String() {
			return gin.H{"id": cmd.ID}, nil
		}
	}
	if len(pending) >= 32 {
		return nil, fmt.Errorf("待处理请求较多，请等待服务器确认")
	}
	command := model.SSHUnbanCommand{UUID: s.UUID, IP: ip.Unmap().String(), CreatedAt: time.Now().Unix()}
	if err = singleton.DB.Create(&command).Error; err != nil {
		return nil, err
	}
	return gin.H{"id": command.ID}, nil
}

func listSSHLoginEvents(c *gin.Context) ([]model.SSHLoginEvent, error) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 || !patAllowsServer(c, id) {
		return nil, fmt.Errorf("服务器无效")
	}
	var s model.Server
	if err = singleton.DB.Select("uuid").First(&s, id).Error; err != nil {
		return nil, err
	}
	return singleton.ReadSSHLocalEvents(c.Request.Context(), s.UUID)
}
