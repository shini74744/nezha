package model

type LogoLibraryGroup struct {
	ID      string `json:"id" gorm:"primaryKey;size:100"`
	Name    string `json:"name" gorm:"uniqueIndex"`
	Version uint64 `json:"version"`
}
