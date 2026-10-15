package main

import (
	"bytes"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"text/template"
)

func TestProcdPrioritiesAndArguments(t *testing.T) {
	tpl := template.Must(template.New("").Funcs(template.FuncMap{"cmd": func(v string) string { return `"` + strings.ReplaceAll(v, `"`, `\"`) + `"` }}).Parse(ownedProcdScript))
	var out bytes.Buffer
	err := tpl.Execute(&out, struct {
		Name, WorkingDirectory, Path string
		Arguments                    []string
	}{
		"DDnezha", "/opt/DDnezha", "/opt/DDnezha/DDnezha", []string{"-c", "/opt/DDnezha/config.yml"},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"START=50\n", "STOP=02\n", "procd_set_param command \"/opt/DDnezha/DDnezha\" \"-c\" \"/opt/DDnezha/config.yml\"", "respawn", "stdout 1", "stderr 1"} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("missing %q in %s", want, out.String())
		}
	}
}

func TestProcdCleanupOnlyExactOwnedLinks(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX boot links")
	}
	root := t.TempDir()
	initDir, rcDir := filepath.Join(root, "init.d"), filepath.Join(root, "rc.d")
	for _, dir := range []string{initDir, rcDir} {
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"DDnezha", "DDnezha-1234567", "nezha-agent", "other"} {
		for _, prefix := range []string{"S50", "K02", "S21", "K89"} {
			if err := os.Symlink(filepath.Join(initDir, name), filepath.Join(rcDir, prefix+name)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := cleanupOwnedProcdLinks(rcDir, initDir, "DDnezha"); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"DDnezha", "DDnezha-1234567", "nezha-agent", "other"} {
		for _, prefix := range []string{"S50", "K02", "S21", "K89"} {
			_, err := os.Lstat(filepath.Join(rcDir, prefix+name))
			if (name == "DDnezha") != os.IsNotExist(err) {
				t.Fatalf("unexpected state %s %s: %v", name, prefix, err)
			}
		}
	}
	if err := cleanupOwnedProcdLinks(rcDir, initDir, "nezha-agent"); err == nil {
		t.Fatal("accepted official name")
	}
	for _, kind := range []string{"foreign-link", "regular-file"} {
		path := filepath.Join(rcDir, "S50DDnezha")
		if kind == "foreign-link" {
			os.Symlink(filepath.Join(initDir, "nezha-agent"), path)
		} else {
			os.WriteFile(path, []byte("foreign"), 0600)
		}
		if err := cleanupOwnedProcdLinks(rcDir, initDir, "DDnezha"); err == nil {
			t.Fatal("accepted " + kind)
		}
		if _, err := os.Lstat(path); err != nil {
			t.Fatal("removed " + kind)
		}
		os.Remove(path)
	}
}
