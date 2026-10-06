package connectivity

import (
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
)

// Record contains private endpoint identities for safe cache reconciliation.
// URLs never appear in public Snapshot JSON.
type Record struct {
	ID          uint64 `gorm:"primaryKey"`
	Identity    string `gorm:"index:idx_connectivity_identity_time,priority:1;uniqueIndex:idx_connectivity_batch,priority:1"`
	FinishedAt  int64  `gorm:"index;index:idx_connectivity_identity_time,priority:2;uniqueIndex:idx_connectivity_batch,priority:2"`
	ScheduledAt int64
	Full        bool
	Payload     string
}

func (Record) TableName() string { return "connectivity_records" }

type Policy struct {
	ID            uint `json:"-" gorm:"primaryKey"`
	Enabled       bool `json:"enabled"`
	IntervalHours int  `json:"interval_hours"`
	RetentionDays int  `json:"retention_days"`
}

func (Policy) TableName() string { return "connectivity_policies" }
func DefaultPolicy() Policy      { return Policy{ID: 1, Enabled: true, IntervalHours: 2, RetentionDays: 1} }
func (p Policy) Validate() error {
	if p.IntervalHours < 1 || p.IntervalHours > 24 || p.RetentionDays < 1 || p.RetentionDays > 30 {
		return errors.New("检测间隔须为 1–24 小时，保留时间须为 1–30 天")
	}
	return nil
}

type Store struct{ DB *gorm.DB }

func (s Store) Policy() (Policy, error) {
	p := DefaultPolicy()
	if s.DB == nil {
		return p, nil
	}
	result := s.DB.Where("id = ?", 1).Limit(1).Find(&p)
	return p, result.Error
}
func (s Store) Save(key string, snapshot Snapshot) error {
	if snapshot.State != "complete" || snapshot.FinishedAt == 0 {
		return errors.New("incomplete connectivity snapshot")
	}
	policy, err := s.Policy()
	if err != nil {
		return err
	}
	snapshot = retainSamples(snapshot, snapshot.FinishedAt-int64(time.Duration(policy.RetentionDays)*24*time.Hour/time.Millisecond))
	urls := map[string]string{}
	for _, r := range snapshot.Results {
		urls[r.ID] = r.URL
	}
	raw, err := json.Marshal(struct {
		Snapshot Snapshot
		URLs     map[string]string
	}{snapshot, urls})
	if err != nil {
		return err
	}
	row := Record{Identity: key, FinishedAt: snapshot.FinishedAt, ScheduledAt: snapshot.ScheduledAt, Full: snapshot.Full, Payload: string(raw)}
	return s.DB.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error
}
func (s Store) Latest(key string, cutoff int64) (Snapshot, bool, error) {
	var row Record
	result := s.DB.Where("identity = ? AND finished_at >= ?", key, cutoff).Order("finished_at DESC").Limit(1).Find(&row)
	err := result.Error
	if err == nil && result.RowsAffected == 0 {
		return Snapshot{}, false, nil
	}
	if err != nil {
		return Snapshot{}, false, err
	}
	var value struct {
		Snapshot Snapshot
		URLs     map[string]string
	}
	if err = json.Unmarshal([]byte(row.Payload), &value); err != nil {
		return Snapshot{}, false, err
	}
	value.Snapshot.Full = row.Full
	for i := range value.Snapshot.Results {
		value.Snapshot.Results[i].URL = value.URLs[value.Snapshot.Results[i].ID]
	}
	return value.Snapshot, true, nil
}
func (s Store) LastFull(key string) (int64, error) {
	var row Record
	err := s.DB.Select("finished_at", "scheduled_at").Where("identity = ? AND full = ? AND scheduled_at > 0", key, true).Order("scheduled_at DESC").Limit(1).Find(&row).Error
	if row.ScheduledAt > 0 {
		return row.ScheduledAt, err
	}
	return row.FinishedAt, err
}
func (s Store) Prune(now time.Time, policy Policy) error {
	return s.DB.Where("finished_at < ?", now.Add(-time.Duration(policy.RetentionDays)*24*time.Hour).UnixMilli()).Delete(&Record{}).Error
}
