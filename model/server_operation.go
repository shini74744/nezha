package model

import (
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// Independent snapshots: never cascade-delete or remap these historical IDs.
// UUID links the same node across ID changes and distinguishes reused IDs.
type ServerOperationLog struct {
	ID         uint64                  `gorm:"primaryKey" json:"id"`
	CreatedAt  time.Time               `gorm:"index" json:"created_at"`
	ServerUUID string                  `gorm:"index" json:"server_uuid"`
	ServerID   uint64                  `gorm:"index" json:"server_id"`
	PreviousID uint64                  `gorm:"index" json:"previous_id"`
	ServerName string                  `json:"server_name"`
	ActorID    uint64                  `json:"actor_id"`
	ActorName  string                  `json:"actor_name"`
	Source     string                  `json:"source"`
	Action     string                  `gorm:"index" json:"action"`
	Changes    []ServerOperationChange `gorm:"serializer:json;type:text" json:"changes"`
}

type ServerOperationChange struct {
	Field  string `json:"field"`
	Before string `json:"before"`
	After  string `json:"after"`
}
type ServerOperationActor struct {
	ID     uint64
	Name   string
	Source string
}

func ServerOperationActorFromContext(c *gin.Context) ServerOperationActor {
	actor := ServerOperationActor{Name: "系统", Source: "system"}
	if c == nil {
		return actor
	}
	if v, ok := c.Get(CtxKeyAuthorizedUser); ok {
		if user, ok := v.(*User); ok && user != nil {
			actor.ID, actor.Name, actor.Source = user.ID, user.Username, "web"
		}
	}
	if _, ok := c.Get(CtxKeyAPIToken); ok {
		actor.Source = "api"
	}
	return actor
}

func operationValue(v any) string {
	text := fmt.Sprint(v)
	if len([]rune(text)) > 2048 {
		text = string([]rune(text)[:2048]) + "…"
	}
	return text
}

// Compare only explicitly allowed settings. Never serialize Server, Host,
// raw Agent config, requests, tokens, credentials or free-form note contents.
func ServerOperationChanges(before, after *Server) []ServerOperationChange {
	var changes []ServerOperationChange
	if before != nil && after == nil {
		return []ServerOperationChange{{"status", "已登记", "已删除并拉黑 UUID"}}
	}
	if before == nil {
		before = &Server{}
	}
	if after == nil {
		after = &Server{}
	}
	add := func(field string, old, next any) {
		if operationValue(old) != operationValue(next) {
			changes = append(changes, ServerOperationChange{field, operationValue(old), operationValue(next)})
		}
	}
	add("id", before.ID, after.ID)
	add("name", before.Name, after.Name)
	add("owner", before.GetUserID(), after.GetUserID())
	add("display_index", before.DisplayIndex, after.DisplayIndex)
	add("hide_for_guest", before.HideForGuest, after.HideForGuest)
	add("hide_for_display", before.HideForDisplay, after.HideForDisplay)
	add("connectivity_disabled", before.ConnectivityDisabled, after.ConnectivityDisabled)
	add("enable_ddns", before.EnableDDNS, after.EnableDDNS)
	add("ddns_profiles", before.DDNSProfiles, after.DDNSProfiles)
	// Free-form fields can contain embedded passwords or signed URLs.
	for _, field := range []struct{ key, old, next string }{
		{"note", before.Note, after.Note},
		{"public_note", before.PublicNote, after.PublicNote},
		{"ddns_domains", before.OverrideDDNSDomainsRaw, after.OverrideDDNSDomainsRaw},
	} {
		if field.old != field.next {
			state := func(s string) string {
				if strings.TrimSpace(s) == "" {
					return "未设置"
				}
				return "已设置（内容不记录）"
			}
			changes = append(changes, ServerOperationChange{field.key, state(field.old), state(field.next)})
		}
	}
	return changes
}

// Call inside the SAME transaction as the mutation; failure must roll it back.
func RecordServerOperation(tx *gorm.DB, actor ServerOperationActor, action string, before, after *Server) error {
	target := after
	if target == nil {
		target = before
	}
	if target == nil {
		return nil
	}
	changes := ServerOperationChanges(before, after)
	if len(changes) == 0 {
		return nil
	}
	oldID := uint64(0)
	if before != nil {
		oldID = before.ID
	}
	return RecordServerOperationChanges(tx, actor, action, target, oldID, changes)
}

func RecordServerOperationChanges(tx *gorm.DB, actor ServerOperationActor, action string, server *Server, previousID uint64, changes []ServerOperationChange) error {
	if len(changes) == 0 {
		return nil
	}
	if actor.Name == "" {
		actor.Name = "系统"
	}
	if actor.Source == "" {
		actor.Source = "system"
	}
	return tx.Create(&ServerOperationLog{
		CreatedAt: time.Now(), ServerUUID: server.UUID, ServerID: server.ID,
		PreviousID: previousID, ServerName: server.Name, ActorID: actor.ID,
		ActorName: actor.Name, Source: actor.Source, Action: action, Changes: changes,
	}).Error
}

// WithServerOperation snapshots persisted settings inside the write transaction.
// nil IDs means all nodes (group changes / ID reassignment); existing node
// lookups after mutation use UUID, never the possibly-reassigned numeric ID.
func WithServerOperation(db *gorm.DB, actor ServerOperationActor, action string, ids []uint64, mutate func(*gorm.DB) error) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var before []Server
		query := tx
		if ids != nil {
			query = query.Where("id IN ?", ids)
		}
		if err := query.Find(&before).Error; err != nil {
			return err
		}
		groups := map[uint64]string{}
		if action == "group" {
			var err error
			groups, err = operationGroups(tx)
			if err != nil {
				return err
			}
		}
		if err := mutate(tx); err != nil {
			return err
		}
		var after []Server
		uuids := make([]string, 0, len(before))
		for i := range before {
			uuids = append(uuids, before[i].UUID)
		}
		if len(uuids) == 0 {
			return nil
		}
		if err := tx.Where("uuid IN ?", uuids).Find(&after).Error; err != nil {
			return err
		}
		afterByUUID := make(map[string]*Server, len(after))
		for i := range after {
			afterByUUID[after[i].UUID] = &after[i]
		}
		nextGroups := map[uint64]string{}
		if action == "group" {
			var err error
			nextGroups, err = operationGroups(tx)
			if err != nil {
				return err
			}
		}
		for i := range before {
			old := &before[i]
			next := afterByUUID[old.UUID]
			changes := ServerOperationChanges(old, next)
			if action == "group" && next != nil && groups[old.ID] != nextGroups[next.ID] {
				changes = append(changes, ServerOperationChange{"groups", groups[old.ID], nextGroups[next.ID]})
			}
			target := next
			if target == nil {
				target = old
			}
			if err := RecordServerOperationChanges(tx, actor, action, target, old.ID, changes); err != nil {
				return err
			}
		}
		return nil
	})
}

func operationGroups(tx *gorm.DB) (map[uint64]string, error) {
	var rows []struct {
		ServerID uint64
		GroupID  uint64
		Name     string
	}
	err := tx.Table("server_group_servers AS membership").
		Select("membership.server_id, groups.id AS group_id, groups.name").
		Joins("JOIN server_groups AS groups ON groups.id = membership.server_group_id").
		Order("groups.id ASC").Scan(&rows).Error
	result := map[uint64]string{}
	for _, row := range rows {
		if result[row.ServerID] != "" {
			result[row.ServerID] += ", "
		}
		result[row.ServerID] += fmt.Sprintf("#%d %s", row.GroupID, row.Name)
	}
	return result, err
}
