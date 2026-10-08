//go:build linux

package scenario

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/nezhahq/nezha/integration/agentcompat/internal/client"
	"github.com/stretchr/testify/require"
)

func TestTransferQuiescenceWaitsForHandlerCleanup(t *testing.T) {
	root := t.TempDir()
	file, err := os.Create(filepath.Join(root, "nz-mcp-xfer-completion"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = file.Close() })
	require.NoError(t, os.Remove(file.Name()))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPost, r.Method)
		require.Equal(t, "/agentcompat/io-stream-state", r.URL.Path)
		var expected client.IOStreamStateExpectation
		require.NoError(t, json.NewDecoder(r.Body).Decode(&expected))
		require.NotNil(t, expected.ExpectedCount)
		require.Zero(t, *expected.ExpectedCount)
		// Simulate cleanup after the client already received the final byte.
		require.NoError(t, file.Close())
		_, _ = w.Write([]byte(`{"success":true,"data":{"count":0,"generation":1}}`))
	}))
	defer server.Close()
	c, err := client.New(client.Config{BaseURL: server.URL})
	require.NoError(t, err)
	execution := transferExecution{client: c, residueScope: transferResidueScope{AgentRoot: root, DashboardPID: os.Getpid()}}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	remaining, err := execution.confirmQuiescence(ctx)
	require.NoError(t, err)
	require.Positive(t, remaining)
}

func TestTransferQuiescenceStillRejectsResidueAfterCleanupReceipt(t *testing.T) {
	root := t.TempDir()
	file, err := os.Create(filepath.Join(root, "nz-mcp-xfer-retained"))
	require.NoError(t, err)
	defer file.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"success":true,"data":{"count":0,"generation":1}}`))
	}))
	defer server.Close()
	c, err := client.New(client.Config{BaseURL: server.URL})
	require.NoError(t, err)
	execution := transferExecution{client: c, residueScope: transferResidueScope{AgentRoot: root, DashboardPID: os.Getpid()}}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	_, err = execution.confirmQuiescence(ctx)
	require.ErrorContains(t, err, "transfer completion left residue")
}

func TestTransferQuiescencePropagatesMissingCleanupReceipt(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()
	c, err := client.New(client.Config{BaseURL: server.URL})
	require.NoError(t, err)
	execution := transferExecution{client: c, residueScope: transferResidueScope{AgentRoot: t.TempDir(), DashboardPID: os.Getpid()}}
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	_, err = execution.confirmQuiescence(ctx)
	require.Error(t, err)
}
