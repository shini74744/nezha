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
	"sort"
	"strings"
	"time"

	"filippo.io/age"
	"github.com/mattn/go-sqlite3"
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
	u := url.URL{Scheme: "file", Path: abs(source)}
	q := u.Query()
	q.Set("mode", "ro")
	q.Set("_busy_timeout", "1000")
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
		return err
	}
	defer sc.Close()
	dc, err := dst.Conn(ctx)
	if err != nil {
		return err
	}
	defer dc.Close()
	err = dc.Raw(func(d any) error {
		return sc.Raw(func(s any) error {
			backup, e := d.(*sqlite3.SQLiteConn).Backup("main", s.(*sqlite3.SQLiteConn), "main")
			if e != nil {
				return e
			}
			defer backup.Close()
			for {
				if e = ctx.Err(); e != nil {
					return e
				}
				done, e := backup.Step(256)
				if e != nil {
					return e
				}
				if done {
					return nil
				}
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(2 * time.Millisecond):
				}
			}
		})
	})
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
	copyFile := func(srcFile, name string) error {
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
		in, err := os.Open(srcFile)
		if err != nil {
			return err
		}
		defer in.Close()
		out, err := os.OpenFile(dest, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
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
	if err = copyFile(src.Config, "data/config.yaml"); err != nil {
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
			return copyFile(p, "data/"+filepath.ToSlash(rel))
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
		encrypted, e = age.Encrypt(dest, recipient)
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
		entry.SHA256 = hex.EncodeToString(sum.Sum(nil))
		entries = append(entries, entry)
	}
	manifest := struct {
		Format     int       `json:"format"`
		Version    string    `json:"version"`
		SnapshotAt time.Time `json:"snapshot_at"`
		Files      []Entry   `json:"files"`
	}{1, s.Version, s.At, entries}
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
