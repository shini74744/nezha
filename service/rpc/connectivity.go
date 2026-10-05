package rpc

import (
	"context"
	"math"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/singleton"
)

// Isolated from stored service IDs and command/MCP tasks. Late responses in this
// namespace are ALWAYS consumed, never passed into ServiceSentinel or alerts.
const connectivityTaskMask uint64 = 1 << 62

var connectivityCounter atomic.Uint64
var connectivityWaiters sync.Map

// A stuck gRPC Send retains its slot until it actually exits, bounding even
// pathological transports instead of leaking a new goroutine on every retry.
var connectivitySends = make(chan struct{}, 16)

type connectivityWaiter struct {
	serverID uint64
	stream   pb.NezhaService_RequestTaskServer
	result   chan *pb.TaskResult
}

func ConnectivityOnline(server *model.Server) bool {
	if server == nil || server.GetTaskStream() == nil {
		return false
	}
	return time.Since(server.RuntimeSnapshot().LastActive) <= 30*time.Second
}

// ConnectivityProbe binds each batch to its original UUID, owner and task stream.
// Reconnection/transfer/reassignment cannot silently change the machine probed.
func ConnectivityProbe(server *model.Server) connectivity.Probe {
	id, uuid, owner, stream := server.ID, server.UUID, server.GetUserID(), server.GetTaskStream()
	return func(parent context.Context, target connectivity.Target) connectivity.Sample {
		fixed, ok := connectivity.FindTarget(target.ID)
		if !ok {
			return connectivity.Sample{Status: "error"}
		}
		ctx, cancel := context.WithTimeout(parent, 35*time.Second)
		defer cancel()
		current, ok := singleton.ServerShared.Get(id)
		if !ok || current.UUID != uuid || current.GetUserID() != owner || current.GetTaskStream() != stream || !ConnectivityOnline(current) {
			return connectivity.Sample{Status: "offline"}
		}
		taskID := connectivityTaskMask | connectivityCounter.Add(1)
		waiter := &connectivityWaiter{serverID: id, stream: stream, result: make(chan *pb.TaskResult, 1)}
		connectivityWaiters.Store(taskID, waiter)
		defer connectivityWaiters.Delete(taskID)
		select {
		case connectivitySends <- struct{}{}:
		case <-ctx.Done():
			return connectivity.Sample{Status: "agent_timeout"}
		}
		sent := make(chan error, 1)
		go func() {
			defer func() { <-connectivitySends }()
			if ctx.Err() != nil {
				sent <- ctx.Err()
				return
			}
			if current.GetUserID() != owner || singleton.ServerIDReassignmentInProgress.Load() || singleton.IsDeletedServerUUID(uuid) {
				sent <- model.ErrTaskStreamOffline
				return
			}
			sent <- current.SendTaskOnStream(ctx, &pb.Task{Id: taskID, Type: model.TaskTypeHTTPGet, Data: fixed.URL}, stream)
		}()
		select {
		case err := <-sent:
			if err != nil {
				return connectivity.Sample{Status: "offline"}
			}
		case <-ctx.Done():
			return connectivity.Sample{Status: "agent_timeout"}
		}
		select {
		case result := <-waiter.result:
			current, ok := singleton.ServerShared.Get(id)
			if !ok || current.UUID != uuid || current.GetUserID() != owner || current.GetTaskStream() != stream {
				return connectivity.Sample{Status: "offline"}
			}
			return classifyConnectivityResult(result)
		case <-ctx.Done():
			return connectivity.Sample{Status: "agent_timeout"}
		}
	}
}
func deliverConnectivityResult(result *pb.TaskResult, reporterID uint64, stream pb.NezhaService_RequestTaskServer) bool {
	if result == nil || result.GetType() != model.TaskTypeHTTPGet || result.GetId()&connectivityTaskMask == 0 {
		return false
	}
	raw, ok := connectivityWaiters.Load(result.GetId())
	if !ok {
		return true
	}
	waiter := raw.(*connectivityWaiter)
	if waiter.serverID != reporterID || waiter.stream != stream {
		return true
	}
	// Copy only bounded diagnostic data. Never return raw Agent text/IPs to visitors.
	data := result.GetData()
	if len(data) > 4096 {
		data = data[:4096]
	}
	copy := &pb.TaskResult{Id: result.Id, Type: result.Type, Delay: result.Delay, Successful: result.Successful, Data: data}
	select {
	case waiter.result <- copy:
	default:
	}
	return true
}

var connectivityHTTPError = regexp.MustCompile(`(?:应用错误:|application error:|http(?:/[0-9.]+)?)\s*([45][0-9]{2})(?:\s|$)`)

func classifyConnectivityResult(result *pb.TaskResult) connectivity.Sample {
	sample := connectivity.Sample{Status: "error"}
	value := float64(result.GetDelay())
	validDelay := !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= 120000
	if result.GetSuccessful() {
		sample.Status = "ok"
		if validDelay {
			sample.DelayMS = &value
		}
		return sample
	}
	data := strings.ToLower(result.GetData())
	if match := connectivityHTTPError.FindStringSubmatch(data); len(match) > 1 {
		sample.Status = "http_error"
		sample.HTTPStatus, _ = strconv.Atoi(match[1])
		if validDelay {
			sample.DelayMS = &value
		}
		return sample
	}
	switch {
	case strings.Contains(data, "disabled query"):
		sample.Status = "query_disabled"
	case strings.Contains(data, "no such host") || strings.Contains(data, "server misbehaving") || strings.Contains(data, "record not resolved") || strings.Contains(data, "lookup "):
		sample.Status = "dns_error"
	case strings.Contains(data, "x509:") || strings.Contains(data, "tls:") || strings.Contains(data, "certificate"):
		sample.Status = "tls_error"
	case strings.Contains(data, "timeout") || strings.Contains(data, "deadline exceeded"):
		sample.Status = "timeout"
	case strings.Contains(data, "connection refused"):
		sample.Status = "refused"
	case strings.Contains(data, "network is unreachable") || strings.Contains(data, "no route to host"):
		sample.Status = "unreachable"
	}
	return sample
}
