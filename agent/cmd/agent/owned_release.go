package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"time"

	"github.com/blang/semver"
	"github.com/inconshreveable/go-update"
	"github.com/nezhahq/go-github-selfupdate/selfupdate"
)

const ownedReleaseChannel = "shini74744-agent-v1"
const maxAgentArchiveBytes int64 = 64 << 20
const maxAgentBinaryBytes uint64 = 128 << 20

var ownedReleaseTag = regexp.MustCompile(`^v[0-9]+\.[0-9]+\.[0-9]+$`)
var sourceCommitPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

type ownedReleaseAsset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
}
type ownedRelease struct {
	Tag        string              `json:"tag_name"`
	Draft      bool                `json:"draft"`
	Prerelease bool                `json:"prerelease"`
	Assets     []ownedReleaseAsset `json:"assets"`
}
type ownedReleaseManifest struct {
	Schema       int    `json:"schema"`
	Channel      string `json:"channel"`
	Version      string `json:"version"`
	SourceCommit string `json:"source_commit"`
}
type ownedReleaseUpdater struct {
	client       *http.Client
	executable   func() (string, error)
	apply        func([]byte, string) error
	goos, goarch string
}

func newOwnedReleaseUpdater() *ownedReleaseUpdater {
	return &ownedReleaseUpdater{
		client: &http.Client{Timeout: 2 * time.Minute, CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if req.URL.Scheme != "https" || len(via) >= 10 {
				return fmt.Errorf("unsafe or excessive release redirect")
			}
			return nil
		}},
		executable: os.Executable,
		apply: func(binary []byte, path string) error {
			return update.Apply(bytes.NewReader(binary), update.Options{TargetPath: path})
		},
		goos: runtime.GOOS, goarch: runtime.GOARCH,
	}
}

// Use GitHub's explicitly designated latest release, not the greatest historical
// semver. The channel manifest prevents the new 1.x series reverting to old 2.x.
func (u *ownedReleaseUpdater) UpdateSelf(current semver.Version, repo string) (*selfupdate.Release, error) {
	if repo != agentReleaseRepository {
		return nil, fmt.Errorf("untrusted Agent release repository")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	data, err := u.fetch(ctx, "https://api.github.com/repos/"+agentReleaseRepository+"/releases/latest", 1<<20)
	if err != nil {
		return nil, err
	}
	var release ownedRelease
	if err = json.Unmarshal(data, &release); err != nil {
		return nil, err
	}
	if release.Draft || release.Prerelease || !ownedReleaseTag.MatchString(release.Tag) {
		return nil, fmt.Errorf("invalid stable Agent release")
	}
	version, err := semver.Parse(release.Tag[1:])
	if err != nil {
		return nil, err
	}
	manifestURL, err := release.assetURL("agent-release.json")
	if err != nil {
		return nil, err
	}
	data, err = u.fetch(ctx, manifestURL, 4096)
	if err != nil {
		return nil, err
	}
	var manifest ownedReleaseManifest
	if err = json.Unmarshal(data, &manifest); err != nil {
		return nil, err
	}
	if manifest.Schema != 1 || manifest.Channel != ownedReleaseChannel || manifest.Version != version.String() || !sourceCommitPattern.MatchString(manifest.SourceCommit) {
		return nil, fmt.Errorf("latest Agent release is not in the owned version series")
	}
	if version.LTE(current) {
		return &selfupdate.Release{Version: current}, nil
	}
	name := "nezha-agent_" + u.goos + "_" + u.goarch + ".zip"
	archiveURL, err := release.assetURL(name)
	if err != nil {
		return nil, err
	}
	checksumURL, err := release.assetURL(name + ".sha256")
	if err != nil {
		return nil, err
	}
	checksum, err := u.fetch(ctx, checksumURL, 256)
	if err != nil {
		return nil, err
	}
	archive, err := u.fetch(ctx, archiveURL, maxAgentArchiveBytes)
	if err != nil {
		return nil, err
	}
	if err = (releaseSHA256{}).Validate(archive, checksum); err != nil {
		return nil, err
	}
	binary, err := unpackOwnedAgent(archive, u.goos)
	if err != nil {
		return nil, err
	}
	path, err := u.executable()
	if err != nil {
		return nil, err
	}
	path, err = filepath.EvalSymlinks(path)
	if err != nil {
		return nil, err
	}
	if err = u.apply(binary, path); err != nil {
		return nil, err
	}
	return &selfupdate.Release{Version: version, AssetURL: archiveURL}, nil
}

func (r ownedRelease) assetURL(name string) (string, error) {
	expected := "https://github.com/" + agentReleaseRepository + "/releases/download/" + r.Tag + "/" + name
	found := false
	for _, asset := range r.Assets {
		if asset.Name != name {
			continue
		}
		if found || asset.URL != expected {
			return "", fmt.Errorf("invalid or duplicate owned release asset: %s", name)
		}
		found = true
	}
	if !found {
		return "", fmt.Errorf("owned release asset missing: %s", name)
	}
	return expected, nil
}

func (u *ownedReleaseUpdater) fetch(ctx context.Context, url string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "shini74744-agent")
	response, err := u.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("owned release request failed: HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("owned release response exceeds size limit")
	}
	return data, nil
}

func unpackOwnedAgent(data []byte, goos string) ([]byte, error) {
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	name := binaryName
	if goos == "windows" {
		name += ".exe"
	}
	if len(archive.File) != 1 || archive.File[0].Name != name || !archive.File[0].Mode().IsRegular() || archive.File[0].UncompressedSize64 > maxAgentBinaryBytes {
		return nil, fmt.Errorf("invalid owned Agent archive contents")
	}
	reader, err := archive.File[0].Open()
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	binary, err := io.ReadAll(io.LimitReader(reader, int64(maxAgentBinaryBytes)+1))
	if err != nil {
		return nil, err
	}
	if len(binary) == 0 || uint64(len(binary)) > maxAgentBinaryBytes {
		return nil, fmt.Errorf("invalid owned Agent binary size")
	}
	return binary, nil
}
