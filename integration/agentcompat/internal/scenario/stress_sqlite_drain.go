//go:build linux && agentcompat

package scenario

import (
	"context"
	"errors"
	"time"

	"github.com/nezhahq/nezha/integration/agentcompat/internal/client"
	processharness "github.com/nezhahq/nezha/integration/agentcompat/internal/process"
)

var ErrStressSQLiteJournalNotDrained = errors.New("stress dashboard sqlite journal is not drained")

type stressSQLiteHoldControl interface {
	ArmSQLiteHold(context.Context) (client.SQLiteHoldReceipt, error)
	WaitForSQLiteHold(context.Context, client.SQLiteHoldReceipt, client.SQLiteHoldState) (client.SQLiteHoldReceipt, error)
	ReleaseSQLiteHold(context.Context, client.SQLiteHoldReceipt) (client.SQLiteHoldReceipt, error)
	AbortSQLiteHold(context.Context, client.SQLiteHoldReceipt) (client.SQLiteHoldReceipt, error)
}

type stressSQLiteJournalWatch interface {
	Wait(context.Context) error
	Close() error
}

type stressSQLiteJournalWatchOpener func(string) (stressSQLiteJournalWatch, error)

func drainStressSQLiteJournal(ctx context.Context, control stressSQLiteHoldControl, writer func(context.Context) error, journalPath string, openWatch stressSQLiteJournalWatchOpener) error {
	receipt, err := control.ArmSQLiteHold(ctx)
	if err != nil {
		return err
	}
	writerContext, cancelWriter := context.WithCancel(ctx)
	writerDone := make(chan error, 1)
	go func() { writerDone <- writer(writerContext) }()
	abort := func(cause error) error {
		_, abortErr := control.AbortSQLiteHold(context.WithoutCancel(ctx), receipt)
		cancelWriter()
		return errors.Join(cause, abortErr, <-writerDone)
	}
	selected, err := control.WaitForSQLiteHold(ctx, receipt, client.SQLiteHoldStateSelected)
	if err != nil {
		return abort(err)
	}
	finalizing, err := control.WaitForSQLiteHold(ctx, selected, client.SQLiteHoldStateFinalizing)
	if err != nil {
		return abort(err)
	}
	watch, err := openWatch(journalPath)
	if err != nil {
		return abort(err)
	}
	if _, err := control.ReleaseSQLiteHold(ctx, finalizing); err != nil {
		return errors.Join(abort(err), watch.Close())
	}
	waitErr := watch.Wait(ctx)
	if waitErr != nil {
		cancelWriter()
	}
	writerErr := <-writerDone
	cancelWriter()
	return errors.Join(waitErr, writerErr, watch.Close())
}

func drainStressDashboardSQLiteJournal(ctx context.Context, fixture *heldSessionSetRealFixture) error {
	journalPath := fixture.dashboard.DatabasePath() + "-journal"
	return drainStressSQLiteJournal(ctx, fixture.controlPAT.Client, func(writerContext context.Context) error {
		_, err := fixture.controlPAT.Client.IOStreamState(writerContext)
		return err
	}, journalPath, func(path string) (stressSQLiteJournalWatch, error) {
		return processharness.OpenSQLiteJournalWatch(path)
	})
}

func observeStressDashboardSQLiteJournal(path string) func(context.Context, processharness.Sample) error {
	return func(_ context.Context, sample processharness.Sample) error {
		held, err := processharness.ProcessHasOpenPath(sample.PID, path)
		if err != nil {
			return err
		}
		if held {
			return ErrStressSQLiteJournalNotDrained
		}
		return nil
	}
}

// The selected transaction drain cannot drain subsequent asynchronous MCP audit
// writes. Require a complete journal-free baseline window, within a fixed bound.
// Never retry resource-count failures or combine samples from different windows.
func sampleStressQuietWindow(ctx context.Context, sample func(context.Context) (processharness.Window, error)) (processharness.Window, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	for {
		window, err := sample(ctx)
		if !errors.Is(err, ErrStressSQLiteJournalNotDrained) {
			return window, err
		}
		timer := time.NewTimer(25 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return window, errors.Join(err, ctx.Err())
		case <-timer.C:
		}
	}
}
