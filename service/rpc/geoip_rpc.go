package rpc

import (
	"context"
	"fmt"
	"log"
	"net"
	"time"

	"github.com/nezhahq/nezha/model"
	geoipx "github.com/nezhahq/nezha/pkg/geoip"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/singleton"
)

func (s *NezhaHandler) ReportGeoIP(ctx context.Context, report *pb.GeoIP) (*pb.GeoIP, error) {
	clientID, err := s.Auth.Check(ctx)
	if err != nil {
		return nil, err
	}
	geoIP := model.PB2GeoIP(report)
	if geoIP.IP.IPv4Addr == "" && geoIP.IP.IPv6Addr == "" {
		ip, _ := ctx.Value(model.CtxKeyRealIP{}).(string)
		if ip == "" {
			ip, _ = ctx.Value(model.CtxKeyConnectingIP{}).(string)
		}
		geoIP.IP.IPv4Addr = ip
	}
	joinedIP := geoIP.IP.Join()
	server, ok := singleton.ServerShared.Get(clientID)
	if !ok || server == nil {
		return nil, fmt.Errorf("server not found")
	}
	oldIP, history, ipChanged, historyErr := singleton.RecordServerIPChange(server, geoIP.IP, time.Now())
	if historyErr != nil {
		log.Printf("NEZHA>> Failed to record IP history for server %d: %v", server.ID, historyErr)
		// Preserve the existing notification path if storage is temporarily unavailable.
		if server.GeoIP != nil {
			oldIP = server.GeoIP.IP
			ipChanged = oldIP.Join() != "" && joinedIP != "" && oldIP != geoIP.IP
		}
	}
	if server.EnableDDNS && joinedIP != "" && (server.GeoIP == nil || server.GeoIP.IP != geoIP.IP) {
		if err := singleton.ServerShared.UpdateDDNS(server, &model.IP{IPv4Addr: geoIP.IP.IPv4Addr, IPv6Addr: geoIP.IP.IPv6Addr}); err != nil {
			log.Printf("NEZHA>> Failed to update DDNS for server %d: %v", server.ID, err)
		}
	}
	if ipChanged && singleton.Conf.EnableIPChangeNotification &&
		((singleton.Conf.Cover == model.ConfigCoverAll && !singleton.Conf.IgnoredIPNotificationServerIDs[clientID]) ||
			(singleton.Conf.Cover == model.ConfigCoverIgnoreAll && singleton.Conf.IgnoredIPNotificationServerIDs[clientID])) &&
		oldIP.Join() != "" && joinedIP != "" {
		singleton.NotificationShared.SendEvent(singleton.Conf.IPChangeNotificationGroupID,
			fmt.Sprintf("[%s] %s, %s => %s", singleton.Localizer.T("IP Changed"), server.Name,
				singleton.IPDesensitize(oldIP.Join()), singleton.IPDesensitize(joinedIP)), "",
			model.NotificationEvent{Kind: "ip_change", ServerName: server.Name, ServerID: server.ID,
				IP: singleton.IPDesensitize(joinedIP), OldIP: singleton.IPDesensitize(oldIP.Join()), NewIP: singleton.IPDesensitize(joinedIP), IPHistory: singleton.FormatIPHistory(history)}, server.RuntimeCopy(server.RuntimeSnapshot()))
	}
	ip := geoIP.IP.IPv4Addr
	if geoIP.IP.IPv6Addr != "" && (report.GetUse6() || ip == "") {
		ip = geoIP.IP.IPv6Addr
	}
	location, err := geoipx.Lookup(net.ParseIP(ip))
	if err != nil {
		log.Printf("NEZHA>> geoip.Lookup: %v", err)
	}
	geoIP.CountryCode = location
	server.GeoIP = &geoIP
	server.SetSnapshotCountry(location)
	return &pb.GeoIP{Ip: nil, CountryCode: location, DashboardBootTime: singleton.DashboardBootTime}, nil
}
