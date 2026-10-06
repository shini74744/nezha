package networkinsight

import (
	"context"
	"strconv"
	"strings"
)

type lookingGlass struct {
	LatestTime string `json:"latest_time"`
	RRCs       []struct {
		RRC   string `json:"rrc"`
		Peers []struct {
			Prefix string `json:"prefix"`
			Peer   string `json:"peer"`
			ASPath string `json:"as_path"`
		} `json:"peers"`
	} `json:"rrcs"`
}

func lookingGlassRoutes(ctx context.Context, ip string) (bgpData, error) {
	var lg lookingGlass
	err := ripeGet(ctx, "looking-glass", ip, &lg)
	raw := bgpData{Timestamp: lg.LatestTime}
	if err != nil {
		return raw, err
	}
	for _, rrc := range lg.RRCs {
		for _, peer := range rrc.Peers {
			fields := strings.Fields(peer.ASPath)
			if len(fields) == 0 || len(fields) > 128 {
				continue
			}
			path := make([]uint32, 0, len(fields))
			valid := true
			for _, field := range fields {
				n, e := strconv.ParseUint(field, 10, 32)
				if e != nil || n == 0 {
					valid = false
					break
				}
				path = append(path, uint32(n))
			}
			if valid {
				raw.BGPState = append(raw.BGPState, Route{Prefix: peer.Prefix, Source: rrc.RRC + "-" + peer.Peer, Path: path})
			}
		}
	}
	return raw, nil
}
