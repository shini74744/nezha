package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"

	"github.com/nezhahq/nezha/cmd/dashboard/rpc"
	"github.com/nezhahq/nezha/service/singleton"
)

type monitoringShutdown struct {
	reports        <-chan struct{}
	stopServices   func() <-chan struct{}
	serviceError   func() error
	recordTransfer func() error
	closeStorage   func() error
}

// Drain accepted RPCs first: they may still enqueue service results. Only then
// seal and drain the service queue, save final counters and close storage.
func (s monitoringShutdown) run(ctx context.Context) error {
	if err := waitShutdownStage(ctx, s.reports, "accepted agent reports"); err != nil {
		return err
	}
	log.Println("NEZHA>> Graceful::AGENT_REPORTS_DRAINED")
	if err := waitShutdownStage(ctx, s.stopServices(), "service report queue"); err != nil {
		return err
	}
	if err := s.serviceError(); err != nil {
		return fmt.Errorf("final monitor persistence: %w", err)
	}
	log.Println("NEZHA>> Graceful::SERVICE_QUEUE_DRAINED")
	log.Println("NEZHA>> Graceful::FINALIZING_STORAGE")
	if err := s.recordTransfer(); err != nil {
		return fmt.Errorf("final traffic persistence: %w", err)
	}
	if err := s.closeStorage(); err != nil {
		return fmt.Errorf("storage close: %w", err)
	}
	return nil
}

func waitShutdownStage(ctx context.Context, done <-chan struct{}, name string) error {
	select {
	case <-done:
		return nil
	default:
	}
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("waiting for %s; storage not closed: %w", name, ctx.Err())
	}
}

func shutdownDashboard(ctx context.Context, servers ...*http.Server) error {
	log.Println("NEZHA>> Graceful::START")
	reports := rpc.StopReports()
	log.Println("NEZHA>> Graceful::REPORT_ADMISSION_CLOSED")
	// Close listeners immediately, but let admitted reports finish. This also
	// unblocks Graceful's serving function if draining fails or times out.
	networkDone := make(chan error, len(servers))
	count := 0
	for _, server := range servers {
		if server == nil {
			continue
		}
		count++
		go func(server *http.Server) { networkDone <- server.Shutdown(ctx) }(server)
	}
	closeConnections := func() {
		for _, server := range servers {
			if server != nil {
				_ = server.Close()
			}
		}
	}
	defer closeConnections()
	defer rpc.CloseReceiptGate()
	if err := singleton.StopTelegramMenus(ctx); err != nil {
		return err
	}
	stopped := make(chan struct{})
	close(stopped)
	shutdown := monitoringShutdown{
		reports: reports,
		stopServices: func() <-chan struct{} {
			if singleton.ServiceSentinelShared == nil {
				return stopped
			}
			return singleton.ServiceSentinelShared.Stop()
		},
		serviceError: func() error {
			if singleton.ServiceSentinelShared == nil {
				return nil
			}
			return singleton.ServiceSentinelShared.ShutdownError()
		},
		recordTransfer: func() error { return singleton.RecordTransferHourlyUsage() },
		closeStorage:   singleton.CloseTSDB,
	}
	if err := shutdown.run(ctx); err != nil {
		log.Printf("NEZHA>> Graceful::INCOMPLETE: %v", err)
		return err
	}
	log.Println("NEZHA>> Graceful::REPORTS_PERSISTED_STORAGE_CLOSED")
	// Idle agent streams do not have admitted work. Close them after persistence
	// so they cannot consume the whole shutdown deadline.
	closeConnections()
	var result error
	for range count {
		result = errors.Join(result, <-networkDone)
	}
	if result == nil {
		log.Println("NEZHA>> Graceful::END")
	}
	return result
}
