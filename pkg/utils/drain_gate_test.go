package utils

import (
	"sync"
	"sync/atomic"
	"testing"
)

func TestDrainGateAdmissionAndRepeatedStop(t *testing.T) {
	var gate DrainGate
	if !gate.Begin() {
		t.Fatal("new gate rejected work")
	}
	done := gate.Stop()
	if gate.Begin() {
		t.Fatal("work accepted after stop")
	}
	select {
	case <-done:
		t.Fatal("finished with admitted work pending")
	default:
	}
	gate.End()
	<-done
	if gate.Stop() != done {
		t.Fatal("Stop must reuse its completion")
	}
}
func TestDrainGateConcurrentAdmissionAndStop(t *testing.T) {
	for range 100 {
		var gate DrainGate
		var workers sync.WaitGroup
		var active atomic.Int64
		start := make(chan struct{})
		for range 32 {
			workers.Add(1)
			go func() {
				defer workers.Done()
				<-start
				if gate.Begin() {
					active.Add(1)
					active.Add(-1)
					gate.End()
				}
			}()
		}
		close(start)
		<-gate.Stop()
		if active.Load() != 0 {
			t.Fatal("drained before admitted work completed")
		}
		workers.Wait()
		if gate.Begin() {
			t.Fatal("gate reopened")
		}
	}
}
