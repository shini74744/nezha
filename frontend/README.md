# Frontend source snapshots
The admin and default public frontend sources are versioned with this backend.
Upstream licenses are retained in each directory. Generated distributions, dependencies,
private deployment fixtures and local TLS certificates are intentionally excluded.

## Build and unit tests

- Admin: `cd frontend/admin && npm ci && npm test && npm run build`
- User: `cd frontend/user && corepack pnpm install --frozen-lockfile && corepack pnpm test && corepack pnpm run build`
- Full custom binary: see the root README and `script/build-custom.sh`.
- User dev server uses HTTP unless both local `.cert/key.pem` and `.cert/cert.pem` exist.

## Browser regressions
From `frontend/admin`, install Chromium with `npx playwright install chromium`.
Portable mocked UI checks:
```sh
npx playwright test tests/e2e/layout-time.spec.ts tests/e2e/theme-settings.spec.ts tests/e2e/dashboard-appearance.spec.ts tests/e2e/appearance-settings.spec.ts --workers=1
```
Screenshots go to ignored `test-results/`; fixture configuration is generated from
the public manifests, not a live installation's settings.
`theme-live.spec.ts` requires explicit `E2E_REAL_BACKEND=1`, an isolated backend at
`http://127.0.0.1:18476`, and the disposable admin/admin test account.
Production-named specs target that same isolated compiled-binary test instance, not a production server.
Native appearance/model/background specs require the default frontend's HTTPS dev
harness on port 18475; use locally generated development certificates.
The exact old-code migration case requires `LEGACY_APPEARANCE_FIXTURE`; this private
fixture is intentionally not included. Never run credential-changing tests on production.

## Doraemon port

The independently selectable `doraemon-dist` theme shares the default frontend's data and server interactions, without inheriting its appearance configuration. Its menu entry is last in `service/singleton/frontend-templates.yaml`.

- Develop: `cd frontend/user && corepack pnpm run dev:doraemon`
- Build: `bash script/build-doraemon.sh` (Node.js 24, Corepack and rsync; uses the pinned pnpm lockfile).
- `script/fetch-frontends.sh` builds this local theme instead of downloading a Monitor archive. `script/build-custom.sh` includes it alongside the existing frontends.
- Implementation, visual source and license: `frontend/user/src/themes/doraemon/README.md`.
- Standalone frontend output is `frontend/user/dist-doraemon`; it and embedded `cmd/dashboard/doraemon-dist` are generated and ignored by Git.


<a id="admin-session-renewal"></a>

## 登录续期与过期提示（v0.0.23）

后台账号登录的有效期由原有配置决定，默认 1 小时。后台或默认／哆啦 A 梦前台页面可见、登录仍有效且网络正常时，每 5 分钟提前续期。后台使用独立定时检查；两套前台共用每 30 秒的身份检查触发续期，浏览前台也能维持共享登录。

- 临时网络错误、服务错误或续期失败后，最早 30 秒再试；单次请求最多等待 10 秒，同时触发的检查共用一次请求。
- 切回页面、恢复联网及从页面缓存返回时立即检查是否需要续期。隐藏或离线时暂停，关闭页面后停止；超过剩余有效期再返回时，需要重新登录。
- 主动退出会清理计时器和正在进行的续期请求。服务端已过期、撤销或拒绝的登录不能通过续期重新激活，重新登录后才恢复自动续期。
- 不延长后台访问密码或 TG 临时凭证的有效期，不改变 CSRF、账号权限或服务器登录校验，也不保存账号密码。
- 后台收到明确登录失效响应后核验当前会话；确认过期则自动进入登录页，显示“登录已过期，请重新登录”，停止旧页面轮询。临时网络／服务错误不当作退出，旧请求不覆盖刚登录的新会话。
- Agent、已有配置和历史数据保持原样。

回归用例：`admin/src/test/session-renewal.test.ts` 覆盖提前续期、三小时连续查看、短暂失败、并发、超时、切回、断网、过期、退出、多标签页及系统时钟回拨；`admin/tests/e2e/admin-session-renewal.spec.ts` 在生产构建的手机／电脑页面使用隔离接口和虚拟时间验证续期、未保存编辑、失败重试与退出。新增 `user/src/test/session-continuity.test.ts`、`admin/src/test/auth-session-expiry.test.tsx` 和 `admin/tests/e2e/shared-session-continuity.spec.ts` 覆盖两套前台、可见前台与隐藏后台共享会话、过期跳转与旧响应竞态。浏览器测试用虚拟时间推进三小时，不代表真实耗时三小时。不得把测试写入线上业务接口。

## Live inventory synchronization (v0.0.21)

Both public themes update server metadata from the authorized WebSocket snapshot.
A complete-note marker distinguishes a cleared note from an unchanged omitted
note. Deleted IDs are pruned and old session-storage notes are ignored. Group
lists revalidate every 10 seconds while visible and on focus. A foreground
connection that receives no valid frame for 15 seconds is retried using the
existing reconnect delay; a retained frame is not evidence of a live connection.

