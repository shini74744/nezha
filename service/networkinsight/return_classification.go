package networkinsight

import (
	"fmt"
	"net/netip"
	"regexp"
	"strings"
)

// These are observed networks, not product/SLA certifications. See
// RETURN_ROUTE_CLASSIFICATION.md for primary sources and inference boundaries.
var routeNetworks = map[string]string{
	"4134": "电信 163", "4809": "电信 CN2", "23764": "电信 CTGNet",
	"4837": "联通 4837", "9929": "联通 9929", "10099": "联通 CUG",
	"58453": "移动 CMI", "58807": "移动 CMIN2", "9808": "移动 9808",
}

func routeNetwork(h ReturnHop) string {
	// Router loopbacks can be geolocated to an aggregate ASN; known backbone
	// prefixes take precedence over that annotation.
	if inRoutePrefix(h.IP, "59.43.0.0/16") {
		return "电信 CN2"
	}
	if inRoutePrefix(h.IP, "202.97.0.0/16") {
		return "电信 163"
	}
	if name := routeNetworks[h.ASN]; name != "" {
		return name
	}
	org := strings.ToLower(h.Organization)
	if strings.Contains(org, "ctgnet") {
		return "电信 CTGNet"
	}
	return ""
}
func inRoutePrefix(ip, prefix string) bool {
	a, e := netip.ParseAddr(ip)
	return e == nil && netip.MustParsePrefix(prefix).Contains(a.Unmap())
}
func routeRegion(h ReturnHop) string {
	s := strings.ToLower(strings.TrimSpace(h.Country + " " + h.Location))
	if s == "" || strings.Contains(s, "anycast") || strings.Contains(s, "保留") {
		return ""
	}
	for _, word := range []string{"香港", "澳门", "澳門", "台湾", "臺灣", "hong kong", "hongkong", "macau", "macao", "taiwan"} {
		if strings.Contains(s, word) {
			return "overseas"
		}
	}
	if strings.HasPrefix(s, "中国") || strings.HasPrefix(s, "中國") || s == "cn" || s == "china" || strings.HasPrefix(s, "china ") {
		return "mainland"
	}
	if h.Country != "" {
		switch strings.ToLower(strings.TrimSpace(h.Country)) {
		case "cn", "china", "中国", "中國":
			return "mainland"
		case "", "unknown", "anycast":
			return ""
		default:
			return "overseas"
		}
	}
	// Historical records have a combined location rather than a country field.
	for _, word := range []string{"美国", "日本", "韩国", "新加坡", "德国", "英国", "法国", "荷兰", "加拿大", "澳大利亚", "俄罗斯", "印度", "马来西亚", "泰国", "越南", "菲律宾", "印度尼西亚", "united states", "japan", "singapore", "germany", "united kingdom", "france", "netherlands", "canada", "australia", "korea", "russia"} {
		if strings.Contains(s, word) {
			return "overseas"
		}
	}
	return ""
}

