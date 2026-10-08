//go:build linux

package scenario

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/nezhahq/nezha/integration/agentcompat/internal/dashboard"
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
)

type delayedReconnectReceipts struct {
	ready    bool
	waitErr  error
	exactErr error
	exact    []dashboard.MCPReceiptExpectation
}

func (reader *delayedReconnectReceipts) WaitForMCPReceiptPairs(ctx context.Context, _ dashboard.MCPReceiptCursor, expected []dashboard.MCPReceiptExpectation) ([]dashboard.MCPReceiptPair, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if reader.waitErr != nil {
		return nil, reader.waitErr
	}
	if len(expected) != 1 || expected[0].ServerID != 7 || expected[0].TaskType != model.TaskTypeExec {
		return nil, errors.New("wrong receipt request")
	}
	// The observer publishes the event after the HTTP response, at this barrier.
	reader.ready = true
	return nil, nil
}
func (reader *delayedReconnectReceipts) MCPReceiptEventsAfter(_ dashboard.MCPReceiptCursor) []dashboard.MCPReceiptEvent {
	if !reader.ready {
		return nil
	}
	return []dashboard.MCPReceiptEvent{{Sequence: 1, DashboardGeneration: 2, GateGeneration: 9, ServerID: 7, TaskID: 101, TaskType: model.TaskTypeExec, Kind: dashboard.MCPReceiptTask}}
}
func (reader *delayedReconnectReceipts) WaitForMCPReceiptSet(_ context.Context, _ dashboard.MCPReceiptCursor, expected []dashboard.MCPReceiptExpectation) ([]dashboard.MCPReceiptPair, error) {
	reader.exact = expected
	return nil, reader.exactErr
}

func TestReconnectReceiptsWaitForObserverBeforeSnapshot(t *testing.T) {
	reader := &delayedReconnectReceipts{}
	_, err := waitReconnectReceipts(t.Context(), reader, dashboard.MCPReceiptCursor{}, 2, 7, []uint64{model.TaskTypeExec})
	require.NoError(t, err)
	require.Equal(t, []dashboard.MCPReceiptExpectation{{DashboardGeneration: 2, GateGeneration: 9, ServerID: 7, TaskID: 101, TaskType: model.TaskTypeExec}}, reader.exact)
}

func TestReconnectReceiptsPreserveWaitFailureAndExactValidation(t *testing.T) {
	failure := errors.New("receipt transport closed")
	_, err := waitReconnectReceipts(t.Context(), &delayedReconnectReceipts{waitErr: failure}, dashboard.MCPReceiptCursor{}, 2, 7, []uint64{model.TaskTypeExec})
	require.ErrorIs(t, err, failure)
	duplicate := errors.New("duplicate receipt")
	_, err = waitReconnectReceipts(t.Context(), &delayedReconnectReceipts{exactErr: duplicate}, dashboard.MCPReceiptCursor{}, 2, 7, []uint64{model.TaskTypeExec})
	require.ErrorIs(t, err, duplicate)
	ctx, cancel := context.WithDeadline(t.Context(), time.Now().Add(-time.Second))
	defer cancel()
	_, err = waitReconnectReceipts(ctx, &delayedReconnectReceipts{}, dashboard.MCPReceiptCursor{}, 2, 7, []uint64{model.TaskTypeExec})
	require.ErrorIs(t, err, context.DeadlineExceeded)
}

func TestReconnectReceiptsStillRejectWrongGeneration(t *testing.T) {
	_, err := waitReconnectReceipts(t.Context(), &delayedReconnectReceipts{}, dashboard.MCPReceiptCursor{}, 3, 7, []uint64{model.TaskTypeExec})
	require.ErrorContains(t, err, "task set is incomplete")
}
