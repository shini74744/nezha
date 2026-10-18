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
	return name + "?" + params.Encode()
}
