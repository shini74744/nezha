package rpc

import (
	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
	"log"
	"sync"
)

// Bounded delivery keeps slow webhooks off the Agent receive loop.
type taskNotificationQueue struct {
	once sync.Once
	jobs chan func()
}

func newTaskNotificationQueue(capacity int) *taskNotificationQueue {
	return &taskNotificationQueue{jobs: make(chan func(), capacity)}
}
func (q *taskNotificationQueue) submit(job func()) bool {
	q.once.Do(func() {
		for i := 0; i < 4; i++ {
			go func() {
				for f := range q.jobs {
					f()
				}
			}()
		}
	})
	select {
	case q.jobs <- job:
		return true
	default:
		return false
	}
}

var taskNotifications = newTaskNotificationQueue(64)

func sendTaskNotification(group uint64, desc, mute string, event model.NotificationEvent, server *model.Server) {
	notifications := singleton.NotificationShared
	if !taskNotifications.submit(func() { notifications.SendEvent(group, desc, mute, event, server) }) {
		log.Printf("DDnezha: task notification queue full; delivery skipped for group %d", group)
	}
}
