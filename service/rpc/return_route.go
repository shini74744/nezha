package rpc

import (
	"context"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/networkinsight"
	"time"
)

func ReturnRouteProbe(server *model.Server) func(context.Context, networkinsight.ReturnResult) networkinsight.ReturnResult {
	run := insightCommandRunner(server, "return-route")
	return func(ctx context.Context, base networkinsight.ReturnResult) networkinsight.ReturnResult {
		command, err := networkinsight.ReturnCommand(base.Target, base.Family, base.Protocol)
		if err != nil {
			base.Status = "invalid_target"
			return base
		}
		result, status := run(ctx, command, 70*time.Second)
		if status != "" {
			base.Status = status
			return base
		}
		return networkinsight.ParseReturnResult(base, result.GetData(), result.GetSuccessful())
	}
}
