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
