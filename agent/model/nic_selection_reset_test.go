package model

import (
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sigs.k8s.io/yaml"
	"testing"
)

const resetFixture = "server: fixture.invalid:443\nuuid: 00000000-0000-0000-0000-000000000123\nclient_secret: test-only-secret\ntls: true\nreport_delay: 3\ncustom_ip_api: [https://example.invalid]\nnic_allowlist:\n  eth0: true\n  ppp0: false\nunknown_future_option:\n  keep: [1, 2, 3]\n"

func TestSaveNICSelectionResetPreservesEveryOtherValue(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yml")
	if err := os.WriteFile(path, []byte(resetFixture), 0600); err != nil {
		t.Fatal(err)
	}
	cfg := AgentConfig{}
	if err := cfg.Read(path); err != nil {
		t.Fatal(err)
	}
	original := cfg.Clone()
	if err := cfg.SaveNICSelectionReset("event-1"); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var before, after map[string]any
	if err = yaml.Unmarshal([]byte(resetFixture), &before); err != nil {
		t.Fatal(err)
	}
	if err = yaml.Unmarshal(raw, &after); err != nil {
		t.Fatal(err)
	}
	if after["nic_allowlist"] != nil || after["nic_selection_reset_id"] != "event-1" {
		t.Fatal("reset not persisted")
	}
	delete(before, "nic_allowlist")
	delete(after, "nic_allowlist")
	delete(after, "nic_selection_reset_id")
	if !reflect.DeepEqual(before, after) {
		t.Fatal("unrelated configuration changed")
	}
	if !reflect.DeepEqual(cfg, original) {
		t.Fatal("persistence mutated runtime")
	}
	var reloaded AgentConfig
	if err = reloaded.Read(path); err != nil {
		t.Fatal(err)
	}
	if len(reloaded.NICAllowlist) != 0 || reloaded.NICSelectionResetID != "event-1" {
		t.Fatal("restart lost fallback")
	}
	info, _ := os.Stat(path)
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
		t.Fatal("file permissions changed")
	}
	matches, _ := filepath.Glob(filepath.Join(filepath.Dir(path), ".ddnezha-nic-config-*"))
	if len(matches) != 0 {
		t.Fatal("temporary configuration left behind")
	}
}
func TestSaveNICSelectionResetRejectsExternalSelectionOrIdentityChange(t *testing.T) {
	for _, field := range []string{"selection", "uuid"} {
		t.Run(field, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "config.yml")
			os.WriteFile(path, []byte(resetFixture), 0600)
			var cfg AgentConfig
			if err := cfg.Read(path); err != nil {
				t.Fatal(err)
			}
			var values map[string]any
			yaml.Unmarshal([]byte(resetFixture), &values)
			if field == "selection" {
				values["nic_allowlist"] = map[string]bool{"eth1": true}
			} else {
				values["uuid"] = "other-machine"
			}
			changed, _ := yaml.Marshal(values)
			os.WriteFile(path, changed, 0600)
			if cfg.SaveNICSelectionReset("event-1") == nil {
				t.Fatal("overwrote external change")
			}
			got, _ := os.ReadFile(path)
			if string(got) != string(changed) {
				t.Fatal("failed save modified file")
			}
		})
	}
}
func TestSaveNICSelectionResetFailureAndSymlink(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yml")
	os.WriteFile(path, []byte(resetFixture), 0600)
	var cfg AgentConfig
	if err := cfg.Read(path); err != nil {
		t.Fatal(err)
	}
	if cfg.SaveNICSelectionReset("") == nil {
		t.Fatal("empty event accepted")
	}
	if runtime.GOOS != "windows" {
		link := filepath.Join(filepath.Dir(path), "config-link.yml")
		if err := os.Symlink(path, link); err != nil {
			t.Fatal(err)
		}
		if err := cfg.Read(link); err != nil {
			t.Fatal(err)
		}
		if err := cfg.SaveNICSelectionReset("event-2"); err != nil {
			t.Fatal(err)
		}
		info, _ := os.Lstat(link)
		if info.Mode()&os.ModeSymlink == 0 {
			t.Fatal("symlink replaced")
		}
	}
	os.Remove(path)
	if cfg.SaveNICSelectionReset("event-3") == nil {
		t.Fatal("missing file accepted")
	}
}
