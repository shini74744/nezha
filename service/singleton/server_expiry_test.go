package singleton

import (
	"fmt"
	"github.com/nezhahq/nezha/model"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestServerExpiryDurableDeliveryAndRetry(t *testing.T) {
	setupCleanMonitorHistoryTestDB(t)
	require.NoError(t, DB.AutoMigrate(&model.ServerExpiryConfig{}, &model.ServerExpiryDelivery{}, &model.Notification{}, &model.NotificationGroup{}, &model.NotificationGroupNotification{}))
	old := NotificationShared
	t.Cleanup(func() { NotificationShared = old })
	n1 := model.Notification{Common: model.Common{ID: 81}, Name: "first"}
	n2 := model.Notification{Common: model.Common{ID: 82}, Name: "second"}
	require.NoError(t, DB.Create(&n1).Error)
	require.NoError(t, DB.Create(&n2).Error)
	require.NoError(t, DB.Create(&model.NotificationGroup{Common: model.Common{ID: 1}, Name: "TG"}).Error)
	for _, n := range []uint64{81, 82} {
		require.NoError(t, DB.Create(&model.NotificationGroupNotification{NotificationGroupID: 1, NotificationID: n}).Error)
	}
	NotificationShared = NewNotificationClass()
	now := trafficTime("2026-10-02T12:00:00+08:00")
	raw := `{"billingDataMod":{"endDate":"2026-10-03T12:00:00+08:00","cycle":"Year"}}`
	require.NoError(t, DB.Model(&model.Server{}).Where("id = ?", 1).Updates(map[string]any{"uuid": "expiry-test", "public_note": raw}).Error)
	conf := model.DefaultServerExpiryConfig()
	conf.Enabled = true
	conf.NotificationGroupID = 1
	require.NoError(t, DB.Create(&conf).Error)
	calls := map[uint64]int{}
	sender := func(n *model.Notification, s *model.Server, b model.ServerBilling, d int, at time.Time) error {
		require.Equal(t, uint64(1), s.ID)
		require.Equal(t, 1, d)
		calls[n.ID]++
		if n.ID == 82 && calls[82] == 1 {
			return fmt.Errorf("temporary failure")
		}
		return nil
	}
	require.NoError(t, checkServerExpiry(now, sender))
	require.Equal(t, 1, calls[81])
	require.Equal(t, 1, calls[82])
	NotificationShared = NewNotificationClass() // Restart-like reconstruction retains DB ledger.
	require.NoError(t, checkServerExpiry(now.Add(time.Minute), sender))
	require.Equal(t, 1, calls[81])
	require.Equal(t, 1, calls[82])
	require.NoError(t, checkServerExpiry(now.Add(5*time.Minute), sender))
	require.Equal(t, 1, calls[81])
	require.Equal(t, 2, calls[82])
	require.NoError(t, checkServerExpiry(now.Add(6*time.Minute), sender))
	require.Equal(t, 2, calls[82])
	// ID changes do not change durable identity.
	require.NoError(t, DB.Model(&model.Server{}).Where("id = ?", 1).Update("id", 99).Error)
	require.NoError(t, checkServerExpiry(now.Add(7*time.Minute), sender))
	require.Equal(t, 1, calls[81])
	// A new expiry creates a new notification lifecycle, without deleting old receipts.
	renewed := `{"billingDataMod":{"endDate":"2026-10-04T12:00:00+08:00","cycle":"Year"}}`
	require.NoError(t, DB.Model(&model.Server{}).Where("id = ?", 99).Update("public_note", renewed).Error)
	renewedCalls := 0
	require.NoError(t, checkServerExpiry(now.Add(24*time.Hour), func(n *model.Notification, s *model.Server, b model.ServerBilling, d int, at time.Time) error {
		renewedCalls++
		return nil
	}))
	require.Equal(t, 2, renewedCalls)
	// No expiry and disabled policies never send.
	require.NoError(t, DB.Model(&model.Server{}).Where("id = ?", 99).Update("public_note", "{}").Error)
	require.NoError(t, checkServerExpiry(now.Add(48*time.Hour), func(*model.Notification, *model.Server, model.ServerBilling, int, time.Time) error {
		t.Fatal("unexpected send")
		return nil
	}))
	conf.Enabled = false
	require.NoError(t, DB.Save(&conf).Error)
	require.NoError(t, checkServerExpiry(now, sender))
}

func TestServerExpiryAutoRenewalDeliveryAcrossCycles(t *testing.T) {
	setupCleanMonitorHistoryTestDB(t)
	require.NoError(t, DB.AutoMigrate(&model.ServerExpiryConfig{}, &model.ServerExpiryDelivery{}, &model.Notification{}, &model.NotificationGroup{}, &model.NotificationGroupNotification{}))
	old := NotificationShared
	t.Cleanup(func() { NotificationShared = old })
	n := model.Notification{Common: model.Common{ID: 81}, Name: "fake"}
	require.NoError(t, DB.Create(&n).Error)
	require.NoError(t, DB.Create(&model.NotificationGroup{Common: model.Common{ID: 1}, Name: "test"}).Error)
	require.NoError(t, DB.Create(&model.NotificationGroupNotification{NotificationGroupID: 1, NotificationID: 81}).Error)
	NotificationShared = NewNotificationClass()
	conf := model.DefaultServerExpiryConfig()
	conf.Enabled = true
	conf.NotificationGroupID = 1
	require.NoError(t, DB.Create(&conf).Error)
	raw := `{"billingDataMod":{"startDate":"2025-05-01","endDate":"2025-06-06T12:00:00+08:00","cycle":"Month","autoRenewal":"1"}}`
	require.NoError(t, DB.Model(&model.Server{}).Where("id = ?", 1).Updates(map[string]any{"uuid": "renewal-test", "public_note": raw}).Error)
	calls := []string{}
	sender := func(n *model.Notification, s *model.Server, b model.ServerBilling, stage int, now time.Time) error {
		calls = append(calls, fmt.Sprintf("%d/%d", b.ExpiresAt, stage))
		require.Equal(t, "2025-06-06T12:00:00+08:00", b.EndDate)
		require.Contains(t, ServerExpiryMessage(s, b, stage, now), "首次购买日期")
		require.Contains(t, ServerExpiryMessage(s, b, stage, now), "最新到期日期")
		return nil
	}
	now := trafficTime("2026-10-02T12:00:00+08:00")
	require.NoError(t, checkServerExpiry(now, sender))
	require.Len(t, calls, 1) // Computed October expiry, not stale June 2025.
	require.NoError(t, checkServerExpiry(now.Add(time.Minute), sender))
	require.Len(t, calls, 1)
	expiry := trafficTime("2026-10-06T12:00:00+08:00")
	require.NoError(t, checkServerExpiry(expiry.Add(time.Minute), sender))
	require.Len(t, calls, 2) // Day-zero survives rolling over to November.
	require.Equal(t, fmt.Sprintf("%d/0", expiry.Unix()), calls[1])
	NotificationShared = NewNotificationClass()
	require.NoError(t, checkServerExpiry(expiry.Add(2*time.Minute), sender))
	require.Len(t, calls, 2)
	require.NoError(t, checkServerExpiry(trafficTime("2026-11-02T12:00:00+08:00"), sender))
	require.Len(t, calls, 3) // New cycle gets its own receipt.
	var saved model.Server
	require.NoError(t, DB.First(&saved, 1).Error)
	require.Equal(t, raw, saved.PublicNote)
}
