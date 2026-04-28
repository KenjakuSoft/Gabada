# Changelog

All notable changes to Gabada are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-04-28

### Added
- **Manual Google Drive sync for multi-device editing.** New Settings → Drive Sync section pushes a complete backup bundle (SQLite DB + `sites.toml` + metadata) as a timestamped snapshot to a `Gabada` folder in your Google Drive, and lets you restore any snapshot from another machine signed into the same Google account. Workflow is intentionally **manual** (push when done editing, restore on the next machine before editing) to avoid SQLite/cloud-sync corruption — no live two-way sync, no conflict resolution. Snapshots are pruned to the last 30 automatically.
- **Google Drive sync internals.** `backend/services/drive_sync.py` runs the OAuth 2.0 Installed App flow with a loopback redirect on a random local port (no port collision with the uvicorn server), persists tokens at `data_dir()/drive-tokens.json` (chmod 0600), refreshes the access token automatically, and uses the `drive.file` scope so Gabada can only see files it created. New endpoints under `/api/drive`: `status`, `credentials` (CRUD), `auth/start`, `auth/poll`, `auth/cancel`, `auth/signout`, `snapshots`, `snapshots/push`, `snapshots/restore/{id}`, `snapshots/{id}` (DELETE). The push/restore flow shares the `_TRANSFER_LOCK` with manual import/export so they cannot interleave.
- **Shared backup-bundle module** at `backend/services/backup_bundle.py` consolidating `validate_backup_database`, `backup_sqlite_file`, `create_backup_bundle`, `extract_backup_bundle`, `restore_live_database`, `restore_site_profiles`, and `timestamp_slug`. Used by both `/api/settings` (manual export/import) and `/api/drive` (snapshot push/restore) so the same validation and zip layout governs both paths.

### Fixed
- **Selector Lab now respects user-pinned selectors.** Previously, a price selector pinned via Selector Lab was overwritten by the smart-scan review pass — the user's selection appeared to be ignored, and the preview popped a misleading "Review corrected a suspicious scrape result" banner. `_apply_custom` now returns a per-field `user_locks` set; `_review_result_with_smart_scan` honours those locks (skips price/dealer overrides, surfaces smart-scan as `review_alternative_price` for one-click switching instead of silently replacing). Verified end-to-end against `barclays.lk` and `sense.lk` with `review_status='ok'` across pure-smart, user-pinned, alt-pinned, and bogus-selector scenarios.
- **Dealer-price auto-fill no longer flips `review_status` to `corrected`.** Filling in a missing dealer field with a smart-scan guess was triggering the amber review banner as if something was actually wrong. The "corrected" status now only fires when an *existing* dealer price was replaced. When the user is driving Selector Lab (any lock set) the dealer auto-fill is skipped entirely.
- **Smart-scan focuses on the product card / buy box.** When no static `PRODUCT_ROOT_SELECTORS` match, the in-page scan now walks up from the strongest H1/title to an ancestor that contains both the heading and an add-to-cart control, then scans only inside that buy box. Stops smart-scan from picking up "related products" prices, footer pricing, and other off-card noise. Falls back to `document.body` if the focused scope yields fewer than 2 candidates so unusual templates still scrape.

### Changed
- **`api/settings.py`** trimmed: backup helpers moved to the shared module; settings.py now imports them as private aliases. Behaviour is unchanged.
- **App version** bumped to **0.3.0** (FastAPI `app.version`, Inno Setup `MyAppVersion`) to reflect the substantial new feature surface.
- **Regression coverage** in `backend/tests/test_review_extreme_divergence.py` extended to 8 cases (5 prior + user-locked price authority, user-driven dealer non-emission, user-locked dealer authority).

### Notes
- Drive sync requires the user to create their own **Desktop** OAuth client in the Google Cloud Console and paste the client ID/secret into Settings. Credentials stay on the local machine; tokens are stored alongside Gabada data, never inside the SQLite database.
- This is *not* real-time sync. Two devices editing simultaneously will overwrite each other on the next push. Use restore-before-edit, push-after-edit on each machine.

