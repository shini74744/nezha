package model

import (
	"fmt"
	"github.com/goccy/go-json"
)

// Empty preferences inherit coverage, ordering and colors from the service.
// A non-empty list is an explicit allow-list; order is local to this server.
type ServerServicePreference struct {
	ServiceID uint64 `json:"service_id"`
	Color     string `json:"color,omitempty"`
}

func NormalizeServerServices(rows []ServerServicePreference) ([]ServerServicePreference, error) {
	if len(rows) > 1000 {
		return nil, fmt.Errorf("最多选择 1000 个服务")
	}
	if rows == nil {
		rows = []ServerServicePreference{}
	}
	seen := map[uint64]bool{}
	for i := range rows {
		if rows[i].ServiceID == 0 || seen[rows[i].ServiceID] {
			return nil, fmt.Errorf("服务无效或重复")
		}
		seen[rows[i].ServiceID] = true
		color, err := NormalizeServiceColor(rows[i].Color)
		if err != nil {
			return nil, err
		}
		rows[i].Color = color
	}
	return rows, nil
}

func (s *Server) ServicePreferences() ([]ServerServicePreference, error) {
	rows := []ServerServicePreference{}
	if s == nil || s.ServicePreferencesRaw == "" {
		return rows, nil
	}
	err := json.Unmarshal([]byte(s.ServicePreferencesRaw), &rows)
	return rows, err
}

func (m *Service) CoversServer(s *Server) bool {
	if m == nil || s == nil || !IsServiceMonitorType(uint64(m.Type)) || (m.Cover != ServiceCoverAll && m.Cover != ServiceCoverIgnoreAll) {
		return false
	}
	rows, err := s.ServicePreferences()
	if err != nil {
		return false
	}
	if len(rows) > 0 {
		for _, row := range rows {
			if row.ServiceID == m.ID {
				return true
			}
		}
		return false
	}
	if m.Cover == ServiceCoverAll {
		return !m.SkipServers[s.ID]
	}
	return m.SkipServers[s.ID]
}

func (s *Server) ServicePresentation(m *Service) (int, string) {
	rows, _ := s.ServicePreferences()
	for i, row := range rows {
		if row.ServiceID == m.ID {
			color := m.ChartColor
			if row.Color != "" {
				color = row.Color
			}
			return len(rows) - i, color
		}
	}
	return m.DisplayIndex, m.ChartColor
}

// Installed with the server registry. Extra dispatches from per-server selection
// must also fit a server-scoped token when editing/deleting a service.
var ServiceOverrideServerIDsLookup func(serviceID uint64) []uint64

func ServiceOverridesSafeForPAT(tok APITokenAccessor, serviceID uint64) bool {
	if tok == nil || serviceID == 0 {
		return true
	}
	if wl, ok := tok.(APITokenWhitelistView); ok && len(wl.ServerIDs()) == 0 {
		return true
	}
	if ServiceOverrideServerIDsLookup == nil {
		return false
	}
	for _, id := range ServiceOverrideServerIDsLookup(serviceID) {
		if !tok.CanAccessServer(id) {
			return false
		}
	}
	return true
}
