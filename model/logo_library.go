package model

type LogoLibraryEntry struct {
	ID           string   `json:"id" gorm:"primaryKey;size:100"`
	GroupID      string   `json:"groupId" gorm:"index"`
	Kind         string   `json:"kind" gorm:"index;size:16"`
	Name         string   `json:"name"`
	Regions      []string `json:"regions" gorm:"serializer:json"`
	Aliases      string   `json:"aliases"`
	Logo         string   `json:"logo"`
	LogoOriginal string   `json:"logoOriginal"`
	LogoWebsite  string   `json:"logoWebsite"`
	Background   string   `json:"background"`
	Source       string   `json:"source"`
	Builtin      bool     `json:"builtin"`
	Version      uint64   `json:"version"`
	Deleted      bool     `json:"-" gorm:"index"`
}
