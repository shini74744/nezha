# Owned logo assets

Custom carrier and provider logos are saved under `data/logos`, addressed by SHA-256, and served at `/api/v1/logo/assets/<hash>.<extension>`. Include this directory in persistent volumes and backups alongside the database. Bundled carrier artwork is still shipped with the frontend.

Only authenticated administrators may fetch/store logos. Raw public-note updates import known logo fields after permission checks. External URLs use the SSRF-protected fetcher. Raster inputs are decoded; SVG is restricted to a static, local-reference subset and served with a sandboxed CSP and nosniff.

## Existing installation migration

1. Build `go build -o logo-migrate ./cmd/logo-migrate`.
2. Back up the dashboard binary, configuration, SQLite database and its WAL/SHM files, and existing `data/logos`.
3. Run `./logo-migrate --db /path/data/sqlite.db --dir /path/data/logos` to verify imports. This writes asset files but does not update notes.
4. Stop the dashboard; refresh the database backup. Run the same command with `--apply`, then deploy the new binary and start the dashboard.
5. Verify logo assets return successfully and unrelated note values are unchanged. Do not deploy if any import failed.

The importer preserves unknown JSON fields and exact numeric values, handles English/Chinese logo keys, and updates all changed rows in one transaction with concurrent-edit checks. A failed import leaves database notes unchanged. Unreferenced assets can remain after failed or dry runs.

An explicitly reviewed provider upgrade can use `--provider-id ID --provider-source HTTPS_IMAGE_URL`. This is never automatic; the previous original is retained. Run the same options for the dry run and apply.

For rollback, stop the dashboard and restore the previous public notes/database and compatible binary together. An old binary may not serve the new asset paths. Do not discard the logo directory while current notes reference it.

Website icon lookup favors larger declared icons, compares actual dimensions, and selects the largest usable ICO frame. Original low-resolution artwork cannot become genuinely high resolution. Provider logos are centered, aspect-preserving and not upscaled.
