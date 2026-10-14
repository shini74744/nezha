package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/blang/semver"
	"github.com/nezhahq/go-github-selfupdate/selfupdate"
)

func TestLegacyUpdaterTransitionsOnlyAfterOldReleasesAreRemoved(t *testing.T) {
	name := binaryName
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	archive := ownedZIP(t, name)
	assetName := "nezha-agent_" + runtime.GOOS + "_" + runtime.GOARCH + ".zip"
	var includeOld atomic.Bool
	includeOld.Store(true)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/releases") {
			release := func(version string) map[string]any {
				base := server.URL + "/" + version + "/"
				return map[string]any{"tag_name": version, "assets": []map[string]any{
					{"id": 1, "name": assetName, "browser_download_url": base + assetName},
					{"id": 2, "name": assetName + ".sha256", "browser_download_url": base + assetName + ".sha256"},
				}}
			}
			releases := []map[string]any{release("v1.0.0")}
			if includeOld.Load() {
				releases = append(releases, release("v2.3.8"))
			}
			json.NewEncoder(w).Encode(releases)
			return
		}
		if r.URL.Path == "/v1.0.0/"+assetName {
			w.Write(archive)
			return
		}
		http.Error(w, "unexpected request", http.StatusNotFound)
	}))
	defer server.Close()
	dir := t.TempDir()
	target := filepath.Join(dir, name)
	original := []byte("legacy agent executable")
	if err := os.WriteFile(target, original, 0700); err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(dir, "config.yml")
	identity := []byte("uuid: fixture-uuid\nclient_secret: fixture-private-key\n")
	if err := os.WriteFile(config, identity, 0600); err != nil {
		t.Fatal(err)
	}
	updater, err := selfupdate.NewUpdater(selfupdate.Config{APIToken: "fixture-only", EnterpriseBaseURL: server.URL + "/api/v3/", BinaryName: binaryName, Validator: releaseSHA256{}})
	if err != nil {
		t.Fatal(err)
	}
	result, err := updater.UpdateCommand(target, semver.MustParse("2.3.8"), agentReleaseRepository)
	if err != nil || result.Version.String() != "2.3.8" {
		t.Fatalf("old release selection: %v", err)
	}
	got, _ := os.ReadFile(target)
	if !bytes.Equal(got, original) {
		t.Fatal("legacy updater should retain 2.3.8 while old release exists")
	}
	includeOld.Store(false)
	result, err = updater.UpdateCommand(target, semver.MustParse("2.3.8"), agentReleaseRepository)
	if err != nil || result.Version.String() != "1.0.0" {
		t.Fatalf("renumber transition: %v", err)
	}
	got, _ = os.ReadFile(target)
	if string(got) != "new owned agent" {
		t.Fatal("renumbered executable not applied")
	}
	got, _ = os.ReadFile(config)
	if !bytes.Equal(got, identity) {
		t.Fatal("node identity changed")
	}
}