// Annotate on full, response-owned data before any redaction. Historical snapshots
// are classified on read as well; no new probe is needed for newer presentation.
func AnnotateReturnRoute(r *ReturnResult) {
	r.Route = nil
	r.Line = ""
	r.Evidence = nil
	r.Confidence = ""
	overseasTTL, landed := 0, false
	counts := map[int]int{}
	for _, h := range r.Hops {
		if h.Samples > 0 {
			counts[h.TTL]++
		}
	}
	networks := map[string]bool{}
	firstCN2, lastCN2 := -1, -1
	for i := range r.Hops {
		h := &r.Hops[i]
		h.Network = routeNetwork(*h)
		h.Stage = ""
		h.IPHidden = false
		if h.Samples == 0 {
			continue
		}
		networks[h.Network] = h.Network != ""
		label := h.Network
		if label == "" && h.ASN != "" {
			label = "AS" + h.ASN
		}
		if label != "" && (len(r.Route) == 0 || r.Route[len(r.Route)-1] != label) && len(r.Route) < 16 {
			r.Route = append(r.Route, label)
		}
		region := routeRegion(*h)
		if h.TTL == 1 && h.Network == "" {
			h.Stage = "origin"
		} else if region == "overseas" {
			h.Stage = "international"
		}
		if region == "mainland" {
			h.Stage = "domestic"
			if overseasTTL > 0 && overseasTTL < h.TTL && counts[h.TTL] == 1 && !landed {
				h.Stage = "landing"
				landed = true
			}
		}
		if region == "overseas" {
			overseasTTL = h.TTL
		}
		if h.IP != "" && h.IP == r.Target {
			h.Stage = "destination"
		}
		if h.Network == "电信 CN2" {
			if firstCN2 < 0 {
				firstCN2 = i
			}
			lastCN2 = i
		}
	}
	// Never invent an adjacency through missing TTLs or ECMP samples.
	gt := false
	for i, h := range r.Hops {
		if !inRoutePrefix(h.IP, "59.43.245.0/24") || counts[h.TTL] != 1 || routeRegion(h) != "mainland" {
			continue
		}
		for _, next := range r.Hops[i+1:] {
			if next.TTL > h.TTL+1 {
				break
			}
			if next.TTL == h.TTL+1 && counts[next.TTL] == 1 && inRoutePrefix(next.IP, "202.97.0.0/16") {
				gt = true
			}
		}
	}
	if firstCN2 >= 0 {
		r.Line = "CN2（类型待确认）"
		r.Confidence = "insufficient"
		r.Evidence = []string{"已观测 CN2，单个 ASN、CTGNet 接入或多跳 CN2 均不能单独确认 GIA。"}
		if gt {
			r.Line = "CN2 GT（路由特征）"
			r.Confidence = "inferred"
			r.Evidence = []string{"观测到境内 CN2 汇聚衔接网段直接进入 163 骨干，相邻 TTL 连续且未见多路径；符合 CN2 GT 特征。", "仅判断本次回程，不等同于商家合同或去程线路。"}
		} else {
			// Require visible international CN2/CTGNet -> mainland CN2 and further
			// mainland CN2, with continuous single-path samples throughout that segment.
			border := -1
			domesticCN2 := 0
			clean := true
			lastTTL := 0
			for i, h := range r.Hops {
				if i > lastCN2 {
					break
				}
				if border < 0 && (h.Network == "电信 CN2" || h.Network == "电信 CTGNet") && routeRegion(h) == "overseas" {
					border = i
				}
				if border < 0 {
					continue
				}
				if h.Samples == 0 || counts[h.TTL] != 1 || (lastTTL > 0 && h.TTL != lastTTL+1) || (h.Network != "电信 CN2" && h.Network != "电信 CTGNet") {
					clean = false
				}
				if h.Network == "电信 CN2" && routeRegion(h) == "mainland" {
					domesticCN2++
				}
				lastTTL = h.TTL
			}
			// Missing later handoffs or 163 access leave the commercial class
			// unresolved, even when the earlier CN2 segment looks clean.
			for i := lastCN2 + 1; i < len(r.Hops); i++ {
				h := r.Hops[i]
				if h.Samples == 0 || counts[h.TTL] != 1 || h.TTL != lastTTL+1 || h.Network == "电信 163" {
					clean = false
				}
				lastTTL = h.TTL
			}
			if border >= 0 && clean && domesticCN2 >= 2 && r.Status == "reached" {
				r.Line = "CN2 GIA（路由特征）"
				r.Confidence = "inferred"
				r.Evidence = []string{"观测到境外 CN2／CTGNet 连续进入境内 CN2，并继续由 CN2 承载；关键段无缺失跳或多路径。", "符合 GIA 路由特征，但单向 traceroute 不能证明购买的服务等级。"}
			} else {
				r.Evidence = append(r.Evidence, "跨境承载或境内汇聚证据不完整时保留待确认；不能因未看到 163 就认定 GIA。")
				if border < 0 {
					r.Evidence = append(r.Evidence, "未明确观测到境外 CN2／CTGNet 承载，无法确认跨境接入类型。")
				}
				if domesticCN2 < 2 {
					r.Evidence = append(r.Evidence, fmt.Sprintf("已观测到的境内 CN2 响应仅 %d 跳，连续承载证据不足。", domesticCN2))
				}
				missing, multi := []string{}, []string{}
				for _, h := range r.Hops {
					if h.TTL < r.Hops[firstCN2].TTL && (border < 0 || h.TTL < r.Hops[border].TTL) {
						continue
					}
					if h.Samples == 0 {
						missing = append(missing, fmt.Sprint(h.TTL))
					}
					if counts[h.TTL] > 1 && (len(multi) == 0 || multi[len(multi)-1] != fmt.Sprint(h.TTL)) {
						multi = append(multi, fmt.Sprint(h.TTL))
					}
				}
				if len(missing) > 0 {
					r.Evidence = append(r.Evidence, "关键承载或后续衔接存在未响应跳（TTL "+strings.Join(missing, "、")+"），未响应不代表故障，也不能证明这些跳仍为 CN2。")
				}
				if len(multi) > 0 {
					r.Evidence = append(r.Evidence, "存在多路径响应（TTL "+strings.Join(multi, "、")+"），不能拼接为唯一 GIA／GT 路径。")
				}
				if networks["电信 163"] {
					r.Evidence = append(r.Evidence, "同时观测到 163，但未满足境内 59.43.245/24 紧接 202.97/16 的 GT 特征，不能仅凭混合承载判定 GT。")
				}
				if r.Status != "reached" {
					r.Evidence = append(r.Evidence, "目标未响应，尚未观测到完整回程。")
				}
			}
		}
	} else if networks["电信 CTGNet"] {
		r.Line = "CTGNet（CN2 类型待确认）"
		r.Confidence = "insufficient"
		r.Evidence = []string{"已观测 CTGNet 国际网络；AS23764 同时承载不同接入服务，不能直接等同 CN2 GIA。"}
	} else {
		for _, name := range []string{"移动 CMIN2", "移动 CMI", "联通 9929", "联通 4837", "电信 163", "移动 9808", "联通 CUG"} {
			if networks[name] {
				r.Line = name
				r.Confidence = "observed"
				break
			}
		}
		if r.Line != "" {
			r.Evidence = []string{"按本次响应的骨干网标识显示，不代表全程均由该网络承载；完整顺序见线路摘要。"}
		}
	}
}

