# Codex Handoff for Claude

**Date:** 2026-05-31  
**Primary implementation commit:** `30eb345 Harden PT tracker sync and reports`  
**Follow-up note/audit commit:** this file was added after `30eb345` to explain the work and to tighten one data audit guard.

This note is for the next Claude session that opens `~/Git/pt-tracker`. Read `AGENTS.md` first for current repo conventions, then use this handoff as the narrative version of what Codex changed and why.

## Executive Summary

Codex implemented the remaining architecture and potential-issue work that had been captured in `CODEX_REMAINING_ISSUES_AND_ARCHITECTURE_GAPS.md`.

The main goal was to turn the tracker from "works as a static page with some high-trust shortcuts" into a cleaner four-layer system:

1. The vault remains source of truth.
2. The repo contains generated JSON snapshots plus a generated manifest.
3. The web app reads same-origin static JSON from GitHub Pages.
4. The Worker performs authenticated writes to `data/pending.json` without giving the browser the PAT.

That last point matters. Before this work, the browser could receive and use the decrypted GitHub PAT. After this work, the browser only knows whether a PAT exists; writes go through `POST /pending/append` on the Worker.

## What Changed

### 1. Generated manifest for static data discovery

Added:

- `scripts/generate_manifest.py`
- `data/manifest.json`

Updated:

- `scripts/sync.py`
- `index.html`
- `reports.html`
- `README.md`
- `CLAUDE.md`
- `AGENTS.md`
- `docs/COWORK_SYNC_TASK.md`

Why:

GitHub Pages can serve known static files, but it cannot list directories. The app and reports previously used GitHub Contents API directory listings for logs/routines/recovery/exercises. That mixed static reads with GitHub API reads and made the browser more dependent on GitHub credentials/network behavior than necessary.

Now sync regenerates `data/manifest.json`, and the app/report page use that manifest to fetch same-origin JSON files from `data/`. The manifest currently records routines, logs, recovery logs, exercises, and `latest_routine_id`.

Important behavior:

- Normal browser/report loads should not call GitHub Contents API for directory listings.
- The Worker still uses GitHub Contents API server-side when appending pending entries.
- If a future data directory becomes part of the app's dynamic discovery surface, add it to the manifest generator and sync step.

### 2. Routine `end_date` derivation

Updated:

- `scripts/parse_routine.py`
- `scripts/sync.py`
- routine JSON snapshots under `data/routines/`
- tests in `tests/test_manifest_and_audits.py`

Why:

Routine JSONs had `end_date: null`, so old routines could remain open-ended in generated data even after later routines existed. That makes routine selection ambiguous and makes historical/current behavior harder to reason about.

Implementation:

- `parse_routine.derive_end_dates()` fills each missing `end_date` as the day before the next routine's `start_date`.
- Explicit `end_date` frontmatter is preserved.
- The newest routine remains open-ended.
- Batch parsing and daily sync both apply this derivation before writing routine JSON.

Current expected windows:

- `2026-W18-CDMX-Phase-1-Closeout`: `2026-05-04` to `2026-05-10`
- `2026-W20-Phase-2-Launch-Reentry`: `2026-05-11` to `2026-05-17`
- `2026-W21-Phase-2-Week-2-Progression`: `2026-05-18` to `2026-05-24`
- `2026-W22-Phase-2-Week-3-Reentry`: `2026-05-25` to open

Follow-up guard:

After the main commit, Codex noticed W20 still had a null `end_date` in generated data. That was corrected, and `scripts/audit_data.py` was tightened so any non-latest dated routine with a missing or overlapping `end_date` fails the data audit.

### 3. Data-integrity audit

Added:

- `scripts/audit_data.py`

Covered invariants:

- JSON parseability for routines/logs/recovery/exercises.
- File basename matches JSON `id` when `id` exists.
- Every exercise referenced by routines/logs has `data/exercises/<id>.json`.
- Exercise `image_url` and `video_url` are non-empty when present in schema.
- Exercise media entries include `image_source` and `image_match`.
- Cooldown moves have non-empty `image_url`.
- Non-latest dated routines have a closed `end_date` before the next routine starts.

Why:

The repo had important conventions written in docs, but not all of them were executable. The audit gives Claude/Codex a single command that catches the common data breakages before a commit.

Command:

```bash
python3 scripts/audit_data.py .
```

### 4. Documentation drift audit

Added:

- `scripts/audit_docs.py`
- `docs/DOC_OWNERSHIP.md`

Why:

This project has several duplicated operational explainers: `README.md`, `CLAUDE.md`, `AGENTS.md`, and Cowork sync docs. Prior discrepancies came from stale statements living in one doc after another doc had been fixed. The doc audit is intentionally small and regex-based; it catches known stale phrases rather than trying to be a general documentation linter.

The ownership doc explains which file owns which kind of truth, so future agents have a better rule for where to update facts instead of copying everything everywhere.

Command:

```bash
python3 scripts/audit_docs.py .
```

### 5. Browser writes moved behind Worker append endpoint

Updated:

- `worker/src/index.ts`
- `worker/README.md`
- `index.html`
- `js/app-context.js`
- E2E helpers/tests

Added:

- `worker/test/pending.test.ts`

Why:

The old model let the browser retrieve a decrypted PAT and perform GitHub Contents API writes directly. That worked, but it meant the browser became a high-trust environment. For an iPhone PWA and eventual native app, the better boundary is: browser/session proves identity, Worker holds secrets, Worker writes.

New behavior:

