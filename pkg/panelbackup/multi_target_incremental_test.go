package panelbackup

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestIncrementalTargetFailureRetryAndPasswordBoundary(t *testing.T) {
	source, db := testSource(t)
	m, err := New(db, source)
	require.NoError(t, err)
	defer m.Close()
	a, key, _ := testReceiver(t, m.installation)
	a, err = m.SaveTarget(TargetInput{Target: a, PrivateKey: key})
	require.NoError(t, err)
	b, key, _ := testReceiver(t, m.installation)
	b, err = m.SaveTarget(TargetInput{Target: b, PrivateKey: key})
	require.NoError(t, err)
	p := Plan{Mode: "manual", BackupType: "incremental", TargetIDs: []uint64{a.ID, b.ID}}
	require.NoError(t, m.SavePlan(p, ""))
	first := runNow(t, m)
	require.Equal(t, "success", first.State)
	realTransfer := m.transfer
	m.transfer = func(ctx context.Context, target Target, secret, installation string, s *Snapshot, id uint64, report func(Delivery)) (Delivery, error) {
		if target.ID == a.ID {
			return Delivery{TargetID: a.ID, Name: a.Name}, errors.New("fixture offline")
		}
		return realTransfer(ctx, target, secret, installation, s, id, report)
	}
	second := runNow(t, m)
	require.Equal(t, "partial", second.State)
	require.Equal(t, "failed", second.Deliveries[0].State)
	require.Equal(t, first.Deliveries[1].ID, second.Deliveries[1].ParentID)
	m.transfer = realTransfer
	_, err = m.Start("retry", nil, second.ID)
	require.NoError(t, err)
	third := waitBackup(t, m).Items[0]
	require.Len(t, third.Deliveries, 1)
	require.Equal(t, first.Deliveries[0].ID, third.Deliveries[0].ParentID)
	// Encryption changes cannot create a mixed-password chain.
	p.Encrypt = true
	require.NoError(t, m.SavePlan(p, "new-encryption-password"))
	fourth := runNow(t, m)
	require.Equal(t, "success", fourth.State)
	for _, d := range fourth.Deliveries {
		require.Equal(t, "full", d.BackupType)
		require.Zero(t, d.ParentID)
	}
	require.NoError(t, m.SavePlan(p, "replacement-encryption-password"))
	fifth := runNow(t, m)
	for _, d := range fifth.Deliveries {
		require.Equal(t, "full", d.BackupType)
		require.Zero(t, d.ParentID)
	}
}