// Fail closed for source/hosting/transit IPs. Guests retain only identified
// backbone addresses beyond the node/provider edge, not a partly masked prefix.
func RedactReturnRoute(r *ReturnResult, sources ...string) {
	protectedAS := map[string]bool{}
	firstCarrierTTL := 0
	for _, h := range r.Hops {
		if h.Samples > 0 && h.Network != "" {
			firstCarrierTTL = h.TTL
			break
		}
	}
	for _, h := range r.Hops {
		if h.Samples > 0 && h.ASN != "" && ((firstCarrierTTL == 0 || h.TTL < firstCarrierTTL) || matchesSource(h.IP, sources)) {
			protectedAS[h.ASN] = true
		}
	}
	for i := range r.Hops {
		h := &r.Hops[i]
		// An unresolved ASN or textual ISP label is not an IP publication allow-list.
		safeCarrier := routeNetworks[h.ASN] != "" || inRoutePrefix(h.IP, "59.43.0.0/16") || inRoutePrefix(h.IP, "202.97.0.0/16")
		protect := h.TTL <= 2 || !safeCarrier || protectedAS[h.ASN] || matchesSource(h.IP, sources) || !ReturnPublicIP(h.IP)
		if protect && h.IP != "" {
			h.IP = ""
			h.IPHidden = true
		}
		h.Location = redactAddressText(h.Location)
		h.Organization = redactAddressText(h.Organization)
		h.Country = redactAddressText(h.Country)
	}
	r.Target = ""
	r.Name = redactAddressText(r.Name)
	r.Carrier = redactAddressText(r.Carrier)
}
func matchesSource(raw string, sources []string) bool {
	ip, e := netip.ParseAddr(raw)
	if e != nil {
		return false
	}
	ip = ip.Unmap()
	for _, s := range sources {
		source, e := netip.ParseAddr(s)
		if e != nil {
			continue
		}
		source = source.Unmap()
		bits := 48
		if source.Is4() {
			bits = 24
		}
		if ip.BitLen() == source.BitLen() && netip.PrefixFrom(source, bits).Masked().Contains(ip) {
			return true
		}
	}
	return false
}

var addressText = regexp.MustCompile(`(?i)(?:[0-9a-f]*:[0-9a-f:.]+(?:%[a-z0-9_-]+)?|(?:[0-9]{1,3}\.){3}[0-9]{1,3})(?:/[0-9]{1,3})?`)

func redactAddressText(s string) string { return addressText.ReplaceAllString(s, "[地址已隐藏]") }
