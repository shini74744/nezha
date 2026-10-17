package controller

import (
	"crypto/sha256"
	"fmt"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/latency"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/nezhahq/nezha/service/singleton"
	"gorm.io/gorm"
)

func init() {
	singleton.ReplacementDataCleanupHook = clearReplacedDetectionData
	singleton.ReplacementConfigResetHook = func(id uint64) error {
		settingsMutationMu.Lock()
		defer settingsMutationMu.Unlock()
		return singleton.ResetReplacementIPNotification(id)
	}
	singleton.ReplacementQuiesceHook = func(server *model.Server) func() {
		unlock := lockTerminalOperation(server.UUID)
		tmuxInstalls.Lock()
		delete(tmuxInstalls.rows, server.UUID)
		tmuxInstalls.Unlock()
		return unlock
	}
}
func clearReplacedDetectionData(tx *gorm.DB, server *model.Server) (func(), error) {
	key := connectivityKey(server)
	var ipHistory model.ServerIPHistory
	if err := tx.Where("server_uuid = ?", server.UUID).Find(&ipHistory).Error; err != nil {
		return nil, err
	}
	// New records carry UUID. Also cover address-keyed records made by older
	// builds using the current and retained legacy address identities.
	ips := []model.IP{{}, ipHistory.CurrentIP}
	for _, entry := range ipHistory.History {
		ips = append(ips, entry.IP)
	}
	identities := make([]string, 0, len(ips))
	for _, ip := range ips {
		raw := fmt.Sprintf("%s:%s:%s", key, ip.IPv4Addr, ip.IPv6Addr)
		identities = append(identities, fmt.Sprintf("%x", sha256.Sum256([]byte(raw))))
	}
	if tx.Migrator().HasTable(&latency.Record{}) {
		if err := tx.Where("server_uuid = ? OR identity = ?", server.UUID, key).Delete(&latency.Record{}).Error; err != nil {
			return nil, err
		}
	}
	if err := tx.Where("server_uuid = ? OR identity = ?", server.UUID, key).Delete(&connectivity.Record{}).Error; err != nil {
		return nil, err
	}
	if err := tx.Where("server_uuid = ? OR identity IN ?", server.UUID, identities).Delete(&networkinsight.Record{}).Error; err != nil {
		return nil, err
	}
	return func() {
		connectivityManager.Forget(key)
		latencyManager.Forget(key)
		insightJobs.Lock()
		defer insightJobs.Unlock()
		for _, identity := range identities {
			for _, kind := range []string{"bgp", "return-route", "streaming"} {
				delete(insightJobs.values, identity+kind)
			}
		}
	}, nil
}