## [0.2.5] — 2026-04-28

### Fixed
- **Smart-scan no longer corrupts JSON-LD prices on extreme mismatches.** When a site published a structured price (e.g. JSON-LD `Rs 54,000`) and the smart-scan latched onto a stray fragment (e.g. `"Rs 4"` embedded in the product short-description), the review logic adopted the tiny value because its raw-text "signal" looked stronger than JSON-LD's plain `"54000"`. Added an extreme-divergence guardrail in `_review_result_with_smart_scan`: when a structured price is locked and the smart-scan candidate differs by 50× or more without a custom selector, the structured price is kept and a review note explains why. Bug surfaced on `nexxcom.lk` Elgato HD60 S+ listing (Rs 54,000 → Rs 4).

### Added
- **`nexxcom.lk` site profile** in `sites.toml` pinned to the `woocommerce` platform with a `p.price, .price .amount` wait-for. This activates the WooCommerce default selectors (`del .amount` / `ins .amount`) so regular and discounted prices are picked up directly via `del`/`ins` markup instead of relying on the generic smart-scan.
- **Manual price choice when the review is uncertain.** `ScrapeResult` now carries `review_alternative_price` / `_raw` / `_label` whenever the review step picks one candidate over a competing one — both for the new extreme-divergence guardrail (alternative = rejected smart-scan candidate) and for the existing auto-correction path (alternative = original extracted price). The Probe page `ScrapeReviewNotice` renders both candidates as side-by-side buttons; clicking the alternative swaps the displayed price and raw value live. Lets the user override the auto-decision in either direction without leaving Probe.
- **Categories drill-in.** Category tiles on the Categories page are now clickable and navigate to `/?category=<id>` — Home reads the URL param and pre-applies the filter so the user lands on the products inside that category. URL stays in sync with the active filter (sharable / back-button friendly). Empty categories show a disabled state instead of a dead-end click.
- **Regression tests** at `backend/tests/test_review_extreme_divergence.py` covering all five branches (extreme divergence, moderate divergence sale, custom-selector bypass, no structured lock, alternative exposure).

## [0.2.4] — 2026-04-27

