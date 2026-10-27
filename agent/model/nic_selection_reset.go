package model

import (
	"encoding/json"
	"errors"
	"maps"
	"os"
	"path/filepath"
	"sigs.k8s.io/yaml"
)

// SaveNICSelectionReset changes only the monitoring selection and its opaque
// notification token. Other YAML values, including unknown options, survive.
func (c *AgentConfig) SaveNICSelectionReset(eventID string) error {
	if eventID == "" || len(eventID) > 64 {
		return errors.New("invalid NIC reminder")
	}
	path, err := filepath.EvalSymlinks(c.filePath)
	if err != nil {
		return err
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	var disk AgentConfig
	if err = yaml.Unmarshal(raw, &disk); err != nil {
		return err
	}
	if disk.UUID != c.UUID || !maps.Equal(disk.NICAllowlist, c.NICAllowlist) {
		return errors.New("NIC configuration changed on disk")
	}
	var values map[string]json.RawMessage
	if err = yaml.Unmarshal(raw, &values); err != nil {
		return err
	}
	if values == nil {
		return errors.New("empty NIC configuration")
	}
	values["nic_allowlist"] = json.RawMessage("null")
	token, err := json.Marshal(eventID)
	if err != nil {
		return err
	}
	values["nic_selection_reset_id"] = token
	next, err := yaml.Marshal(values)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".ddnezha-nic-config-")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err = tmp.Chmod(info.Mode().Perm()); err != nil {
		tmp.Close()
		return err
	}
	if _, err = tmp.Write(next); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}
