package model

// TerminalSession stores names and lifecycle metadata only, never terminal output or input.
// ServerUUID is the identity key: a reused numeric server ID must not expose old sessions.
type TerminalSession struct {
	Common
	ServerID          uint64 `json:"server_id" gorm:"index"`
	ServerUUID        string `json:"-" gorm:"index"`
	Kind              string `json:"kind"`
	StreamID          string `json:"stream_id,omitempty"`
	Name              string `json:"name"`
	RemoteID          string `json:"remote_id,omitempty"`
	RemoteCreated     string `json:"remote_created,omitempty"`
	Windows           string `json:"windows_json,omitempty" gorm:"type:text"`
	CreatedWindowName string `json:"created_window_name,omitempty"`
	Source            string `json:"source"`
	Status            string `json:"status"`
}
type TerminalSessionEvent struct {
	Common
	SessionID  uint64 `json:"session_id" gorm:"index"`
	ServerUUID string `json:"-" gorm:"index"`
	Action     string `json:"action"`
	Name       string `json:"name"`
	WindowName string `json:"window_name,omitempty"`
}
