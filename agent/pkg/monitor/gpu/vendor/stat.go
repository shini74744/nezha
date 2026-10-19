package vendor

// GPUStat carries per-card figures. Memory is in MiB and is left zero by
// vendors that do not report it, so callers must treat MemoryTotal == 0 as
// "memory unknown" rather than "no memory".
type GPUStat struct {
	Name              string // Optional identity supplied by the same per-card query.
	Utilization       float64
	MemoryUsed        uint64
	MemoryTotal       uint64
	SharedMemoryUsed  uint64
	SharedMemoryTotal uint64
}

// AppleIntegratedName is shared with the HID temperature adapter; do not infer discrete VRAM.
const AppleIntegratedName = "Apple GPU (integrated)"
