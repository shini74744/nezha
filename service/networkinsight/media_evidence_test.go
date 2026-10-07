package networkinsight

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func mediaFixtureContext(t *testing.T) (context.Context, context.CancelFunc) {
	t.Helper()
	timeout := 3 * time.Second
	if runtime.GOOS == "windows" {
		// Git-for-Windows starts many native shell processes for these local fixtures.
		// This bounds the test harness, not MediaCommand's per-request timeout.
		timeout = 15 * time.Second
	}
	return context.WithTimeout(context.Background(), timeout)
}

// Configure PATH inside the POSIX shell, including on Git-for-Windows.
// Resolve the fake executable before running any probe so a broken fixture
// cannot fall through to real platform traffic.
func mediaFixtureCommand(ctx context.Context, dir, command string, env ...string) *exec.Cmd {
	prefix := "PATH=\"$PWD:$PATH\"; export PATH; test \"$(command -v curl)\" = \"$PWD/curl\" || exit 97; "
	cmd := exec.CommandContext(ctx, "sh", "-c", prefix+command)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), env...)
	return cmd
}

func TestMediaFixtureRejectsMissingCurl(t *testing.T) {
	dir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	raw, err := mediaFixtureCommand(ctx, dir, "printf unexpected > should-not-run").CombinedOutput()
	var exit *exec.ExitError
	require.ErrorAs(t, err, &exit, string(raw))
	require.Equal(t, 97, exit.ExitCode())
	_, err = os.Stat(filepath.Join(dir, "should-not-run"))
	require.True(t, os.IsNotExist(err))
}

