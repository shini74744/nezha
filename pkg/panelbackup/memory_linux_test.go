//go:build linux

package panelbackup

import (
	"github.com/stretchr/testify/require"
	"os"
	"testing"
)

func TestBackupMemoryBudget(t *testing.T) {
	for _, test := range []struct {
		name  string
		files map[string]string
		want  uint64
		known bool
	}{
		{"host", map[string]string{"/proc/meminfo": "MemTotal: 999999 kB\nMemAvailable: 524288 kB\n"}, 512 << 20, true},
		{"missing", nil, 0, false},
		{"malformed", map[string]string{"/proc/meminfo": "MemAvailable: -1 kB\n"}, 0, false},
		{"root limit", map[string]string{"/proc/meminfo": "MemAvailable: 524288 kB\n", "/sys/fs/cgroup/memory.max": "314572800", "/sys/fs/cgroup/memory.current": "104857600"}, 200 << 20, true},
		{"unit limit", map[string]string{"/proc/self/cgroup": "0::/system.slice/app.service\n", "/sys/fs/cgroup/system.slice/app.service/memory.max": "314572800", "/sys/fs/cgroup/system.slice/app.service/memory.current": "104857600"}, 200 << 20, true},
		{"parent limit", map[string]string{"/proc/self/cgroup": "0::/system.slice/app.service\n", "/sys/fs/cgroup/system.slice/memory.max": "314572800", "/sys/fs/cgroup/system.slice/memory.current": "314572801"}, 0, true},
		{"unlimited", map[string]string{"/proc/meminfo": "MemAvailable: 524288 kB\n", "/sys/fs/cgroup/memory.max": "max", "/sys/fs/cgroup/memory.current": "104857600"}, 512 << 20, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			available, known := memoryAvailable(func(p string) ([]byte, error) {
				v, ok := test.files[p]
				if !ok {
					return nil, os.ErrNotExist
				}
				return []byte(v), nil
			})
			require.Equal(t, test.want, available)
			require.Equal(t, test.known, known)
		})
	}
}
