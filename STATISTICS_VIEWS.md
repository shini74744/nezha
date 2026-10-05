# Frontend statistics views

The frontend statistics entry supports separate or combined **cycle traffic usage** and **service uptime**, controlled by the global display setting.
It does not change quota calculations, server-card traffic bars, rate effects, monitoring rules, or authentication.

## Global display control

Administrators configure **统计显示拆分** under **美化设置 → 全站显示**.
Changes save automatically and are independent of the selected appearance theme and its master enable switch.

- ON (default for older configurations): show the two-category menu described below; repeat selection of the active category closes it.
- OFF: the statistics button toggles both categories together, with no category menu. Native themes render both sections in the page; independent themes render both in the shared dialog and hide its category tabs.
- The administrative GET/PATCH endpoint is `/api/v1/setting/display`, with the boolean `statistics_split`. Omitted PATCH fields are preserved. The public setting exposes the value to native themes; independent themes receive it in the injected script's data attribute when the HTML loads. Refresh the page after changing the setting to apply it immediately.
- This switch does not enable or disable server-card traffic bars; those retain their theme-specific controls.
- The adjacent **详细网络拆分** switch controls native detail/network composition, not these statistics cards. Its compatibility mapping and supported themes are documented in [APPEARANCE.md](APPEARANCE.md#全站显示设置2026-10-05).

## Themes

The following category-selection behavior applies when statistics splitting is ON:

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

## Sorting and scrollbar stability

- The default (Official) and Doraemon toolbar sorting menu uses a non-modal DropdownMenu radio group, just like the statistics menu. Opening either menu must not hide the page scrollbar, lock body scrolling, disable outside pointer events or add scrollbar-width compensation.
- Sorting retains the compact light/dark palette, all eleven existing metrics and the separate direction control. Switching back to the default metric restores its original descending order; selecting the already active metric closes the menu without changing the order.
- Click the trigger again, click outside, or press Escape to dismiss. Keyboard navigation and selection are retained; the menu scrolls internally when the viewport is short and coarse-pointer rows remain at least 44px high.
- The native sort trigger uses `data-sort-trigger` for theme styling. It is a button with a menu, not a combobox; accessible options use `menuitemradio`. Doraemon's mobile truncation targets this attribute.
- Independent community themes keep their vendor sorting components. This fix does not alter global Select components or the scroll-lock behavior of unrelated dialogs.

## Source / verification

- Native UI: frontend/user/src/components/{StatisticsMenu,SortMetricSelect,ServiceTracker,CycleTransferStats,ServiceTrackerClient,ServerNetworkSection}.tsx and hooks/use-statistics-view.ts.
- Global display controls: frontend/admin/src/components/global-display-settings.tsx and cmd/dashboard/controller/setting_display.go; the settings endpoint preserves unrelated configuration.
- Third-party adapter: cmd/dashboard/controller/frontend-statistics.js and frontend_statistics.go. The script is Go-embedded, so third-party bundles need not be rebuilt.
- Build frontend/user twice (build and build:doraemon), then synchronize both output directories into cmd/dashboard before building the dashboard binary.
- Vitest covers selection, theme isolation, migration, loading/error/retry, filtering, split/combined rendering and sort metric/direction behavior. `sort-metric-select.test.tsx` verifies non-modal toggling, outside interaction and default-order reset; `Server.test.tsx` checks actual server ordering.
- Playwright statistics-views.spec.ts covers native themes at 320/390/768/1440 px and dark mode, plus combined statistics. The scrollbar regressions explicitly enable classic Chromium scrollbars and compare viewport width, body geometry/styles and scroll position before/after repeated opening; sort cases cover 390/1366 px plus 320/390 px touch and keyboard/outside dismissal. statistics-universal.spec.ts covers all four independent themes in split/combined modes on phone/desktop. server-detail-network.spec.ts covers the global switches and native detail/network composition.
- Go tests cover all six theme HTML responses, local overrides, no admin/404 injection, and frontend-password protection.
