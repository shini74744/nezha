package connectivity

import "time"

// Schedules use fixed UTC+8 clock boundaries, independent of host timezone.
// A slot identifies the planned batch, never its actual start or finish time.
func ClockSlot(now time.Time, intervalHours int) time.Time {
	if intervalHours < 1 {
		intervalHours = 1
	}
	const offset int64 = 8 * 60 * 60
	period := int64(intervalHours) * 60 * 60
	return time.Unix((now.Unix()+offset)/period*period-offset, 0)
}
func NextClockSlot(now time.Time, intervalHours int) time.Time {
	return ClockSlot(now, intervalHours).Add(time.Duration(intervalHours) * time.Hour)
}
