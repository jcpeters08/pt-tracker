# CLAUDE.md — PT Tracker

If you're a new Claude session opening this repo, read this first.

## What this is

Personal workout tracker. Static web app on GitHub Pages, JSON in this repo, Obsidian vault as source of truth, daily sync script closes the loop. PWA on iPhone home screen is the primary input device.

Live app: https://jcpeters08.github.io/pt-tracker/ · Reports: https://jcpeters08.github.io/pt-tracker/reports.html

## 4-layer architecture

```
Vault (source of truth)             Repo (data + viewer)            Live web app        Auth Worker
────────────────────────            ─────────────────────           ───────────────     ─────────────────
Weekly Plans/*.md           ──→     data/routines/*.json     ──→    index.html     ──→  pt-tracker-auth
Workout Log/*.md            ←─→     data/logs/*.json         ←─→    reports.html
Recovery Log/*.md           ←─→     data/recovery_logs/*.json
Overview.md                 ──→     data/profile.json
Log.md                      ←──     (appended by sync)
Recovery Log.md             ←──     (appended by sync)
                                    data/pending.json        ←──    (Worker appends)
                                    data/manifest.json       ←──    (sync recomputes)
                                    data/analytics.json      ←──    (sync recomputes)
```

The web app reads `data/manifest.json` plus same-origin JSON snapshots. It appends to `data/pending.json` through the auth Worker's `POST /pending/append`; the Worker holds the encrypted PAT and performs GitHub Contents writes. The daily scheduled task at 8:03 CT drains pending → vault MD, re-derives JSON from MD, recomputes analytics + manifest, commits + pushes.

See `README.md` for deploy and how-to-log details.

## Frontend module layout

`index.html` is the orchestrator (boot, sign-in, `renderApp`, submit handlers, draft I/O, the document-level target-editor handler). Everything reusable lives in ES modules under `js/`, imported at the top of the inline `<script type="module">`. The split took `index.html` from ~2780 → ~2060 lines.

Two interop patterns, by module type:

- **Pure-logic modules use real DI** — they take arguments and return values, touch no globals: `util`, `storage`, `payloads`, `routines`, `pending`. Trivially unit-testable.
- **Render modules share `state` + `hooks`** via `app-context.js`. `state` is the single mutable app-state object — every importer shares the same reference, so in-place mutation propagates (this deliberately relaxes pure DI for the render layer, which reads/writes state on nearly every line). `hooks` is a registry `index.html` fills at boot — `Object.assign(hooks, { renderApp, markWorkoutDirty, saveWorkoutDraft, getRoutineMode })` — so render modules can call back into index **without** a circular import.

| Module | Owns | Key exports |
|---|---|---|
| `app-context.js` | shared `state` singleton, `hooks` registry, day constants | `state`, `hooks`, `DAYS`, `DAY_LABELS`, `todayKey`, `CD_CHOICE_KEY` |
| `util.js` | pure helpers (kg↔lbs, rounding, formatting, escaping, dates) | `kgToLbs`, `lbsToKg`, `roundTo`, `fmtNum`, `escapeHtml`, `isoNow`, `localDateIso`, `dayTypeKey` |
| `storage.js` | dupe-submit guard + draft GC | `payloadSignature`, `gcOldDrafts` |
| `payloads.js` | pending-entry builders | `buildSessionPayload`, `buildSkipPayload`, `buildRecoveryPayload` |
| `routines.js` | date → active-routine selection | `selectRoutineForDate` |
| `pending.js` | pre-dedupe append (the slot-replace logic) | `mergePending` |
| `ui.js` | toasts + modal open/close (howto, video, lightbox) | `toast`, `shortDate`, `openHowto`/`closeHowto`, `openVideo`/`closeVideo`, `openLightbox`/`closeLightbox` |
| `reports.js` | reports-page pure helpers | `escapeHtml`, `personalRecordRowsHtml`, `calendarCells`, `weekRangeFromIso` |
| `recovery.js` | recovery-panel renderers (take `state` + an `onDirty` callback) | `ensureRecoveryRounds`, `renderRecoverySummary`, `renderRecoveryRounds` |
| `workout.js` | workout day-view renderers (day toggle, exercise cards, cool-down) | `renderDayToggle`, `renderExercises`, `renderCooldown`, `renderExerciseCard`, `ensureLogState`, `dayLabel`, `cooldownStateKey` |

