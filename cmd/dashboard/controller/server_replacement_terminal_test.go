package controller

import (
	"testing"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
)

func TestReplacementRetiresOldManagedTerminalGeneration(t *testing.T) {
	m := sessionFixture(t)
	s, ok := singleton.ServerShared.Get(m.ServerID)
	require.True(t, ok)
	require.True(t, m.valid())
	s.MachineGeneration++
	require.False(t, m.valid())
	c := sessionRequestContext(t, map[string]any{"stream_id": m.ID, "enabled": true})
	_, err := keepTerminalSession(c)
	require.Error(t, err)
	var count int64
	require.NoError(t, singleton.DB.Model(&model.TerminalSessionEvent{}).Count(&count).Error)
	require.Zero(t, count)
}

func TestReplacementQuiesceWaitsForTerminalMutation(t *testing.T) {
	s := &model.Server{UUID: "replacement-terminal-isolated-fixture"}
	release := lockTerminalOperation(s.UUID)
	acquired := make(chan func(), 1)
	go func() { acquired <- singleton.ReplacementQuiesceHook(s) }()
	select {
	case unlock := <-acquired:
		unlock()
		t.Fatal("reset crossed an active terminal mutation")
	case <-time.After(20 * time.Millisecond):
	}
	release()
	select {
	case unlock := <-acquired:
		unlock()
	case <-time.After(time.Second):
		t.Fatal("terminal mutation did not release reset")
	}
}
