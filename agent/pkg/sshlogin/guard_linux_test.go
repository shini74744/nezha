package sshlogin

import (
	"testing"
	"time"
)

func TestSSHDurableQueueAckDoesNotDiscardNewEvents(t *testing.T) {
	old := Event{ID: "old", Time: time.Now().UnixMilli()}
	newer := Event{ID: "new", Time: time.Now().UnixMilli()}
	state := savedState{Pending: []Event{old, newer}, Completed: []uint64{1, 2}}
	acknowledge(&state, Report{Events: []Event{old}, Completed: []uint64{1}})
	if len(state.Pending) != 1 || state.Pending[0].ID != "new" || len(state.Completed) != 1 || state.Completed[0] != 2 {
		t.Fatalf("lost new local state: %+v", state)
	}
}
func TestSSHLocalPortResolutionFreshness(t *testing.T) {
	now := time.Now()
	events := []Event{{Time: now.UnixMilli(), SourceIP: "192.0.2.1", SourcePort: 40001}, {Time: now.Add(-time.Hour).UnixMilli(), SourceIP: "192.0.2.2", SourcePort: 22}}
	resolvePorts(events, []uint16{2222}, map[string]uint16{}, now.Add(-time.Second))
	if events[0].Port != 2222 || events[1].Port != 0 {
		t.Fatalf("incorrect attribution %+v", events)
	}
	events[0].Port = 0
	resolvePorts(events[:1], []uint16{22, 2222}, map[string]uint16{}, now.Add(-time.Second))
	if events[0].Port != 0 {
		t.Fatal("guessed port with multiple listeners")
	}
	resolvePorts(events[:1], []uint16{22, 2222}, map[string]uint16{"192.0.2.1:40001": 2222}, time.Time{})
	if events[0].Port != 2222 {
		t.Fatal("ignored socket mapping")
	}
}
