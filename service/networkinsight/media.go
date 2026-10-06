package networkinsight

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

type MediaTarget struct {
	ID, Name, Icon string
	URLs           []string
}

var mediaCatalog = []MediaTarget{
	{"netflix", "Netflix", "netflix", []string{"https://www.netflix.com/title/80018499", "https://www.netflix.com/title/81280792", "https://www.netflix.com/title/70143836"}},
	{"youtube", "YouTube Premium", "youtube", []string{"https://www.youtube.com/premium"}},
	{"disneyplus", "Disney+", "disneyplus", []string{"https://www.disneyplus.com/"}},
	{"bbc", "BBC iPlayer", "bbc", []string{"https://open.live.bbc.co.uk/mediaselector/6/select/version/2.0/mediaset/pc/vpid/bbc_one_london/format/json"}},
	{"tvb", "TVBAnywhere+", "", []string{"https://uapisfm.tvbanywhere.com.sg/geoip/check/platform/android"}},
	{"spotify", "Spotify", "spotify", []string{"https://spclient.wg.spotify.com/signup/public/v1/account"}},
}

func MediaTargets() []MediaTarget { return append([]MediaTarget(nil), mediaCatalog...) }
func MediaTargetByID(id string) (MediaTarget, bool) {
	for _, t := range mediaCatalog {
		if t.ID == id {
			return t, true
		}
	}
	return MediaTarget{}, false
}
func EmptyMedia() []MediaResult {
	out := []MediaResult{}
	for _, t := range mediaCatalog {
		for _, f := range []string{"IPv4", "IPv6"} {
			out = append(out, MediaResult{ID: t.ID, Name: t.Name, Icon: t.Icon, Family: f, Status: "untested"})
		}
	}
	return out
}

// Fixed read-only requests, no downloaded executable, credentials, installation
// or network changes. Bounded temporary bodies are removed; only markers return.
const mediaScript = `
command -v curl >/dev/null 2>&1 || { printf 'NZM_UNSUPPORTED\n'; exit 0; }
tmp=$(mktemp -d) || exit 1
trap 'rm -f "$tmp/body"; rmdir "$tmp"' EXIT HUP INT TERM
probe() {
 key=$1
 address=$2
 code=$(curl -q FAMILY --noproxy '*' --proto '=https' --proto-redir '=https' --max-redirs 4 --connect-timeout 3 --max-time 3 --max-filesize 2097152 -sL -A 'Mozilla/5.0 NezhaNetworkInsights/1' -H 'Accept-Language: en-US,en;q=0.9' -o "$tmp/body" -w '%{http_code}' "$address" 2>/dev/null)
 rc=$?
 flags=''
 has() { grep -Eiq "$1" "$tmp/body" 2>/dev/null; }
 has 'Our systems have detected unusual traffic|verify you are human|<title>Just a moment|<title>Before you continue' && flags="$flags""challenge,"
 has 'Oh no!|not available in your country|not available in your region|not yet available|UNSUPPORTED_LOCATION|geolocation|allow_in_this_country"[[:space:]]*:[[:space:]]*false|is_country_launched"[[:space:]]*:[[:space:]]*false' && flags="$flags""restricted,"
 has 'og:type[^>]+video[.]|videoId"[[:space:]]*:[[:space:]]*(80018499|81280792|70143836)|"@type"[[:space:]]*:[[:space:]]*"(Movie|TVSeries)"' && flags="$flags""title,"
 has 'ad-free|ad.free and offline|YouTube and YouTube Music ad.free' && flags="$flags""premium,"
 has 'allow_in_this_country"[[:space:]]*:[[:space:]]*true|isAllowed"[[:space:]]*:[[:space:]]*true|is_country_launched"[[:space:]]*:[[:space:]]*true' && flags="$flags""allowed,"
 has 'vs-hls-push-uk' && flags="$flags""bbc,"
 region=$(sed -nE 's/.*"(INNERTUBE_CONTEXT_GL|countryCode|country_code|country)"[[:space:]]*:[[:space:]]*"([A-Z]{2})".*/\2/p' "$tmp/body" 2>/dev/null | head -c 2)
 printf 'NZM|%s|%s|%s|%s|%s\n' "$key" "$code" "$rc" "$flags" "$region"
}
`

