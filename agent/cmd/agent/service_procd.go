package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// The service library creates S50/K02 links, so rc.common must use the same
// priorities when checking "enabled" and when disabling the service.
const ownedProcdScript = `#!/bin/sh /etc/rc.common
USE_PROCD=1
START=50
STOP=02
name="{{.Name}}"
start_service() {
    cd "{{.WorkingDirectory}}" || return 1
    procd_open_instance
    procd_set_param command "{{.Path}}"{{range .Arguments}} {{.|cmd}}{{end}}
    procd_set_param respawn ${respawn_threshold:-3600} ${respawn_timeout:-5} ${respawn_retry:-5}
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_set_param pidfile "/var/run/${name}.pid"
    procd_close_instance
}
`

// v1.0.2's library used START=21/STOP=89 while installing S50/K02. Once
// uninstall has successfully removed the init script, remove only exact
// links to that owned service; never follow links or remove ordinary files.
func cleanupOwnedProcdLinks(rcDir, initDir, name string) error {
	if name != binaryName && !strings.HasPrefix(name, binaryName+"-") {
		return fmt.Errorf("refusing non-DDnezha service name")
	}
	if filepath.Base(name) != name {
		return fmt.Errorf("invalid DDnezha service name")
	}
	target := filepath.Join(initDir, name)
	for _, prefix := range []string{"S50", "K02", "S21", "K89"} {
		path := filepath.Join(rcDir, prefix+name)
		link, err := os.Readlink(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return fmt.Errorf("refusing non-link boot entry %s: %w", path, err)
		}
		if !filepath.IsAbs(link) {
			link = filepath.Join(rcDir, link)
		}
		if filepath.Clean(link) != target {
			return fmt.Errorf("refusing foreign boot entry %s", path)
		}
		if err := os.Remove(path); err != nil {
			return err
		}
	}
	return nil
}
