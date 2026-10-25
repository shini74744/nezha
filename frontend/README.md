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
