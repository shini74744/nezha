package networkinsight

type Record struct {
	ID          uint64 `gorm:"primaryKey"`
	Identity    string `gorm:"index:idx_insight_identity_time,priority:1"`
	Kind        string `gorm:"index:idx_insight_identity_time,priority:2"`
	FinishedAt  int64  `gorm:"index;index:idx_insight_identity_time,priority:3"`
	ScheduledAt int64
	Payload     string
}

func (Record) TableName() string { return "network_insight_records" }

type ASNode struct {
	ASN   uint32 `json:"asn"`
	Name  string `json:"name"`
	Tier1 bool   `json:"tier1"`
}
type Path struct {
	Origin ASNode  `json:"origin"`
	Direct *ASNode `json:"direct,omitempty"`
	Second *ASNode `json:"second,omitempty"`
	Count  int     `json:"count"`
}
type Topology struct {
	TestedAt   int64     `json:"tested_at,omitempty"`
	Family     string    `json:"family"`
	Prefix     string    `json:"prefix,omitempty"`
	ObservedAt string    `json:"observed_at,omitempty"`
	Total      int       `json:"total"`
	Paths      []Path    `json:"paths"`
	Status     string    `json:"status"`
	Source     string    `json:"source"`
	Graph      *BGPGraph `json:"graph,omitempty"`
}
type MediaResult struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Icon   string `json:"icon"`
	Family string `json:"family"`
	Status string `json:"status"`
	Region string `json:"region,omitempty"`
}
type ReturnSelection struct {
	ID     string `json:"id"`
	Family string `json:"family"`
}

type Snapshot struct {
	AutoAttempt        int              `json:"auto_attempt,omitempty"`
	AutoRetryAt        int64            `json:"auto_retry_at,omitempty"`
	AutoFirstStartedAt int64            `json:"auto_first_started_at,omitempty"`
	Retest             *ReturnSelection `json:"retest,omitempty"`
	ScheduledAt        int64            `json:"scheduled_at,omitempty"`
	State              string           `json:"state"`
	StartedAt          int64            `json:"started_at,omitempty"`
	FinishedAt         int64            `json:"finished_at,omitempty"`
	RetryAt            int64            `json:"retry_at,omitempty"`
	Topologies         []Topology       `json:"topologies,omitempty"`
	Results            []MediaResult    `json:"results,omitempty"`
	Routes             []ReturnResult   `json:"routes,omitempty"`
}
