package singleton

import (
	"fmt"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/ddns"
	"slices"
)

// Shared admin-owned profiles may notify their owner; never route a member's
// DNS data to a different member's notification group.
func DDNSNotificationGroupAllowed(groupOwner, profileOwner uint64) bool {
	return groupOwner != 0 && (groupOwner == profileOwner || profileOwnedByRealAdmin(groupOwner))
}
func ddnsNotificationEvent(server *model.Server, profile *model.DDNSProfile, r ddns.UpdateResult) (string, model.NotificationEvent) {
	kind, label := "ddns_failure", "DDNS 更新失败"
	if r.Success {
		kind, label = "ddns_success", "DDNS 更新成功"
	}
	if profile.Provider == model.ProviderDummy && r.Success {
		label = "DDNS 模拟完成"
	}
	target := IPDesensitize(r.IP)
	if r.IP == "" {
		target = "无目标 IP（删除记录）"
	}
	e := model.NotificationEvent{Kind: kind, ServerName: server.Name, ServerID: server.ID, RuleName: profile.Name,
		Domain: r.Domain, RecordType: r.RecordType, TargetIP: target, Result: r.Detail}
	msg := fmt.Sprintf("[%s] %s\n配置：%s\n域名：%s\n记录类型：%s\n目标 IP：%s\n结果：%s", label, server.Name, profile.Name, r.Domain, r.RecordType, target, r.Detail)
	return msg, e
}
func notifyDDNSResult(serverID, ownerUID uint64, requested *model.DDNSProfile, r ddns.UpdateResult) {
	if NotificationShared == nil || DDNSShared == nil || ServerShared == nil || DB == nil {
		return
	}
	server, ok := ServerShared.Get(serverID)
	if !ok || server.GetUserID() != ownerUID || !server.EnableDDNS || !slices.Contains(server.DDNSProfiles, requested.ID) {
		return
	}
	profile, ok := DDNSShared.Get(requested.ID)
	if !ok || profile.UserID != requested.UserID || profile.NotificationGroupID == 0 {
		return
	}
	if profile.UserID != ownerUID && !profileOwnedByRealAdmin(profile.UserID) {
		return
	}
	var group model.NotificationGroup
	if DB.First(&group, profile.NotificationGroupID).Error != nil || !DDNSNotificationGroupAllowed(group.UserID, profile.UserID) {
		return
	}
	msg, event := ddnsNotificationEvent(server, profile, r)
	mute := fmt.Sprintf("ddns-fail-%d-%d-%s-%s", serverID, profile.ID, r.Domain, r.RecordType)
	if r.Success {
		NotificationShared.UnMuteNotification(profile.NotificationGroupID, mute)
		NotificationShared.SendEvent(profile.NotificationGroupID, msg, "", event)
	} else {
		NotificationShared.SendEvent(profile.NotificationGroupID, msg, mute, event)
	}
}
