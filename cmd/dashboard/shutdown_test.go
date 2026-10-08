package main

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

func TestMonitoringShutdownOrdering(t *testing.T) {
	reports := make(chan struct{})
	services := make(chan struct{})
	sealed := make(chan struct{})
	var calls []string
	shutdown := monitoringShutdown{
		reports:        reports,
		stopServices:   func() <-chan struct{} { calls = append(calls, "seal-services"); close(sealed); return services },
		serviceError:   func() error { calls = append(calls, "check-write-error"); return nil },
		recordTransfer: func() error { calls = append(calls, "save-counters"); return nil },
		closeStorage:   func() error { calls = append(calls, "close-storage"); return nil },
	}
	done := make(chan error, 1)
	go func() { done <- shutdown.run(t.Context()) }()
	select {
	case <-sealed:
		t.Fatal("service queue sealed before accepted RPCs completed")
	case <-time.After(10 * time.Millisecond):
	}
	close(reports)
	<-sealed
	select {
	case <-done:
		t.Fatal("storage closed before queued service data completed")
	default:
	}
	close(services)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	want := []string{"seal-services", "check-write-error", "save-counters", "close-storage"}
	if !reflect.DeepEqual(calls, want) {
		t.Fatalf("got %v want %v", calls, want)
	}
}
func TestMonitoringShutdownTimeoutDoesNotCloseStorage(t *testing.T) {
	for _, stage := range []string{"reports", "services"} {
		t.Run(stage, func(t *testing.T) {
			reports := make(chan struct{})
			services := make(chan struct{})
			if stage == "services" {
				close(reports)
			}
			touched := false
			s := monitoringShutdown{reports: reports, stopServices: func() <-chan struct{} { return services }, serviceError: func() error { return nil }, recordTransfer: func() error { touched = true; return nil }, closeStorage: func() error { touched = true; return nil }}
			ctx, cancel := context.WithCancel(t.Context())
			cancel()
			if err := s.run(ctx); !errors.Is(err, context.Canceled) {
				t.Fatalf("got %v", err)
			}
			if touched {
				t.Fatal("storage or counters finalized before drain")
			}
		})
	}
}
func TestMonitoringShutdownPersistenceFailureIsNotSuccess(t *testing.T) {
	done := make(chan struct{})
	close(done)
	wanted := errors.New("test write error")
	s := monitoringShutdown{reports: done, stopServices: func() <-chan struct{} { return done }, serviceError: func() error { return wanted }, recordTransfer: func() error { t.Fatal("continued despite failed save"); return nil }, closeStorage: func() error { t.Fatal("closed despite failed save"); return nil }}
	if err := s.run(t.Context()); !errors.Is(err, wanted) {
		t.Fatalf("got %v", err)
	}
}

func TestMonitoringShutdownFinalSaveFailuresAreNotSuccess(t *testing.T) {
	for _, stage := range []string{"traffic", "storage"} {
		t.Run(stage, func(t *testing.T) {
			done := make(chan struct{})
			close(done)
			wanted := errors.New("test final write error")
			closed := false
			s := monitoringShutdown{
				reports: done, stopServices: func() <-chan struct{} { return done },
				serviceError: func() error { return nil },
				recordTransfer: func() error {
					if stage == "traffic" {
						return wanted
					}
					return nil
				},
				closeStorage: func() error { closed = true; return wanted },
			}
			if err := s.run(t.Context()); !errors.Is(err, wanted) {
				t.Fatalf("got %v", err)
			}
			if stage == "traffic" && closed {
				t.Fatal("closed storage despite traffic save failure")
			}
		})
	}
}
