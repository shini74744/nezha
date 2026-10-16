package model

// Optional event-time context, separate from Changes so unchanged IPs never
// increase change counts or cause a record to match an unrelated field filter.
type ServerOperationDetails struct {
	IPSnapshot []ServerOperationIPSnapshot  `json:"ip_snapshot,omitempty"`
	PublicNote *ServerOperationTextSnapshot `json:"public_note,omitempty"`
}

type ServerOperationIPSnapshot struct {
	Field    string `json:"field"`
	Before   string `json:"before"`
	After    string `json:"after"`
	Observed bool   `json:"observed"`
}

type ServerOperationTextSnapshot struct {
	Before string `json:"before"`
	After  string `json:"after"`
}

func publicNoteOperationDetails(before, after *Server) *ServerOperationDetails {
	if after == nil {
		return nil
	}
	old := ""
	if before != nil {
		old = before.PublicNote
	}
	if old == after.PublicNote {
		return nil
	}
	// Preserve the exact persisted text, including edits beyond operationValue's
	// display limit. Never snapshot the Server object or its private Note.
	return &ServerOperationDetails{PublicNote: &ServerOperationTextSnapshot{
		Before: old, After: after.PublicNote,
	}}
}

func inventoryIPSnapshot(baseline, values map[string]string) []ServerOperationIPSnapshot {
	snapshot := make([]ServerOperationIPSnapshot, 0, 2)
	for _, field := range []string{"ipv4", "ipv6"} {
		old, known := baseline[field]
		if !known {
			old = "未记录"
		}
		next, observed := values[field]
		if observed {
			next = operationValue(next)
		} else {
			// Last known is context, NOT proof that this family was available.
			next = old
		}
		snapshot = append(snapshot, ServerOperationIPSnapshot{
			Field: field, Before: old, After: next, Observed: observed,
		})
	}
	return snapshot
}
