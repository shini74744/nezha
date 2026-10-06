# Node BGP and streaming insights

Both public themes expose BGP and streaming tabs alongside connectivity. Each server has independent default-on switches. Disabled features reject reads and starts. Guests read saved results only; administrators and node owners may refresh subject to CSRF, frontend password, token scopes, server restrictions and a five-minute cooldown.

## Execution and limits

- BGP queries fixed RIPEstat endpoints from the dashboard using the node's reported public IPv4/IPv6, never the visitor's IP. Origin and two adjacent AS hops are visualized. Percentages and edge widths represent collector-peer observations, not bandwidth or commercial transit relationships. Prepends are collapsed and loops rejected. Largest 40 aggregates are shown against the complete denominator. Blue outlines mark a common-backbone reference, not authoritative Tier-1 certification.
- Streaming checks execute a fixed read-only shell command on the target Agent's bound session, separately for IPv4/IPv6. Requires sh/curl and command execution enabled. No external executable, installation, network/DNS/proxy changes, or credentials. Requests have a three-second budget; Netflix uses three title requests. Temporary bodies are bounded to 2 MiB and removed. Only sanitized markers are returned.
- Netflix compares original/non-original title-page evidence; YouTube checks Premium and region. Other providers require recognized public region signals. HTTP 200 alone never means unlocked. Unknown, timeout, network error and challenge remain distinct. Provider changes may make results inconclusive; public signals do not guarantee account playback rights.

## Cache and permissions

The existing Card settings → Connectivity → Automatic checks policy also controls these features: default two hours and one-day retention. Automatic jobs target online enabled servers, globally capped at three jobs and two starts per scheduler tick. Expired records are periodically pruned. Opening a tab never triggers an external probe.

Records are partitioned by server ID, UUID, owner and reported IPs. Transfers, reused IDs and IP changes cannot expose a previous identity's cached results. Sessions and identity are revalidated before dispatch and result acceptance. Public responses contain BGP prefixes but not exact node IPs, raw Agent output or credentials.

BGP supports saved snapshot selection; streaming updates progressively while retaining clear inconclusive/error states. Both are lazy-loaded, use the existing theme components and support narrow screens without page-wide horizontal overflow.

## References

- https://stat.ripe.net/docs/data-api/api-endpoints/bgp-state
- https://ip.net.coffee/ip/
- https://github.com/lmc999/RegionRestrictionCheck
- https://www.vps69.com/posts/tutorial/streaming-unlock/

Third-party detector scripts are research references, not downloaded or executed.
