package main

import (
	"context"
	"github.com/nezhahq/agent/model"
	pb "github.com/nezhahq/agent/proto"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestConnectivityHTTPDeadlineCancelsBody(t *testing.T) {
	old := httpClient
	httpClient = &http.Client{Timeout: 30 * time.Second}
	defer func() { httpClient = old }()
	stopped := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(200)
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(stopped)
	}))
	defer server.Close()
	result := &pb.TaskResult{}
	started := time.Now()
	handleHttpGetTaskWithConfig(taskFeatureGates{}, &pb.Task{Id: 1<<62 | 1, Type: model.TaskTypeHTTPGet, Data: server.URL}, result)
	elapsed := time.Since(started)
	if elapsed > 4*time.Second || elapsed < 2800*time.Millisecond {
		t.Fatalf("connectivity deadline=%s, want about 3s", elapsed)
	}
	if result.Successful || !strings.Contains(strings.ToLower(result.Data), "deadline") {
		t.Fatalf("bad timeout result: %+v", result)
	}
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("timed-out HTTP body still running")
	}
}

type deadlineTransport struct {
	t            *testing.T
	wantDeadline bool
}

func (d deadlineTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	deadline, ok := r.Context().Deadline()
	if !ok {
		d.t.Fatal("HTTP request has no deadline")
	}
	remaining := time.Until(deadline)
	if d.wantDeadline && remaining > 3100*time.Millisecond {
		d.t.Fatalf("connectivity deadline too long: %s", remaining)
	}
	if !d.wantDeadline && remaining < 20*time.Second {
		d.t.Fatalf("ordinary service monitor timeout was shortened: %s", remaining)
	}
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("ok")), Header: make(http.Header), Request: r}, nil
}
func TestConnectivityDeadlineDoesNotChangeOrdinaryHTTPMonitor(t *testing.T) {
	old := httpClient
	defer func() { httpClient = old }()
	for _, connectivity := range []bool{false, true} {
		httpClient = &http.Client{Timeout: 30 * time.Second, Transport: deadlineTransport{t, connectivity}}
		id := uint64(1)
		if connectivity {
			id |= 1 << 62
		}
		result := &pb.TaskResult{}
		handleHttpGetTaskWithConfig(taskFeatureGates{}, &pb.Task{Id: id, Type: model.TaskTypeHTTPGet, Data: "https://example.test/"}, result)
		if !result.Successful {
			t.Fatal(result.Data)
		}
	}
}
func TestConnectivityHTTPRespectsTaskSessionCancellation(t *testing.T) {
	old := httpClient
	httpClient = &http.Client{Timeout: 30 * time.Second}
	defer func() { httpClient = old }()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result := doTaskWithSnapshot(ctx, &model.AgentConfig{}, &pb.Task{Id: 1<<62 | 2, Type: model.TaskTypeHTTPGet, Data: "http://127.0.0.1:1"})
	if result.Successful || !strings.Contains(result.Data, "context canceled") {
		t.Fatalf("task session ignored: %+v", result)
	}
}
