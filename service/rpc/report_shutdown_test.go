package rpc

import (
	"context"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/tsdb"
	pb "github.com/nezhahq/nezha/proto"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"sync/atomic"
	"testing"
	"time"
)

func TestStopReportsDrainsAcceptedStateRejectsNextMessage(t *testing.T) {
	reporter := requestTaskSecurityServer(9, 200, "ffffffff-ffff-ffff-ffff-ffffffffffff")
	setupRequestTaskSecurityFixture(t, []*model.Server{reporter}, nil, map[uint64]model.UserInfo{200: {Role: model.RoleMember}}, map[string]uint64{"reporter-secret": 200})
	stop := make(chan struct{})
	stream := &stateGenerationHandlerStream{ctx: metadata.NewIncomingContext(context.Background(), metadata.Pairs("client_secret", "reporter-secret", "client_uuid", reporter.UUID)), states: make(chan *pb.State, 2), receipts: make(chan *pb.Receipt, 2), stop: stop}
	stream.states <- &pb.State{Uptime: 44}
	started := make(chan struct{})
	release := make(chan struct{})
	var writes atomic.Int32
	old := writeServerMetrics
	writeServerMetrics = func(*tsdb.ServerMetrics) error { writes.Add(1); close(started); <-release; return nil }
	t.Cleanup(func() { writeServerMetrics = old })
	handler := NewNezhaHandler()
	finished := make(chan error, 1)
	go func() { finished <- handler.ReportSystemState(stream) }()
	<-started
	drained := handler.StopReports()
	select {
	case <-drained:
		t.Fatal("drained while accepted state was being persisted")
	default:
	}
	close(release)
	select {
	case <-drained:
	case <-time.After(time.Second):
		t.Fatal("idle receive prevented draining")
	}
	require.Equal(t, int32(1), writes.Load())
	stream.states <- &pb.State{Uptime: 99}
	require.Equal(t, codes.Unavailable, status.Code(<-finished))
	require.Equal(t, int32(1), writes.Load())
	close(stop)
}
func TestStopReportsRejectsTaskResultBeforeMutation(t *testing.T) {
	reporter := requestTaskSecurityServer(7, 200, "10101010-1010-1010-1010-101010101010")
	task := requestTaskSecurityCron(42, 200, model.CronCoverAll, nil)
	setupRequestTaskSecurityFixture(t, []*model.Server{reporter}, []*model.Cron{task}, map[uint64]model.UserInfo{200: {Role: model.RoleMember}}, map[string]uint64{"reporter-secret": 200})
	handler := NewNezhaHandler()
	stream := requestTaskSecurityAuthedStream("reporter-secret", reporter.UUID)
	stream.results = []*pb.TaskResult{cronTaskResult(task.ID, true)}
	stream.onResult = func() { <-handler.StopReports() }
	require.Equal(t, codes.Unavailable, status.Code(handler.RequestTask(stream)))
	assertCronResultNotUpdated(t, task.ID)
}
func TestStopReportsRejectsHostAndGeoIPBeforeAuthentication(t *testing.T) {
	handler := NewNezhaHandler()
	<-handler.StopReports()
	_, err := handler.ReportSystemInfo(context.Background(), &pb.Host{})
	require.Equal(t, codes.Unavailable, status.Code(err))
	_, err = handler.ReportSystemInfo2(context.Background(), &pb.Host{})
	require.Equal(t, codes.Unavailable, status.Code(err))
	_, err = handler.ReportGeoIP(context.Background(), &pb.GeoIP{})
	require.Equal(t, codes.Unavailable, status.Code(err))
}
