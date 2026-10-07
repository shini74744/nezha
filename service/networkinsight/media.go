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
	{"spotify", "Spotify", "spotify", []string{"https://www.spotify.com/"}},
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

// Fixed anonymous availability checks, independently implemented from the
// RegionRestrictionCheck platform signals (see docs/streaming-probes.md).
// No downloaded executable, account credentials, installation or network changes.
// Bounded temporary bodies/tokens are removed; only compact evidence returns.
const mediaScript = `
command -v curl >/dev/null 2>&1 || { printf 'NZM_UNSUPPORTED\n'; exit 0; }
tmp=$(mktemp -d) || exit 1
trap 'rm -f "$tmp/body" "$tmp/error"; rmdir "$tmp"' EXIT HUP INT TERM
request() {
 address=$1
 shift
 : > "$tmp/body"
 : > "$tmp/error"
 code=$(curl -q FAMILY --noproxy '*' --proto '=https' --proto-redir '=https' --max-redirs 4 --connect-timeout 3 --max-time 8 --max-filesize 2097152 -sSL -A 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' -H 'Accept-Language: en-US,en;q=0.9' -o "$tmp/body" -w '%{http_code}' "$@" "$address" 2>"$tmp/error")
 rc=$?
}
has() { grep -Eiq "$1" "$tmp/body" 2>/dev/null; }
country() {
 grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[A-Z]{2}\"" "$tmp/body" 2>/dev/null | head -n 1 | sed -E 's/.*"([A-Z]{2})"$/\1/'
}
emit() {
 flags=''
 region=''
 grep -Eiq 'Network is unreachable|No route to host' "$tmp/error" && flags="no_route,"
 has 'Our systems have detected unusual traffic|verify you are human|<title>Just a moment|<title>Before you continue' && flags="$flags""challenge,"
 case "$kind" in
 netflix)
  has 'Oh no!|not available in your country|not available in your region' && flags="$flags""restricted,"
  has 'og:type[^>]+video[.]|videoId"[[:space:]]*:[[:space:]]*(80018499|81280792|70143836)|"@type"[[:space:]]*:[[:space:]]*"(Movie|TVSeries)"' && flags="$flags""title,"
  region=$(country countryCode)
  [ -n "$region" ] || region=$(country country)
  [ -n "$region" ] || region=$(grep -oE '"id"[[:space:]]*:[[:space:]]*"[A-Z]{2}"[[:space:]]*,[[:space:]]*"countryName"' "$tmp/body" | head -n 1 | sed -E 's/.*"([A-Z]{2})".*/\1/')
  ;;
 youtube)
  has 'not available in your country|not available in your region|www[.]google[.]cn' && flags="$flags""restricted,"
  has 'ad-free|ad.free and offline|YouTube and YouTube Music ad.free' && flags="$flags""premium,"
  region=$(country INNERTUBE_CONTEXT_GL)
  ;;
 disneyplus)
  has 'forbidden-location|UNSUPPORTED_LOCATION|"inSupportedLocation"[[:space:]]*:[[:space:]]*false' && flags="$flags""restricted,"
  if [ "$disney_session" = 1 ]; then
   has '"inSupportedLocation"[[:space:]]*:[[:space:]]*true' && flags="$flags""allowed,"
   region=$(country countryCode)
  fi
  flags="$flags""api,"
  ;;
 spotify)
  flags="$flags""registration,"
  has '"status"[[:space:]]*:[[:space:]]*(320|120)([[:space:]]*[,}]|$)|"is_country_launched"[[:space:]]*:[[:space:]]*false' && flags="$flags""restricted,"
  if has '"status"[[:space:]]*:[[:space:]]*311([[:space:]]*[,}]|$)' && has '"is_country_launched"[[:space:]]*:[[:space:]]*true'; then flags="$flags""allowed,"; fi
  region=$(country country)
  ;;
 tvb)
  has '"allow_in_this_country"[[:space:]]*:[[:space:]]*false' && flags="$flags""restricted,"
  has '"allow_in_this_country"[[:space:]]*:[[:space:]]*true' && flags="$flags""allowed,"
  region=$(country country)
  [ -n "$region" ] || region=$(country country_code)
  ;;
 bbc)
  has '"id"[[:space:]]*:[[:space:]]*"geolocation"' && flags="$flags""restricted,"
  has 'vs-hls-push-uk' && flags="$flags""bbc,"
  ;;
 esac
 printf 'NZM|%s|%s|%s|%s|%s\n' "$key" "$code" "$rc" "$flags" "$region"
}
probe() {
 key=$1
 request "$2"
 emit
}
`

