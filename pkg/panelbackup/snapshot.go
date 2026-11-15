package panelbackup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"runtime/debug"
	"sort"
	"strings"
	"time"

	"filippo.io/age"
	"github.com/mattn/go-sqlite3"
	"github.com/nezhahq/nezha/pkg/backupformat"
	"github.com/nezhahq/nezha/pkg/backupspace"
)

type Source struct {
	Location *time.Location
	Database string
	Config   string
	DataDir  string
	TSDBDir  string
	Version  string
	// The returned tree must remain immutable until cleanup. Native snapshots
	// are online; never pause ingestion for the duration of a network transfer.
	TSDBSnapshot func() (directory string, cleanup func() error, err error)
}
type Entry struct {
	Name   string `json:"name"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
	file   string
}
type Snapshot struct {
	Kind     string
	Index    []backupformat.File
	Parent   *backupformat.Archive
	Deleted  []string
	ParentID uint64
	Depth    int

	At       time.Time
	Entries  []Entry
	Total    int64
	Version  string
	Password string
	work     string
	release  func() error
}

func (s *Snapshot) Close() error {
	var err error
	if s.release != nil {
		err = s.release()
		s.release = nil
	}
	if s.work != "" {
		if e := os.RemoveAll(s.work); err == nil {
			err = e
		}
		s.work = ""
	}
	return err
}
func abs(p string) string { a, _ := filepath.Abs(p); return a }
func within(root, p string) bool {
	rel, e := filepath.Rel(root, p)
	return e == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}
func SQLiteSnapshot(ctx context.Context, source, destination string) error {
	uriPath := filepath.ToSlash(abs(source))
	if filepath.VolumeName(source) != "" && !strings.HasPrefix(uriPath, "/") {
		uriPath = "/" + uriPath
	}
	u := url.URL{Scheme: "file", Path: uriPath}
	q := u.Query()
	q.Set("mode", "ro")
	q.Set("_busy_timeout", "5000")
	u.RawQuery = q.Encode()
	src, err := sql.Open("sqlite3", u.String())
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := sql.Open("sqlite3", destination+"?_busy_timeout=1000")
	if err != nil {
		return err
	}
	defer dst.Close()
	sc, err := src.Conn(ctx)
	if err != nil {
		return fmt.Errorf("连接源数据库失败: %w", err)
	}
	defer sc.Close()
	dc, err := dst.Conn(ctx)
	if err != nil {
		return err
	}
	defer dc.Close()
	// This is a private, disposable destination. Durability is verified when the
	// completed archive is committed at the receiver, so no source lock needs
	// to be held while syncing a temporary database journal.
	if _, err = dc.ExecContext(ctx, "PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF"); err != nil {
		return err
	}
	err = func() error {
		// Pin a read view across all backup steps. Without it, continuous writes
		// from other connections restart SQLite's incremental backup forever.
		if _, e := sc.ExecContext(ctx, "BEGIN"); e != nil {
			return fmt.Errorf("开始数据库快照失败: %w", e)
		}
		defer func() { _, _ = sc.ExecContext(context.Background(), "ROLLBACK") }()
		var tables int
		if e := sc.QueryRowContext(ctx, "SELECT count(*) FROM sqlite_schema").Scan(&tables); e != nil {
			return fmt.Errorf("固定数据库快照失败: %w", e)
		}
		// Rollback-journal sources briefly retain a read lock; bound that window
		// below the panel's writer retry budget. Never hold it during compression,
		// history snapshots, transfer, or verification, and never change source mode.
		copyCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		return dc.Raw(func(d any) error {
			return sc.Raw(func(s any) error {
				backup, e := d.(*sqlite3.SQLiteConn).Backup("main", s.(*sqlite3.SQLiteConn), "main")
				if e != nil {
					return e
				}
				closed := false
				defer func() {
					if !closed {
						_ = backup.Close()
					}
				}()
				remaining := -1
				for {
					if e = copyCtx.Err(); e != nil {
						return fmt.Errorf("数据库快照未能在安全窗口内完成，请稍后重试: %w", e)
					}
					done, e := backup.Step(256)
					if e != nil {
						return e
					}
					if done {
						closed = true
						return backup.Close()
					}
					next := backup.Remaining()
					if next == remaining {
						select {
						case <-copyCtx.Done():
							return copyCtx.Err()
						case <-time.After(2 * time.Millisecond):
						}
					}
					remaining = next
				}
			})
		})
	}()
	if err != nil {
		return err
	}
	if err = os.Chmod(destination, 0600); err != nil {
		return err
	}
	var check string
	if err = dst.QueryRowContext(ctx, "PRAGMA quick_check").Scan(&check); err != nil {
		return err
	}
	if check != "ok" {
		return errors.New("数据库快照校验失败")
	}
	return nil
}
func Prepare(ctx context.Context, src Source, phase func(string)) (snap *Snapshot, err error) {
	// Resolve administrator-configured roots once, including macOS /var aliases.
	// Individual links inside ordinary data files remain rejected below.
	for _, p := range []*string{&src.Database, &src.Config, &src.DataDir, &src.TSDBDir} {
		if *p == "" {
			continue
		}
		resolved, e := filepath.EvalSymlinks(abs(*p))
		if e != nil {
			return nil, fmt.Errorf("备份来源路径不可用: %w", e)
		}
		*p = resolved
	}
	info, statErr := os.Stat(src.Database)
	if statErr != nil {
		return nil, statErr
	}
	if err = backupspace.Check(filepath.Dir(abs(src.Database)), uint64(info.Size())+512*1024*1024); err != nil {
		return nil, fmt.Errorf("面板无法准备备份: %w", err)
	}
	work, err := os.MkdirTemp(filepath.Dir(abs(src.Database)), ".ddnz-backup-")
	if err != nil {
		return nil, fmt.Errorf("创建备份临时目录失败: %w", err)
	}
	snap = &Snapshot{At: time.Now(), Version: src.Version, work: work}
	prepared := snap
	defer func() {
		if err != nil {
			_ = prepared.Close()
		}
	}()
	phase("snapshot")
	if err = SQLiteSnapshot(ctx, src.Database, filepath.Join(work, "sqlite.db")); err != nil {
		return nil, fmt.Errorf("数据库快照失败: %w", err)
	}
	snap.Entries = append(snap.Entries, Entry{Name: "data/sqlite.db", file: filepath.Join(work, "sqlite.db")})
	// Copy ordinary files once, so every destination receives the same generation.
	seen := map[string]bool{"data/sqlite.db": true}
	copyFile := func(srcFile, name, allowedRoot string) error {
		if seen[name] {
			return nil
		}
		seen[name] = true
		if err := ctx.Err(); err != nil {
			return err
		}
		info, err := os.Lstat(srcFile)
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return fmt.Errorf("备份文件不是普通文件: %s", name)
		}
		if err := backupspace.Check(work, uint64(info.Size())+512*1024*1024); err != nil {
			return fmt.Errorf("准备文件 %s 失败: %w", name, err)
		}
		dest := filepath.Join(work, fmt.Sprintf("file-%d", len(snap.Entries)))
		root, err := os.OpenRoot(allowedRoot)
		if err != nil {
			return err
		}
		defer root.Close()
		relative, err := filepath.Rel(allowedRoot, srcFile)
		if err != nil {
			return err
		}
		in, err := root.Open(relative)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600) // #nosec G304 -- generated filename inside private snapshot staging directory.
		if err != nil {
			return err
		}
		copied, err := io.Copy(out, io.LimitReader(contextReader{ctx, in}, info.Size()+1))
		if err == nil && copied != info.Size() {
			err = fmt.Errorf("文件在备份时发生变化，请重试: %s", name)
		}
		closeErr := out.Close()
		if err == nil {
			err = closeErr
		}
		if err != nil {
			return err
		}
		snap.Entries = append(snap.Entries, Entry{Name: name, file: dest})
		return nil
	}
	if err = copyFile(src.Config, "data/config.yaml", filepath.Dir(src.Config)); err != nil {
		return nil, fmt.Errorf("备份配置失败: %w", err)
	}
	roots := []string{abs(filepath.Dir(src.Database)), abs(src.DataDir)}
	rootsSeen := map[string]bool{}
	for _, root := range roots {
		if rootsSeen[root] {
			continue
		}
		rootsSeen[root] = true
		if _, e := os.Stat(root); os.IsNotExist(e) {
			continue
		}
		err = filepath.WalkDir(root, func(p string, d os.DirEntry, e error) error {
			if e != nil {
				return e
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if p == root {
				return nil
			}
			name := d.Name()
			if d.IsDir() {
				if strings.HasPrefix(name, ".ddnz-backup-") || (src.TSDBDir != "" && abs(p) == abs(src.TSDBDir)) {
					return filepath.SkipDir
				}
				return nil
			}
			if abs(p) == abs(src.Database) || abs(p) == abs(src.Config) || strings.HasPrefix(abs(p), abs(src.Database)+"-") {
				return nil
			}
			if d.Type()&os.ModeSymlink != 0 {
				return fmt.Errorf("数据目录含符号链接，未读取链接外的文件: %s", name)
			}
			rel, e := filepath.Rel(root, p)
			if e != nil {
				return e
			}
			return copyFile(p, "data/"+filepath.ToSlash(rel), root)
		})
		if err != nil {
			return nil, fmt.Errorf("备份上传文件失败: %w", err)
		}
	}
	if src.TSDBDir != "" {
		if src.TSDBSnapshot == nil {
			return nil, errors.New("历史监控存储尚未就绪，无法创建完整备份")
		}
		var tree string
		tree, snap.release, err = src.TSDBSnapshot()
		if err != nil {
			return nil, fmt.Errorf("历史监控快照失败: %w", err)
		}
		// VictoriaMetrics snapshots use internal symlinks to immutable hard-linked parts.
		// Resolve only beneath the configured TSDB directory; never archive link targets outside it.
		var walk func(string, string, int) error
		walk = func(p, name string, depth int) error {
			if depth > 64 {
				return errors.New("历史监控快照目录层数异常")
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			resolved, e := filepath.EvalSymlinks(p)
			if e != nil {
				return e
			}
			if !within(abs(src.TSDBDir), abs(resolved)) {
				return errors.New("历史监控快照链接超出数据目录")
			}
			info, e := os.Stat(resolved)
			if e != nil {
				return e
			}
			if info.IsDir() {
				entries, e := os.ReadDir(resolved)
				if e != nil {
					return e
				}
				for _, d := range entries {
					if e = walk(filepath.Join(resolved, d.Name()), name+"/"+d.Name(), depth+1); e != nil {
						return e
					}
				}
				return nil
			}
			if !info.Mode().IsRegular() {
				return errors.New("历史监控快照包含特殊文件")
			}
			snap.Entries = append(snap.Entries, Entry{Name: name, file: resolved, Size: info.Size()})
			return nil
		}
		if err = walk(tree, "data/tsdb", 0); err != nil {
			return nil, err
		}
	}
	for i := range snap.Entries {
		info, e := os.Stat(snap.Entries[i].file)
		if e != nil {
			return nil, e
		}
		snap.Entries[i].Size = info.Size()
		snap.Total += info.Size()
	}
	sort.Slice(snap.Entries, func(i, j int) bool { return snap.Entries[i].Name < snap.Entries[j].Name })
	return snap, nil
}

type contextReader struct {
	ctx context.Context
	r   io.Reader
}

func (r contextReader) Read(b []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.r.Read(b)
}

type countingReader struct {
	r     io.Reader
	count func(int)
}

func (r countingReader) Read(b []byte) (int, error) { n, e := r.r.Read(b); r.count(n); return n, e }

// Write streams one complete archive. Total source bytes and wire bytes are distinct.
func (s *Snapshot) Write(ctx context.Context, dest io.Writer, progress func(int64)) error {
	var encrypted io.WriteCloser
	if s.Password != "" {
		recipient, e := age.NewScryptRecipient(s.Password)
		if e != nil {
			return e
		}
		// Password derivation temporarily allocates 256 MiB. Reclaim previous
		// garbage before it, then return its workspace to the OS before streaming.
		// Keep age's default work factor and encrypted format unchanged.
		debug.FreeOSMemory()
		if e = checkBackupMemory(320 << 20); e != nil {
			return e
		}
		encrypted, e = age.Encrypt(dest, recipient)
		debug.FreeOSMemory()
		if e != nil {
			return e
		}
		dest = encrypted
	}
	gz, err := gzip.NewWriterLevel(dest, gzip.BestSpeed)
	if err != nil {
		return err
	}
	tarOut := tar.NewWriter(gz)
	entries := make([]Entry, 0, len(s.Entries))
	var processed int64
	for _, entry := range s.Entries {
		if err = ctx.Err(); err != nil {
			return err
		}
		f, e := os.Open(entry.file)
		if e != nil {
			return e
		}
		e = tarOut.WriteHeader(&tar.Header{Name: entry.Name, Mode: 0600, Size: entry.Size, ModTime: s.At, Typeflag: tar.TypeReg})
		sum := sha256.New()
		if e == nil {
			_, e = io.CopyN(io.MultiWriter(tarOut, sum), countingReader{contextReader{ctx, f}, func(n int) { processed += int64(n); progress(processed) }}, entry.Size)
		}
		_ = f.Close()
		if e != nil {
			return e
		}
		actual := hex.EncodeToString(sum.Sum(nil))
		if entry.SHA256 != "" && actual != entry.SHA256 {
			return errors.New("快照文件在传输时发生变化，请重试")
		}
		entry.SHA256 = actual
		entries = append(entries, entry)
	}
	manifest := backupformat.Manifest{Format: 1, Version: s.Version, SnapshotAt: s.At}
	for _, entry := range entries {
		manifest.Files = append(manifest.Files, backupformat.File{Name: entry.Name, Size: entry.Size, SHA256: entry.SHA256})
	}
	if s.Kind == "incremental" {
		manifest.Format = 2
		manifest.Type = "incremental"
		manifest.Parent = s.Parent
		manifest.Deleted = s.Deleted
		manifest.Files = s.Index
	}
	body, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	if err = tarOut.WriteHeader(&tar.Header{Name: "manifest.json", Mode: 0600, Size: int64(len(body)), ModTime: s.At}); err != nil {
		return err
	}
	if _, err = tarOut.Write(body); err != nil {
		return err
	}
	if err = tarOut.Close(); err != nil {
		return err
	}
	if err = gz.Close(); err != nil {
		return err
	}
	if encrypted != nil {
		return encrypted.Close()
	}
	return nil
}
