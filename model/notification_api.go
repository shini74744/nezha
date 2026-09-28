package model

type NotificationTestEvent struct {
	Kind     string `json:"kind"`
	ServerID uint64 `json:"server_id,omitempty"`
}

type NotificationForm struct {
	TestEvent         *NotificationTestEvent   `json:"test_event,omitempty"`
	EventTemplates    *NotificationEventConfig `json:"event_templates,omitempty"`
	Name              string                   `json:"name,omitempty" minLength:"1"`
	URL               string                   `json:"url,omitempty"`
	RequestMethod     uint8                    `json:"request_method,omitempty"`
	RequestType       uint8                    `json:"request_type,omitempty"`
	RequestHeader     string                   `json:"request_header,omitempty"`
	RequestBody       string                   `json:"request_body,omitempty"`
	VerifyTLS         bool                     `json:"verify_tls,omitempty" validate:"optional"`
	SkipCheck         bool                     `json:"skip_check,omitempty" validate:"optional"`
	FormatMetricUnits bool                     `json:"format_metric_units,omitempty" validate:"optional"`
}
