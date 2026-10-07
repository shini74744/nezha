# Streaming availability probes

Reference signals reviewed on 2026-10-07 from the user-supplied [guide](https://www.vps69.com/posts/tutorial/streaming-unlock/):

- [lmc999 RegionRestrictionCheck](https://github.com/lmc999/RegionRestrictionCheck/blob/main/check.sh), retrieved SHA-256 9c0ec7f81a39743c91df9636924f7b308b96fbc038b84b95040d6eb48f8da8cd.
- [xykt RegionRestrictionCheck](https://github.com/xykt/RegionRestrictionCheck/blob/main/check.sh), retrieved SHA-256 a86f9330744ed05cbd110d76d606ddf0aedbcdf6e160f99c28e6ad07fd214359.

The fixed probes are independently implemented. No third-party script execution, cookies, installation, routing or DNS changes.

| Platform | Positive evidence | Display |
| --- | --- | --- |
| Netflix | Licensed-title metadata, or originals metadata with both licensed checks explicitly restricted | 解锁 / 仅自制内容 |
| YouTube Premium | Premium availability and INNERTUBE_CONTEXT_GL | 解锁 + region |
| Disney+ | Anonymous device grant and supported-location session with countryCode | 解锁 / 受限 |
| BBC iPlayer | UK HLS media selector response | 解锁 · GB |
| TVBAnywhere+ | allow_in_this_country=true | 解锁 |
| Spotify | Registration status 311, country, is_country_launched=true | 可注册 / 注册受限 |

Spotify checks registration geography, not playback. The incomplete validation request omits email/password and uses an invalid identifier, so it cannot create an account. Disney uses a public browser application key, not user credentials. Anonymous tokens never leave the node command's process; temporary bodies are removed.

HTTP 200 alone does not prove unlock. Missing evidence, rate limits, challenge pages and transport failures remain distinct. Netflix region comes from the successful licensed probe. Existing available_families behavior hides absent IPv6 without suppressing failures on dual-stack nodes.

Requests have verified HTTPS, 8-second deadlines and 2 MiB body limits. Disney uses at most three requests with redirects disabled for token-bearing calls. Token characters and length are checked before reuse; no eval. The existing 35-second command deadline, node permissions and read-only visitor access remain unchanged.

Old saved records are retained. New semantics apply after a manual or scheduled retest. No login or video playback is attempted.

Tests cover fake-curl device/token/session flows, token injection and size rejection, no token leakage, platform-specific evidence, missing regions, successful Netflix region selection, network failures, challenge precedence, IPv6 hiding and responsive display.
