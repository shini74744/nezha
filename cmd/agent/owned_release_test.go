package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/blang/semver"
)

type ownedTransport func(*http.Request) (*http.Response, error)

func (f ownedTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type ownedUpdateFixture struct {
	updater  *ownedReleaseUpdater
	release  ownedRelease
	manifest ownedReleaseManifest
	bodies   map[string][]byte
	requests []string
	applied  int
	binary   []byte
	path     string
}

func ownedZIP(t *testing.T, names ...string) []byte {
	t.Helper()
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for _, name := range names {
		f, err := w.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = f.Write([]byte("new owned agent")); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}
func ownedFixture(t *testing.T) *ownedUpdateFixture {
	t.Helper()
	f := &ownedUpdateFixture{
		manifest: ownedReleaseManifest{Schema: 1, Channel: ownedReleaseChannel, Version: "1.0.1", SourceCommit: strings.Repeat("a", 40)},
		release:  ownedRelease{Tag: "v1.0.1"}, bodies: map[string][]byte{},
	}
	f.path = filepath.Join(t.TempDir(), "agent")
	if err := os.WriteFile(f.path, []byte("old agent"), 0700); err != nil {
		t.Fatal(err)
	}
	base := "https://github.com/" + agentReleaseRepository + "/releases/download/v1.0.1/"
	archive := ownedZIP(t, binaryName)
	for name, data := range map[string][]byte{
		"agent-release.json":                 nil,
		"nezha-agent_linux_amd64.zip":        archive,
		"nezha-agent_linux_amd64.zip.sha256": []byte(fmt.Sprintf("%x\n", sha256.Sum256(archive))),
	} {
		f.release.Assets = append(f.release.Assets, ownedReleaseAsset{Name: name, URL: base + name})
		f.bodies[base+name] = data
	}
	f.updater = newOwnedReleaseUpdater()
	f.updater.goos, f.updater.goarch = "linux", "amd64"
	f.updater.executable = func() (string, error) { return f.path, nil }
	f.updater.apply = func(binary []byte, path string) error {
		if path != f.path {
			t.Fatal("unexpected target path")
		}
		f.applied++
		f.binary = append([]byte(nil), binary...)
		return nil
	}
	f.updater.client = &http.Client{Transport: ownedTransport(func(r *http.Request) (*http.Response, error) {
		url := r.URL.String()
		f.requests = append(f.requests, url)
		var data []byte
		var err error
		if url == "https://api.github.com/repos/"+agentReleaseRepository+"/releases/latest" {
			data, err = json.Marshal(f.release)
		} else if strings.HasSuffix(url, "/agent-release.json") {
			data, err = json.Marshal(f.manifest)
		} else {
			var ok bool
			data, ok = f.bodies[url]
			if !ok {
				return nil, errors.New("unexpected request")
			}
		}
		if err != nil {
			return nil, err
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(data)), Header: make(http.Header)}, nil
	})}
	return f
}
func TestOwnedLatestUpdateUsesNewSeriesAndVerifiesArchive(t *testing.T) {
	f := ownedFixture(t)
	result, err := updateFromOwnedRepository(f.updater, semver.MustParse("1.0.0"))
	if err != nil || result.Version.String() != "1.0.1" || f.applied != 1 || string(f.binary) != "new owned agent" {
		t.Fatalf("update failed: %v", err)
	}
	if len(f.requests) != 4 || !strings.HasSuffix(f.requests[0], "/releases/latest") {
		t.Fatalf("unexpected requests: %v", f.requests)
	}
}
func TestOwnedLatestUpdateNeverFallsBackOrAppliesInvalidRelease(t *testing.T) {
	cases := map[string]func(*ownedUpdateFixture){
		"draft":                  func(f *ownedUpdateFixture) { f.release.Draft = true },
		"prerelease":             func(f *ownedUpdateFixture) { f.release.Prerelease = true },
		"invalid tag":            func(f *ownedUpdateFixture) { f.release.Tag = "../v1.0.1" },
		"old series":             func(f *ownedUpdateFixture) { f.manifest.Channel = "legacy" },
		"missing channel":        func(f *ownedUpdateFixture) { f.manifest.Channel = "" },
		"wrong schema":           func(f *ownedUpdateFixture) { f.manifest.Schema = 2 },
		"wrong manifest version": func(f *ownedUpdateFixture) { f.manifest.Version = "2.3.8" },
		"missing source":         func(f *ownedUpdateFixture) { f.manifest.SourceCommit = "" },
		"foreign asset": func(f *ownedUpdateFixture) {
			for i := range f.release.Assets {
				if f.release.Assets[i].Name == "agent-release.json" {
					f.release.Assets[i].URL = "https://example.com/agent-release.json"
				}
			}
		},
		"duplicate asset": func(f *ownedUpdateFixture) { f.release.Assets = append(f.release.Assets, f.release.Assets[0]) },
		"missing checksum": func(f *ownedUpdateFixture) {
			for i, a := range f.release.Assets {
				if strings.HasSuffix(a.Name, ".sha256") {
					f.release.Assets = append(f.release.Assets[:i], f.release.Assets[i+1:]...)
					break
				}
			}
		},
		"checksum mismatch": func(f *ownedUpdateFixture) {
			for url := range f.bodies {
				if strings.HasSuffix(url, ".sha256") {
					f.bodies[url] = []byte(strings.Repeat("0", 64))
				}
			}
		},
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			f := ownedFixture(t)
			change(f)
			_, err := updateFromOwnedRepository(f.updater, semver.MustParse("1.0.0"))
			if err == nil || f.applied != 0 {
				t.Fatalf("invalid release applied: %v", err)
			}
			data, e := os.ReadFile(f.path)
			if e != nil || string(data) != "old agent" {
				t.Fatal("old executable changed")
			}
		})
	}
}
func TestOwnedLatestUpdateSameOrOlderDoesNotReplace(t *testing.T) {
	for _, current := range []string{"1.0.1", "1.0.2"} {
		f := ownedFixture(t)
		result, err := updateFromOwnedRepository(f.updater, semver.MustParse(current))
		if err != nil || result.Version.String() != current || f.applied != 0 || len(f.requests) != 2 {
			t.Fatalf("unexpected replacement: %v", err)
		}
	}
}
func TestOwnedUpdaterRejectsWrongRepositoryAndNetworkFailure(t *testing.T) {
	f := ownedFixture(t)
	if _, err := f.updater.UpdateSelf(semver.MustParse("1.0.0"), "nezhahq/agent"); err == nil || len(f.requests) != 0 {
		t.Fatal("untrusted repository accepted")
	}
	f.updater.client.Transport = ownedTransport(func(r *http.Request) (*http.Response, error) {
		f.requests = append(f.requests, r.URL.String())
		return &http.Response{StatusCode: 403, Body: io.NopCloser(strings.NewReader("limited"))}, nil
	})
	if _, err := updateFromOwnedRepository(f.updater, semver.MustParse("1.0.0")); err == nil || len(f.requests) != 1 || f.applied != 0 {
		t.Fatal("network failure was ignored")
	}
}
func TestOwnedUpdaterApplyErrorIsReturned(t *testing.T) {
	f := ownedFixture(t)
	expected := errors.New("cannot replace")
	f.updater.apply = func([]byte, string) error { return expected }
	if _, err := updateFromOwnedRepository(f.updater, semver.MustParse("1.0.0")); !errors.Is(err, expected) {
		t.Fatalf("lost failure: %v", err)
	}
}
func TestOwnedArchiveOnlyAcceptsExactPlatformBinary(t *testing.T) {
	for _, tc := range []struct {
		goos  string
		names []string
		valid bool
	}{
		{"linux", []string{binaryName}, true},
		{"windows", []string{binaryName + ".exe"}, true},
		{"windows", []string{binaryName}, false},
		{"linux", []string{"../" + binaryName}, false},
		{"linux", []string{binaryName, "config.yml"}, false},
		{"linux", nil, false},
	} {
		_, err := unpackOwnedAgent(ownedZIP(t, tc.names...), tc.goos)
		if (err == nil) != tc.valid {
			t.Fatalf("archive validation: %+v %v", tc, err)
		}
	}
}
func TestOwnedFetchBoundsAndHTTPSRedirects(t *testing.T) {
	f := ownedFixture(t)
	f.updater.client.Transport = ownedTransport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("12345"))}, nil
	})
	if _, err := f.updater.fetch(context.Background(), "https://api.github.com", 4); err == nil {
		t.Fatal("oversized response accepted")
	}
	u := newOwnedReleaseUpdater()
	request, _ := http.NewRequest(http.MethodGet, "http://example.com", nil)
	if u.client.CheckRedirect(request, nil) == nil {
		t.Fatal("insecure redirect accepted")
	}
}

func TestOwnedUpdaterRealAtomicReplacement(t *testing.T) {
	f := ownedFixture(t)
	f.updater.apply = newOwnedReleaseUpdater().apply
	result, err := updateFromOwnedRepository(f.updater, semver.MustParse("1.0.0"))
	if err != nil || result.Version.String() != "1.0.1" {
		t.Fatalf("replacement failed: %v", err)
	}
	got, err := os.ReadFile(f.path)
	if err != nil || string(got) != "new owned agent" {
		t.Fatalf("replacement contents: %v", err)
	}
}
