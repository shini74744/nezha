package model

type ServerGroupForm struct {
	Name     string   `json:"name" minLength:"1"`
	Servers  []uint64 `json:"servers"`
	Revision string   `json:"revision,omitempty"`
}

type ServerGroupResponseItem struct {
	Group    ServerGroup `json:"group"`
	Servers  []uint64    `json:"servers"`
	Revision string      `json:"revision"`
}
