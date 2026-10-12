package model

import "time"

// Old runtime references cannot publish after explicit replacement.
func (s *Server) MachineRuntimeActive() bool {
	h := s.RuntimeHandle().holder
	h.mu.Lock()
	defer h.mu.Unlock()
	return !h.retired
}
func (s *Server) RetireMachineRuntime() {
	s.RevokeStreams()
	h := s.RuntimeHandle().holder
	h.mu.Lock()
	defer h.mu.Unlock()
	h.retired = true
	h.generation++
	h.stream = nil
	h.lastActive = time.Time{}
	if h.canonical != nil {
		h.canonical.LastActive = time.Time{}
	}
}
