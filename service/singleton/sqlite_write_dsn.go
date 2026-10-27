package singleton

import (
	"net/url"
	"strings"
)

// Reserve SQLite's single writer at BEGIN, before reading a history baseline.
// A deferred read-to-write upgrade can return SQLITE_BUSY immediately when a
// snapshot writer already owns the reservation: waiting would deadlock that
// writer's commit against our read lock. BEGIN IMMEDIATE waits before taking
// any read lock, so the driver's busy timeout can actually resolve contention.
//
// This does not change the database schema, journal mode, durability settings,
// connection pool, or ordinary SELECT concurrency. Keep whole-transaction
// retries as a fallback for external readers/writers and never suppress errors.
func sqliteWriteDSN(path string) string {
	name, query, _ := strings.Cut(path, "?")
	params, err := url.ParseQuery(query)
	if err != nil {
		// Let the driver reject malformed options; never silently drop them.
		return path
	}
	params.Set("_txlock", "immediate")
	// A simultaneous fleet flush can spend more than the driver's five-second
	// default committing durable writes on slower disks. Wait for the current
	// writer without changing durability or retrying a partially applied write.
	// Respect both aliases when an operator explicitly chose a lock budget.
	if !params.Has("_busy_timeout") && !params.Has("_timeout") {
		params.Set("_busy_timeout", "30000")
	}
	return name + "?" + params.Encode()
}
