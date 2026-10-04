# Frontend statistics views

The frontend statistics entry separates **cycle traffic usage** from **service uptime**.
It does not change quota calculations, server-card traffic bars, rate effects, monitoring rules, or authentication.

## Themes

- Official and Doraemon: the existing chart button opens an accessible two-choice radio menu. Only the chosen category is mounted. Selecting the active category again closes it; selecting the other switches categories. The panel close button remains available.
- Nazhua, Aobobo, Nezha-Pixel and Nezha-ASCII: these are independent upstream bundles, not skins of the Official frontend. The server injects a compact, bottom-left statistics launcher into their HTML. Its menu opens one selected category in a responsive dialog, with an optional category switch inside.
- The third-party launcher uses Shadow DOM to isolate CSS. It does not patch minified vendor bundles or replace their existing navigation.
- Admin pages, password prompts and 404 responses never receive the launcher. The script also remains behind the frontend-password check. New non-admin *-dist themes use the same fallback.
- Official/Doraemon preferences use the existing per-theme storage prefix. Saved legacy open state migrates to one available category. An explicit close overrides the old force-show flag.
- Third-party dialogs do not reopen automatically on refresh. The last selected category is remembered under the theme's own storage key.

## Data and layout

- Both categories read the existing, authorization-filtered /api/v1/service response. No new privileged data endpoint is introduced.
- Official/Doraemon traffic follows the current server filter. Third-party dialogs show the API's visible server set; independent vendor group filters are not inspected.
- Empty/error/loading states are category-specific. The third-party script polls only while the dialog is open and the document visible; closing aborts outstanding requests.
- Statistics menus mirror the compact sort menu: content-sized width, two text-only choices, no title/icon column, and a highlighted selected row. There is no close menu item; repeat selection toggles the category off. Third-party dialog tabs follow the same toggle behavior. Desktop rows are 32px; coarse pointers retain 44px touch targets. Native themes reuse the sort menu's light/dark palette, and third-party launchers use matching scoped styling.
- Phone menus fit the viewport, long names wrap, dates wrap independently, and uptime details can be opened by touching a day.
- Desktop grids use multiple columns; mobile cards use one column. Closing restores focus to the entry.

## Source / verification

- Native UI: frontend/user/src/components/{StatisticsMenu,ServiceTracker,CycleTransferStats,ServiceTrackerClient}.tsx and hooks/use-statistics-view.ts.
- Third-party adapter: cmd/dashboard/controller/frontend-statistics.js and frontend_statistics.go. The script is Go-embedded, so third-party bundles need not be rebuilt.
- Build frontend/user twice (build and build:doraemon), then synchronize both output directories into cmd/dashboard before building the dashboard binary.
- Vitest covers selection, theme isolation, migration, loading/error/retry, filtering and mutual exclusion.
- Playwright statistics-views.spec.ts covers the native themes at 320/390/768/1440 px and dark mode. statistics-universal.spec.ts covers all four independent themes on phone/desktop, tap, empty/error/retry, focus and close behavior.
- Go tests cover all six theme HTML responses, local overrides, no admin/404 injection, and frontend-password protection.
