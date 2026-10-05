// Package agentuninstall builds UUID-bound jobs for standard Agent installations.
package agentuninstall

import (
	"bytes"
	"compress/gzip"
	_ "embed"
	"encoding/base64"
	"fmt"
	"regexp"
	"strings"
)

//go:embed uninstall.sh
var posixScript string

//go:embed uninstall.ps1
var windowsScript string
var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func Command(uuid, platform string) (string, error) {
	if !uuidPattern.MatchString(uuid) {
		return "", fmt.Errorf("非标准 UUID，不执行远端清理")
	}
	platform = strings.ToLower(platform)
	for _, marker := range []string{"f50", "android", "openwrt", "routeros", "ios"} {
		if strings.Contains(platform, marker) {
			return "", fmt.Errorf("特殊节点不支持标准 Agent 卸载")
		}
	}
	uuid = strings.ToLower(uuid)
	if strings.Contains(platform, "windows") {
		script := strings.ReplaceAll(windowsScript, "__UUID__", uuid)
		var compressed bytes.Buffer
		writer := gzip.NewWriter(&compressed)
		if _, err := writer.Write([]byte(script)); err != nil {
			return "", err
		}
		if err := writer.Close(); err != nil {
			return "", err
		}
		payload := base64.StdEncoding.EncodeToString(compressed.Bytes())
		command := `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$m=New-Object IO.MemoryStream(,[Convert]::FromBase64String('` + payload + `'));$g=New-Object IO.Compression.GzipStream($m,[IO.Compression.CompressionMode]::Decompress);&([scriptblock]::Create((New-Object IO.StreamReader($g)).ReadToEnd()))"`
		if len(command) > 8000 {
			return "", fmt.Errorf("Windows 卸载命令超出长度限制")
		}
		return command, nil
	}
	return strings.ReplaceAll(posixScript, "__UUID__", uuid), nil
}
