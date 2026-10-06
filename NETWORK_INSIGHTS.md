# Node BGP and streaming insights

Both public themes expose BGP and streaming tabs alongside connectivity. Each server has independent default-on switches. Disabled features reject reads and starts. Guests read saved results only; administrators and node owners may refresh subject to CSRF, frontend password, token scopes, server restrictions and a five-minute cooldown.

## Execution and limits

- BGP queries fixed RIPEstat endpoints from the dashboard using the node's reported public IPv4/IPv6, never the visitor's IP or an Agent traceroute. Looking Glass is preferred, with BGP State as fallback. Full AS paths are reversed from origin outward, prepends collapsed, loops/sets rejected, and duplicate collector-peer/path samples removed. Public graphs retain ASNs and counts, never collector peer IPs.
- The observation graph follows the VPStarter visual reference: strict/enhanced modes, horizontal/vertical layered layout, route-server visibility, stable source coloring, optional supplemental edges, pan/pinch/zoom/fit/fullscreen, node/path selection, sortable branch summary and an expandable methodology legend. The original IPv4/IPv6 selector, saved history and refresh permissions remain intact.
- Nodes are placed at their nearest observed distance from an origin. Edges count actual adjacent AS pairs; selection uses saved complete paths, not invented paths through a merged graph. Counts and line widths are observations, not bandwidth or commercial transit relationships. T1/≈T1 badges are static annotations, not authoritative certification.
- Graphs are bounded to 256 nodes, 2048 observed edges and 1024 distinct complete paths. Whole paths are retained in sample-count order; omissions set an explicit truncation notice and preserve the total denominator. Old snapshots without graph data show only their saved three-AS aggregates and an upgrade notice; they do not invent deeper hops or collector counts.
- Route-server annotations use a fixed public PeeringDB endpoint, cached for 24 hours. Enhanced supplemental context uses RIPEstat ASN neighbours for up to 16 ASNs, cached for two hours, limited to 128 edges between existing nodes. ASN-wide adjacency is not a prefix observation: dashed edges are explicitly separate, do not change layers or counts, and are excluded from branch statistics. The reference site's private bgp.tools overlay is not copied or proxied.
- Optional annotations have a six-second budget; name enrichment has an 18-second budget. Individual data requests remain bounded to 12 seconds / 8 MiB (PeeringDB: 4 MiB), with fixed destinations and redirects rejected. Partial or unavailable metadata never becomes fabricated evidence. Graph toolbar actions use the saved data only and do not trigger network probes.
- Streaming checks execute a fixed read-only shell command on the target Agent's bound session, separately for IPv4/IPv6. Requires sh/curl and command execution enabled. No external executable, installation, network/DNS/proxy changes, or credentials. Requests have a three-second budget; Netflix uses three title requests. Temporary bodies are bounded to 2 MiB and removed. Only sanitized markers are returned.
- Netflix compares original/non-original title-page evidence; YouTube checks Premium and region. Other providers require recognized public region signals. HTTP 200 alone never means unlocked. Unknown, timeout, network error and challenge remain distinct. Provider changes may make results inconclusive; public signals do not guarantee account playback rights.

## Cache and permissions

The existing Card settings → Connectivity → Automatic checks policy also controls these features: default two hours and one-day retention. Automatic jobs target online enabled servers, globally capped at three jobs and two starts per scheduler tick. Expired records are periodically pruned. Opening a tab never triggers an external probe.

Records are partitioned by server ID, UUID, owner and reported IPs. Transfers, reused IDs and IP changes cannot expose a previous identity's cached results. Sessions and identity are revalidated before dispatch and result acceptance. Public responses contain BGP prefixes but not exact node IPs, raw Agent output or credentials.

BGP supports saved snapshot selection; streaming updates progressively while retaining clear inconclusive/error states. Both are lazy-loaded, use the existing theme components and support narrow screens without page-wide horizontal overflow.

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
