package nic

import (
	"sort"
	"strings"
	"time"
)

// SelectionRecovery requires repeated complete enumerations. Link state is
// intentionally absent: a disconnected interface still has a valid identity.
type SelectionRecovery struct {
	candidate    string
	since        time.Time
	observations int
}

func (r *SelectionRecovery) Observe(allow map[string]bool, names []string, available bool, now time.Time) bool {
	selected := make([]string, 0, len(allow))
	for name, on := range allow {
		if on {
			selected = append(selected, name)
		}
	}
	if !available || len(names) == 0 || len(selected) == 0 {
		*r = SelectionRecovery{}
		return false
	}
	sort.Strings(selected)
	present := make(map[string]bool, len(names))
	for _, name := range names {
		present[name] = true
	}
	missing := make([]string, 0, len(selected))
	for _, name := range selected {
		if !present[name] {
			missing = append(missing, name)
		}
	}
	if len(missing) == 0 {
		*r = SelectionRecovery{}
		return false
	}
	key := strings.Join(selected, "\x00") + "\x01" + strings.Join(missing, "\x00")
	if key != r.candidate || now.Before(r.since) {
		*r = SelectionRecovery{candidate: key, since: now, observations: 1}
		return false
	}
	r.observations++
	return r.observations >= 3 && now.Sub(r.since) >= 30*time.Second
}
