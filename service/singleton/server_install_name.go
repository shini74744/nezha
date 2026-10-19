package singleton

import "time"

var installationNameZone = time.FixedZone("Asia/Shanghai", 8*60*60)

// Name a new machine from the durable command issuance time, never its first
// connection or the dashboard's timezone. Existing node names are not updated.
func installationCommandServerName(createdAt time.Time) string {
	if createdAt.IsZero() {
		return "新服务器" // Legacy records without an issuance time must not invent one.
	}
	return createdAt.In(installationNameZone).Format("2006/01/02/15:04")
}
