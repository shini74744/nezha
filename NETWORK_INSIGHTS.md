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

## Return-route (NextTrace only)

The default and Doraemon detail pages add **回程** between BGP and streaming.
The independent server switch hides this tab and prevents new probes; older API
clients omitting `return_route_disabled` preserve its current value.

- Card settings → 回程: revision-checked admin-only target editor, automatic
  detection, interval (1–24 hours), retention (1–30 days), and TCP/ICMP/UDP.
  Defaults: Beijing/Shanghai/Guangzhou × Telecom/Unicom/Mobile, TCP port 80,
  six-hour interval, one-day retention. **Automation is initially off**.
- Requests originate on the selected Agent, not on the dashboard or visitor.
  Existing command-task RPC is reused; no Agent protocol upgrade is required.
  Only public literal IP targets are accepted (1–12 entries). No arbitrary
  shell commands, domains, private addresses or client-supplied run payloads.
- Supported probe nodes: Linux root, amd64/arm64/armv7, with sh, curl, sha256sum,
  timeout, stat and mktemp; Agent command execution must be enabled.
  Other platforms, missing tools, denied execution, download/checksum failures,
  timeouts and absent responses have explicit states rather than fake routes.
- On first use, download only official NextTrace tiny **v1.7.3**, verify a pinned
  SHA-256, and atomically cache it under root-only
  `/var/cache/nezha-nexttrace-v1.7.3`. No NodeQuality/NetQuality shell script,
  package installation, hardware/IP-quality check or bandwidth test runs.
  The binary is not embedded or redistributed by the dashboard.
- JSON output, 30 hops, three samples per hop, two concurrent targets per job;
  three return-route jobs globally, separate from BGP/streaming capacity; additional nodes queue with manual priority. Same-node manual/automatic requests reuse one job. Administrators have no retest cooldown.
  NextTrace is bounded to 35 seconds per target (download 25 seconds), replies
  to 256 KiB, and the entire job to eight minutes. Temporary outputs are removed.
  Map/report upload is disabled; NextTrace still uses its normal ASN/geolocation
  lookup service. Full scripts and speed tests are never executed.
- Only reported public address families are probed. No reported IPv6 means no
  IPv6 card. A family/IP change invalidates the previous identity cache.
- Cards show observed AS/line labels and reached/partial/error status; expand to
  see hop number, ASN, location and mean RTT of valid responses **for each hop
  address**. Unanswered hops are not automatically faults. CN2 is not labeled
  GIA merely because AS4809 was seen. Do not treat labels as SLA guarantees.
- Guests only read saved/in-progress results. Admins/node owners may start a
  probe, subject to existing auth/CSRF/token/server rules. Admins see full target/hop IPs. Guests and ordinary owners receive server-side redaction of node/provider prefixes, early/private/unidentified hops and embedded addresses; only identified backbone IPs beyond that edge may be visible, including history and running results. Owner/ID/IP/session changes reject stale replies; target/protocol changes invalidate queued probes and prevent stale results from being persisted.
- Saved snapshots survive restart, have independent expiry, and are selectable
  from a BGP-style time-card strip. Automatic cycles restart at Beijing 00:00 every day (including non-divisors of 24); queued work retains its scheduled slot. Long hop details open in a bounded, scrollable dialog, with consecutive unanswered hops merged by default. See [classification and privacy rules](RETURN_ROUTE_CLASSIFICATION.md). Desktop/mobile, light/dark and both built-in themes share the
  same interaction, without page-wide horizontal overflow.