**No `innerHTML` in render modules** — a PreToolUse hook blocks it, and it's the right call for user data anyway. Build DOM imperatively: `workout.js` uses a small `el(tag, props, ...kids)` helper; `ui.js`/`recovery.js` use `createElement` + `replaceChildren`/`textContent`. User data (exercise names, notes, cool-down moves) flows through `textContent`/`dataset`, never string interpolation.

Tests: unit specs are co-located (`js/*.test.js`, run via `npm test` → vitest); browser flows live in `e2e/*.spec.js` (`npx playwright test`). The auth Worker has its own vitest suite under `worker/`.

## Critical conventions — DON'T BREAK

1. **Storage canonical = kg. Display = lbs (user preference, kg toggle available).** Every `weight_kg` field is the truth. lbs is derived at render time. Don't refactor to lbs-canonical — analytics, parsers, and sync all depend on kg.

2. **Vault MD is source of truth.** `scripts/sync.py` re-derives `data/routines/*.json`, `data/logs/*.json`, `data/recovery_logs/*.json` from vault MD every morning. Editing a JSON in the repo without also updating the corresponding vault MD gets reverted on the next sync. To make a routine change permanent, edit the Weekly Plan MD via the Cowork pattern (below).

3. **Routine MDs use a fixed day-header format**: `## Mon 5/4 — Push (Chest / Shoulders / Triceps)` — day name (short or long), date `M/D`, em-dash separator, label. Parsed by `scripts/parse_routine.py`.

4. **Routine MDs support optional `**Warm-up:**` and `**Cool-down:**` lines** per day. When `Cool-down` is absent, the app falls back to the curated library in `data/cooldowns.json` keyed by muscle group.

5. **Pre-dedupe on append**: appends go through the Worker's `POST /pending/append`, which removes any existing pending entry for the same slot before pushing a new one. The web app mirrors the same `mergePending()` logic locally so the just-submitted entry appears immediately. Workouts dedupe by `(date, day_of_week, type)`; recovery by `(date, location)`; routine_edit by `(routine_id, day_of_week, exercise_id)`.

6. **localStorage drafts auto-save** on every Done click, weight input, rep edit, exercise note, session note, cooldown completion, and recovery round change. Keyed by `pt_tracker_draft_v2:<routine_id>|<date>|<day>|<type>` (workout; legacy `v1` keys are swept on boot) or `pt_tracker_recovery_draft_v1:<date>` (recovery). Cleared on successful submit. GC'd at 5 days.

7. **Identical-payload re-submission is refused.** Each submitter compares the current payload's signature against the last successful submission; identical payloads get a toast ("Already submitted — change something to log again") instead of silently writing a duplicate.

8. **Every exercise referenced in `data/routines/` or `data/logs/` must have a corresponding `data/exercises/<id>.json` file with a non-null `image_url`.** Two failure modes to guard against:
   - **Missing file**: an `exercise_id` appears in a routine or log JSON but no file at `data/exercises/<that-id>.json` exists. The app has no metadata to show — no thumbnail, no instructions, no video link.
   - **File exists, null image_url**: a file is present but `image_url` is `null` or empty. The app falls through to a placeholder.

   Both are violations of this rule. When introducing a new exercise (whether through a routine update, a logged workout, or any other path), create the matching `data/exercises/<id>.json` in the same commit, fully populated.

   The only way to leave `image_url` null is:
   1. Explicitly search at least the canonical source (`yuhonas/free-exercise-db`) — direct URL probes for likely folder names AND a folder-listing keyword search.
   2. Explicitly search at least one fallback (Wikimedia Commons, Wikipedia article for the exercise, or another stable public-domain / CC source).
   3. Document the searches in the exercise file's `image_match` field (what was tried, what 404'd, what was inappropriate).
   4. Obtain explicit user permission to leave it null.

   Without all four steps, `image_url: null` is not allowed. When committing a new or updated exercise file, also populate `image_source` (license + attribution) and `image_match` (the source folder name or alternative title used). Prefer SVG when only Wikimedia thumb sizes are unavailable — browsers render SVG natively.

   To audit the whole repo for these failures, run `python3 scripts/audit_data.py .`.

## Glossary

