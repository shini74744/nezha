package model

// Empty mode preserves existing visibility. Source flags remain authoritative
// for connectivity, including changes made by the existing batch editor.
func (s *Server) NetworkMode() string {
	conn := !s.ConnectivityDisabled || s.ConnectivityLocalOnly
	switch s.NetworkDisplayMode {
	case "hidden", "latency":
		return s.NetworkDisplayMode
	case "connectivity":
		if conn {
			return "connectivity"
		}
		return "hidden"
	case "both":
		if conn {
			return "both"
		}
		return "latency"
	}
	if !conn {
		return "hidden"
	}
	return "both"
}
func (s *Server) LatencyEnabled() bool {
	return s.NetworkMode() == "both" || s.NetworkMode() == "latency"
}