// Disney's anonymous device grant is bounded to three requests (24s maximum).
// Tokens are accepted only as JWT/base64url strings and never emitted or executed.
const disneyScript = `
key=0
auth='ZGlzbmV5JmJyb3dzZXImMS4wLjA.Cu56AgSfBTDag5NiRA81oLHkDZfu5L3CKadnefEAY84'
request 'https://disney.api.edge.bamgrid.com/devices' --max-redirs 0 -H "authorization: Bearer $auth" -H 'content-type: application/json' --data '{"deviceFamily":"browser","applicationRuntime":"chrome","deviceProfile":"windows","attributes":{}}'
token() { grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[A-Za-z0-9._-]+\"" "$tmp/body" | head -n 1 | sed -E 's/.*:[[:space:]]*"([^"]*)"/\1/'; }
ok() { [ "$rc" = 0 ] && { [ "$code" = 200 ] || [ "$code" = 201 ]; }; }
assertion=$(token assertion)
if ok && [ -n "$assertion" ] && [ "${#assertion}" -le 8192 ]; then
 request 'https://disney.api.edge.bamgrid.com/token' --max-redirs 0 -H "authorization: Bearer $auth" --data 'grant_type=urn:ietf:params:oauth:grant-type:token-exchange&latitude=0&longitude=0&platform=browser&subject_token_type=urn:bamtech:params:oauth:token-type:device' --data-urlencode "subject_token=$assertion"
 refresh=$(token refresh_token)
 if ok && [ -n "$refresh" ] && [ "${#refresh}" -le 8192 ]; then
  disney_session=1
  request 'https://disney.api.edge.bamgrid.com/graph/v1/device/graphql' --max-redirs 0 -H "authorization: $auth" -H 'content-type: application/json' --data "{\"query\":\"mutation Availability(\u0024input: RefreshTokenInput!) { refreshToken(refreshToken: \u0024input) { activeSession { sessionId } } }\",\"variables\":{\"input\":{\"refreshToken\":\"$refresh\"}}}"
 fi
fi
emit
`

// Validation-only, deliberately missing email/password and using an invalid
// identifier. This cannot register an account; it tests registration geography.
const spotifyScript = `
key=0
request 'https://spclient.wg.spotify.com/signup/public/v1/account' --max-redirs 0 --data 'birth_day=1&birth_month=1&birth_year=2000&creation_point=https%3A%2F%2Fwww.spotify.com%2F&displayname=AvailabilityCheck&gender=male&key=a1e486e2729f46d6bb368d6b2bcda326&platform=www&send-email=0&thirdpartyemail=0&identifier_token=invalid-availability-check'
emit
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
	script := strings.ReplaceAll(mediaScript, "FAMILY", f) + "kind='" + id + "'\n"
	switch id {
	case "disneyplus":
		script += disneyScript
	case "spotify":
		script += spotifyScript
	default:
		for i, u := range t.URLs {
			script += fmt.Sprintf("probe %d '%s'\n", i, u)
		}
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
	has := func(e evidence, s string) bool { return strings.Contains(","+e.flags, ","+s+",") }
	valid := func(e evidence) bool { return e.exit == 0 && e.code == 200 && !has(e, "challenge") }
	failure := func(e evidence) string {
		if e.exit == 28 {
			return "timeout"
		}
		if has(e, "no_route") {
			return "no_route"
		}
		if e.exit == 6 {
			return "dns_error"
		}
		if e.exit != 0 {
			return "network_error"
		}
		if has(e, "challenge") || e.code == 429 {
			return "challenge"
		}
		if e.code == 403 && !has(e, "restricted") {
			return "blocked"
		}
		return ""
	}
	if id == "netflix" {
		licensed := false
		restricted := true
		for i := 1; i < len(t.URLs); i++ {
			e := items[i]
			if valid(e) && has(e, "title") && !has(e, "restricted") {
				licensed = true
				if out.Region == "" {
					out.Region = e.region
				}
			}
			restricted = restricted && e.exit == 0 && !has(e, "challenge") && (has(e, "restricted") || e.code == 404)
		}
		if licensed {
			out.Status = "unlocked"
		} else if valid(first) && has(first, "title") && !has(first, "restricted") && restricted {
			out.Status = "originals"
			out.Region = first.region
		} else if first.exit == 0 && !has(first, "challenge") && first.code < 500 && has(first, "restricted") {
			out.Status = "restricted"
		}
		if out.Status == "unknown" {
			for i := 0; i < len(t.URLs); i++ {
				if status := failure(items[i]); status != "" {
					out.Status = status
					break
				}
			}
		}
		return out
	}
	if status := failure(first); status != "" {
		out.Status = status
		return out
	}
	if first.code < 500 && has(first, "restricted") {
		out.Status = "restricted"
		out.Region = first.region
		if id == "spotify" && has(first, "registration") {
			out.Status = "registration_restricted"
		}
		return out
	}
	if !valid(first) {
		return out
	}
	out.Region = first.region
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
	case "spotify":
		if has(first, "registration") {
			if has(first, "allowed") && first.region != "" {
				out.Status = "registration_available"
			}
		} else {
			out.Status = "reachable"
		}
	case "tvb", "disneyplus":
		if has(first, "allowed") && (id != "disneyplus" || first.region != "") {
			out.Status = "unlocked"
		} else if id == "disneyplus" && !has(first, "api") {
			out.Status = "reachable"
		}
	}
	return out
}
