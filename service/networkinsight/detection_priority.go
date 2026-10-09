package networkinsight

import (
	"errors"
	"gorm.io/gorm"
)

// DetectionPriority is shared by all automatic card jobs, independent of their intervals.
type DetectionPriority struct {
	ID    uint     `json:"-" gorm:"primaryKey"`
	Order []string `json:"order" gorm:"serializer:json"`
}

func DefaultDetectionPriority() DetectionPriority {
	return DetectionPriority{ID: 1, Order: []string{"connectivity", "bgp", "return-route", "streaming"}}
}
func (p DetectionPriority) Validate() error {
	allowed := map[string]bool{"connectivity": true, "bgp": true, "return-route": true, "streaming": true}
	if len(p.Order) != len(allowed) {
		return errors.New("必须包含四项任务，且不能重复")
	}
	for _, kind := range p.Order {
		if !allowed[kind] {
			return errors.New("任务类型无效或重复")
		}
		delete(allowed, kind)
	}
	return nil
}
func ReadDetectionPriority(db *gorm.DB) (DetectionPriority, error) {
	p := DefaultDetectionPriority()
	if db == nil {
		return p, nil
	}
	err := db.Where("id = ?", 1).Limit(1).Find(&p).Error
	if err != nil {
		return p, err
	}
	return p, p.Validate()
}