### Changed
- **Renamed remaining "dealer session/login" leftovers** to neutral "login session" wording in user-facing strings (`scraper_routes.py` probe note, the authenticated-scrape review note) and internal logs (`engine.py` login window logs). The dealer-price concept on price logs / imports / probe is preserved (it's a real wholesale-pricing concept).
- **README** refreshed: highlights call out Facebook Marketplace and per-store login sessions, the scraping model documents the FB fast path, and version pointers updated.

### Fixed
- **`packaging/output/`** added to `.gitignore` (the unix release script writes there; previously only `packaging/windows/output/` was ignored).

## [0.2.3] — 2026-04-27

### Fixed
- **Facebook Marketplace strikethrough price** — the previous regex used `[^}]` to scan inside the `strikethrough_price` object, but FB's GraphQL response nests sub-objects (e.g. `currency`) so the first inner `}` truncated the match before reaching `"amount"`. Replaced the regex set with a brace-balanced object extractor that handles arbitrary nesting (`_extract_fb_object_ranges`).
- **Listing pulled from recommendation cards** — when a marketplace page hydrates the main listing alongside "More from this seller" cards, the first `listing_price` in script order isn't always the target. New `_fb_select_listing_scope` anchors extraction to the item id parsed from the URL, scoring each candidate object by distance to the id/title.

### Added
- **DOM strikethrough fallback** for FB Marketplace — if JSON extraction misses `strikethrough_price` (FB renames GraphQL fields periodically), Gabada reads the visible line-through element straight from the rendered page.
- **More FB amount field names** — `formatted_amount_zeros_stripped`, `formattedAmountWithoutDecimals`, plus a `formatted_price.text` fallback.
- **`web.facebook.com` host** added to the recognised marketplace hosts.
- **`facebook-marketplace` platform** registered in `site_profiles.py` (`PLATFORM_WAIT_FOR` / `PLATFORM_SELECTORS`); `sites.toml` switched the FB profile to use it. Probe and Selector Lab now surface FB results as labelled candidates.

### Changed
- **Dealer-price suppression on Facebook Marketplace** — FB has no wholesale-pricing concept, so `_clear_dealer_price` now wipes `dealer_price` everywhere on FB scrapes (`scrape()`, `scrape_with_open_page()`, smart scan, common patterns) to remove a class of false positives.

## [0.2.2] — 2026-04-26

### Added
- **Facebook Marketplace scraper** — extracts title, price, discount price (via `strikethrough_price`), and stock status (`is_live` / `is_sold` / `is_pending`) from FB Marketplace listings by parsing the inline GraphQL JSON. Bypasses the generic waterfall when the URL is a `facebook.com/marketplace/…` listing.
- New `["facebook.com"]` profile in `sites.toml` to settle the page before extraction.

### Changed
- **Stores: dropped "dealer" terminology** — the per-store login feature now uses neutral language. DB columns (`dealer_login_url` → `login_url`, `dealer_storage_state_path` → `storage_state_path`, `dealer_session_updated_at` → `session_updated_at`) are renamed in place via `ALTER TABLE RENAME COLUMN` (no data loss). API fields, Pydantic models (`StoreLoginSessionRequest/Response`), the endpoints (`/stores/{id}/login-session`), the helper `_login_target`, and the frontend Stores page (variables, types, HTML ids, badge text) all rename in lockstep. The dealer-price concept on price logs / imports / probe is preserved (it's a real wholesale-pricing concept, not store metadata).

### Fixed
- **macOS build** — PyInstaller's bincache flatten broke the Playwright `Google Chrome for Testing.app` bundle and `codesign` failed with "bundle format unrecognized". The spec now skips the Playwright `datas` entry on Darwin, and `build_release.sh` copies the browser cache into `<bundle>/_internal/ms-playwright/` after PyInstaller finishes — the same path the runtime hook (`app_paths.configure_runtime_environment`) reads.

## [0.2.1] — 2026-04-26

### Changed
- Build script (`packaging/build_release.sh`) runs with `set -x` for trace output.
- Release workflow tees Linux/macOS build output to `packaging/output/build.log` and uploads workflow artifacts even on failure, so build logs survive when PyInstaller errors.

### Note
- v0.2.0's macOS job failed at the PyInstaller step. v0.2.1 keeps the same intent but adds the diagnostics needed to surface the actual error in CI.

## [0.2.0] — 2026-04-26

First multi-platform release. Windows installer + portable bundles for Linux and macOS.

### Added
- **Linux and macOS portable builds** in the release pipeline (`Gabada-vX.Y.Z-linux-x64.tar.gz`, `Gabada-vX.Y.Z-macos-arm64.tar.gz`).
- **Unix launchers** — `start_gabada.sh` and `stop_gabada.sh` for Linux/macOS.
- **Cross-platform PyInstaller spec** at [`packaging/gabada.spec`](./packaging/gabada.spec) replacing the Windows-only spec.
- **Linux/macOS build script** at [`packaging/build_release.sh`](./packaging/build_release.sh).
- **Unified release workflow** ([`.github/workflows/release.yml`](./.github/workflows/release.yml)) — builds Windows / Linux / macOS in parallel and attaches all artifacts to the GitHub Release.
- **Tag-push trigger** — pushing a `v*` tag now creates a release automatically.

### Changed
- README restyled with icon-keyed sections, badge row, and richer tables.
- Quick Start now uses `py -3` instead of pinning `py -3.11` (any installed Python ≥3.11 works).
- Documented `Start Gabada.vbs` (silent launcher) and `Stop Gabada.bat`.
- Documented environment variables: `GABADA_DATA_DIR`, `GABADA_NO_BROWSER`, `PLAYWRIGHT_BROWSERS_PATH`.

### Fixed
- Removed unused `os` import and dead `global` declarations in `backend/scraper/engine.py` (lint cleanup).
- Deleted unused `frontend-web/src/components/products/ProductCard.tsx` and `frontend-web/src/components/ui/card.tsx` (knip cleanup).

### Removed
- `.github/workflows/windows-release.yml` — superseded by `release.yml`.
- `packaging/windows/gabada.spec` — superseded by `packaging/gabada.spec`.

## [0.1.4] — 2026-04-23

### Changed
- Polished the importer, diagnostics, and desktop UX.
- Made the file import workflow easier to review.

## [0.1.3] — 2026-04-23

### Added
- Scheduled WooCommerce catalog sync — auto-add new products from a connected store.
- Portable backup / restore workflow — `Settings → Backup, restore, and share`.
- Improvements to imports, the activity feed, and documentation.

## [0.1.2] — 2026-04-23

### Added
- Full WooCommerce catalog fetching during import (no longer capped at the first page).

### Fixed
- Smart price review hardened against title-noise false positives.

## [0.1.1] — 2026-04-21

### Changed
- Hardened scraper detection and cleaned repo docs.

### Added
- Scraper review warnings and auto-correction for suspicious price/stock matches.

## [0.1.0] — 2026-04-21

First tagged Windows release line.

### Added
- Windows release automation via GitHub Actions.
- Windows desktop packaging — PyInstaller bundle + Inno Setup installer.
- Bento-driven interactive UI overhaul across all pages.
- `sites.toml` site-profile registry editable from the app.
- Full ISO 4217 currency list in settings.
- Bot-check bypass, preorder/backorder support, reverse-price fix, and edit UI.
- "Add another store" flow on the product detail page.
- React-based frontend (`frontend-web`) replacing the Flutter prototype.
- Settings form, probe debugger, and static frontend mount.
- Add-product flow, store CRUD, and import (WooCommerce + file).
- Torrent-style home and product detail pages with price chart and logs.
- Selector-aware deterministic smart scan, dealer price detection, probe + login-session endpoints.
- User-configurable currency, timezone, and scrape schedule.
- Auto-detection of platform when adding a store URL.
- Manual override bottom sheet on each store row (price, stock, note).
- Dealer price support, EMI/installment filtering, manual overrides, and bulk WooCommerce / file import.
- Activity feed, categories, LKR currency support.
- Initial scaffold of the price and stock tracker.

[0.2.5]: https://github.com/Xx-LiDAF-xX/Gabada/releases/tag/v0.2.5
[0.2.4]: https://github.com/Xx-LiDAF-xX/Gabada/releases/tag/v0.2.4
[0.2.3]: https://github.com/Xx-LiDAF-xX/Gabada/releases/tag/v0.2.3
[0.2.2]: https://github.com/Xx-LiDAF-xX/Gabada/releases/tag/v0.2.2
[0.2.1]: https://github.com/Xx-LiDAF-xX/Gabada/releases/tag/v0.2.1
[0.2.0]: https://github.com/Xx-LiDAF-xX/Gabada/releases/tag/v0.2.0
[0.1.4]: https://github.com/Xx-LiDAF-xX/Gabada/releases/tag/v0.1.4
[0.1.3]: https://github.com/Xx-LiDAF-xX/Gabada/releases/tag/v0.1.3
[0.1.2]: https://github.com/Xx-LiDAF-xX/Gabada/releases/tag/v0.1.2
[0.1.1]: https://github.com/Xx-LiDAF-xX/Gabada/releases/tag/v0.1.1
[0.1.0]: https://github.com/Xx-LiDAF-xX/Gabada/releases/tag/v0.1.0
