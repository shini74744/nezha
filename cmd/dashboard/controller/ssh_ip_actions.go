package controller

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"net/http"
	"net/netip"
	"slices"
	"strconv"
	"time"
)

func listSSHLoginBans(c *gin.Context) (model.SSHBanPage, error) {
	var empty model.SSHBanPage
	id, e := strconv.ParseUint(c.Param("id"), 10, 64)
	if e != nil || id == 0 || !patAllowsServer(c, id) {
		return empty, fmt.Errorf("服务器无效")
	}
	page, e := strconv.Atoi(c.DefaultQuery("page", "1"))
	if e != nil {
		return empty, fmt.Errorf("页码无效")
	}
	size, e := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if e != nil {
		return empty, fmt.Errorf("每页条数无效")
	}
	var s model.Server
	if e = singleton.DB.Select("uuid").First(&s, id).Error; e != nil {
		return empty, e
	}
	return singleton.ReadSSHLocalBans(c.Request.Context(), s.UUID, c.Query("search"), page, size)
}
func sshLoginIPAction(c *gin.Context) (any, error) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	var f struct {
		ServerID uint64 `json:"server_id"`
		IP       string `json:"ip"`
		Action   string `json:"action"`
		Revision uint64 `json:"revision"`
	}
	if e := c.ShouldBindJSON(&f); e != nil {
		return nil, e
	}
	if f.ServerID == 0 || !patAllowsServer(c, f.ServerID) {
		return nil, fmt.Errorf("服务器无效或无权访问")
	}
	ip, e := netip.ParseAddr(f.IP)
	if e != nil || ip.Zone() != "" || ip.IsUnspecified() || ip.IsMulticast() {
		return nil, fmt.Errorf("IP 地址无效")
	}
	ip = ip.Unmap()
	if f.Action != "whitelist" && f.Action != "blacklist" {
		return nil, fmt.Errorf("操作无效")
	}
	if f.Action == "blacklist" && ip.IsLoopback() {
		return nil, fmt.Errorf("不能拉黑本机回环地址")
	}
	singleton.SSHLoginMu.Lock()
	defer singleton.SSHLoginMu.Unlock()
	var revision uint64
	var commandID uint64
	e = singleton.DB.Transaction(func(tx *gorm.DB) error {
		var s model.Server
		if err := tx.Select("id", "uuid").First(&s, f.ServerID).Error; err != nil {
			return err
		}
		p := model.DefaultSSHLoginPolicy()
		p.UUID = s.UUID
		if err := tx.Where("uuid = ?", s.UUID).Limit(1).Find(&p).Error; err != nil {
			return err
		}
		if p.Revision != f.Revision {
			return fmt.Errorf("设置已更新，请刷新后重试")
		}
		st := singleton.SSHLoginStatusFor(s.UUID)
		old := p
		p.Allowlist = append(append([]string{}, p.Allowlist...), st.ImportedAllowlist...)
		p.BlockIPs = append([]string{}, p.BlockIPs...)
		if f.Action == "whitelist" {
			covered := false
			for _, v := range p.Allowlist {
				if a, err := netip.ParseAddr(v); err == nil && a.Unmap() == ip {
					covered = true
				}
				if n, err := netip.ParsePrefix(v); err == nil && n.Contains(ip) {
					covered = true
				}
			}
			if !covered {
				p.Allowlist = append(p.Allowlist, ip.String())
			}
			p.BlockIPs = slices.DeleteFunc(p.BlockIPs, func(v string) bool { k, _ := model.CanonicalSSHSource(v); return k == ip.String() })
			var pending []model.SSHUnbanCommand
			if err := tx.Where("uuid = ? AND done = ? AND created_at > ?", s.UUID, false, time.Now().Add(-10*time.Minute).Unix()).Find(&pending).Error; err != nil {
				return err
			}
			for _, cmd := range pending {
				if cmd.IP == ip.String() {
					commandID = cmd.ID
				}
			}
			if commandID == 0 {
				if len(pending) >= 32 {
					return fmt.Errorf("待处理请求较多，请等待服务器确认")
				}
				cmd := model.SSHUnbanCommand{UUID: s.UUID, IP: ip.String(), CreatedAt: time.Now().Unix()}
				if err := tx.Create(&cmd).Error; err != nil {
					return err
				}
				commandID = cmd.ID
			}
		} else {
			for _, v := range p.Allowlist {
				if n, err := netip.ParsePrefix(v); err == nil && n.Contains(ip) && n.Bits() != n.Addr().BitLen() {
					return fmt.Errorf("该 IP 位于白名单网段内，请先调整白名单")
				}
			}
			p.Allowlist = slices.DeleteFunc(p.Allowlist, func(v string) bool { k, _ := model.CanonicalSSHSource(v); return k == ip.String() })
			found := false
			for _, v := range p.BlockIPs {
				if a, err := netip.ParseAddr(v); err == nil && a.Unmap() == ip {
					found = true
				}
				if n, err := netip.ParsePrefix(v); err == nil && n.Contains(ip) {
					found = true
				}
			}
			if !found {
				p.BlockIPs = append(p.BlockIPs, ip.String())
			}
		}
		slices.Sort(p.Allowlist)
		p.Allowlist = slices.Compact(p.Allowlist)
		if err := p.Validate(); err != nil {
			return err
		}
		if err := singleton.CompileSSHBlacklist(c.Request.Context(), &p); err != nil {
			return err
		}
		p.KeepSSHBlockTimes(old, time.Now().UnixMilli())
		p.Revision++
		revision = p.Revision
		return tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&p).Error
	})
	if e != nil {
		return nil, e
	}
	return gin.H{"revision": revision, "command_id": commandID}, nil
}
