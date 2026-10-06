# Node BGP and streaming insights

Both public themes expose BGP and streaming tabs alongside connectivity. Each server has independent default-on switches. Disabled features reject reads and starts. Guests read saved results only; administrators and node owners may refresh subject to CSRF, frontend password, token scopes, server restrictions and a five-minute cooldown.

## Execution and limits

- BGP queries fixed RIPEstat endpoints from the dashboard using the node's public IPv4/IPv6, never the visitor's IP or an Agent traceroute. Looking Glass is preferred, with BGP State as fallback. Full AS paths are reversed from origin outward, prepends collapsed, loops/sets rejected, and duplicate collector-peer/path samples removed. Public graphs retain ASNs and counts, never collector peer IPs.
- The observation graph offers VPStarter-inspired interactions in the panel's own theme-aware translucent UI (not a visual clone): strict/enhanced modes, horizontal/vertical layered layout, route-server visibility, stable source coloring, optional supplemental edges, pan/pinch/pointer-anchored wheel zoom/fit/fullscreen, node/path selection, sortable branch summary and an expandable methodology legend. The original IPv4/IPv6 selector, saved history and refresh permissions remain intact.
- Default core view is a display-only projection: keep every origin, rank branches by observed sample count then collector breadth, retain real contiguous saved path prefixes, and cap ordinary branches at 32 ASNs total / eight per layer. Large graphs fold single-sample tails (sparse-only graphs keep a connected preview); already-small graphs remain unchanged. Full view restores the entire saved graph, subject to the independent route-server toggle and backend safety limits. The shown/available AS count makes folding explicit. Neither mode changes stored history, counts, percentage denominators or path-selection evidence; no edge is invented across a hidden ASN. Core view initially fits the whole selected topology, including on mobile.
- Nodes are placed at their nearest observed distance from an origin. Edges count actual adjacent AS pairs; selection uses saved complete paths, not invented paths through a merged graph. Counts and line widths are observations, not bandwidth or commercial transit relationships. T1/≈T1 badges are static annotations, not authoritative certification.
- Graphs are bounded to 256 nodes, 2048 observed edges and 1024 distinct complete paths. Whole paths are retained in sample-count order; omissions set an explicit truncation notice and preserve the total denominator. Old snapshots without graph data show only their saved three-AS aggregates and an upgrade notice; they do not invent deeper hops or collector counts.
- Route-server annotations use a fixed public PeeringDB endpoint, cached for 24 hours. Enhanced supplemental context uses RIPEstat ASN neighbours for up to 16 ASNs, cached for two hours, limited to 128 edges between existing nodes. ASN-wide adjacency is not a prefix observation: dashed edges are explicitly separate, do not change layers or counts, and are excluded from branch statistics. The reference site's private bgp.tools overlay is not copied or proxied.
- Optional annotations have a six-second budget; name enrichment has an 18-second budget. Individual data requests remain bounded to 12 seconds / 8 MiB (PeeringDB: 4 MiB), with fixed destinations and redirects rejected. Partial or unavailable metadata never becomes fabricated evidence. Graph toolbar actions use the saved data only and do not trigger network probes.
- A missing reported IPv6 is confirmed on the target Agent with two fixed, forced-IPv6 HTTPS IP-echo requests (5 seconds / 4 KiB each). Parsed addresses must be public IPv6; no dashboard egress substitution, DDNS updates or network configuration changes. IPv4 and IPv6 BGP queries run concurrently. Truly absent or undiscoverable IPv6 remains explicit, not fabricated.
- Streaming checks execute a fixed read-only shell command on the target Agent's bound session, separately for IPv4/IPv6. Requires sh/curl and command execution enabled. No external executable, installation, network/DNS/proxy changes, or credentials. Requests have an eight-second total budget with a three-second connection timeout; Netflix uses three title requests within a 35-second RPC budget. Connectivity card probes remain unchanged at three seconds. Both address families are actually attempted even when no IPv6 has been reported. Temporary bodies are cleared between requests, bounded to 2 MiB and removed. Only sanitized markers are returned.
- Netflix compares original/non-original title-page evidence; YouTube checks Premium and region. Other providers require recognized public region signals. Disney+/Spotify show a neutral '网页可达' state when only a public webpage is reachable, not an unlock verdict; Spotify does not submit signup requests. HTTP 200 alone never means unlocked. Unknown, timeout, DNS failure, missing route, access denial, network error and challenge remain distinct. One failed Netflix title does not overwrite positive evidence from another licensed title. Provider changes may make results inconclusive; public signals do not guarantee account playback rights.

## Cache and permissions

Card settings → BGP independently controls BGP automatic checks: enabled by default, every six hours, one-day retention. Connectivity and streaming retain the existing two-hour / one-day policy under Connectivity. Each policy has separate revision-checked administrator-only APIs and pruning by record kind, so changing BGP does not affect the other records. Automatic jobs target online enabled servers, globally capped at three jobs and two starts per scheduler tick. Expired records are periodically pruned. Opening a tab never triggers an external probe.

Records are partitioned by server ID, UUID, owner and reported IPs. Transfers, reused IDs and IP changes cannot expose a previous identity's cached results. Sessions and identity are revalidated before dispatch and result acceptance. Only administrator responses may include BGP prefixes. Guests, members and non-admin node owners receive redacted latest, running and historical snapshots for both families; response copies never mutate stored data. Raw Agent output and credentials are never returned.

BGP supports saved snapshot selection; streaming updates progressively while retaining clear inconclusive/error states. Both are lazy-loaded, use the existing theme components and support narrow screens without page-wide horizontal overflow.

Connectivity includes Hong Kong (TVB, HK01, MTR, Viu) and Macau (CTM, TDM, Macau Pass, government portal), with locally bundled icons and country-prioritized ordering. Existing custom catalogs are not overwritten; administrators can explicitly merge missing built-ins.

## References

- https://stat.ripe.net/docs/data-api/api-endpoints/bgp-state
- https://data.stat.ripe.net/docs/data-api/api-endpoints/looking-glass
- https://stat.ripe.net/docs/data-api/api-endpoints/asn-neighbours
- https://www.peeringdb.com/api/net?info_type=Route%20Server&depth=0
- https://vpstarter.com/reviews/gomami-networks/gomami-networks-hkg-turin-hk-0df058/#bgp
- https://ip.net.coffee/ip/
- https://github.com/lmc999/RegionRestrictionCheck
- https://www.vps69.com/posts/tutorial/streaming-unlock/

Third-party detector scripts are research references, not downloaded or executed.

### BGP protocol availability

BGP responses expose `available_families` (protocol names only, never IPs). The UI
uses the current reported public addresses to hide an absent IPv6 tab and restore
it automatically after IPv6 is reported again; IPv6-only nodes retain their IPv6
tab. A missing selected family safely falls back to an available family. Address
changes invalidate the old identity's snapshots. Availability refresh follows
the existing Agent IP-report period and the page's normal polling interval.

Agent v2.3.7 fixes the HTTPS dial-lock bottleneck and enforces the connectivity
task's three-second request deadline inside the Agent, including TLS and body
reads. Ordinary HTTP service monitors retain their existing timeout. IPv4 and
IPv6 changes, appearances and disappearances independently trigger IP reports.
