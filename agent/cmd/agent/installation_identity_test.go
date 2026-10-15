package main

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/blang/semver"
)

func identityFixture(t *testing.T) (string, string) {
	t.Helper()
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	name := binaryName
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	binary := filepath.Join(dir, name)
	config := filepath.Join(dir, "config.yml")
	for path, data := range map[string]string{binary: "fixture", config: "uuid: preserved", filepath.Join(dir, installationMarker): binaryName + "\n"} {
		if err := os.WriteFile(path, []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
	}
	return binary, config
}
func TestDDnezhaInstallationOwnership(t *testing.T) {
	binary, config := identityFixture(t)
	if err := validateInstallationIdentity(binary, config, runtime.GOOS); err != nil {
		t.Fatal(err)
	}
	if err := validateInstallationIdentity(binary, filepath.Join(t.TempDir(), "config.yml"), runtime.GOOS); err == nil {
		t.Fatal("foreign configuration accepted")
	}
	official := filepath.Join(filepath.Dir(binary), "nezha-agent")
	if err := os.WriteFile(official, []byte("official"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := validateInstallationIdentity(official, "", runtime.GOOS); err == nil {
		t.Fatal("official executable accepted")
	}
	marker := filepath.Join(filepath.Dir(binary), installationMarker)
	if err := os.WriteFile(marker, []byte("official"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := validateInstallationIdentity(binary, config, runtime.GOOS); err == nil {
		t.Fatal("foreign marker accepted")
	}
	if err := os.Remove(marker); err != nil {
		t.Fatal(err)
	}
	if err := validateInstallationIdentity(binary, config, runtime.GOOS); err == nil {
		t.Fatal("missing marker accepted")
	}
}
func TestDDnezhaServiceNamesNeverDependOnOfficialExecutableName(t *testing.T) {
	if got := independentServiceName("", ""); got != "DDnezha" {
		t.Fatal(got)
	}
	if got := independentServiceName("/DDnezha/config.yml", "/DDnezha/config.yml"); got != "DDnezha" {
		t.Fatal(got)
	}
	a := independentServiceName("/DDnezha/config-a.yml", "/DDnezha/config.yml")
	b := independentServiceName("/DDnezha/config-b.yml", "/DDnezha/config.yml")
	if a == b || !strings.HasPrefix(a, binaryName+"-") || !strings.HasPrefix(b, binaryName+"-") {
		t.Fatal(a, b)
	}
}
func TestDDnezhaRejectsSymlinkedConfig(t *testing.T) {
	binary, config := identityFixture(t)
	outside := filepath.Join(t.TempDir(), "official.yml")
	if err := os.WriteFile(outside, []byte("official-config"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(config); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, config); err != nil {
		t.Skip("symlinks unavailable:", err)
	}
	if err := validateInstallationIdentity(binary, config, runtime.GOOS); err == nil {
		t.Fatal("official configuration link accepted")
	}
}
func TestDDnezhaUpdaterRefusesOfficialPathAndMissingMarker(t *testing.T) {
	for _, mode := range []string{"official-name", "missing-marker"} {
		t.Run(mode, func(t *testing.T) {
			f := ownedFixture(t)
			if mode == "official-name" {
				official := filepath.Join(filepath.Dir(f.path), "nezha-agent")
				if err := os.Rename(f.path, official); err != nil {
					t.Fatal(err)
				}
				f.path = official
			} else if err := os.Remove(filepath.Join(filepath.Dir(f.path), installationMarker)); err != nil {
				t.Fatal(err)
			}
			if _, err := updateFromOwnedRepository(f.updater, semver.MustParse("1.0.0")); err == nil || f.applied != 0 {
				t.Fatal("foreign update accepted", err)
			}
		})
	}
}