- **W18 / W20** — ISO week number prefix on routine ids (e.g. `2026-W18-CDMX-Phase-1-Closeout`, `2026-W20-Phase-2-Launch-Reentry`)
- **Phase 1** — Mexico City era (CDMX), dumbbell-focused, with personal trainer. Capped 2026-05-10.
- **Phase 2** — Minneapolis Planet Fitness, solo, barbell-capable. Active.
- **PF** — Planet Fitness (Minneapolis). DBs in 5-lb increments (5/10/.../80 lb), real barbell with 2.5/5/10/25/35/45-lb plates, cable stacks usually 5-lb increments. **No 22-lb dumbbells exist** — round to nearest 5-lb when picking defaults.
- **CDMX** — Ciudad de México; the user lived there during Phase 1
- **Embrace North** — sauna + cold plunge studio in Minneapolis. Typical pattern: 2–3 rounds, 15 min sauna + 3–5 min plunge per round
- **Thermocycling** — sauna + cold-plunge contrast therapy
- **"Hold X ceiling"** — routine note meaning "don't push past prior limit this week"
- **"Hold 5/1 PR"** — held the personal record set on May 1 specifically; don't push past it

## Schema highlights

- **Pending entry types**: `log` (workout), `skip` (didn't do the workout), `recovery` (sauna/plunge), `routine_edit` (in-app target tweak — rewrites a cell in the Weekly Plan MD on next sync)
- **Recovery has `rounds_detail`** — array of `{round, sauna_min, plunge_min}`. Summary fields (`rounds`, `sauna_min`, `plunge_min`, `total_min`) are derived from it. Backward-compatible with old uniform-round entries.
- **Workout logs have an optional `cooldown` field**: `{type: "library"|"fitnessplus", source_key, fitnessplus_name, completed_at}` — populated when user clicks "Mark cool-down complete" in the app. Renders as a `## Cool-down` section in vault MD.
- **Weight rendering in vault MD**: `_format_weight` in `sync.py` outputs `"<lbs> lbs (<kg> kg)"` (lbs primary, integer-rounded). Routine MDs use the same format.
- **`routine_edit` entry shape**: `{type: "routine_edit", routine_id, day_of_week, exercise_id, changes: {target_weight_kg?, target_weight_raw?, target_reps?, target_sets?}, created_at}`. `changes` is partial — only edited fields are present. `target_weight_raw` is included whenever `target_weight_kg` changes (web app pre-formats the lbs/kg string and preserves any `ea` suffix from the prior raw value).
- **`data/manifest.json`** lists local snapshot IDs for `routines`, `logs`, `recovery_logs`, and `exercises`, plus `latest_routine_id`. Browser reads should use the manifest and same-origin JSON files; do not add GitHub Contents directory listings for normal app/report loads.

## Operational pointers

- **Daily sync**: Cowork scheduled task `pt-tracker-daily-sync`. Cron `3 8 * * *` (8:03 CT local). The task's authoritative spec is `docs/COWORK_SYNC_TASK.md` (this repo, version-controlled) — Cowork's UI holds only a thin wrapper that pulls latest and reads that file. See `docs/COWORK_WRAPPER_PROMPT.md` for the paste-once wrapper text. Pre-conditions: Mac on, vault mounted, repo on `main`.
- **Auth Worker**: `worker/` directory. Live at `https://pt-tracker-auth.ositodelnorte.workers.dev`. Cloudflare KV stores encrypted PAT keyed by email. The Worker never returns the decrypted PAT; browser writes use `POST /pending/append`. Allowlist: `jcpeters08@gmail.com`.
- **Vault path**: `~/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer/`
- **Vault MD edits via Cowork**: direct filesystem access to the vault is sandboxed from a Claude Code session in this repo. Use a separate Cowork session (which has full vault access) for MD updates. Pattern:
  1. Specify the exact file path
  2. List the precise edits to make (use `Edit`, not `Write`, to preserve hand-edits)
  3. Provide a verification command (parser invocation)
  4. Tell Cowork "Do NOT commit. The 8:03 sync will pick it up."

## Known quirks / gotchas

- **`~/Documents/` is iCloud Drive–synced on this Mac** (firmlinked to `~/Library/Mobile Documents/com~apple~CloudDocs/Documents/` via macOS's "Desktop & Documents Folders" feature). The vault lives inside it, so iCloud can evict file content and leave `.icloud` placeholder files that look like real files to `ls` but can't actually be read. The Cowork wrapper has a materialization step (`brctl download` with `open` fallback) before running sync, but ad-hoc scripts that touch the vault should also account for this. Detection: if `ls ~/Documents/Jonathan\'s\ Vault/` shows files starting with `.` and ending in `.icloud`, the content isn't local.
- **Volume-summary prefix match** in `pt_common.is_volume_summary_row` requires a separator after the prefix word (`:`, `—`, `–`, `-`, or exact match) — so "Back Squat", "Back Extension", "Chest Press" resolve as exercises, while "Back: 12 sets", bare "Back", "Chest — 24 sets" still filter as volume summaries. Earlier behavior matched any `startswith` and silently dropped real exercise rows whose names started with a muscle-group word.
- **`data/cooldowns.json` cooldown moves all have a populated `image_url`** (30 moves, sourced from `yuhonas/free-exercise-db` + Wikimedia Commons). If a future move is added with a null `image_url`, the cooldown card falls back to a 🧘 emoji placeholder.
- **PF doesn't have 22-lb dumbbells.** When picking default weights, use real PF increments (5/10/15/20/25/30/35/40/45/50/55/60/65/70/75/80 lb DBs). Straight kg→lb conversion gives nonsense values.
- **Routine JSON edits without matching vault MD get reverted by the next 8:03 sync.** Always edit the vault MD too (via Cowork) when changing a routine.
- **Routine `end_date` is generated when missing.** `scripts/parse_routine.py` derives each routine's missing `end_date` as the day before the next routine's `start_date`; the latest routine remains open-ended. Selection logic still honors explicit frontmatter `end_date`, then falls back to latest past routine for gaps. `start_date` is derived from the first day-header date (falling back to the ISO week in the id).
- **The 8:03 daily sync silently fails if the Mac is asleep / on battery at cron time.** If the Mac is in a maintenance dark-wake (lid closed or on battery) when the cron fires, the scheduled session runs `git pull` and starts `sync.py` but gets suspended when the machine drops back to sleep — *before* `sync.py` reaches its `git add` + commit. Symptoms: `data/analytics.json` + `data/profile.json` show regenerated-but-uncommitted timestamp diffs (`generated_at` / `synced_at`), no `sync: drain…` commit lands, and nothing is reported (the task's `git status` verify step never runs). The half-finished git ops also leave stale 0-byte `.git/index.lock` / `.git/ORIG_HEAD.lock`, which then block the *next* run's index writes too. Detection: `.git/COMMIT_EDITMSG` predates today while `data/*.json` mtimes cluster around ~08:05, plus stale `.git/*.lock`. Recovery: `rm -f .git/index.lock .git/ORIG_HEAD.lock` (only if no live `git` process holds them — check `lsof`), then either let the next good sync re-stage + commit (it self-heals) or discard the churn with `git restore --source=HEAD --staged --worktree data/<files>`. Prevention: keep the Mac awake / plugged in at 8:03 (`caffeinate` or a scheduled `pmset` wake). Observed 2026-05-31.

## Where to look for more

- `README.md` — full architecture, deploy, sign-in flow, how to add routine/exercise
- `git log --oneline -30` — every recent change with rationale in the commit message
- `worker/README.md` — auth Worker deploy
- `docs/DOC_OWNERSHIP.md` — ownership boundaries for duplicated docs
- `docs/IOS_APP_ARCHITECTURE.md` — native iPhone app migration architecture
- Vault `Web-App-Build-Brief.md` — original build brief (referenced but not yet ingested into this brief)

## Wrap-up checkpoints (proactive offers at session end)

When something material lands (new feature, new convention, new gotcha, schema change), the active Claude session **proactively offers** updates at session wrap-up. The user can also explicitly say "update CLAUDE.md" or "check the task doc" at any time. Trivial bug fixes / wording tweaks don't trigger an offer.

1. **CLAUDE.md** — does anything new (feature, convention, gotcha, schema change) need to be reflected here?
2. **`docs/COWORK_SYNC_TASK.md`** — this file is the authoritative spec for the daily Cowork scheduled task. Cowork's UI holds only a thin wrapper that pulls latest and reads this file, so any change that affects what the daily sync sees, writes, or skips needs to be reflected here. Common triggers:
   - New `pending.json` entry type (currently: `log`, `skip`, `recovery`, `routine_edit`)
   - New vault output path or filename convention
   - New section in a vault MD that `sync.py` renders (e.g. Cool-down completion)
   - New `data/<dir>/` snapshot generated or new analytics field
   - Change to the "hard limits" / "don't touch" list
   When updating this file, no Cowork UI paste is needed — the next 8:03 AM run picks up the change automatically. If the **wrapper prompt itself** changes (rare — see `docs/COWORK_WRAPPER_PROMPT.md`), the user has to paste the new wrapper into the Cowork UI once.

Don't commit speculative refactors. User vets architectural moves before they're written.
