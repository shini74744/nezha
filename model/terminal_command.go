package model

// Only ciphertext is persisted. Plaintext is returned exclusively to its owner.
type TerminalCommand struct {
	Common
	Name       string `json:"name" gorm:"size:80;not null"`
	Ciphertext string `json:"-" gorm:"type:text;not null"`
	Version    uint64 `json:"version" gorm:"not null;default:1"`
}
type TerminalCommandView struct {
	ID      uint64 `json:"id"`
	Name    string `json:"name"`
	Command string `json:"command"`
	Version uint64 `json:"version"`
}
type TerminalCommandForm struct {
	Name    string `json:"name"`
	Command string `json:"command"`
	Version uint64 `json:"version"`
}
