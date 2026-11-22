package controller

import (
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

// restoreServerListIPs fills response copies after a dashboard restart, before
// an offline Agent has reported again. Never hydrate shared runtime state or
// merge address families: a fresh IPv4-only report must not revive an old IPv6.
func restoreServerListIPs(servers []*model.Server) error {
	missing := make(map[string][]*model.Server)
	for _, server := range servers {
		if server.UUID != "" && (server.GeoIP == nil || server.GeoIP.IP.Join() == "") {
			missing[server.UUID] = append(missing[server.UUID], server)
		}
	}
	if len(missing) == 0 {
		return nil
	}
	uuids := make([]string, 0, len(missing))
	for uuid := range missing {
		uuids = append(uuids, uuid)
	}
	var rows []model.ServerIPHistory
	if err := singleton.DB.Select("server_uuid", "current_ip").
		Where("server_uuid IN ?", uuids).Find(&rows).Error; err != nil {
		return err
	}
	for _, row := range rows {
		for _, server := range missing[row.ServerUUID] {
			geo := model.GeoIP{}
			if server.GeoIP != nil {
				geo = *server.GeoIP
			}
			geo.IP = row.CurrentIP
			server.GeoIP = &geo
		}
	}
	return nil
}
