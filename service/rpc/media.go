package rpc

import (
	"context"
	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/nezhahq/nezha/service/singleton"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

const mediaTaskMask uint64 = 1 << 61

var mediaCounter atomic.Uint64
var mediaWaiters sync.Map
var mediaSends = make(chan struct{}, 8)

type mediaWaiter struct {
	serverID uint64
	stream   pb.NezhaService_RequestTaskServer
	result   chan *pb.TaskResult
}

func MediaProbe(server *model.Server) func(context.Context, string, string) networkinsight.MediaResult {
	id, uuid, owner, stream := server.ID, server.UUID, server.GetUserID(), server.GetTaskStream()
	return func(parent context.Context, target, family string) networkinsight.MediaResult {
		base := networkinsight.ClassifyMedia(target, family, "", false)
		command, err := networkinsight.MediaCommand(target, family)
		if err != nil {
			return base
		}
		current, ok := singleton.ServerShared.Get(id)
		valid := func(s *model.Server) bool {
			return s != nil && s.UUID == uuid && s.GetUserID() == owner && s.GetTaskStream() == stream && !s.StreamingDisabled && ConnectivityOnline(s) && !singleton.ServerIDReassignmentInProgress.Load() && !singleton.IsDeletedServerUUID(uuid)
		}
		if !ok || !valid(current) {
			base.Status = "offline"
			return base
		}
		host := current.RuntimeSnapshot().Host
		if host == nil || strings.Contains(strings.ToLower(host.Platform), "windows") {
			base.Status = "unsupported"
			return base
		}
		ctx, cancel := context.WithTimeout(parent, 15*time.Second)
		defer cancel()
		taskID := mediaTaskMask | mediaCounter.Add(1)
		waiter := &mediaWaiter{id, stream, make(chan *pb.TaskResult, 1)}
		mediaWaiters.Store(taskID, waiter)
		defer mediaWaiters.Delete(taskID)
		select {
		case mediaSends <- struct{}{}:
		case <-ctx.Done():
			base.Status = "timeout"
			return base
		}
		sent := make(chan error, 1)
		go func() {
			defer func() { <-mediaSends }()
			s, ok := singleton.ServerShared.Get(id)
			if !ok || !valid(s) {
				sent <- model.ErrTaskStreamOffline
				return
			}
			sent <- s.SendTaskOnStream(ctx, &pb.Task{Id: taskID, Type: model.TaskTypeCommand, Data: command}, stream)
		}()
		select {
		case err := <-sent:
			if err != nil {
				base.Status = "offline"
				return base
			}
		case <-ctx.Done():
			base.Status = "timeout"
			return base
		}
		select {
		case result := <-waiter.result:
			s, ok := singleton.ServerShared.Get(id)
			if !ok || !valid(s) {
				base.Status = "offline"
				return base
			}
			if ctx.Err() != nil {
				base.Status = "timeout"
				return base
			}
			return networkinsight.ClassifyMedia(target, family, result.GetData(), result.GetSuccessful())
		case <-ctx.Done():
			base.Status = "timeout"
			return base
		}
	}
}
func deliverMediaResult(result *pb.TaskResult, reporterID uint64, stream pb.NezhaService_RequestTaskServer) bool {
	if result == nil || result.GetId()&mediaTaskMask == 0 {
		return false
	}
	// Consume every reserved reply, including wrong type, forged and late replies.
	if result.GetType() != model.TaskTypeCommand {
		return true
	}
	raw, ok := mediaWaiters.Load(result.GetId())
	if !ok {
		return true
	}
	w := raw.(*mediaWaiter)
	if reporterID != w.serverID || stream != w.stream {
		return true
	}
	data := result.GetData()
	if len(data) > 4096 {
		data = ""
	}
	copy := &pb.TaskResult{Id: result.Id, Type: result.Type, Successful: result.Successful, Data: data}
	select {
	case w.result <- copy:
	default:
	}
	return true
}
