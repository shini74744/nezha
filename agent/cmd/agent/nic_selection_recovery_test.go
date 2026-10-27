package main

import (
	"encoding/json"
	"github.com/nezhahq/agent/model"
	"github.com/nezhahq/agent/pkg/monitor/nic"
	pb "github.com/nezhahq/agent/proto"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func recoveryConfig(t *testing.T) (*model.AgentConfig, string) {
	t.Helper()
	oldConfig, oldSnapshot := agentConfig, runtimeConfigSnapshot.Load()
	oldTimer := reloadTimer
	reloadTimer = nil
	t.Cleanup(func() { agentConfig = oldConfig; runtimeConfigSnapshot.Store(oldSnapshot); reloadTimer = oldTimer })
	path := filepath.Join(t.TempDir(), "config.yml")
	raw := "server: fixture.invalid:443\nclient_secret: test-secret\nuuid: 00000000-0000-0000-0000-000000000123\nnic_allowlist:\n  old0: true\n"
	if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
		t.Fatal(err)
	}
	var cfg model.AgentConfig
	if err := cfg.Read(path); err != nil {
		t.Fatal(err)
	}
	return publishRuntimeConfig(cfg), path
}
func TestNICSelectionRecoveryPublishesOnlyAfterPersisting(t *testing.T) {
	cfg, path := recoveryConfig(t)
	if err := commitNICSelectionReset(cfg); err != nil {
		t.Fatal(err)
	}
	next := loadRuntimeConfig()
	if next == cfg || len(next.NICAllowlist) != 0 || next.NICSelectionResetID == "" {
		t.Fatal("fallback not published")
	}
	if !cfg.NICAllowlist["old0"] {
		t.Fatal("previous generation mutated")
	}
	var disk model.AgentConfig
	if err := disk.Read(path); err != nil {
		t.Fatal(err)
	}
	if disk.NICSelectionResetID != next.NICSelectionResetID || disk.UUID != cfg.UUID || disk.ClientSecret != cfg.ClientSecret {
		t.Fatal("identity or persistence mismatch")
	}
}
func TestNICSelectionRecoveryDoesNotOverridePendingOrNewConfig(t *testing.T) {
	for _, mode := range []string{"save fails", "pending", "new generation"} {
		t.Run(mode, func(t *testing.T) {
			cfg, path := recoveryConfig(t)
			before, _ := os.ReadFile(path)
			if mode == "save fails" {
				os.Remove(path)
			}
			if mode == "pending" {
				reloadTimer = time.AfterFunc(time.Hour, func() {})
				defer reloadTimer.Stop()
			}
			if mode == "new generation" {
				next := cfg.Clone()
				next.NICAllowlist = map[string]bool{"eth1": true}
				publishRuntimeConfig(next)
			}
			expected := loadRuntimeConfig()
			err := commitNICSelectionReset(cfg)
			if (err != nil) != (mode == "save fails") {
				t.Fatalf("unexpected error: %v", err)
			}
			if loadRuntimeConfig() != expected {
				t.Fatal("unexpected config publication")
			}
			if mode != "save fails" {
				after, _ := os.ReadFile(path)
				if string(after) != string(before) {
					t.Fatal("file changed")
				}
			}
		})
	}
}
func TestNICReminderMetadataIsReadOnly(t *testing.T) {
	cfg := model.AgentConfig{UUID: "00000000-0000-0000-0000-000000000123", Server: "fixture.invalid:443", ClientSecret: "test", NICSelectionResetID: "original-event"}
	data, err := marshalReportedConfig(&cfg, nic.Inventory{Available: true})
	if err != nil || strings.Contains(string(data), "nic_selection_reset_id") {
		t.Fatal("internal token exposed", err)
	}
	result := &pb.TaskResult{}
	next, ok := parseApplyConfigLocked(&cfg, &pb.Task{Data: `{"nic_selection_reset_id":"forged-event","nic_allowlist":{"eth0":true}}`}, result)
	if !ok || next.NICSelectionResetID != "original-event" || !next.NICAllowlist["eth0"] {
		t.Fatal("token writable or selection blocked", result)
	}
	raw, _ := json.Marshal(cfg)
	if !strings.Contains(string(raw), "original-event") {
		t.Fatal("token cannot survive persistence")
	}
}
