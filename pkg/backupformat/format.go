// Package backupformat defines the portable, versioned backup and recovery bundle formats.
package backupformat

import (
	"path"
	"regexp"
	"strings"
	"time"
)

type File struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}
type Archive struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}
type Manifest struct {
	Format     int       `json:"format"`
	Version    string    `json:"version"`
	SnapshotAt time.Time `json:"snapshot_at"`
	Type       string    `json:"type,omitempty"`
	Parent     *Archive  `json:"parent,omitempty"`
	Deleted    []string  `json:"deleted,omitempty"`
	Files      []File    `json:"files"`
}
type Bundle struct {
	Format   int       `json:"format"`
	Archives []Archive `json:"archives"`
}

var archiveName = regexp.MustCompile(`^backup-[0-9]{8}T[0-9]{6}\.[0-9]{9}Z-[0-9]{6,20}\.tar\.gz(\.age)?$`)
var checksum = regexp.MustCompile(`^[0-9a-f]{64}$`)

func ValidArchive(s string) bool { return archiveName.MatchString(s) }
func ValidHash(s string) bool    { return checksum.MatchString(s) }
func ValidDataPath(s string) bool {
	return strings.HasPrefix(s, "data/") && len(s) > 5 && path.Clean(s) == s &&
		!strings.ContainsAny(s, "\\\x00\r\n:") && !strings.HasSuffix(s, "/")
}
