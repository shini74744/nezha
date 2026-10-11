package model

type TerminalForm struct {
	Protocol string `json:"protocol,omitempty"`
	ServerID uint64 `json:"server_id,omitempty"`
}

type CreateTerminalResponse struct {
	SessionID  string `json:"session_id,omitempty"`
	ServerID   uint64 `json:"server_id,omitempty"`
	ServerName string `json:"server_name,omitempty"`
	Kind       string `json:"kind,omitempty"`
	Keep       bool   `json:"keep"`
	RecordID   uint64 `json:"record_id,omitempty"`
}
