//go:build !linux

package panelbackup

func checkBackupMemory(uint64) error { return nil }
