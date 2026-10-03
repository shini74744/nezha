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
