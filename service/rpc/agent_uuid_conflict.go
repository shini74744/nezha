package rpc

import (
	"context"
	"net"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"google.golang.org/grpc/peer"
)

// Report when a new authenticated stream submits a sample while a recent
// predecessor is still live, or when the displaced stream continues reporting
// after its replacement has reported. IPs are evidence, not machine identities.
func recordUUIDConflict(uuid string, displaced, current context.Context) {
	if displaced == nil || current == nil || displaced.Err() != nil || current.Err() != nil || singleton.DB == nil || singleton.IsDeletedServerUUID(uuid) {
		return
	}
	oldPeer, oldOK := peer.FromContext(displaced)
	newPeer, newOK := peer.FromContext(current)
	if !oldOK || !newOK || oldPeer.Addr == nil || newPeer.Addr == nil {
		return
	}
	oldAddr, newAddr := oldPeer.Addr.String(), newPeer.Addr.String()
	if oldAddr == newAddr || len(oldAddr) > 128 || len(newAddr) > 128 {
		return
	}
	// Only record actual network endpoints, never arbitrary metadata.
	if _, _, err := net.SplitHostPort(oldAddr); err != nil {
		return
	}
	if _, _, err := net.SplitHostPort(newAddr); err != nil {
		return
	}
	realIP := func(ctx context.Context, fallback string) string {
		ip, _ := ctx.Value(model.CtxKeyRealIP{}).(string)
		if parsed := net.ParseIP(ip); parsed != nil {
			return parsed.String()
		}
		host, _, _ := net.SplitHostPort(fallback)
		if parsed := net.ParseIP(host); parsed != nil {
			return parsed.String()
		}
		return ""
	}
	now := time.Now().Unix()
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	// Only an existing registered UUID can create a conflict record.
	singleton.DB.WithContext(ctx).Exec(`INSERT INTO agent_uuid_conflicts
        (uuid, previous_ip, last_ip, previous_peer, last_peer, first_report_at, last_report_at, report_count)
        SELECT ?, ?, ?, ?, ?, ?, ?, 1 WHERE EXISTS (SELECT 1 FROM servers WHERE uuid = ?)
        ON CONFLICT(uuid) DO UPDATE SET previous_ip=excluded.previous_ip, last_ip=excluded.last_ip,
        previous_peer=excluded.previous_peer, last_peer=excluded.last_peer,
        last_report_at=excluded.last_report_at, report_count=report_count+1
        WHERE agent_uuid_conflicts.previous_peer != excluded.previous_peer
           OR agent_uuid_conflicts.last_peer != excluded.last_peer
           OR agent_uuid_conflicts.last_report_at < excluded.last_report_at - 2`,
		uuid, realIP(displaced, oldAddr), realIP(current, newAddr), oldAddr, newAddr, now, now, uuid)
}
