package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/nezhahq/agent/pkg/util"
)

const installationMarker = ".DDnezha-owned"

// Require the independent executable and an adjacent ownership marker before any
// service/configuration mutation or self-update. Renaming a binary must never
// make it control the official nezha-agent service or follow its symlinks.
func validateInstallationIdentity(executable, config, goos string) error {
	expected := binaryName
	if goos == "windows" {
		expected += ".exe"
	}
	if filepath.Base(executable) != expected {
		return fmt.Errorf("DDnezha requires its independent executable name %s; migrate the old installation first", expected)
	}
	absolute, err := filepath.Abs(executable)
	if err != nil {
		return err
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return err
	}
	if resolved != absolute {
		return fmt.Errorf("DDnezha refuses a symlinked installation")
	}
	marker := filepath.Join(filepath.Dir(absolute), installationMarker)
	info, err := os.Lstat(marker)
	if err != nil || !info.Mode().IsRegular() {
		return fmt.Errorf("DDnezha ownership marker is missing or unsafe")
	}
	data, err := os.ReadFile(marker)
	if err != nil || strings.TrimSpace(string(data)) != binaryName {
		return fmt.Errorf("DDnezha ownership marker does not match")
	}
	if config != "" {
		path, err := filepath.Abs(config)
		if err != nil || filepath.Dir(path) != filepath.Dir(absolute) {
			return fmt.Errorf("DDnezha config must be inside its independent installation directory")
		}
		if info, err := os.Lstat(path); err == nil {
			if !info.Mode().IsRegular() {
				return fmt.Errorf("DDnezha refuses a non-regular configuration")
			}
		} else if !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

func independentServiceName(config, defaultConfig string) string {
	name := binaryName
	if config != defaultConfig && config != "" {
		name += "-" + util.MD5Sum(config)[:7]
	}
	return name
}
