package model

import (
	"encoding/hex"
	pb "github.com/nezhahq/nezha/proto"
	"strings"
	"unicode"
	"unicode/utf8"
)

const MaxNetworkInterfaceRates = 256

func ValidNetworkInterfaceName(name string) bool {
	return name != "" && len(name) <= 256 && utf8.ValidString(name) &&
		!strings.ContainsFunc(name, unicode.IsControl)
}
func NetworkInterfaceMetric(name, direction string) string {
	if !ValidNetworkInterfaceName(name) || (direction != "in" && direction != "out") {
		return ""
	}
	return "nic_" + hex.EncodeToString([]byte(name)) + "_" + direction + "_speed"
}
func IsNetworkInterfaceMetric(metric string) bool {
	if len(metric) > 527 || !strings.HasPrefix(metric, "nic_") {
		return false
	}
	for _, direction := range []string{"in", "out"} {
		suffix := "_" + direction + "_speed"
		if !strings.HasSuffix(metric, suffix) {
			continue
		}
		b, err := hex.DecodeString(strings.TrimSuffix(strings.TrimPrefix(metric, "nic_"), suffix))
		return err == nil && NetworkInterfaceMetric(string(b), direction) == metric
	}
	return false
}
func decodeNetworkInterfaces(rows []*pb.State_NetworkInterface) []NetworkInterfaceSpeed {
	var out []NetworkInterfaceSpeed
	seen := map[string]bool{}
	for _, n := range rows {
		name := n.GetName()
		if !ValidNetworkInterfaceName(name) || seen[name] {
			continue
		}
		seen[name] = true
		out = append(out, NetworkInterfaceSpeed{Name: name, InSpeed: n.GetInSpeed(), OutSpeed: n.GetOutSpeed(), Available: n.GetAvailable()})
		if len(out) >= MaxNetworkInterfaceRates {
			break
		}
	}
	return out
}
func NetworkInterfaceMetrics(rows []NetworkInterfaceSpeed) map[string]float64 {
	out := map[string]float64{}
	seen := map[string]bool{}
	for _, n := range rows {
		if !n.Available || !ValidNetworkInterfaceName(n.Name) || seen[n.Name] {
			continue
		}
		seen[n.Name] = true
		out[NetworkInterfaceMetric(n.Name, "in")] = float64(n.InSpeed)
		out[NetworkInterfaceMetric(n.Name, "out")] = float64(n.OutSpeed)
		if len(seen) >= MaxNetworkInterfaceRates {
			break
		}
	}
	return out
}
