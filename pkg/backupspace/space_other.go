//go:build !linux && !darwin && !freebsd

package backupspace

// Filesystem writes still report ENOSPC on platforms without this preflight.
func Check(path string, reserve uint64) error { return nil }
