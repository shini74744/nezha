package utils

import "sync"

// DrainGate separates closing admission from waiting for admitted work.
// Its zero value accepts work. Every successful Begin must have one End.
type DrainGate struct {
	mu      sync.Mutex
	active  int
	stopped bool
	drained chan struct{}
}

func (g *DrainGate) Begin() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.stopped {
		return false
	}
	g.active++
	return true
}

func (g *DrainGate) End() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.active--
	if g.active < 0 {
		panic("unbalanced DrainGate.End")
	}
	if g.stopped && g.active == 0 {
		close(g.drained)
	}
}

// Stop atomically rejects new work and returns a channel closed only after
// all work admitted before Stop has finished. Repeated calls are safe.
func (g *DrainGate) Stop() <-chan struct{} {
	g.mu.Lock()
	defer g.mu.Unlock()
	if !g.stopped {
		g.stopped = true
		g.drained = make(chan struct{})
		if g.active == 0 {
			close(g.drained)
		}
	}
	return g.drained
}
