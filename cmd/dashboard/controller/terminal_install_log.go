package controller

import (
	"context"
	"regexp"
	"strings"
	"time"
	"unicode"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/rpc"
)

var runTmuxInstallLog = rpc.RunTerminalManagementCommand
var installLogURL = regexp.MustCompile(`(?i)[a-z][a-z0-9+.-]*://[^\s<>]+`)
var installLogSecret = regexp.MustCompile(`(?i)(authorization|password|passwd|token|api[_-]?key|secret)\s*[:=]`)
var installLogANSI = regexp.MustCompile("\x1b\\[[0-?]*[ -/]*[@-~]")

func cleanInstallLog(raw string) string {
	if len(raw) > 32768 {
		raw = raw[len(raw)-32768:]
		// Drop a cut first line so a truncated credential cannot evade redaction.
		if boundary := strings.IndexByte(raw, '\n'); boundary >= 0 {
			raw = raw[boundary+1:]
		} else {
			raw = "[过长日志行已省略]\n"
		}
	}
	raw = strings.ToValidUTF8(raw, "")
	raw = installLogANSI.ReplaceAllString(raw, "")
	raw = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\t' {
			return r
		}
		if r == '\r' {
			return '\n'
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, raw)
	lines := strings.Split(raw, "\n")
	for i, line := range lines {
		line = installLogURL.ReplaceAllString(line, "[软件源地址已隐藏]")
		if installLogSecret.MatchString(line) {
			line = "[含敏感信息的日志已隐藏]"
		}
		lines[i] = line
	}
	return strings.Join(lines, "\n")
}

func executeTmuxInstall(job *tmuxInstallJob, server *model.Server, install, read, cleanup string, installRunner, logRunner func(context.Context, *model.Server, string) (string, error)) {
	type outcome struct {
		raw string
		err error
	}
	ctx, cancel := context.WithTimeout(context.Background(), 350*time.Second)
	defer cancel()
	finished := make(chan outcome, 1)
	go func() {
		runCtx, stop := context.WithTimeout(ctx, 335*time.Second)
		defer stop()
		raw, err := installRunner(runCtx, server, install)
		finished <- outcome{raw, err}
	}()
	refresh := func() {
		readCtx, stop := context.WithTimeout(ctx, 8*time.Second)
		defer stop()
		raw, err := logRunner(readCtx, server, read)
		if err != nil {
			return
		}
		tmuxInstalls.Lock()
		job.View.Log = cleanInstallLog(raw)
		tmuxInstalls.Unlock()
	}
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	var result tmuxInstallView
	waiting := true
	for waiting {
		select {
		case out := <-finished:
			result = installResult(out.raw, out.err)
			waiting = false
		case <-ticker.C:
			refresh()
		case <-ctx.Done():
			result = installResult("", ctx.Err())
			waiting = false
		}
	}
	refresh()
	// Remove only this job's generated temporary log, never any server configuration.
	cleanupCtx, stop := context.WithTimeout(context.Background(), 8*time.Second)
	defer stop()
	_, _ = logRunner(cleanupCtx, server, cleanup)
	tmuxInstalls.Lock()
	result.Log = job.View.Log
	job.View = result
	tmuxInstalls.Unlock()
}
