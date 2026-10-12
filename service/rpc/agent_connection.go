package rpc

import (
	"context"
	"errors"
	"github.com/nezhahq/nezha/service/singleton"
	"sync"
	"time"
)

// Reverse proxies may route unary and stream requests over different upstream
// connections. Only an authenticated, node-scoped replacement credential pairs
// the staged host and first state. Never use physical TCP identity or source IP.
var replacementSessions = struct {
	sync.Mutex
	values map[string]*replacementConnection
}{values: make(map[string]*replacementConnection)}

func replacementSession(ctx context.Context) (*replacementConnection, error) {
	secret, uuid := replacementCredentials(ctx)
	row, _, err := singleton.AuthorizeServerReplacement(secret, uuid)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, errors.New("missing replacement credential")
	}
	replacementSessions.Lock()
	defer replacementSessions.Unlock()
	now := time.Now()
	for id, item := range replacementSessions.values {
		if now.After(item.expires) {
			delete(replacementSessions.values, id)
		}
	}
	if item := replacementSessions.values[row.TokenHash]; item != nil {
		return item, nil
	}
	expires := row.ExpiresAt
	if row.State == "clearing" {
		expires = now.Add(2 * time.Hour)
	}
	item := &replacementConnection{ready: make(chan struct{}), expires: expires}
	replacementSessions.values[row.TokenHash] = item
	return item, nil
}