The admin server table revalidates every 5 seconds while visible, on focus and
on reconnect. Rows and selections use server IDs. Refreshing the list keeps open
editors and unsaved input mounted; deleting a row clears its batch selection.
After upgrading, reload each already-open page once to load the new client.
No Agent upgrade, database migration or history-retention change is required.

The portable browser checks use mock APIs and WebSockets, never production
credentials. Serve the final admin build with SPA fallback and the two distinct
public builds, then run from `frontend/admin`:

```sh
E2E_SKIP_WEBSERVER=1 E2E_BASE_URL=http://127.0.0.1:18476 \
NIC_USER_URL=http://127.0.0.1:18477 NIC_DORAEMON_URL=http://127.0.0.1:18478 \
npx playwright test tests/e2e/admin-server-live-sync.spec.ts tests/e2e/frontend-live-sync.spec.ts tests/e2e/server-sort-search.spec.ts --workers=1
```

Coverage includes add/edit/clear/delete/reused IDs, selection and unsaved editor
preservation, group changes, a silent open socket, network recovery, both public
themes, light/dark modes and phone/desktop layouts. Real timers are used for the
admin polling test so its scheduling and request deduplication behave naturally.

## Recovery and preload regressions

The default and Doraemon themes share history, session and connection recovery:

- History query keys include the server, metrics and period. Superseded requests are aborted and late responses cannot replace the selected result. HTTP errors, failed envelopes, invalid JSON and incomplete series are errors, not successful empty or zero-valued charts.
- History requests expose retry controls. Local error boundaries keep unaffected detail regions and tabs usable; a failed lazy view can be retried. If the browser retains a failed module download, use the displayed page-refresh fallback. Network-history retries retain the selected monitor.
- WebSockets clean up obsolete connections and duplicate timers, retry disconnects, and recover on online/focus/pageshow events. Normal reconnection keeps the last received frame, which is not proof of a current live connection. A viewer change clears the previous viewer's frames and reconnects.
- Components share the profile query instead of reading an HttpOnly cookie. Foreground polling, focus and reconnection refresh the session; transient errors retain a known identity, confirmed HTTP 401 resolves to anonymous, and an initial failed lookup stays unknown. This does not change server-side authorization or extend session lifetime.
- Optional local/session storage reads, writes and removals tolerate blocked getters, security errors and quotas. Existing preference keys remain unchanged; persistence across reloads is not guaranteed when storage is unavailable.
- Existing primary/secondary detail preloading, warm-view state, custom tags/colors, label alignment, remaining-value hover and connectivity/latency switching are retained. No Agent, database or history-retention change is required.

After installing the locked dependencies, run from `frontend/user`:

```sh
corepack pnpm exec vitest run src/test/frontend-recovery.test.tsx src/test/websocket-recovery.test.tsx src/test/components/network-chart.test.tsx src/test/primary-detail-preload.test.tsx src/test/secondary-detail-preload.test.tsx
corepack pnpm run typecheck
corepack pnpm test
corepack pnpm run build
corepack pnpm run build:doraemon
```

For the browser checks, serve the built `frontend/user/dist` on
`https://127.0.0.1:18477` and `frontend/user/dist-doraemon` on
`https://127.0.0.1:18478`, with SPA fallback for `/server/7` and local development
certificates. Do not serve the default output at both ports. These specs mock
HTTP APIs and WebSockets; no production credentials or live backend are required.
The preview servers are separate from Playwright's optional admin web server.
From `frontend/admin`, with its locked dependencies and Chromium installed, run:

```sh
E2E_SKIP_WEBSERVER=1 npx playwright test tests/e2e/frontend-recovery.spec.ts tests/e2e/detail-responsiveness.spec.ts --workers=1
```

The recovery spec covers history/monitor failures and retry, blocked browser
storage, module-download failure and refresh, reconnection and expired sessions.
The responsiveness spec covers rapid navigation, cold/warm preloading, existing
custom tab switching and scroll stability. Both themes and phone/desktop widths
are covered; this is Chromium coverage, not a claim of native Safari/iOS testing.
Shut down the local preview servers after testing. Generated distributions,
certificates and test output remain ignored and must not be committed.

Source-only changes belong under `Unreleased` / `未发布` in the root changelog
until a verified dashboard release is published; do not advance component version
files or replace existing release assets merely to update documentation.

## Statistics and sorting regressions

