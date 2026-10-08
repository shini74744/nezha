package dependencypolicy

import (
	"context"
	"encoding/json"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/mod/semver"
)

// Keep the two SSH fixes even though the dashboard does not currently use SSH.
// OpenPGP has no fixed release: guard the transitive package graph instead.
func TestDashboardCryptoDependencies(t *testing.T) {
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatal(err)
	}
	runGo := func(t *testing.T, args ...string) string {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "go", args...)
		cmd.Dir = root
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("go %v: %v\n%s", args, err, output)
		}
		return string(output)
	}

	t.Run("patched-module", func(t *testing.T) {
		var module struct {
			Version string
			Replace *json.RawMessage
		}
		output := runGo(t, "list", "-mod=readonly", "-m", "-json", "golang.org/x/crypto")
		if err := json.Unmarshal([]byte(output), &module); err != nil {
			t.Fatal(err)
		}
		if module.Replace != nil {
			t.Fatal("x/crypto replacement requires a separate security review")
		}
		if !semver.IsValid(module.Version) || semver.Compare(module.Version, "v0.56.0") < 0 {
			t.Fatalf("x/crypto %q lacks the GO-2026-6354 and GO-2026-6355 fixes", module.Version)
		}
	})

	for _, tags := range []string{"", "go_json"} {
		name := tags
		if name == "" {
			name = "default"
		}
		t.Run(name+"-no-openpgp", func(t *testing.T) {
			output := runGo(t, "list", "-mod=readonly", "-deps", "-tags="+tags, "-f", "{{.ImportPath}}", "./cmd/dashboard")
			for _, pkg := range strings.Fields(output) {
				if isLegacyOpenPGP(pkg) {
					t.Errorf("dashboard imports unmaintained package %s (GO-2026-5932)", pkg)
				}
			}
		})
	}
}

func isLegacyOpenPGP(pkg string) bool {
	const base = "golang.org/x/crypto/openpgp"
	return pkg == base || strings.HasPrefix(pkg, base+"/")
}

func TestLegacyOpenPGPPackageMatch(t *testing.T) {
	for pkg, want := range map[string]bool{
		"golang.org/x/crypto/openpgp":             true,
		"golang.org/x/crypto/openpgp/packet":      true,
		"golang.org/x/crypto/openpgp/armor":       true,
		"golang.org/x/crypto/bcrypt":              false,
		"golang.org/x/crypto/hkdf":                false,
		"golang.org/x/crypto/openpgp-example":     false,
		"github.com/ProtonMail/go-crypto/openpgp": false,
	} {
		t.Run(pkg, func(t *testing.T) {
			if got := isLegacyOpenPGP(pkg); got != want {
				t.Fatalf("isLegacyOpenPGP(%q) = %v, want %v", pkg, got, want)
			}
		})
	}
}
