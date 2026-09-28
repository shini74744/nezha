package model

// BatchServerVisibilityForm only changes explicitly supplied visibility flags.
type BatchServerVisibilityForm struct {
	IDs            []uint64 `json:"ids"`
	HideForGuest   *bool    `json:"hide_for_guest,omitempty"`
	HideForDisplay *bool    `json:"hide_for_display,omitempty"`
}

type BatchServerVisibilityResult struct {
	Updated int `json:"updated"`
}
