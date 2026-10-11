package terminalsession

import (
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

type Window struct {
	ID    string `json:"id"`
	Index int    `json:"index"`
	Name  string `json:"name"`
}
type Tmux struct {
	ID      string   `json:"id"`
	Created string   `json:"created"`
	Name    string   `json:"name"`
	Windows []Window `json:"windows"`
}

var tmuxID = regexp.MustCompile(`^\$[0-9]{1,12}$`)
var windowID = regexp.MustCompile(`^@[0-9]{1,12}$`)
var createdID = regexp.MustCompile(`^[0-9]{1,20}$`)

func Quote(s string) string { return "'" + strings.ReplaceAll(s, "'", "'\"'\"'") + "'" }
func ValidName(name string, session bool) bool {
	return utf8.ValidString(name) && strings.TrimSpace(name) != "" && utf8.RuneCountInString(name) <= 60 && strings.IndexFunc(name, unicode.IsControl) < 0 && (!session || !strings.ContainsAny(name, ":."))
}

const ListTmuxCommand = `unset TMUX TMUX_PANE
if ! command -v tmux >/dev/null 2>&1; then printf 'NZX_MISSING\n'; exit 0; fi
printf 'NZX_OK\n'
sessions=$(LC_ALL=C tmux -u list-sessions -F '#{session_id} #{session_created}' 2>&1) || {
 case "$sessions" in *"no server running"*|*"No such file or directory"*) printf 'NZX_END\n';; *) printf 'NZX_ERROR\n';; esac
 exit 0
}
count=0
while read -r sid created; do
 [ -n "$sid" ] || continue
 count=$((count+1)); [ "$count" -le 128 ] || { printf 'NZX_LIMIT\n'; exit 0; }
 name=$(tmux -u display-message -p -t "$sid" '#{session_name}' 2>/dev/null | base64 | tr -d '\n')
 printf 'S|%s|%s|%s\n' "$sid" "$created" "$name"
 tmux -u list-windows -t "$sid" -F '#{window_id} #{window_index}' 2>/dev/null | while read -r wid idx; do
  name=$(tmux -u display-message -p -t "$wid" '#{window_name}' 2>/dev/null | base64 | tr -d '\n')
  printf 'W|%s|%s|%s|%s\n' "$sid" "$wid" "$idx" "$name"
 done
done <<NZX_SESSIONS
$sessions
NZX_SESSIONS
printf 'NZX_END\n'
`

func ParseTmux(raw string) ([]Tmux, bool, error) {
	if strings.TrimSpace(raw) == "NZX_MISSING" {
		return nil, false, nil
	}
	lines := strings.Split(strings.TrimSpace(raw), "\n")
	if len(lines) < 2 || lines[0] != "NZX_OK" || lines[len(lines)-1] != "NZX_END" {
		return nil, false, errors.New("tmux 列表不完整，请重试（最多显示 128 个会话）")
	}
	rows := []Tmux{}
	index := map[string]int{}
	windows := 0
	decode := func(v string) (string, error) {
		b, e := base64.StdEncoding.DecodeString(v)
		if e != nil || len(b) > 4096 || !utf8.Valid(b) {
			return "", errors.New("tmux 名称格式无效")
		}
		return strings.TrimSuffix(string(b), "\n"), nil
	}
	for _, line := range lines[1 : len(lines)-1] {
		p := strings.Split(strings.TrimSuffix(line, "\r"), "|")
		if len(p) == 4 && p[0] == "S" && tmuxID.MatchString(p[1]) && createdID.MatchString(p[2]) {
			if _, exists := index[p[1]]; exists {
				return nil, false, errors.New("tmux 会话重复")
			}
			name, e := decode(p[3])
			if e != nil {
				return nil, false, e
			}
			index[p[1]] = len(rows)
			rows = append(rows, Tmux{ID: p[1], Created: p[2], Name: name, Windows: []Window{}})
		} else if len(p) == 5 && p[0] == "W" && windowID.MatchString(p[2]) {
			i, ok := index[p[1]]
			n, e := strconv.Atoi(p[3])
			if !ok || e != nil || n < 0 {
				return nil, false, errors.New("tmux 窗口格式无效")
			}
			name, e := decode(p[4])
			if e != nil {
				return nil, false, e
			}
			rows[i].Windows = append(rows[i].Windows, Window{ID: p[2], Index: n, Name: name})
			windows++
		} else {
			return nil, false, errors.New("tmux 列表格式无效")
		}
		if len(rows) > 128 || windows > 512 {
			return nil, false, errors.New("tmux 会话或窗口数量超过限制")
		}
	}
	for _, row := range rows {
		if len(row.Windows) == 0 {
			return nil, false, errors.New("tmux 会话正在变化，请刷新重试")
		}
	}
	return rows, true, nil
}
func CreateTmuxCommand(name, window string) (string, error) {
	if !ValidName(name, true) || !ValidName(window, false) {
		return "", errors.New("名称需为 1–60 个字符，会话名不能含冒号或句点")
	}
	return "unset TMUX TMUX_PANE\ncommand -v tmux >/dev/null 2>&1 || { printf 'NZX_MISSING\\n'; exit 0; }\ncreated=$(tmux -u new-session -d -s " + Quote(name) + " -n " + Quote(window) + " -P -F '#{session_id}|#{session_created}') || exit 1\nsid=${created%%|*}\ntmux -u set-window-option -t \"$sid\" automatic-rename off >/dev/null 2>&1\nprintf '%s\\n' \"$created\"", nil
}
func VerifyTmuxCommand(row Tmux) (string, error) {
	if !tmuxID.MatchString(row.ID) || !createdID.MatchString(row.Created) {
		return "", errors.New("tmux 会话标识无效")
	}
	return "test \"$(tmux -u display-message -p -t " + Quote(row.ID) + " '#{session_created}' 2>/dev/null)\" = " + Quote(row.Created), nil
}
func AttachTmuxCommand(row Tmux, window string) (string, error) {
	verify, e := VerifyTmuxCommand(row)
	if e != nil {
		return "", e
	}
	selectWindow := ""
	if window != "" {
		found := false
		for _, w := range row.Windows {
			if w.ID == window && windowID.MatchString(window) {
				found = true
			}
		}
		if !found {
			return "", errors.New("所选窗口不存在")
		}
		selectWindow = "tmux -u select-window -t " + Quote(row.ID+":"+window) + " && "
	}
	// sh -c works even when the Agent user's interactive shell is fish.
	script := "unset TMUX TMUX_PANE; " + verify + " && " + selectWindow + "exec tmux -u attach-session -t " + Quote(row.ID) + "; printf '\\n会话已结束，请刷新列表。\\n'; exit"
	return "exec sh -c " + Quote(script), nil
}
func EndTmuxCommand(row Tmux) (string, error) {
	verify, e := VerifyTmuxCommand(row)
	if e != nil {
		return "", e
	}
	return fmt.Sprintf("unset TMUX TMUX_PANE\n%s && tmux -u kill-session -t %s", verify, Quote(row.ID)), nil
}
