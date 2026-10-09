package controller

import (
	"encoding/json"
	"fmt"
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/connectivity"
	"github.com/nezhahq/nezha/service/networkinsight"
	"github.com/nezhahq/nezha/service/singleton"
	"github.com/stretchr/testify/require"
	"sync"
	"testing"
	"time"
)

func TestReturnQueueDedupPriorityCancelAndRelease(t *testing.T) {
	q := newReturnRouteQueue(1)
	a, e := q.reserve(1, "a", false)
	require.NoError(t, e)
	require.True(t, a.isReady())
	b, e := q.reserve(2, "b", false)
	require.NoError(t, e)
	c, e := q.reserve(3, "c", false)
	require.NoError(t, e)
	_, e = q.reserve(1, "changed-identity", true)
	require.Error(t, e)
	q.promote("c")
	require.True(t, c.isManual())
	require.Equal(t, 1, q.position("c"))
	require.Equal(t, 2, q.position("b"))
	a.done()
	a.done()
	require.True(t, c.isReady())
	require.False(t, b.isReady())
	b.done()
	require.Zero(t, q.position("b"))
	c.done()
	require.Zero(t, q.active)
	require.Empty(t, q.tickets)
	for i := 0; i < 50; i++ {
		n, e := q.reserve(1, "again", true)
		require.NoError(t, e)
		require.True(t, n.isReady())
		n.done()
	}
}

func TestReturnQueueConcurrentReservationAndPromotion(t *testing.T) {
	q := newReturnRouteQueue(3)
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			id := uint64(i%12 + 1)
			key := fmt.Sprint(id)
			ticket, err := q.reserve(id, key, i%2 == 0)
			if err != nil {
				q.promote(key)
				return
			}
			q.promote(key)
			_ = q.position(key)
			_ = ticket.isManual()
			ticket.done()
		}(i)
	}
	wg.Wait()
	require.Zero(t, q.active)
	require.Empty(t, q.tickets)
	require.Empty(t, q.waiting)
}

func TestReturnClockEveryDayStartsAtBeijingMidnight(t *testing.T) {
	cst := time.FixedZone("CST", 8*3600)
	for days := 0; days < 4; days++ {
		midnight := time.Date(2026, 10, 8+days, 0, 0, 0, 0, cst)
		for hours := 1; hours <= 24; hours++ {
			for h := 0; h < 24; h++ {
				now := midnight.Add(time.Duration(h)*time.Hour + 59*time.Minute + 59*time.Second)
				expected := midnight.Add(time.Duration(h/hours*hours) * time.Hour)
				require.Equal(t, expected.UnixMilli(), insightClockSlot("return-route", now.UTC(), hours).UnixMilli())
				require.Equal(t, connectivity.ClockSlot(now, hours), insightClockSlot("bgp", now, hours))
			}
		}
		require.Equal(t, midnight.UnixMilli(), insightClockSlot("return-route", midnight, 5).UnixMilli())
		require.Equal(t, midnight.Add(-4*time.Hour).UnixMilli(), insightClockSlot("return-route", midnight.Add(-time.Second), 5).UnixMilli())
	}
}

func TestReturnManualSharesAutomaticJobAndNoAdminCooldown(t *testing.T) {
	setupInsight(t)
	old := returnRoutes
	returnRoutes = newReturnRouteQueue(1)
	defer func() { returnRoutes = old }()
	server, _ := singleton.ServerShared.Get(1)
	key, _, err := insightIdentity(server)
	require.NoError(t, err)
	key += "return-route"
	ticket, err := returnRoutes.reserve(server.ID, key, false)
	require.NoError(t, err)
	insightJobs.Lock()
	insightJobs.values[key] = networkinsight.Snapshot{State: "running"}
	insightJobs.Unlock()
	defer func() { insightJobs.Lock(); delete(insightJobs.values, key); ticket.done(); insightJobs.Unlock() }()
	for i := 0; i < 25; i++ {
		require.NoError(t, launchInsight(server, "return-route", false, true))
	}
	require.True(t, ticket.isManual())
	require.Len(t, returnRoutes.tickets, 1)
	require.EqualError(t, launchInsight(server, "return-route", true), "检测已在执行")
}

func TestReturnAdminCanQueueDespiteCooldownWithoutStartingDuplicate(t *testing.T) {
	setupInsight(t)
	sqlDB, dbErr := singleton.DB.DB()
	require.NoError(t, dbErr)
	sqlDB.SetMaxOpenConns(1)
	server, _ := singleton.ServerShared.Get(1)
	identity, _, err := insightIdentity(server)
	require.NoError(t, err)
	now := time.Now().UnixMilli()
	raw, _ := json.Marshal(networkinsight.Snapshot{State: "complete", FinishedAt: now, RetryAt: now + 300000})
	require.NoError(t, singleton.DB.Create(&networkinsight.Record{Identity: identity, Kind: "return-route", FinishedAt: now, Payload: string(raw)}).Error)
	old := returnRoutes
	returnRoutes = newReturnRouteQueue(1)
	blocker, err := returnRoutes.reserve(999, "block", true)
	require.NoError(t, err)
	defer func() { blocker.done(); returnRoutes = old }()
	require.EqualError(t, launchInsight(server, "return-route", false), "请稍后重试")
	wasEnabled := returnRouteAutoEnabled.Load()
	returnRouteAutoEnabled.Store(true)
	defer returnRouteAutoEnabled.Store(wasEnabled)
	// Auto starts the current clock slot even after a fresh manual result.
	require.NoError(t, launchInsight(server, "return-route", true))
	got, err := readInsight(connectivityContext("1", &model.User{Common: model.Common{ID: 10}, Role: model.RoleAdmin}), "return-route")
	require.NoError(t, err)
	require.Equal(t, "queued", got.State)
	require.Equal(t, 1, got.QueuePosition)
	require.Equal(t, insightClockSlot("return-route", time.Now(), 6).UnixMilli(), got.ScheduledAt)
	require.NoError(t, launchInsight(server, "return-route", false, true))
	require.Len(t, returnRoutes.tickets, 2)
	// Invalidate via persisted policy, then release. No RPC is started or stale result written.
	changed := networkinsight.DefaultReturnPolicy()
	changed.Targets[0].IPv4 = "1.1.1.1"
	require.NoError(t, singleton.DB.Save(&changed).Error)
	blocker.done()
	require.Eventually(t, func() bool { insightJobs.Lock(); defer insightJobs.Unlock(); return len(insightJobs.values) == 0 }, time.Second, 5*time.Millisecond)
	var n int64
	require.NoError(t, singleton.DB.Model(&networkinsight.Record{}).Where("kind = ?", "return-route").Count(&n).Error)
	require.EqualValues(t, 1, n)
}
