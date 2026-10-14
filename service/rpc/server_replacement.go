package rpc

import (
	"context"
	"errors"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"google.golang.org/grpc/metadata"
	"sync"
	"time"
)

type replacementConnection struct {
	mu      sync.Mutex
	uuid    string
	host    *model.Host
	ready   chan struct{}
	once    sync.Once
	expires time.Time
}

func replacementCredentials(ctx context.Context) (string, string) {
	md, _ := metadata.FromIncomingContext(ctx)
	return firstMetadataValue(md, "client-secret", "client_secret"), firstMetadataValue(md, "client-uuid", "client_uuid")
}
func pendingReplacement(ctx context.Context) (bool, error) {
	secret, uuid := replacementCredentials(ctx)
	if !singleton.IsReplacementSecret(secret) {
		return false, nil
	}
	row, _, err := singleton.AuthorizeServerReplacement(secret, uuid)
	if err != nil {
		// A released/deleted machine may retain its stable replacement key,
		// but no longer has the old one-time cleanup record.
		if binding, ok := singleton.AgentCredentialBySecret(secret); ok && binding.UUID == uuid && binding.VerifiedAt > 0 {
			return false, nil
		}
		return false, err
	}
	return row.State != "active", nil
}
func stageReplacementHost(ctx context.Context, uuid string, host model.Host) error {
	session, sessionErr := replacementSession(ctx)
	if sessionErr != nil {
		return sessionErr
	}
	if session == nil || host.Platform == "" {
		return errors.New("换机需要完整主机上报")
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	session.uuid, session.host = uuid, &host
	return nil
}
func completeReplacementReport(ctx context.Context, state *model.HostState) (*model.Server, error) {
	session, sessionErr := replacementSession(ctx)
	if sessionErr != nil {
		return nil, sessionErr
	}
	if session == nil {
		return nil, errors.New("missing replacement connection")
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	secret, uuid := replacementCredentials(ctx)
	if session.uuid != uuid || session.host == nil {
		return nil, errors.New("请重新连接并上报主机信息")
	}
	server, err := singleton.CompleteServerReplacement(secret, uuid, session.host, state)
	if err == nil {
		session.once.Do(func() { close(session.ready) })
	}
	return server, err
}
func waitReplacementReport(ctx context.Context) error {
	pending, err := pendingReplacement(ctx)
	if err != nil || !pending {
		return err
	}
	session, sessionErr := replacementSession(ctx)
	if sessionErr != nil {
		return sessionErr
	}
	if session == nil {
		return errors.New("missing replacement connection")
	}
	timer := time.NewTimer(2 * time.Minute)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return errors.New("waiting for first replacement state timed out")
	case <-session.ready:
		return nil
	}
}