// All HTTP is replaced locally; no platform traffic or user accounts in tests.
func TestPlatformSpecificMediaFlows(t *testing.T) {
	cases := []struct {
		id, scenario, body, status, region string
		calls                              int
	}{
		{"disneyplus", "", `{"extensions":{"sdk":{"session":{"location":{"countryCode":"JP"},"inSupportedLocation":true}}}}`, "unlocked", "JP", 3},
		{"disneyplus", "", `{"countryCode":"US","inSupportedLocation":false}`, "restricted", "US", 3},
		{"disneyplus", "", `{"inSupportedLocation":true}`, "unknown", "", 3},
		{"disneyplus", "", `{"countryCode":"JP","isAllowed":true}`, "unknown", "JP", 3},
		{"disneyplus", "forbidden", "", "restricted", "", 2},
		{"disneyplus", "timeout", "", "timeout", "", 1},
		{"disneyplus", "invalid-token", "", "unknown", "", 1},
		{"disneyplus", "oversized-token", "", "unknown", "", 1},
		{"disneyplus", "challenge", `{"countryCode":"JP","inSupportedLocation":true}`, "challenge", "", 3},
		{"spotify", "", `{"status":311,"country":"JP","is_country_launched":true}`, "registration_available", "JP", 1},
		{"spotify", "", `{"status":320,"country":"CN","is_country_launched":true}`, "registration_restricted", "CN", 1},
		{"spotify", "", `{"status":120,"country":"US"}`, "registration_restricted", "US", 1},
		{"spotify", "", `{"country":"JP","is_country_launched":true}`, "unknown", "JP", 1},
		{"spotify", "", `{"status":3110,"country":"JP","is_country_launched":true}`, "unknown", "JP", 1},
		{"spotify", "", `{"status":311,"is_country_launched":true}`, "unknown", "", 1},
		{"spotify", "", `<html>Welcome to Spotify</html>`, "unknown", "", 1},
		{"spotify", "challenge", `{"status":311,"country":"JP","is_country_launched":true}`, "challenge", "", 1},
		{"tvb", "", `{"isAllowed":true,"country":"US"}`, "unknown", "US", 1},
		{"tvb", "", `{"allow_in_this_country":true,"country":"HK"}`, "unlocked", "HK", 1},
		{"youtube", "", `{"INNERTUBE_CONTEXT_GL":"JP","country":"US"} ad-free`, "unlocked", "JP", 1},
	}
	for _, tc := range cases {
		t.Run(tc.id+"/"+tc.scenario+"/"+tc.status, func(t *testing.T) {
			dir := t.TempDir()
			fake := `#!/bin/sh
while [ "$#" -gt 0 ]; do
 case "$1" in
 -o) body=$2; shift 2;;
 https://*) url=$1; shift;;
 *) shift;;
 esac
done
printf '%s
' "$url" >> "$NZ_LOG"
case "$url" in
 */devices)
  if [ "$NZ_SCENARIO" = timeout ]; then printf 000; exit 28; fi
  if [ "$NZ_SCENARIO" = oversized-token ]; then awk 'BEGIN {printf "{\"assertion\":\""; for (i=0;i<8193;i++) printf "A"; printf "\"}"}' > "$body"; printf 200; exit 0; fi
  if [ "$NZ_SCENARIO" = invalid-token ]; then printf '%s' '{"assertion":"$(touch SHOULD_NOT_EXIST)"}' > "$body"; else printf '%s' '{"assertion":"test.assertion.token"}' > "$body"; fi
  printf 200;;
 */token)
  if [ "$NZ_SCENARIO" = forbidden ]; then printf '%s' '{"errors":[{"code":"forbidden-location"}]}' > "$body"; printf 403; else printf '%s' '{"refresh_token":"test.refresh.token"}' > "$body"; printf 200; fi;;
 *)
  printf '%s' "$NZ_BODY" > "$body"
  if [ "$NZ_SCENARIO" = challenge ]; then printf 429; else printf 200; fi;;
esac
`
			require.NoError(t, os.WriteFile(filepath.Join(dir, "curl"), []byte(fake), 0700))
			command, err := MediaCommand(tc.id, "IPv6")
			require.NoError(t, err)
			require.Contains(t, command, "curl -q -6")
			require.NotContains(t, command, " -k ")
			require.NotContains(t, command, "&email=")
			require.NotContains(t, command, "password=")
			ctx, cancel := mediaFixtureContext(t)
			defer cancel()
			log := filepath.Join(dir, "calls")
			cmd := mediaFixtureCommand(ctx, dir, command, "NZ_BODY="+tc.body, "NZ_SCENARIO="+tc.scenario, "NZ_LOG=calls")
			raw, err := cmd.CombinedOutput()
			require.NoError(t, err, string(raw))
			require.NotContains(t, string(raw), "test.assertion.token")
			require.NotContains(t, string(raw), "test.refresh.token")
			require.Equal(t, 1, strings.Count(string(raw), "NZM|"))
			result := ClassifyMedia(tc.id, "IPv6", string(raw), true)
			require.Equal(t, tc.status, result.Status, string(raw))
			require.Equal(t, tc.region, result.Region, string(raw))
			calls, err := os.ReadFile(log)
			require.NoError(t, err)
			require.Equal(t, tc.calls, strings.Count(string(calls), "\n"))
			_, err = os.Stat(filepath.Join(dir, "SHOULD_NOT_EXIST"))
			require.True(t, os.IsNotExist(err))
		})
	}
}

func TestMediaRegionFollowsWinningEvidence(t *testing.T) {
	r := ClassifyMedia("netflix", "IPv4", "NZM|0|000|28||JP\nNZM|1|200|0|title,|US\nNZM|2|200|0|title,|US", true)
	require.Equal(t, "unlocked", r.Status)
	require.Equal(t, "US", r.Region)
	r = ClassifyMedia("youtube", "IPv4", "NZM|0|429|0|premium,|US", true)
	require.Equal(t, "challenge", r.Status)
	require.Empty(t, r.Region)
	r = ClassifyMedia("disneyplus", "IPv4", "NZM|0|503|0|restricted,api,|JP", true)
	require.Equal(t, "unknown", r.Status)
	require.Empty(t, r.Region)
}
