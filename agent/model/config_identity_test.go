package model

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDDnezhaConfigurationIgnoresOfficialEnvironment(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yml")
	original := "server: own.example:443\nclient_secret: own-key\nuuid: 11111111-1111-4111-8111-111111111111\n"
	if err := os.WriteFile(path, []byte(original), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("NZ_SERVER", "official.example:443")
	t.Setenv("NZ_CLIENT_SECRET", "official-secret")
	t.Setenv("NZ_UUID", "22222222-2222-4222-8222-222222222222")
	var cfg AgentConfig
	if err := cfg.Read(path); err != nil {
		t.Fatal(err)
	}
	if cfg.Server != "own.example:443" || cfg.ClientSecret != "own-key" || cfg.UUID != "11111111-1111-4111-8111-111111111111" {
		t.Fatal("official environment contaminated owned config")
	}
	t.Setenv("DDNZ_SERVER", "new-own.example:443")
	if err := cfg.Read(path); err != nil || cfg.Server != "new-own.example:443" {
		t.Fatal("own namespace ignored", err)
	}
	data, err := os.ReadFile(path)
	if err != nil || string(data) != original {
		t.Fatal("read unexpectedly changed identity")
	}
}
