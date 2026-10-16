package model

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
)

// A durable comparison baseline, not a retention-limited monitoring snapshot.
// Keep it when history is manually removed, so unchanged reports stay silent.
type ServerInventoryBaseline struct {
	ServerUUID string            `gorm:"primaryKey" json:"-"`
	Values     map[string]string `gorm:"serializer:json;type:text" json:"-"`
	UpdatedAt  time.Time
}

func HostInventoryValues(h *Host) map[string]string {
	if h == nil {
		return nil
	}
	cpu := append([]string(nil), h.CPU...)
	sort.Strings(cpu)
	gpu := append([]string(nil), h.GPU...)
	sort.Strings(gpu)
	return map[string]string{
		"cpu": strings.Join(cpu, "\n"), "memory_total": fmt.Sprint(h.MemTotal),
		"disk_total": fmt.Sprint(h.DiskTotal), "swap_total": fmt.Sprint(h.SwapTotal),
		"operating_system": strings.TrimSpace(h.Platform + " " + h.PlatformVersion),
		"architecture":     h.Arch, "virtualization": h.Virtualization,
		"gpu": strings.Join(gpu, "\n"), "agent_version": h.Version,
	}
}

func GeoInventoryValues(g *GeoIP) map[string]string {
	if g == nil {
		return nil
	}
	values := map[string]string{}
	// A failed lookup / temporarily unavailable family is not evidence of removal.
	if g.IP.IPv4Addr != "" {
		values["ipv4"] = g.IP.IPv4Addr
	}
	if g.IP.IPv6Addr != "" {
		values["ipv6"] = g.IP.IPv6Addr
	}
	if g.CountryCode != "" {
		values["region"] = strings.ToUpper(g.CountryCode)
	}
	return values
}

// Called in an identity-guarded transaction. Only static, allowlisted fields
// are persisted; credentials, notes and fluctuating usage are never serialized.
func RecordServerInventory(tx *gorm.DB, server *Server, values map[string]string) error {
	if len(values) == 0 {
		return nil
	}
	var baseline ServerInventoryBaseline
	err := tx.Where("server_uuid = ?", server.UUID).Find(&baseline).Error
	if err != nil {
		return err
	}
	missing := baseline.ServerUUID == ""
	if baseline.Values == nil {
		baseline.Values = map[string]string{}
	}
	ipSnapshot := inventoryIPSnapshot(baseline.Values, values)
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	changes := make([]ServerOperationChange, 0)
	for _, key := range keys {
		next := operationValue(values[key])
		old, known := baseline.Values[key]
		if known && old == next {
			continue
		}
		if !known {
			old = "未记录"
		}
		changes = append(changes, ServerOperationChange{Field: key, Before: old, After: next})
		baseline.Values[key] = next
	}
	if len(changes) == 0 {
		return nil
	}
	baseline.ServerUUID, baseline.UpdatedAt = server.UUID, time.Now()
	action := "inventory_change"
	if missing {
		action = "inventory_baseline"
	}
	var details *ServerOperationDetails
	for _, change := range changes {
		if change.Field == "ipv4" || change.Field == "ipv6" {
			details = &ServerOperationDetails{IPSnapshot: ipSnapshot}
			break
		}
	}
	if err := RecordServerOperationChanges(tx, ServerOperationActor{Name: "Agent", Source: "agent"}, action, server, server.ID, changes, details); err != nil {
		return err
	}
	return tx.Save(&baseline).Error
}