- `GET /pat` returns `{has_pat: true|false}` only.
- `PUT /pat` still validates and stores an encrypted PAT server-side.
- `POST /pending/append` authenticates the session, decrypts the PAT server-side, reads `data/pending.json`, dedupes the slot, writes the file back through GitHub Contents API, and retries once on SHA conflict.
- The browser calls only `POST /pending/append` for `log`, `skip`, `recovery`, and `routine_edit` entries.
- The browser keeps a local `state.pendingEntries` overlay so a just-submitted workout/recovery can show immediately without waiting for GitHub Pages cache/sync.

Dedupe behavior preserved:

- Workout `log` and `skip`: `(date, day_of_week, type)`
- Recovery: `(date, location)`
- Routine edit: `(routine_id, day_of_week, exercise_id)`

Rollout compatibility:

- `fetchPatStatus()` accepts the old `{pat}` response shape during rollout but does not store or use the PAT.

### 6. Reports upgraded from v1

Updated:

- `reports.html`

Added:

- `js/reports.js`
- `js/reports.test.js`

Why:

Reports were useful but thin. The original remaining-issues brief called out recovery, heatmap/calendar, drilldown, richer PRs, and XSS hardening. Codex implemented those without turning the report page into a full app rewrite.

New report behavior:

- Uses `data/manifest.json` instead of GitHub Contents listings.
- Loads exercise names for friendlier PR/drilldown rows.
- Shows weekly recovery sauna/plunge minutes.
- Shows a training calendar with logged workout days and recovery outlines.
- Adds week drilldown for logged workouts and recovery sessions.
- Shows richer personal records from `analytics.personal_records`.
- Adds summary/coaching cards for latest-week compliance, recovery sessions, and PR signals.
- Escapes dynamic HTML through helpers in `js/reports.js`.

Test coverage:

- `js/reports.test.js` checks dynamic PR row escaping and calendar cell generation.

### 7. iPhone architecture documented

Added:

- `docs/IOS_APP_ARCHITECTURE.md`

Why:

Jonathan asked about making this a real iPhone app. The system was not quite ready to describe cleanly until browser reads and writes had clear boundaries. With manifest reads and Worker writes in place, the architecture doc recommends a staged path:

1. Keep PWA as baseline.
2. Use Capacitor as the first native shell.
3. Keep vault/repo/sync/Worker contracts intact.
4. Add native features only where they create real value: secure storage, background sync signals, notifications, HealthKit later if desired.

No native iOS project was generated in this pass. The doc is intentionally architecture-first so Jonathan can decide when to start actual app scaffolding.

### 8. Tests and E2E updates

Added/updated:

- `tests/test_manifest_and_audits.py`
- `js/reports.test.js`
- `worker/test/pending.test.ts`
- `worker/test/pat.test.ts`
- `e2e/helpers.js`
- `e2e/*.spec.js`

Why:

The remaining issues were not just implementation gaps; several were "we need automated proof this does not regress." Coverage now includes manifest generation, routine end-date derivation, data/doc audits, report escaping/calendar helpers, Worker append/dedupe/retry/auth behavior, and updated browser flows that use the Worker append endpoint.

One E2E nuance:

The skip test now uses `2026-05-25`, a W22 date, because older routine windows are correctly historical/read-only after end-date derivation.

## Commands Run Before `30eb345`

Fresh validation before the implementation commit:

```bash
python3 -m pytest
npm test
(cd worker && npm test)
python3 scripts/audit_data.py .
python3 scripts/audit_docs.py .
npx playwright test
```

Results at that time:

- Python tests: `37 passed`
- Root Vitest: `27 passed`
- Worker Vitest: `14 passed`
- Playwright: `8 passed`
- Data audit: passed
- Doc audit: passed

Codex also smoke-tested `reports.html` in the in-app browser:

- charts mounted
- calendar cells rendered
- PR rows rendered
- coaching cards rendered
- no report-load error

## Current Validation Commands for Claude

Use these before any follow-up commit:

```bash
python3 -m pytest
npm test
(cd worker && npm test)
python3 scripts/audit_data.py .
python3 scripts/audit_docs.py .
npx playwright test
```

For a docs-only change, at minimum run:

```bash
python3 scripts/audit_docs.py .
```

For a generated-data or parser/sync change, at minimum run:

```bash
python3 -m pytest tests/test_manifest_and_audits.py -q
python3 scripts/audit_data.py .
```

## Things Claude Should Preserve

- Do not return decrypted PATs to the browser.
- Do not reintroduce GitHub Contents directory listings into `index.html` or `reports.html` for normal data discovery.
- Keep `data/manifest.json` generated by sync, not hand-maintained long-term.
- Keep vault markdown as the source of truth for routines/logs/recovery.
- Keep routine JSON `end_date` derivation in parser/sync; latest routine is the only open-ended routine.
- Keep data/doc audits lightweight and explicit. They are guardrails, not a schema framework.
- If adding a new pending entry type, update Worker validation, browser append behavior, `sync.py`, docs, and tests together.

## Known Residuals / Not Done

- No GitHub Actions workflow was added. The audit commands are committed and ready to wire into CI later.
- No native iOS project was scaffolded. `docs/IOS_APP_ARCHITECTURE.md` defines the recommended path.
- The report page is still a static HTML report, not a full dashboard app. It is more complete now, but intentionally not a separate frontend build system.
- The browser retains backward-compatible handling for an old Worker `{pat}` response during rollout; remove that only after the deployed Worker is confirmed updated.

## Suggested Next Claude Moves

1. If asked to deploy, deploy the Worker first so `POST /pending/append` exists before the app depends on it.
2. Push GitHub Pages changes after confirming the Worker deployment.
3. Consider adding GitHub Actions for:
   - `python3 -m pytest`
   - `npm test`
   - `(cd worker && npm test)`
   - `python3 scripts/audit_data.py .`
   - `python3 scripts/audit_docs.py .`
4. When Jonathan is ready for the iPhone app, start with the Capacitor path in `docs/IOS_APP_ARCHITECTURE.md`.
