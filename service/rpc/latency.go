package rpc

import (
	"context"
	"errors"
	"github.com/nezhahq/nezha/service/latency"
	"math"
	"net"
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
const latencyTaskMask uint64 = 1 << 62

// Panel-side deadline for one dispatched attempt. Older Agents may finish their
// own HTTP request later; their late reply is consumed without changing results.
const latencyProbeTimeout = 12 * time.Second

var latencyCounter atomic.Uint64
var latencyWaiters sync.Map

// A stuck gRPC Send retains its slot until it actually exits, bounding even
// pathological transports instead of leaking a new goroutine on every retry.
var latencySends = make(chan struct{}, 16)

type latencyWaiter struct {
	serverID uint64
	stream   pb.NezhaService_RequestTaskServer
	result   chan *pb.TaskResult
}

func LatencyOnline(server *model.Server) bool {
	if server == nil || server.GetTaskStream() == nil {
		return false
	}
	return time.Since(server.RuntimeSnapshot().LastActive) <= 30*time.Second
}

// LatencyProbe binds each batch to its original UUID, owner and task stream.
// Reconnection/transfer/reassignment cannot silently change the machine probed.
func LatencyProbe(server *model.Server, selected ...[]connectivity.Target) connectivity.Probe {
	catalog := connectivity.Targets()
	if len(selected) > 0 {
		catalog = selected[0]
	}
	approved := make(map[string]connectivity.Target, len(catalog))
	for _, target := range catalog {
		approved[target.ID] = target
	}
	id, uuid, owner, stream := server.ID, server.UUID, server.GetUserID(), server.GetTaskStream()
	return func(parent context.Context, target connectivity.Target) connectivity.Sample {
		fixed, ok := approved[target.ID]
		if !ok {
			return connectivity.Sample{Status: "error"}
		}
		ctx, cancel := context.WithTimeout(parent, latencyProbeTimeout)
		defer cancel()
		current, ok := singleton.ServerShared.Get(id)
		if !ok || current.UUID != uuid || current.GetUserID() != owner || current.GetTaskStream() != stream || !LatencyOnline(current) {
			return connectivity.Sample{Status: "offline"}
		}
		address, err := publicLatencyAddress(ctx, fixed.URL, fixed.Family)
		if err != nil {
			return connectivity.Sample{Status: "dns_error"}
		}
		taskID := latencyTaskMask | latencyCounter.Add(1)
		waiter := &latencyWaiter{serverID: id, stream: stream, result: make(chan *pb.TaskResult, 1)}
		latencyWaiters.Store(taskID, waiter)
		defer latencyWaiters.Delete(taskID)
		select {
		case latencySends <- struct{}{}:
		case <-ctx.Done():
			return connectivity.Sample{Status: "agent_timeout"}
		}
		sent := make(chan error, 1)
		go func() {
			defer func() { <-latencySends }()
			if ctx.Err() != nil {
				sent <- ctx.Err()
				return
			}
			if current.GetUserID() != owner || singleton.ServerIDReassignmentInProgress.Load() || singleton.IsDeletedServerUUID(uuid) {
				sent <- model.ErrTaskStreamOffline
				return
			}
			sent <- current.SendTaskOnStream(ctx, &pb.Task{Id: taskID, Type: model.TaskTypeTCPPing, Data: address}, stream)
		}()
		select {
		case err := <-sent:
			if ctx.Err() != nil {
				return connectivity.Sample{Status: "agent_timeout"}
			}
			if err != nil {
				return connectivity.Sample{Status: "offline"}
			}
		case <-ctx.Done():
			return connectivity.Sample{Status: "agent_timeout"}
		}
		select {
		case result := <-waiter.result:
			if ctx.Err() != nil {
				return connectivity.Sample{Status: "agent_timeout"}
			}
			current, ok := singleton.ServerShared.Get(id)
			if !ok || current.UUID != uuid || current.GetUserID() != owner || current.GetTaskStream() != stream {
				return connectivity.Sample{Status: "offline"}
			}
			return classifyLatencyResult(result)
		case <-ctx.Done():
			return connectivity.Sample{Status: "agent_timeout"}
		}
	}
}
func deliverLatencyResult(result *pb.TaskResult, reporterID uint64, stream pb.NezhaService_RequestTaskServer) bool {
	if result == nil || result.GetType() != model.TaskTypeTCPPing || result.GetId()&latencyTaskMask == 0 {
		return false
	}
	raw, ok := latencyWaiters.Load(result.GetId())
	if !ok {
		return true
	}
	waiter := raw.(*latencyWaiter)
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

var latencyHTTPError = regexp.MustCompile(`(?:应用错误:|application error:|http(?:/[0-9.]+)?)\s*([45][0-9]{2})(?:\s|$)`)

func classifyLatencyResult(result *pb.TaskResult) connectivity.Sample {
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
	if match := latencyHTTPError.FindStringSubmatch(data); len(match) > 1 {
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

// Resolve in the trusted panel and dispatch a literal public IP, preventing
// custom targets from reaching private networks or rebinding inside an Agent.
func publicLatencyAddress(ctx context.Context, target string, family ...string) (string, error) {
	host, port, err := net.SplitHostPort(target)
	if err != nil {
		return "", err
	}
	network := "ip"
	if len(family) > 0 {
		switch family[0] {
		case "IPv4":
			network = "ip4"
		case "IPv6":
			network = "ip6"
		case "":
		default:
			return "", errors.New("invalid latency family")
		}
	}
	ips, err := net.DefaultResolver.LookupIP(ctx, network, host)
	if err != nil {
		return "", err
	}
	addresses := make([]net.IPAddr, 0, len(ips))
	for _, ip := range ips {
		addresses = append(addresses, net.IPAddr{IP: ip})
	}
	for _, address := range addresses {
		if !latency.PublicIP(address.IP) {
			return "", errors.New("non-public latency target")
		}
	}
	for _, address := range addresses {
		if address.IP.To4() != nil {
			return net.JoinHostPort(address.IP.String(), port), nil
		}
	}
	if len(addresses) > 0 {
		return net.JoinHostPort(addresses[0].IP.String(), port), nil
	}
	return "", errors.New("no public latency address")
}
