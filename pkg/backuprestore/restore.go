// Package backuprestore restores a verified chain into a new directory only.
package backuprestore

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime/debug"
	"strings"

	"filippo.io/age"
	"github.com/nezhahq/nezha/pkg/backupformat"
)

type reader struct {
	ctx context.Context
	r   io.Reader
}

func (r reader) Read(b []byte) (int, error) {
	if e := r.ctx.Err(); e != nil {
		return 0, e
	}
	return r.r.Read(b)
}
func digest(ctx context.Context, root *os.Root, name string) (string, int64, error) {
	f, e := root.Open(name)
	if e != nil {
		return "", 0, e
	}
	defer f.Close()
	h := sha256.New()
	n, e := io.Copy(h, reader{ctx, f})
	return hex.EncodeToString(h.Sum(nil)), n, e
}
func readJSON(p string, v any) error {
	root, e := os.OpenRoot(filepath.Dir(p))
	if e != nil {
		return e
	}
	defer root.Close()
	f, e := root.Open(filepath.Base(p))
	if e != nil {
		return e
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, 16<<20+1))
	if e != nil {
		return e
	}
	if len(b) > 16<<20 {
		return errors.New("备份索引过大")
	}
	return json.Unmarshal(b, v)
}
func filesMap(files []backupformat.File) (map[string]backupformat.File, error) {
	out := map[string]backupformat.File{}
	for _, f := range files {
		if !backupformat.ValidDataPath(f.Name) || !backupformat.ValidHash(f.SHA256) || f.Size < 0 {
			return nil, errors.New("备份文件索引无效")
		}
		if _, ok := out[f.Name]; ok {
			return nil, errors.New("备份文件索引重复")
		}
		out[f.Name] = f
	}
	return out, nil
}

