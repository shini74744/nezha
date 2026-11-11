package rpc

import (
	"context"
	"encoding/json"
	"time"

	"github.com/nezhahq/nezha/model"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/nezhahq/nezha/service/singleton"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *NezhaHandler) ReportSSHLogin(ctx context.Context, r *pb.TaskResult) (*pb.Task, error) {
	if !s.reportGate.Begin() {
		return nil, errReportsStopping
	}
	defer s.reportGate.End()
	id, err := s.Auth.Check(ctx)
	if err != nil {
		return nil, err
	}
	if pending, e := pendingReplacement(ctx); e != nil {
		return nil, e
	} else if pending {
		return nil, status.Error(codes.FailedPrecondition, "awaiting replacement")
	}
	live, ok := singleton.ServerShared.Get(id)
	if !ok || live == nil || !live.MachineRuntimeActive() {
		return nil, status.Error(codes.NotFound, "server unavailable")
	}
	if r == nil || len(r.Data) > 262144 {
		return nil, status.Error(codes.InvalidArgument, "SSH report too large")
	}
	var server model.Server
	if err = singleton.DB.WithContext(ctx).Select("id", "uuid").First(&server, id).Error; err != nil {
		return nil, status.Error(codes.NotFound, "server not found")
	}
	var report model.SSHLoginReport
	if err = json.Unmarshal([]byte(r.Data), &report); err != nil {
		return nil, status.Error(codes.InvalidArgument, "invalid SSH report")
	}
	reply, err := singleton.ReceiveSSHLogin(server.UUID, report, time.Now())
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "SSH report rejected")
	}
	data, err := json.Marshal(reply)
	if err != nil {
		return nil, err
	}
	return &pb.Task{Data: string(data)}, nil
}