Feature and compatibility notes: [STATISTICS_VIEWS.md](../STATISTICS_VIEWS.md) and
[APPEARANCE.md](../APPEARANCE.md#全站显示设置2026-10-05).

Targeted unit checks from `frontend/user` (after installing its locked dependencies):

```sh
corepack pnpm exec vitest run src/test/components/sort-metric-select.test.tsx src/test/pages/Server.test.tsx
corepack pnpm run typecheck
```

For the native menu browser regressions, first build both `frontend/user` variants
(`build` and `build:doraemon`) and serve their output as local HTTPS previews on
`https://127.0.0.1:5189` (default) and `https://127.0.0.1:5190` (Doraemon).
Use development certificates only; the specs ignore local certificate errors,
mock APIs/WebSockets and do not require production credentials. Then run from
`frontend/admin`:

```sh
E2E_SKIP_WEBSERVER=1 npx playwright test tests/e2e/statistics-views.spec.ts --grep 'sort menu scroll stability|statistics menu scroll stability' --workers=1
```

These tests enable classic Chromium scrollbars to detect page-width changes that
headless overlay scrollbars would conceal. They cover repeated opening/closing,
keyboard selection, outside clicks/scrolling and mobile touch targets. The sort
regressions use per-test screenshot output directories and must leave the page's
scrollbar, body overflow, pointer events and compensation margins unchanged.


## Snapshot timeline scrolling

Snapshot timelines in latency, BGP and return-route views consume wheel input
throughout their region, including the first/last item and a single-item list.
Moving the pointer outside restores normal page scrolling. Browser Ctrl+wheel
zoom and native touch gestures are preserved. Regression checks are in
`src/test/plan-ui.test.tsx`, `network-insight.spec.ts` and
`server-latency.spec.ts` (tests matching `snapshot wheel boundaries`).


## 指标详细查看与在线率

详情图表以同一行绘图区和坐标轴对齐；CPU／GPU 标题区按内容紧凑排布，避免固定大块留白，不增加卡片高度。“详细”位于原有底部留白中央，点击可选择时间范围、定位实际采样点、逐点查看、锁定或放大。手机入口采用 24px 可见按钮和 36px 触摸区域，均位于绘图区之下，卡片高度不变。手机详细页优先展示快捷范围和图表，展开“选择时间范围或定位”后使用精确查询；电脑直接显示表单。手机纵向滑动仍滚动弹窗，点按和横向滑动用于选点。

1／7／30 天指标横轴采用完整滚动时间范围，缺失区间不扩展成有数据。采样聚合粒度不变，打开详细查看时冻结当前快照。实时或最后状态里的“近 1／6／24 小时”会读取已有的 1 天历史，再显示所选完整区间；切换快捷范围复用本次加载数据，30 秒聚合点不伪装成更高精度。选中范围有高亮，失败保留原图并提供重试，空范围明确显示无记录。“恢复全部”恢复本次已加载的完整范围，已是完整范围时禁用；可刷新历史或返回原快照。没有对应小时级历史的指标禁用小时按钮，不用其他指标代替。

点击现有“实时”可选择“实时图表”或“在线率”；离线机器使用“最后状态”入口。选择在线率后，原图表区域直接切换，使用菜单返回实时图表或最后状态，不再打开弹窗。在线率页面展示在线比例、在线／离线累计、最后活跃、每日时间轴及在线／离线时段。访客最多查看 1 天，登录后可查看 7／30 天；默认在线记录保留 30 天，后台 API 或 online_stats_days 配置支持 7—3650 天。此保留策略仅作用于新建的 online_sessions 表，不影响 TSDB 和原有历史。

本次启用前没有在线会话记录，不能还原历史在线率。online_history_coverages 标记每台机器的记录起点，起点以前不作为离线。升级仅新增表，原有 Agent 无需升级。授权的永久删除会清除该节点在线记录；系统 ID 调整会同步迁移；全量换机重置后从新记录起点统计。

实现参考官方前台 nezha-dash-v2 提交 d9d59cc62b53b9658e86b97b024baa69148eabd0 的在线历史组件、算法及测试，以及官方后端 nezha 提交 15fa673c745005d0fef5d6d031fe77351d28bcbb 的在线会话记录。保留原有许可证，并适配本项目的菜单、权限、状态流租约和节点生命周期。

回归入口：user 的 chart-detail、metric-time-window、online-history、server-detail-online-history 单元测试；admin/tests/e2e/chart-detail.spec.ts 和 frontend-recovery.spec.ts 验证两个主题的 320／390／900／1440 像素布局、绘图区对齐、卡片高度、时间范围和菜单。后端 online_history*_test.go 覆盖时区、断线、恢复、失败重试、保留范围、启用前未知时间和 ID 生命周期。

## Per-interface network rate view (v0.0.19 / Agent v1.0.8)

The network card and detail dialog share an administrator-only interface menu. Aggregate view follows the current monitoring selection; viewing one interface does not submit configuration or alter traffic accounting. REST, WebSocket, offline snapshots, and metric queries enforce the same access boundary. Both themes retain mobile and desktop layouts. Missing history remains a gap, idle measurements remain zero, and switching cancels stale history requests. The configuration dialog refreshes inventory every 10 seconds while visible without replacing unsaved edits. Ordinary offline/reconnect/restart preserves saved monitoring configuration. See [network interface selection](../docs/network-interface-selection.md).

## Homepage NIC aggregation (v0.0.20 / Agent v1.0.9)

The independent admin homepage selection supports multiple monitored interfaces. Both themes project card rates and totals without mutating the original state. The detail chart defaults to the saved selection while temporary choices remain local. Guests receive the homepage projection without interface names or a selector. Period responses include a selection key to prevent stale cached totals from appearing after a change.

Regression coverage includes default/single/multiple selections, unavailable data, sum-by-timestamp history, separate configuration saves, permission checks, and both themes at mobile and desktop widths. See [usage and accounting limits](../docs/home-network.md).
