package backupreceiver

import (
	"io"
	"os"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/nezhahq/nezha/pkg/backupspace"
	"github.com/pkg/sftp"
)

// os.Root enforces containment during the filesystem operation itself, including
// concurrent renames and symlinks. No shell, links, ownership changes, or special
// files are exposed through this SFTP endpoint.
type Filesystem struct {
	root      *os.Root
	directory string
	folder    string
	mu        sync.Mutex
	created   map[string]bool
}

func NewFilesystem(directory, user string) (*Filesystem, error) {
	root, err := os.OpenRoot(directory)
	if err != nil {
		return nil, err
	}
	return &Filesystem{created: map[string]bool{}, root: root, directory: path.Clean(directory), folder: "ddnezha-" + strings.Split(strings.TrimPrefix(user, "ddnb_"), "_")[0]}, nil
}
func (f *Filesystem) Close() error { return f.root.Close() }
func (f *Filesystem) Handlers() sftp.Handlers {
	return sftp.Handlers{FileGet: f, FilePut: f, FileCmd: f, FileList: f}
}
func (f *Filesystem) name(p string) (string, error) {
	if strings.ContainsAny(p, "\x00\\") {
		return "", os.ErrPermission
	}
	for _, part := range strings.Split(p, "/") {
		if part == ".." {
			return "", os.ErrPermission
		}
	}
	p = path.Clean(p)
	if p == f.directory {
		return ".", nil
	}
	if !strings.HasPrefix(p, f.directory+"/") {
		return "", os.ErrPermission
	}
	p = strings.TrimPrefix(p, f.directory+"/")
	if p != f.folder && !strings.HasPrefix(p, f.folder+"/") {
		return "", os.ErrPermission
	}
	if strings.Count(p, "/") > 1 {
		return "", os.ErrPermission
	}
	return p, nil
}
func (f *Filesystem) Fileread(r *sftp.Request) (io.ReaderAt, error) {
	name, err := f.name(r.Filepath)
	if err != nil {
		return nil, err
	}
	file, err := f.root.Open(name)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		file.Close()
		return nil, os.ErrPermission
	}
	return file, nil
}

type syncedFile struct {
	*os.File
	directory string
	parent    string
	root      *os.Root
	lastCheck time.Time
	mu        sync.Mutex
}

func (f *syncedFile) WriteAt(data []byte, offset int64) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if time.Since(f.lastCheck) > time.Second {
		if err := backupspace.Check(f.directory, 256*1024*1024); err != nil {
			return 0, err
		}
		f.lastCheck = time.Now()
	}
	return f.File.WriteAt(data, offset)
}
func (f *syncedFile) Close() error {
	err := f.Sync()
	ce := f.File.Close()
	if err != nil {
		return err
	}
	if ce != nil {
		return ce
	}
	if f.root != nil {
		dir, e := f.root.Open(f.parent)
		if e != nil {
			return e
		}
		defer dir.Close()
		return dir.Sync()
	}
	return nil
}
func (f *Filesystem) Filewrite(r *sftp.Request) (io.WriterAt, error) {
	name, err := f.name(r.Filepath)
	if err != nil {
		return nil, err
	}
	if name == "." || name == f.folder {
		return nil, os.ErrPermission
	}
	flags := r.Pflags()
	// Every new backup has a unique name. Refuse destructive opens of older backups.
	if !flags.Write || !flags.Creat || !flags.Excl || flags.Append {
		return nil, os.ErrPermission
	}
	file, err := f.root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	f.created[name] = true
	f.mu.Unlock()
	return &syncedFile{File: file, directory: f.directory, parent: path.Dir(name), root: f.root}, nil
}
func (f *Filesystem) Filecmd(r *sftp.Request) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	name, err := f.name(r.Filepath)
	if err != nil {
		return err
	}
	switch r.Method {
	case "Mkdir":
		if name != f.folder {
			return os.ErrPermission
		}
		return f.root.Mkdir(name, 0700)
	case "Rename":
		target, err := f.name(r.Target)
		if err != nil {
			return err
		}
		if !strings.HasSuffix(name, ".partial") || strings.TrimSuffix(name, ".partial") != target {
			return os.ErrPermission
		}
		if !f.created[name] {
			return os.ErrPermission
		}
		// Publish without replacement atomically, even across separate SFTP
		// sessions. A prior existence check followed by Rename can overwrite
		// a backup created by another connection between those operations.
		if err := f.root.Link(name, target); err != nil {
			return err
		}
		if err := f.root.Remove(name); err != nil {
			return err
		}
		delete(f.created, name)
		f.created[target] = true
		dir, e := f.root.Open(path.Dir(target))
		if e != nil {
			return e
		}
		defer dir.Close()
		return dir.Sync()
	case "Remove":
		if !f.created[name] && !strings.HasSuffix(name, ".partial") {
			return os.ErrPermission
		}
		if name == "." || name == f.folder {
			return os.ErrPermission
		}
		info, err := f.root.Lstat(name)
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return os.ErrPermission
		}
		return f.root.Remove(name)
	case "Setstat":
		attrs := r.AttrFlags()
		if attrs.Size || attrs.UidGid || attrs.Acmodtime {
			return os.ErrPermission
		}
		file, err := f.root.Open(name)
		if err != nil {
			return err
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			return err
		}
		if info.IsDir() {
			return file.Chmod(0700)
		}
		if !info.Mode().IsRegular() {
			return os.ErrPermission
		}
		return file.Chmod(0600)
	default:
		return sftp.ErrSSHFxOpUnsupported
	}
}

type listing []os.FileInfo

func (l listing) ListAt(out []os.FileInfo, offset int64) (int, error) {
	if offset < 0 {
		return 0, os.ErrInvalid
	}
	if offset >= int64(len(l)) {
		return 0, io.EOF
	}
	n := copy(out, l[offset:])
	if n < len(out) {
		return n, io.EOF
	}
	return n, nil
}
func (f *Filesystem) Filelist(r *sftp.Request) (sftp.ListerAt, error) {
	name, err := f.name(r.Filepath)
	if err != nil {
		return nil, err
	}
	switch r.Method {
	case "Stat", "Lstat":
		info, err := f.root.Lstat(name)
		if err != nil {
			return nil, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return nil, os.ErrPermission
		}
		return listing{info}, nil
	case "List":
		file, err := f.root.Open(name)
		if err != nil {
			return nil, err
		}
		defer file.Close()
		entries, err := file.Readdir(-1)
		if err != nil {
			return nil, err
		}
		result := listing{}
		for _, info := range entries {
			if name == "." && info.Name() != f.folder {
				continue
			}
			if info.Mode()&os.ModeSymlink != 0 {
				continue
			}
			result = append(result, info)
		}
		return result, nil
	default:
		return nil, sftp.ErrSSHFxOpUnsupported
	}
}
func (f *Filesystem) RealPath(p string) (string, error) {
	if p == "." || p == "" {
		return f.directory, nil
	}
	name, err := f.name(p)
	if err != nil {
		return "", err
	}
	if name == "." {
		return f.directory, nil
	}
	return path.Join(f.directory, name), nil
}
