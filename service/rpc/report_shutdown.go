package rpc

import (
	"github.com/nezhahq/nezha/pkg/utils"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

var errReportsStopping = status.Error(codes.Unavailable, "dashboard is stopping; new reports are not accepted")

// StopReports rejects new report messages, including messages on existing
// streams, without interrupting work already admitted. Idle Recv calls do not
// hold a lease, so a disconnected or silent agent cannot prevent draining.
func (s *NezhaHandler) StopReports() <-chan struct{} {
	return s.reportGate.Stop()
}

type reportLease struct {
	gate *utils.DrainGate
	held bool
}

func (l *reportLease) begin() bool {
	l.held = l.gate.Begin()
	return l.held
}
func (l *reportLease) end() {
	if l.held {
		l.gate.End()
		l.held = false
	}
}
