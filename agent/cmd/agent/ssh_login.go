package main

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/nezhahq/agent/pkg/sshlogin"
	pb "github.com/nezhahq/agent/proto"
	"sync/atomic"
)

type sshRPCConnection struct {
	client   pb.NezhaServiceClient
	identity string
}

var sshRPC atomic.Pointer[sshRPCConnection]

func sshIdentity() string {
	config := loadRuntimeConfig()
	return config.UUID + "|" + config.Server + "|" + config.ConfigPath()
}
func sshLoginDaemon(ctx context.Context) {
	identity := sshIdentity()
	sshlogin.Run(ctx, identity, func(ctx context.Context, report sshlogin.Report) (sshlogin.Reply, error) {
		var reply sshlogin.Reply
		live := sshRPC.Load()
		if live == nil || live.identity != identity {
			return reply, fmt.Errorf("SSH monitoring transport unavailable")
		}
		data, err := json.Marshal(report)
		if err != nil {
			return reply, err
		}
		result, err := live.client.ReportSSHLogin(ctx, &pb.TaskResult{Data: string(data)})
		if err != nil {
			return reply, err
		}
		err = json.Unmarshal([]byte(result.Data), &reply)
		return reply, err
	})
}
