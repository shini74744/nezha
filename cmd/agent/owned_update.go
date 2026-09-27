package main

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/blang/semver"
	"github.com/nezhahq/go-github-selfupdate/selfupdate"
)

// All automatic and dashboard-triggered upgrades share this source.
// Legacy region/mirror settings deliberately cannot override it.
const agentReleaseRepository = "shini74744/agent"

type agentUpdater interface {
	UpdateSelf(semver.Version, string) (*selfupdate.Release, error)
}

func updateFromOwnedRepository(updater agentUpdater, version semver.Version) (*selfupdate.Release, error) {
	return updater.UpdateSelf(version, agentReleaseRepository)
}

func ownedUpdateConfig() selfupdate.Config {
	return selfupdate.Config{BinaryName: binaryName, Validator: releaseSHA256{}}
}

type releaseSHA256 struct{}

func (releaseSHA256) Suffix() string { return ".sha256" }
func (releaseSHA256) Validate(release, checksum []byte) error {
	expected := strings.TrimSpace(string(checksum))
	decoded, err := hex.DecodeString(expected)
	if err != nil || len(decoded) != sha256.Size {
		return fmt.Errorf("invalid release SHA256")
	}
	actual := fmt.Sprintf("%x", sha256.Sum256(release))
	if actual != strings.ToLower(expected) {
		return fmt.Errorf("release SHA256 mismatch")
	}
	return nil
}
