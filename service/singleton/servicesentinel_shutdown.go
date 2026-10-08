package singleton

import (
	"errors"
	"fmt"
	"time"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/pkg/tsdb"
)

// ShutdownError is read only after Stop's completion channel has closed.
func (ss *ServiceSentinel) ShutdownError() error {
	<-ss.workerDone
	return ss.shutdownErr
}

// Preserve an incomplete averaging window on a normal stop, without changing
// the sampling cadence while running. The database is still open at this point.
func (ss *ServiceSentinel) flushPendingHistory() {
	if ServerShared == nil {
		return
	}
	ServerShared.lockLifecycleRead()
	defer ServerShared.unlockLifecycleRead()
	ss.serviceResponseDataStoreLock.Lock()
	defer ss.serviceResponseDataStoreLock.Unlock()
	for serviceID, reporters := range ss.serviceResponsePing {
		svc, ok := ss.Get(serviceID)
		if !ok {
			continue
		}
		for reporterID, pending := range reporters {
			if pending.count == 0 {
				continue
			}
			reporter, _ := ServerShared.Get(reporterID)
			if !canReportServiceResult(svc, reporter, uint64(svc.Type)) {
				continue
			}
			var err error
			if TSDBShared != nil {
				err = TSDBShared.WriteServiceMetrics(&tsdb.ServiceMetrics{
					ServiceID: serviceID, ServerID: reporterID, Timestamp: time.Now(),
					Delay: pending.ping, Successful: pending.successCount*2 >= pending.count,
				})
			} else {
				err = DB.Create(&model.ServiceHistory{
					ServiceID: serviceID, ServerID: reporterID, AvgDelay: pending.ping, Data: pending.lastData,
				}).Error
			}
			if err != nil {
				ss.shutdownErr = errors.Join(ss.shutdownErr, fmt.Errorf("flush service %d reporter %d: %w", serviceID, reporterID, err))
				continue
			}
			*pending = pingStore{}
		}
	}
	// With TSDB each non-ping report was already written. The SQLite backend
	// additionally batches service availability into 30-sample windows.
	if TSDBShared != nil || DB == nil {
		return
	}
	for serviceID, window := range ss.serviceCurrentStatusData {
		if len(window.result) == 0 {
			continue
		}
		if _, ok := ss.Get(serviceID); !ok {
			continue
		}
		stats := ss.serviceResponseDataStore[serviceID]
		if err := DB.Create(&model.ServiceHistory{
			ServiceID: serviceID, AvgDelay: stats.Delay, Up: stats.Up, Down: stats.Down,
			Data: window.result[len(window.result)-1].Data,
		}).Error; err != nil {
			ss.shutdownErr = errors.Join(ss.shutdownErr, fmt.Errorf("flush availability %d: %w", serviceID, err))
			continue
		}
		window.result = window.result[:0]
	}
}
