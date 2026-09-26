package model

import "fmt"

// ServerSnapshot retains the last report in each second of a server's final
// minute. Retention is relative to its last report, NOT wall-clock time.
type ServerSnapshot struct {
	ServerID   uint64 `gorm:"primaryKey;autoIncrement:false"`
	Slot       int64  `gorm:"primaryKey;autoIncrement:false"`
	UUID       string `gorm:"index"`
	RecordedAt int64
	Payload    string
}

type RecordedServerState struct {
	At          int64      `json:"at"`
	Host        *Host      `json:"host,omitempty"`
	State       *HostState `json:"state"`
	CountryCode string     `json:"country_code,omitempty"`
}

func (r RecordedServerState) Metrics() map[string]float64 {
	s := r.State
	if s == nil {
		return map[string]float64{}
	}
	values := map[string]float64{
		"cpu": s.CPU, "memory": float64(s.MemUsed), "swap": float64(s.SwapUsed), "disk": float64(s.DiskUsed),
		"net_in_speed": float64(s.NetInSpeed), "net_out_speed": float64(s.NetOutSpeed),
		"net_in_transfer": float64(s.NetInTransfer), "net_out_transfer": float64(s.NetOutTransfer),
		"load1": s.Load1, "load5": s.Load5, "load15": s.Load15, "uptime": float64(s.Uptime),
		"tcp_conn": float64(s.TcpConnCount), "udp_conn": float64(s.UdpConnCount), "process_count": float64(s.ProcessCount),
	}
	if r.Host != nil {
		if r.Host.MemTotal > 0 {
			values["memory_percent"] = float64(s.MemUsed) / float64(r.Host.MemTotal) * 100
		}
		if r.Host.MemTotal > 0 && r.Host.SwapTotal == 0 && s.SwapUsed == 0 {
			values["swap_percent"] = 0
		}
		if r.Host.SwapTotal > 0 {
			values["swap_percent"] = float64(s.SwapUsed) / float64(r.Host.SwapTotal) * 100
		}
		if r.Host.DiskTotal > 0 {
			values["disk_percent"] = float64(s.DiskUsed) / float64(r.Host.DiskTotal) * 100
		}
	}
	for i, v := range s.GPU {
		values[fmt.Sprintf("gpu_%d", i)] = v
	}
	return values
}
