package model

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"github.com/goccy/go-json"
	"math"
	"slices"
)

// Empty selection preserves the existing monitored aggregate.
func NormalizeHomeNetworkNames(names []string) ([]string, error) {
	if len(names) > MaxNetworkInterfaceRates {
		return nil, errors.New("选择的网卡过多")
	}
	out := make([]string, 0, len(names))
	for _, name := range names {
		if !ValidNetworkInterfaceName(name) {
			return nil, errors.New("网卡名称无效")
		}
		if !slices.Contains(out, name) {
			out = append(out, name)
		}
	}
	slices.Sort(out)
	return out, nil
}
func (s *Server) HomeNetworkNames() []string {
	var names []string
	if json.Unmarshal([]byte(s.HomeNetworkInterfacesRaw), &names) != nil {
		return nil
	}
	return names
}

func (s *Server) HomeNetworkScopeKey() string {
	names := s.HomeNetworkNames()
	if len(names) == 0 {
		return ""
	}
	encoded, _ := json.Marshal(names)
	hash := sha256.Sum256(encoded)
	return hex.EncodeToString(hash[:12])
}

type HomeNetworkView struct {
	ScopeKey          string   `json:"scope_key"`
	Interfaces        []string `json:"interfaces,omitempty"`
	InSpeed           uint64   `json:"in_speed"`
	OutSpeed          uint64   `json:"out_speed"`
	InTransfer        uint64   `json:"in_transfer"`
	OutTransfer       uint64   `json:"out_transfer"`
	RatesAvailable    bool     `json:"rates_available"`
	CountersAvailable bool     `json:"counters_available"`
}

func (s *Server) HomeNetwork(state *HostState, admin bool) *HomeNetworkView {
	names := s.HomeNetworkNames()
	if len(names) == 0 {
		return nil
	}
	result := &HomeNetworkView{ScopeKey: s.HomeNetworkScopeKey(), RatesAvailable: state != nil, CountersAvailable: state != nil}
	if admin {
		result.Interfaces = names
	}
	if state == nil {
		return result
	}
	seen := map[string]NetworkInterfaceSpeed{}
	for _, n := range state.NetworkInterfaces {
		if _, ok := seen[n.Name]; !ok {
			seen[n.Name] = n
		}
	}
	add := func(total *uint64, value uint64) bool {
		if math.MaxUint64-*total < value {
			return false
		}
		*total += value
		return true
	}
	for _, name := range names {
		n, ok := seen[name]
		result.RatesAvailable = result.RatesAvailable && ok && n.Available
		result.CountersAvailable = result.CountersAvailable && ok && n.CountersAvailable
		if !add(&result.InSpeed, n.InSpeed) || !add(&result.OutSpeed, n.OutSpeed) {
			result.RatesAvailable = false
		}
		if !add(&result.InTransfer, n.InTransfer) || !add(&result.OutTransfer, n.OutTransfer) {
			result.CountersAvailable = false
		}
	}
	if !result.RatesAvailable {
		result.InSpeed, result.OutSpeed = 0, 0
	}
	if !result.CountersAvailable {
		result.InTransfer, result.OutTransfer = 0, 0
	}
	return result
}

// One checkpoint and one daily row per machine keep writes bounded even with
// many NICs. Payload maps are capped by the wire decoder's 256-interface limit.
type NICTransferCheckpoint struct {
	UUID    string `gorm:"primaryKey;size:64"`
	Payload string
}
type NICTransferDay struct {
	UUID    string `gorm:"primaryKey;size:64"`
	Day     string `gorm:"primaryKey;size:10"`
	Payload string
}
type NICCounterCheckpoint struct {
	At          int64
	In, Out     uint64
	Epoch       string
	CoveredFrom int64
}
type NICDayTraffic struct {
	In, Out            uint64
	Partial, Estimated bool
}
