package backuprestore

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/nezhahq/nezha/pkg/backupformat"
	"github.com/stretchr/testify/require"
)

func item(name, content string) backupformat.File {
	h := sha256.Sum256([]byte(content))
	return backupformat.File{Name: name, Size: int64(len(content)), SHA256: hex.EncodeToString(h[:])}
}
func archive(t *testing.T, dir string, id int, m backupformat.Manifest, files map[string]string, extra *tar.Header) backupformat.Archive {
	t.Helper()
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	tw := tar.NewWriter(gz)
	for name, text := range files {
		require.NoError(t, tw.WriteHeader(&tar.Header{Name: name, Typeflag: tar.TypeReg, Size: int64(len(text)), Mode: 0600}))
		_, err := tw.Write([]byte(text))
		require.NoError(t, err)
	}
	if extra != nil {
		require.NoError(t, tw.WriteHeader(extra))
	}
	body, err := json.Marshal(m)
	require.NoError(t, err)
	require.NoError(t, tw.WriteHeader(&tar.Header{Name: "manifest.json", Size: int64(len(body)), Mode: 0600}))
	_, err = tw.Write(body)
	require.NoError(t, err)
	require.NoError(t, tw.Close())
	require.NoError(t, gz.Close())
	name := "backup-" + time.Date(2026, 11, 15, 12, 0, id, 0, time.UTC).Format("20060102T150405.000000000Z") + "-000001.tar.gz"
	h := sha256.Sum256(buf.Bytes())
	require.NoError(t, os.WriteFile(filepath.Join(dir, name), buf.Bytes(), 0600))
	return backupformat.Archive{Name: name, Size: int64(buf.Len()), SHA256: hex.EncodeToString(h[:])}
}
func bundle(t *testing.T, dir string, archives ...backupformat.Archive) string {
	t.Helper()
	b, err := json.Marshal(backupformat.Bundle{Format: 1, Archives: archives})
	require.NoError(t, err)
	p := filepath.Join(dir, "bundle.json")
	require.NoError(t, os.WriteFile(p, b, 0600))
	return p
}
func TestRestoreRejectsUnsafeAndIncompleteArchives(t *testing.T) {
	for _, kind := range []string{"traversal", "link", "duplicate-index", "missing-file", "bad-content", "bad-hash", "symlink-source", "invalid-delete", "wrong-parent"} {
		t.Run(kind, func(t *testing.T) {
			dir := t.TempDir()
			m := backupformat.Manifest{Format: 1, Files: []backupformat.File{item("data/a", "test")}}
			files := map[string]string{"data/a": "test"}
			var extra *tar.Header
			switch kind {
			case "traversal":
				files = map[string]string{"../escaped": "test"}
			case "link":
				extra = &tar.Header{Name: "data/link", Typeflag: tar.TypeSymlink, Linkname: "/etc/passwd"}
			case "duplicate-index":
				m.Files = append(m.Files, m.Files[0])
			case "missing-file":
				files = map[string]string{}
			case "bad-content":
				files["data/a"] = "evil"
			}
			a := archive(t, dir, 0, m, files, extra)
			if kind == "bad-hash" {
				a.SHA256 = string(bytes.Repeat([]byte("0"), 64))
			}
			if kind == "symlink-source" {
				original := filepath.Join(dir, a.Name)
				require.NoError(t, os.Rename(original, filepath.Join(dir, "actual")))
				err := os.Symlink("actual", original)
				if runtime.GOOS == "windows" && err != nil {
					t.Skip("Windows runner does not grant symlink creation")
				}
				require.NoError(t, err)
			}
			chain := []backupformat.Archive{a}
			if kind == "invalid-delete" || kind == "wrong-parent" {
				parent := a
				if kind == "wrong-parent" {
					parent.SHA256 = string(bytes.Repeat([]byte("1"), 64))
				}
				next := backupformat.Manifest{Format: 2, Type: "incremental", Parent: &parent, Files: m.Files}
				if kind == "invalid-delete" {
					next.Deleted = []string{"data/not-present"}
				}
				chain = append(chain, archive(t, dir, 1, next, map[string]string{}, nil))
			}
			out := filepath.Join(t.TempDir(), "restored")
			require.Error(t, Restore(context.Background(), bundle(t, dir, chain...), out, nil))
			require.NoDirExists(t, out)
		})
	}
}
func TestRestoreFileDirectoryReplacementAndCancellation(t *testing.T) {
	dir := t.TempDir()
	first := archive(t, dir, 0, backupformat.Manifest{Format: 1, Files: []backupformat.File{item("data/a", "file"), item("data/b/c", "child")}}, map[string]string{"data/a": "file", "data/b/c": "child"}, nil)
	second := archive(t, dir, 1, backupformat.Manifest{Format: 2, Type: "incremental", Parent: &first, Files: []backupformat.File{item("data/a/new", "new"), item("data/b", "parent")}, Deleted: []string{"data/a", "data/b/c"}}, map[string]string{"data/a/new": "new", "data/b": "parent"}, nil)
	p := bundle(t, dir, first, second)
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	require.Error(t, Restore(cancelled, p, filepath.Join(t.TempDir(), "cancelled"), nil))
	out := filepath.Join(t.TempDir(), "restored")
	require.NoError(t, Restore(context.Background(), p, out, nil))
	value, err := os.ReadFile(filepath.Join(out, "data/a/new"))
	require.NoError(t, err)
	require.Equal(t, "new", string(value))
	value, err = os.ReadFile(filepath.Join(out, "data/b"))
	require.NoError(t, err)
	require.Equal(t, "parent", string(value))
	require.Error(t, Restore(context.Background(), p, out, nil))
	value, err = os.ReadFile(filepath.Join(out, "data/b"))
	require.NoError(t, err)
	require.Equal(t, "parent", string(value))
}
