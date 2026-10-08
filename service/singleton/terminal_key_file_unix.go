//go:build !windows

package singleton

import (
	"errors"
	"os"
)

// openPrivateTerminalKey preserves Unix owner-only permissions and validates
// the same file handle that will be read, including after a path replacement.
func openPrivateTerminalKey(path string, create bool) (*os.File, error) {
	var before os.FileInfo
	if !create {
		var err error
		before, err = os.Lstat(path)
		if err != nil {
			return nil, err
		}
		if !before.Mode().IsRegular() || before.Mode().Perm()&0077 != 0 {
			return nil, errors.New("terminal command key must be a regular private file (0600)")
		}
	}
	flags := os.O_RDONLY
	if create {
		flags = os.O_RDWR | os.O_CREATE | os.O_EXCL
	}
	// #nosec G304 -- Operator-configured startup key path, not request input. O_EXCL protects creation; existing files must match the checked regular/private file.
	file, err := os.OpenFile(path, flags, 0600)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err == nil && (!info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 || (before != nil && !os.SameFile(before, info))) {
		err = errors.New("terminal command key must be the checked regular private file (0600)")
	}
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	return file, nil
}