func MediaCommand(id, family string) (string, error) {
	t, ok := MediaTargetByID(id)
	if !ok || (family != "IPv4" && family != "IPv6") {
		return "", fmt.Errorf("invalid fixed probe")
	}
	f := "-4"
	if family == "IPv6" {
		f = "-6"
	}
	script := strings.ReplaceAll(mediaScript, "FAMILY", f)
	for i, u := range t.URLs {
		script += fmt.Sprintf("probe %d '%s'\n", i, u)
	}
	return "sh -c '" + strings.ReplaceAll(script, "'", "'\"'\"'") + "'", nil
}

type evidence struct {
	code, exit    int
	flags, region string
}

var regionPattern = regexp.MustCompile("^[A-Z]{2}$")

func ClassifyMedia(id, family, data string, successful bool) MediaResult {
	t, ok := MediaTargetByID(id)
	if !ok {
		return MediaResult{Status: "unknown"}
	}
	out := MediaResult{ID: id, Name: t.Name, Icon: t.Icon, Family: family, Status: "unknown"}
	if !successful {
		if strings.Contains(strings.ToLower(data), "disabled") {
			out.Status = "disabled"
		}
		return out
	}
	if strings.TrimSpace(data) == "NZM_UNSUPPORTED" {
		out.Status = "unsupported"
		return out
	}
	items := map[int]evidence{}
	for _, line := range strings.Split(data, "\n") {
		p := strings.Split(strings.TrimSpace(line), "|")
		if len(p) != 6 || p[0] != "NZM" {
			continue
		}
		key, e := strconv.Atoi(p[1])
		if e != nil || key < 0 || key >= len(t.URLs) {
			continue
		}
		code, e := strconv.Atoi(p[2])
		if e != nil || code < 0 || code > 599 {
			continue
		}
		rc, e := strconv.Atoi(p[3])
		if e != nil {
			continue
		}
		region := ""
		if regionPattern.MatchString(p[5]) {
			region = p[5]
		}
		items[key] = evidence{code, rc, p[4], region}
	}
	if len(items) != len(t.URLs) {
		return out
	}
	first := items[0]
	out.Region = first.region
	has := func(e evidence, s string) bool { return strings.Contains(","+e.flags, ","+s+",") }
	valid := func(e evidence) bool { return e.exit == 0 && e.code == 200 && !has(e, "challenge") }
	for _, e := range items {
		if e.exit == 28 {
			out.Status = "timeout"
			return out
		}
		if e.exit != 0 {
			out.Status = "network_error"
			return out
		}
		if has(e, "challenge") || e.code == 429 {
			out.Status = "challenge"
			return out
		}
	}
	if id == "netflix" {
		licensed := false
		restricted := true
		for i := 1; i < len(t.URLs); i++ {
			e := items[i]
			licensed = licensed || (valid(e) && has(e, "title") && !has(e, "restricted"))
			restricted = restricted && (has(e, "restricted") || e.code == 404)
		}
		if licensed {
			out.Status = "unlocked"
		} else if valid(first) && has(first, "title") && !has(first, "restricted") && restricted {
			out.Status = "originals"
		} else if first.code == 403 || has(first, "restricted") {
			out.Status = "restricted"
		}
		return out
	}
	if first.code == 403 || has(first, "restricted") {
		out.Status = "restricted"
		return out
	}
	if !valid(first) {
		return out
	}
	switch id {
	case "youtube":
		if has(first, "premium") && first.region != "" {
			out.Status = "unlocked"
		}
	case "bbc":
		if has(first, "bbc") {
			out.Status = "unlocked"
			out.Region = "GB"
		}
	case "tvb", "disneyplus", "spotify":
		if has(first, "allowed") {
			out.Status = "unlocked"
		}
	}
	return out
}
