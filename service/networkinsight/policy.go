package networkinsight

import (
	"github.com/nezhahq/nezha/service/connectivity"
	"gorm.io/gorm"
)

// BGP has its own policy; connectivity and streaming keep their existing policy.
type BGPPolicy connectivity.Policy

func (BGPPolicy) TableName() string { return "bgp_policies" }
func DefaultBGPPolicy() BGPPolicy {
	return BGPPolicy{ID: 1, Enabled: true, IntervalHours: 6, RetentionDays: 1}
}
func (p BGPPolicy) Validate() error { return connectivity.Policy(p).Validate() }
func ReadBGPPolicy(db *gorm.DB) (BGPPolicy, error) {
	p := DefaultBGPPolicy()
	if db == nil {
		return p, nil
	}
	err := db.Where("id = ?", 1).Limit(1).Find(&p).Error
	return p, err
}
