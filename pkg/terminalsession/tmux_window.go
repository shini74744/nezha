package terminalsession

import (
	"errors"
	"strings"
)

func CreateTmuxWindowCommand(row Tmux, name string) (string, error) {
	verify, err := VerifyTmuxCommand(row)
	if err != nil {
		return "", err
	}
	if !ValidName(name, false) {
		return "", errors.New("窗口名称需为 1–60 个字符，不能包含控制字符")
	}
	return "unset TMUX TMUX_PANE\n" + verify + " || exit 1\n" +
		"wid=$(tmux -u new-window -d -t " + Quote(row.ID+":") + " -n " + Quote(name) + " -P -F '#{window_id}') || exit 1\n" +
		"tmux -u set-window-option -t \"$wid\" automatic-rename off >/dev/null 2>&1\nprintf '%s\\n' \"$wid\"", nil
}
func FindTmuxWindow(row Tmux, id string) (Window, error) {
	if windowID.MatchString(id) {
		for _, win := range row.Windows {
			if win.ID == id {
				return win, nil
			}
		}
	}
	return Window{}, errors.New("窗口不存在或已变化，请刷新列表")
}
func ParseCreatedWindow(raw string) (string, error) {
	id := strings.TrimSpace(raw)
	if !windowID.MatchString(id) {
		return "", errors.New("新增窗口结果未确认，请刷新列表后再操作")
	}
	return id, nil
}
func ParseEndedWindow(raw string) error {
	switch strings.TrimSpace(raw) {
	case "NZX_WINDOW_ENDED":
		return nil
	case "NZX_WINDOW_SHARED":
		return errors.New("窗口被多个会话共享，请先解除链接再关闭")
	case "NZX_WINDOW_LAST":
		return errors.New("只剩一个窗口，不能单独结束；如需关闭整组，请使用结束会话")
	default:
		return errors.New("结束窗口结果未确认，请刷新列表")
	}
}
func EndTmuxWindowCommand(row Tmux, id string) (string, error) {
	verify, err := VerifyTmuxCommand(row)
	if err != nil {
		return "", err
	}
	if _, err = FindTmuxWindow(row, id); err != nil {
		return "", err
	}
	if len(row.Windows) <= 1 {
		return "", errors.New("只剩一个窗口，不能单独结束；如需关闭整组，请使用结束会话")
	}
	// Stable IDs and live checks protect against renamed, moved, linked or already-closed windows.
	command := "unset TMUX TMUX_PANE\n" + verify + " || exit 1\n" +
		"tmux -u list-windows -t " + Quote(row.ID) + " -F '#{window_id}' | grep -Fx -- " + Quote(id) + " >/dev/null || exit 1\n" +
		"links=$(tmux -u list-windows -a -F '#{window_id}' | grep -Fxc -- " + Quote(id) + ")\n" +
		"[ \"$links\" = 1 ] || { printf 'NZX_WINDOW_SHARED\\n'; exit 0; }\n" +
		"[ \"$(tmux -u display-message -p -t " + Quote(row.ID) + " '#{session_windows}')\" -gt 1 ] || { printf 'NZX_WINDOW_LAST\\n'; exit 0; }\n"
	return command + "tmux -u kill-window -t " + Quote(row.ID+":"+id) + " && printf 'NZX_WINDOW_ENDED\\n'", nil
}