References: [NextTrace](https://github.com/nxtrace/NTrace-core) and
[NetQuality route-test design](https://github.com/xykt/NetQuality).
Only the route-detection concept is used; third-party scripts are not executed.

### Return-route snapshot comparison (preview3)

The read-only comparison dialog selects two completed retained snapshots. It
compares per-target line/status, destination-only weighted RTT and visible hop
sets grouped by TTL, with responsive stacked/side-by-side layouts and optional
route/status-change filtering. Pending probes are excluded and the open dialog
retains a frozen response so polling cannot silently replace its inputs.

The API assigns response-local opaque comparison groups before guest redaction.
Different target addresses/protocols, missing targets and unsupported legacy
hidden-target records never produce an RTT delta. Groups are not address hashes
and are not persisted. Existing source-IP protection applies equally to both
sides. See RETURN_ROUTE_CLASSIFICATION.md for quality-label and inference limits.

### BGP 快照对比（preview4）

BGP 卡片新增“快照对比”，至少两份完成记录可用。选择基准／对比快照和协议族，展示前缀、观测数量、ASN 新增／减少、有序 AS 路径新增／减少及样本数变化。补充推测连线不纳入差异；任一失败或缺失记录不计算路径撤销。旧版记录双方统一降级为两级上游摘要，截断、前缀不同或前缀被权限隐藏均明确提示。对比期间冻结数据，切换身份／IP 查看权限关闭旧弹窗，不发起探测。

回程详情右上角增加“单独检测”，仅使用已配置目标与当前协议族，保存新快照并保留其他项目的原检测时间。与整组／自动任务共用节点互斥与原权限、CSRF、配置验证；无须升级 Agent。

### Lightweight connectivity sampling (2026-10-09)

All 110 built-in connectivity destinations use fixed public small resources or
empty/tiny diagnostic endpoints, shared by the browser and Agent catalogs.
The browser no longer substitutes a website homepage for the server URL.
YouTube uses `https://yt3.ggpht.com/favicon.ico`, matching the inspected
ip.skk.moe resource. Official CDN resources test that CDN, not video playback,
account access, streaming unlock or an ICMP/network-layer RTT.

Each target receives two unreported warmup requests, followed by five measured
Agent requests or ten browser requests. Only measured valid HTTP response times
are averaged; a timeout is not zero milliseconds. Warmups never appear as dots
or enter history. Server probes keep the existing Agent HTTP GET protocol and
body completion timing; browsers keep credential-free, uncached no-CORS HEAD.
No Agent upgrade is needed. Prewarming can reuse connections but cannot guarantee
identical DNS, routing, CDN selection or latency on different clients.

Warmups share existing bounded dispatch, cancellation, identity and permission
guards; the server batch budget is four minutes to accommodate 120 targets at
the existing three-second per-attempt ceiling. Disabled-query/offline outcomes
during warmup end that item without fabricated samples. Single retests warm up
again and preserve other targets.

Exact legacy built-in URLs are upgraded when loading saved catalogs, preserving
names, order, icons, switches and genuinely customized URLs. Administrator URLs
remain private; unknown custom hosts use only public `/favicon.ico` locally.
Historical measurements of changed resources are not reused as current results.

### Local probe worker and return map (custom-2026.10.09.2)

Local probes use a dedicated Web Worker; timing is measured inside the worker, not across UI message delivery. Each target keeps two warmups plus ten measured responses. Dots and the effective response mean update while testing. Cancellation, single retests and worker-start/runtime failure fallback remain bounded; the per-target worker watchdog covers all 12 attempts. Server probes retain two warmups plus five measured attempts with partial snapshots available during the run. Cached history keeps its original samples; new runs use the current policy. No Agent upgrade is required.

Return details offer a lazy-loaded local SVG map and a hop list. Coordinates come from the existing pinned NextTrace JSON, never from city-name guesses or another geolocation request. Unknown (0,0), incomplete, out-of-range, private and privacy-redacted locations are omitted. A missing or ECMP TTL breaks a line; nearby/coincident coordinates are grouped. The map is a location reference, not proof of physical routers or cable paths. The first mainland response label describes the first visible mainland geolocation after an overseas response, not a verified landing station. Independent hop RTTs need not increase with TTL.

## Automatic card priority (2026-10-09)

后台“卡片设置 → 自动检测优先级”可调整连通性、BGP、回程、流媒体的先后顺序。旧配置默认顺序为连通性 → BGP → 回程 → 流媒体；保存时校验四项完整且不重复，并使用 revision 防止覆盖其他页面修改。

- 单一调度器每 15 秒检查到期任务，每轮最多启动 3 项；先处理较早周期，同一周期按设置优先级、上次完成时间、服务器 ID 稳定排序。
- 同一节点一次只启动一项自动任务，已有执行中／排队中的回程任务会占住节点；优先项暂时无容量时，后续项不抢跑。不同节点仍保持既有有限并发。
- 原间隔、保留天数和时钟基准不变。回程继续每天北京时间零点重新起算，流媒体继续沿用连通性的自动检测周期；关闭全局策略或节点开关会跳过相应任务。
- 优先级仅约束自动任务，不中断已经启动的工作，不增加管理员手动重测冷却。手动请求仍使用原有权限、去重和容量限制。
- 周期去重读取持久化记录，重启不会把本周期已完成的任务再跑一次。

后台服务器列表的“批量设置”增加四项功能开关，默认保持原样；可统一开启或关闭已选择的机器。已经符合目标状态的机器跳过写入，保存结果显示实际修改数量。未选中的机器、未指定开关、Logo、DDNS、备注和节点身份均不更改；权限失败或数据库写入失败时整批回滚。

### BGP failed-cycle recovery, route-map explanations, and local-only connectivity

BGP 自动快照中任一协议族为 `unavailable` 时，在同一检测周期按 5、15、30、60 分钟退避补测，后续保持每小时一次，成功后停止；无公网地址和确无路由不当作数据源失败。兼容旧版失败快照。新周期按原周期开始检测，不无限重试旧周期。节点离线／其他任务执行时顺延；关闭策略或该节点功能后不再自动补测。

同周期补测只查询失败的协议族，成功结果保留，且保留各协议族实际检测时间和首次检测时间。原始尝试记录不删除；时间线每个自动周期只显示最新一次，手动快照仍独立。前台说明预计补测时间与排队顺延，不能保证外部 BGP 数据源一定恢复。

回程地图在地图上方解释未绘制的跳点，区分未响应、内网地址、隐私隐藏和缺少有效经纬度；可展开逐条查看。不存在的坐标不推测补齐。一个坐标可能对应多个 TTL，仍按原规则聚合。

单台服务器编辑的连通性使用三段选择：“服务器＋本地”“仅本地”“隐藏标签”。后两种均停止服务器端连通性检测；仅本地保留前台标签和后台配置的目标目录，浏览器需点击后才测量。结果只留在当前页面，不写入服务器历史，离线节点也可以本地测量。保留两次预热和十次正式采样；单项首测不会移除其他卡片或显示旧服务器延迟。旧版关闭节点默认仍隐藏标签。批量设置同样支持关闭并隐藏或关闭但保留本地延迟，默认不修改。

发布范围：源码与 Linux／Windows 安装包随 `custom-2026.10.09.3` 发布，阿里同步更新；无需升级 Agent。未加入访客 IP 回程检测。