// Restore expects the bundle to have been unpacked in its own directory. It
// never writes into an existing destination and never follows archive links.
func Restore(ctx context.Context, bundlePath, destination string, password func() (string, error)) (err error) {
	var bundle backupformat.Bundle
	if err = readJSON(bundlePath, &bundle); err != nil {
		return err
	}
	if bundle.Format != 1 || len(bundle.Archives) == 0 || len(bundle.Archives) > 32 {
		return errors.New("恢复包格式或备份数量无效")
	}
	destination, err = filepath.Abs(destination)
	if err != nil {
		return err
	}
	if _, err = os.Lstat(destination); !os.IsNotExist(err) {
		return errors.New("恢复目录已存在，请使用新的目录")
	}
	stage, err := os.MkdirTemp(filepath.Dir(destination), ".ddnz-restore-")
	if err != nil {
		return err
	}
	defer func() { _ = os.RemoveAll(stage) }()
	root, err := os.OpenRoot(stage)
	if err != nil {
		return err
	}
	defer root.Close()
	source, err := os.OpenRoot(filepath.Dir(bundlePath))
	if err != nil {
		return err
	}
	defer source.Close()
	current := map[string]backupformat.File{}
	seenArchives := map[string]bool{}
	pass := ""
	for i, a := range bundle.Archives {
		if err = ctx.Err(); err != nil {
			return err
		}
		if !backupformat.ValidArchive(a.Name) || !backupformat.ValidHash(a.SHA256) || a.Size < 0 || seenArchives[a.Name] {
			return errors.New("恢复包文件信息无效")
		}
		seenArchives[a.Name] = true
		info, e := source.Lstat(a.Name)
		if e != nil {
			return e
		}
		if !info.Mode().IsRegular() || info.Size() != a.Size {
			return errors.New("备份文件缺失或大小不匹配")
		}
		f, e := source.Open(a.Name)
		if e != nil {
			return e
		}
		h := sha256.New()
		_, e = io.Copy(h, reader{ctx, f})
		if e != nil {
			f.Close()
			return e
		}
		if hex.EncodeToString(h.Sum(nil)) != a.SHA256 {
			f.Close()
			return fmt.Errorf("备份校验失败: %s", a.Name)
		}
		if _, e = f.Seek(0, 0); e != nil {
			f.Close()
			return e
		}
		var input io.Reader = f
		if strings.HasSuffix(a.Name, ".age") {
			if pass == "" {
				if password == nil {
					f.Close()
					return errors.New("此备份需要密码")
				}
				pass, e = password()
				if e != nil {
					f.Close()
					return e
				}
			}
			identity, e := age.NewScryptIdentity(pass)
			if e != nil {
				f.Close()
				return e
			}
			identity.SetMaxWorkFactor(18)
			debug.FreeOSMemory()
			input, e = age.Decrypt(input, identity)
			debug.FreeOSMemory()
			if e != nil {
				f.Close()
				return fmt.Errorf("备份解密失败: %w", e)
			}
		}
		round, e := os.MkdirTemp(filepath.Dir(stage), ".ddnz-restore-round-")
		if e != nil {
			f.Close()
			return e
		}
		manifest, written, e := extract(ctx, input, round)
		closeErr := f.Close()
		if e == nil {
			e = closeErr
		}
		if e != nil {
			os.RemoveAll(round)
			return e
		}
		e = apply(root, round, current, manifest, written, i, a, bundle)
		os.RemoveAll(round)
		if e != nil {
			return e
		}
		current, e = filesMap(manifest.Files)
		if e != nil {
			return e
		}
	}
	// Verify the complete final state, including files carried over from a base.
	for name, item := range current {
		sum, size, e := digest(ctx, root, name)
		if e != nil {
			return e
		}
		if sum != item.SHA256 || size != item.Size {
			return fmt.Errorf("恢复文件校验失败: %s", name)
		}
	}
	// No overwrite: reserve the final directory exclusively, then move only our
	// private tree into it. A failed move leaves an explicit error, never touches
	// an existing user's directory.
	if err = os.Mkdir(destination, 0700); err != nil {
		return err
	}
	entries, err := os.ReadDir(stage)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err = os.Rename(filepath.Join(stage, entry.Name()), filepath.Join(destination, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}
func extract(ctx context.Context, input io.Reader, dir string) (backupformat.Manifest, map[string]backupformat.File, error) {
	var manifest backupformat.Manifest
	written := map[string]backupformat.File{}
	gz, e := gzip.NewReader(reader{ctx, input})
	if e != nil {
		return manifest, nil, e
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	root, e := os.OpenRoot(dir)
	if e != nil {
		return manifest, nil, e
	}
	defer root.Close()
	gotManifest := false
	for {
		h, e := tr.Next()
		if e == io.EOF {
			break
		}
		if e != nil {
			return manifest, nil, e
		}
		if h.Typeflag != tar.TypeReg && h.Typeflag != tar.TypeRegA {
			return manifest, nil, errors.New("备份含链接或特殊文件，已停止恢复")
		}
		if h.Name == "manifest.json" {
			if gotManifest || h.Size > 16<<20 {
				return manifest, nil, errors.New("备份索引无效")
			}
			gotManifest = true
			b, e := io.ReadAll(tr)
			if e != nil {
				return manifest, nil, e
			}
			if e = json.Unmarshal(b, &manifest); e != nil {
				return manifest, nil, e
			}
			continue
		}
		if !backupformat.ValidDataPath(h.Name) || h.Size < 0 || h.Size > 1<<40 {
			return manifest, nil, errors.New("备份路径或大小无效")
		}
		if _, ok := written[h.Name]; ok {
			return manifest, nil, errors.New("备份包含重复文件")
		}
		if e = root.MkdirAll(filepath.Dir(h.Name), 0700); e != nil {
			return manifest, nil, e
		}
		f, e := root.OpenFile(h.Name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			return manifest, nil, e
		}
		sum := sha256.New()
		n, e := io.Copy(io.MultiWriter(f, sum), reader{ctx, tr})
		ce := f.Close()
		if e == nil {
			e = ce
		}
		if e != nil {
			return manifest, nil, e
		}
		if n != h.Size {
			return manifest, nil, io.ErrUnexpectedEOF
		}
		written[h.Name] = backupformat.File{Name: h.Name, Size: n, SHA256: hex.EncodeToString(sum.Sum(nil))}
	}
	// Read through gzip and age trailers; archive/tar's EOF alone is not enough
	// to authenticate the final age chunk or validate the gzip checksum.
	if _, e = io.Copy(io.Discard, reader{ctx, gz}); e != nil {
		return manifest, nil, e
	}
	if !gotManifest {
		return manifest, nil, errors.New("备份缺少索引")
	}
	return manifest, written, nil
}
func apply(root *os.Root, round string, current map[string]backupformat.File, m backupformat.Manifest, written map[string]backupformat.File, index int, a backupformat.Archive, b backupformat.Bundle) error {
	next, e := filesMap(m.Files)
	if e != nil {
		return e
	}
	if index == 0 {
		if m.Format != 1 || m.Parent != nil || len(m.Deleted) > 0 {
			return errors.New("恢复链缺少全量基础备份")
		}
	} else {
		previous := b.Archives[index-1]
		if m.Format != 2 || m.Type != "incremental" || m.Parent == nil || *m.Parent != previous {
			return errors.New("增量备份依赖不匹配")
		}
	}
	deleted := map[string]bool{}
	for _, name := range m.Deleted {
		if !backupformat.ValidDataPath(name) || deleted[name] {
			return errors.New("删除记录无效")
		}
		if _, ok := current[name]; !ok {
			return errors.New("删除记录没有对应的基础文件")
		}
		if _, ok := next[name]; ok {
			return errors.New("删除记录与文件索引冲突")
		}
		deleted[name] = true
	}
	for name, old := range current {
		n, ok := next[name]
		if !ok && !deleted[name] {
			return errors.New("增量备份缺少删除记录")
		}
		if ok && old == n {
			continue
		}
		if ok {
			if _, exists := written[name]; !exists {
				return errors.New("增量备份缺少修改后的文件")
			}
		}
	}
	for name, item := range written {
		if next[name] != item {
			return errors.New("备份内容与索引不匹配")
		}
	}
	for name, item := range next {
		if current[name] != item && written[name] != item {
			return errors.New("备份缺少文件")
		}
	}
	// Remove old files before creating new directories (file/directory renames).
	for name := range deleted {
		if e = root.Remove(name); e != nil {
			return e
		}
	}
	// Remove only empty directories, deepest first. This handles directory-to-file changes.
	for name := range written {
		if info, err := root.Lstat(name); err == nil && info.IsDir() {
			if e = removeEmptyTree(root, name); e != nil {
				return e
			}
		}
		if e = root.MkdirAll(filepath.Dir(name), 0700); e != nil {
			return e
		}
		if info, err := root.Lstat(name); err == nil && info.Mode().IsRegular() {
			if e = root.Remove(name); e != nil {
				return e
			}
		}
		if e = os.Rename(filepath.Join(round, filepath.FromSlash(name)), filepath.Join(root.Name(), filepath.FromSlash(name))); e != nil {
			return e
		}
	}
	return nil
}
func removeEmptyTree(root *os.Root, name string) error {
	f, e := root.Open(name)
	if e != nil {
		return e
	}
	list, e := f.ReadDir(-1)
	f.Close()
	if e != nil {
		return e
	}
	for _, item := range list {
		if !item.IsDir() {
			return errors.New("恢复目录中出现未记录文件")
		}
		if e = removeEmptyTree(root, filepath.Join(name, item.Name())); e != nil {
			return e
		}
	}
	return root.Remove(name)
}
