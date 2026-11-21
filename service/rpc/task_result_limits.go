package rpc

import "unicode/utf8"

// maxTaskResultTextBytes bounds the Agent-chosen output of scheduled tasks and
// service monitors. Both are meant for a human to read in a notification.
const maxTaskResultTextBytes = 64 * 1024

const taskResultTruncatedSuffix = "\n...(truncated)"

// truncateTaskResultText cuts oversized output on a rune boundary so the kept
// part stays valid UTF-8 for JSON and the database.
func truncateTaskResultText(text string) string {
	if len(text) <= maxTaskResultTextBytes {
		return text
	}
	keep := maxTaskResultTextBytes
	for keep > 0 && !utf8.RuneStart(text[keep]) {
		keep--
	}
	return text[:keep] + taskResultTruncatedSuffix
}
