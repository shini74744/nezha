# Website and custom logos

Server editor supports overrides for every operator, including the three built-in Chinese carriers, and a separate provider logo above the server name. Clearing an override restores the bundled logo. Provider logos fit an 80 by 28 CSS-pixel box; carrier logos fit 16 by 12, with object-fit contain. Failed provider images are hidden; built-in carrier overrides fall back to the bundled mark.

## Automatic favicon acquisition

Enter a public website (a bare hostname is accepted) and click 自动. The authenticated, CSRF-protected administrator-only POST /api/v1/logo/fetch endpoint reads HTML icon links, root favicon.ico and apple-touch-icon.png. If the origin cannot supply a supported image, it tries Google and DuckDuckGo favicon caches. Only the public hostname is sent to caches, never the original path, query, credentials or dashboard cookies. These external caches are best effort and may be stale or unavailable. Images are embedded in the saved public note, not hotlinked to a cache at render time.

The endpoint only accepts HTTP/HTTPS on default web ports. Every connection resolves and validates all DNS answers, pins the approved address, disables environment proxies and checks redirects. Private, loopback, link-local, shared, multicast and reserved IP ranges are rejected. There is a 30-second overall deadline, bounded redirects, three concurrent requests, a 4 KiB JSON input cap and a 2 MiB per-remote-response cap. These retrieval safety limits do not impose a file-byte limit on user uploads. The browser decodes raster/ICO results; untrusted SVG is not accepted, and falls back to another favicon source.

## Transparency and raw-note compatibility

PNG/JPEG/WebP/GIF uploads have no application byte-size limit. Browser memory still limits extremely large files. Processing uses at most 1024 pixels on the long edge, preserves aspect ratio, crops transparent margins and produces a static PNG. It only removes an almost uniform white/black border connected to the image exterior; enclosed white artwork and images with existing alpha are preserved. Complex backgrounds are not guaranteed to be removable. Restore original retains the source (including GIF animation). Direct HTTPS image links can also be used without processing.

New public-note fields: planDataMod.providerLogo (厂商图标), networkRouteLogos (运营商图标), and per-entry logo/logoOriginal/logoWebsite (Logo地址/原始Logo/网站地址). Both raw and custom-field editors round-trip these fields and keep unrelated properties. All saved addresses and logo data are public; do not enter tokens or private information.
