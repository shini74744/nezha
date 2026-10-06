package networkinsight

import (
	"context"
	"github.com/stretchr/testify/require"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestIPv6DiscoveryRejectsInvalidNonPublicAndIPv4(t *testing.T) {
	for _, v := range []string{"", "1.1.1.1", "::ffff:1.1.1.1", "fe80::1", "fc00::1", "2001:db8::1", "<script>2606:4700::1111</script>", "2606:4700::1111;id"} {
		require.Empty(t, ParseIPv6(v))
	}
	require.Equal(t, "2606:4700:4700::1111", ParseIPv6("fl=abc\nip=2606:4700:4700::1111\nloc=US"))
	require.Contains(t, IPv6Command(), "curl -q -6")
	require.Contains(t, IPv6Command(), "--max-time 5")
	require.NotContains(t, IPv6Command(), " -k ")
}
func TestMediaPartialFailureDoesNotErasePositiveLicensedEvidence(t *testing.T) {
	got := ClassifyMedia("netflix", "IPv6", "NZM|0|000|28||\nNZM|1|200|0|title,|US\nNZM|2|000|28||", true)
	require.Equal(t, "unlocked", got.Status)
	got = ClassifyMedia("netflix", "IPv6", "NZM|0|200|0|title,|US\nNZM|1|404|0||\nNZM|2|000|28||", true)
	require.Equal(t, "timeout", got.Status)
	require.Equal(t, "no_route", ClassifyMedia("youtube", "IPv6", "NZM|0|000|7|no_route,|", true).Status)
	require.Equal(t, "reachable", ClassifyMedia("spotify", "IPv4", "NZM|0|200|0||", true).Status)
	require.Equal(t, "restricted", ClassifyMedia("disneyplus", "IPv4", "NZM|0|200|0|restricted,|CN", true).Status)
	require.Equal(t, "challenge", ClassifyMedia("disneyplus", "IPv4", "NZM|0|200|0|challenge,|US", true).Status)
}
func TestMediaClearsPreviousResponseBeforeNextRequest(t *testing.T) {
	dir := t.TempDir()
	script := `#!/bin/sh
while [ "$#" -gt 0 ]; do
 if [ "$1" = "-o" ]; then shift; dest=$1; fi
 address=$1
 shift
done
case "$address" in
 *80018499) printf '<meta property="og:type" content="video.movie">' > "$dest"; printf 200;;
 *) printf 200;;
esac
`
	require.NoError(t, os.WriteFile(filepath.Join(dir, "curl"), []byte(script), 0700))
	command, err := MediaCommand("netflix", "IPv6")
	require.NoError(t, err)
	require.Contains(t, command, "curl -q -6")
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "sh", "-c", command)
	cmd.Env = append(os.Environ(), "PATH="+dir+":"+os.Getenv("PATH"))
	raw, err := cmd.CombinedOutput()
	require.NoError(t, err, string(raw))
	require.Equal(t, 1, strings.Count(string(raw), "title,"))
	require.Equal(t, "unknown", ClassifyMedia("netflix", "IPv6", string(raw), true).Status)
}
