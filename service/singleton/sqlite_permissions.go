package singleton

import (
	"errors"
	"fmt"
	"os"
	"runtime"
)

// prepareSQLiteFiles protects the database before SQLite can read or write it.
// SQLite derives newly created journal/WAL permissions from the database file;
// existing sidecars must also be tightened when upgrading an older installation.
// Do not chmod the parent directory: it may contain publicly served assets.
func prepareSQLiteFiles(path string) error {
	if err := secureSQLiteFile(path, true); err != nil {
		return err
	}
	for _, suffix := range []string{"-journal", "-wal", "-shm"} {
		if err := secureSQLiteFile(path+suffix, false); err != nil {
			return err
		}
	}
	return nil
}

func secureSQLiteFile(path string, create bool) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		if !create {
			return nil
		}
		// #nosec G304 -- The operator supplies this startup DB path, never an HTTP parameter; O_EXCL prevents replacing existing files.
		file, createErr := os.OpenFile(path, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0600)
		if errors.Is(createErr, os.ErrExist) {
			// Another startup won creation; validate that file before touching it.
			return secureSQLiteFile(path, false)
		}
		if createErr != nil {
			return fmt.Errorf("create private SQLite file: %w", createErr)
		}
		return file.Close()
	}
	if err != nil {
		return fmt.Errorf("inspect SQLite file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("SQLite file must be regular and not a symlink: %s", path)
	}
	// #nosec G304 -- Operator-controlled startup path; Lstat rejects non-regular files and SameFile below rejects replacement races.
	file, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		return fmt.Errorf("open SQLite file for permission check: %w", err)
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return err
	}
	if !os.SameFile(info, opened) {
		return fmt.Errorf("SQLite file changed during permission check: %s", path)
	}
	// Windows access is governed by ACLs, not Unix group/other permission bits.
	if runtime.GOOS != "windows" {
		if err := file.Chmod(0600); err != nil {
			return fmt.Errorf("secure SQLite file permissions: %w", err)
		}
	}
	return nil
}
