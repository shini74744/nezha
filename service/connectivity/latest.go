package connectivity

// LatestCompleted returns an independent, retention-limited view while a newer
// batch is running. Reconcile prevents stale endpoint identities from resurfacing.
func (m *Manager) LatestCompleted(key string, targets []Target) (Snapshot, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e := m.entries[key]
	if e == nil {
		return Snapshot{}, false
	}
	source := e.previous
	if e.snapshot.State == "complete" {
		source = &e.snapshot
	}
	cutoff := m.now().Add(-m.ttl).UnixMilli()
	if source == nil || source.FinishedAt == 0 || source.FinishedAt < cutoff {
		return Snapshot{}, false
	}
	snapshot := retainSamples(reconcile(clone(*source), targets), cutoff)
	return snapshot, snapshot.State == "complete"
}
