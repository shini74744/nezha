package main

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"testing"

	"github.com/blang/semver"
	"github.com/nezhahq/go-github-selfupdate/selfupdate"
)

type recordingUpdater struct {
	calls []string
	err   error
}

func (u *recordingUpdater) UpdateSelf(v semver.Version, repo string) (*selfupdate.Release, error) {
	u.calls = append(u.calls, repo)
	return &selfupdate.Release{Version: v}, u.err
}
func TestOwnedUpdateNeverFallsBack(t *testing.T) {
	for _, version := range []string{"0.1.0", "2.3.6"} {
		for _, failure := range []error{nil, errors.New("source unavailable")} {
			u := &recordingUpdater{err: failure}
			_, err := updateFromOwnedRepository(u, semver.MustParse(version))
			if err != failure || len(u.calls) != 1 || u.calls[0] != "shini74744/agent" {
				t.Fatalf("unexpected update source or fallback: %v, %v", u.calls, err)
			}
		}
	}
}
func TestOwnedUpdateChecksum(t *testing.T) {
	validator := ownedUpdateConfig().Validator
	content := []byte("our agent")
	valid := []byte(fmt.Sprintf("%x\n", sha256.Sum256(content)))
	if validator.Suffix() != ".sha256" || validator.Validate(content, valid) != nil {
		t.Fatal("valid checksum rejected")
	}
	for _, invalid := range [][]byte{nil, []byte("abc"), make([]byte, 64), []byte(fmt.Sprintf("%x", sha256.Sum256([]byte("other"))))} {
		if validator.Validate(content, invalid) == nil {
			t.Fatal("invalid checksum accepted")
		}
	}
}
