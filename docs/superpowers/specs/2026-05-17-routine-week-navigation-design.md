# Forward/backward week navigation + pre-tune targets

**Date:** 2026-05-17
**Status:** Design — awaiting approval

## Problem

Today the web app's routine pill (`index.html:545`) is a read-only label. The active routine is auto-picked from today's date via `pickRoutineForDate()` (`index.html:1120`). There's no way to:

- View next week's plan before it starts (W21 exists in the repo from 2026-05-18 but isn't visible until Monday).
- Tune target weight/reps/sets for a future week without going through the vault MD via Cowork.
- Review a past week's actual logged sets without opening the Reports page.

The `localStorage[ROUTINE_KEY]` pin also short-circuits the auto-pick — once W20 is pinned and has no `end_date`, the picker will keep returning W20 even after W21's `start_date` arrives.

## Goals

1. Tap the routine pill → pick any week within current ± 2 weeks.
2. For an **upcoming** week: see the plan, edit target weight/reps/sets per exercise inline, save the change.
3. For a **past** week: see the plan with actual logged sets overlaid, read-only.
4. Edits to future-week targets flow through `data/pending.json` → daily sync writes back to vault MD → next sync re-derives the routine JSON (full round-trip; vault MD remains source of truth).
5. Workout date stays as today's actual date in all cases — logged sessions are dated today regardless of which routine is selected.

## Non-goals

- Editing routines from past weeks. Past-week mode is strictly read-only.
- Editing the `notes` column from the app. Notes stay vault-edited.
- Adding or deleting exercises / days from the app. Only existing rows can be tweaked.
- Logging sessions dated other than today. The date picker continues to default to today.
- Changing the `localStorage` pin behavior on initial load — auto-pick still runs as today.

## UI changes (`index.html`)

### Routine pill → dropdown button

The `.routine-pill` div at `index.html:545` becomes a `<button>`. Tap opens a popover anchored to the pill. The list is built by sorting all routines in `state.routineMeta` by `start_date` descending, finding the index of `auto_picked_id`, and selecting up to 2 entries newer + current + up to 2 entries older. If fewer than 2 exist on a side, the list is just shorter. Each row shows:

- Routine name (e.g. "W21 MPLS Planet Fitness — Solo")
- Small chip: `past` / `current` / `upcoming`
- Date range (`5/18 – ?` or `5/11 – 5/17`)

Selecting a row replaces `state.routine` in memory and re-renders the day toggle + exercise cards. The selection is session-only — reload re-runs `pickRoutineForDate()` and shows the date-appropriate routine.

### Day toggle re-renders per selected routine

No code change needed beyond ensuring the existing re-render hook fires when `state.routine` changes. The day toggle is already built from `state.routine.days`.

### Workout date stays today

No change. The date input continues to default to `localDateIso()` on load.

### Mode classification

Compute `auto_picked_id = pickRoutineForDate(today)` once on load. The selected routine's mode is:

- **Current** — `selected_routine.id === auto_picked_id`. No banner. Existing behavior unchanged.
- **Upcoming** — `selected_routine.start_date > today`.
- **Past** — anything else (not current and not upcoming).

This means the moment W21 becomes auto-picked (Monday 5/18), W20 automatically reclassifies as past — no dependence on `end_date` being set, and no "stale current" state.

### Mode banners + behavior

- **Past routine**
  - Banner: `📜 Read-only — historical routine`
  - All weight inputs, Done buttons, reps editors, notes, cooldown buttons disabled
  - Submit + Skip buttons hidden
  - Logged data from `data/logs/*.json` (filtered by `log.routine_id === selected_routine.id`) overlaid on each exercise card (see "Past-week overlay" below)

- **Upcoming routine**
  - Banner: `🔮 Upcoming routine — pre-tune targets, can't log yet`
  - Submit + Skip buttons hidden
  - Tap-to-edit on target line enabled

- **Current routine** — no banner, full logging UI, tap-to-edit also enabled.

### Tap-to-edit on target line

On current and upcoming routines, the line that currently renders `"35 lbs (16 kg) × 10 × 3"` becomes tappable. Tap → that line is replaced with three inline inputs (`weight lbs`, `reps`, `sets`) plus Save / Cancel buttons. On Save:

1. Compute new `target_weight_kg` from the lbs input (round to 0.5 kg, matching existing conversion).
2. Build new `target_weight_raw`. Read the prior raw to detect the `ea` suffix; preserve it.
3. Append a `routine_edit` entry to `data/pending.json` via the existing GitHub Contents API path. Apply the pre-dedupe rule (below).
4. Update the in-memory render — the target line now shows the new value.

The Cancel button discards the edit and restores the original display.

### Past-week overlay of logged data

Log JSON files do **not** carry a `routine_id` field (verified — fields are `id, date, day_of_week, type, muscle_groups, phase, location, …`). Match by date range against the routine's window.

When the selected routine is in past mode:

1. Fetch `data/logs/` listing via GitHub Contents API (anonymous, same pattern as `loadRoutines()` at `index.html:1084`).
2. Compute the routine's effective window: `[start_date, end_date]`. If `end_date` is null, use `start_date + 6 days` (one ISO week) as the implicit end.
3. Filter to logs where `log.date` falls in the window.
4. Build `{day_of_week: log_object}`. Day toggle shows status per day: ✓ logged / 🟡 skipped / blank.
5. On day select, each exercise card renders the plan as usual and additionally shows an `Actual:` line beneath the target: `"actual: 35 lbs × 12, 35 × 10, 30 × 10"` (derived from `log.exercises[].sets[]`). If an exercise has no matching log entry, shows `"actual: —"`.
6. All inputs disabled, Submit/Skip hidden, banner visible.

Failure mode: if the log list fetch fails (network / rate limit), the plan still renders read-only with a small inline notice `"couldn't load logged sets"`.

## New `pending.json` entry type: `routine_edit`

Append to `data/pending.json` from the web app when the user saves a target tweak.

```json
{
  "type": "routine_edit",
  "routine_id": "2026-W21-Phase-2-Week-2-Progression",
  "day_of_week": "monday",
  "exercise_id": "flat-db-bench-press",
  "changes": {
    "target_weight_kg": 18.0,
    "target_weight_raw": "40 lbs (18 kg) ea",
    "target_reps": 12,
    "target_sets": 3
  },
  "created_at": "2026-05-17T15:42:10Z",
  "client_id": "ios-pwa"
}
```

### Dedupe rule

Before append, `appendPending()` removes any prior `routine_edit` entry with the same `(routine_id, day_of_week, exercise_id)`. Mirrors the existing pre-dedupe rules for `log`/`skip`/`recovery`. Multiple tweaks to the same exercise before sync only keep the latest. This is documented in `CLAUDE.md` convention #5 as a hard convention.

### Partial `changes`

Only fields the user actually modified are present. Lets `sync.py` update specific cells without clobbering others. `target_weight_raw` is included whenever `target_weight_kg` changes — the web app computes the canonical `"<lbs> lbs (<kg> kg) [ea?]"` string at save time, so `sync.py` doesn't have to re-derive formatting.

## `sync.py` changes — process `routine_edit` before re-deriving JSON

Drain order in `scripts/sync.py`:

1. **NEW** — process `routine_edit` entries (writes to vault Weekly Plans MD)
2. Existing — process `log` / `skip` / `recovery` entries (appends to vault Log / Recovery Log MDs)
3. Existing — re-derive `data/routines/*.json` from vault MDs via `parse_routine.py`
4. Existing — re-derive `data/logs/*.json` / `data/recovery_logs/*.json` via `parse_log.py` / `parse_recovery.py`
5. Existing — `compute_analytics.py`
6. Existing — commit + push

The new `routine_edit` step runs first so the re-derive picks up the edits.

### Algorithm per `routine_edit` entry

1. Open `~/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer/Weekly Plans/{routine_id}.md`. If missing → audit to `data/failed_routine_edits.json` and continue.
2. Walk lines looking for the day-header matching `day_of_week`, using existing `DAY_HEADER_RE` from `parse_routine.py:26` and `pc.canonical_day()`.
3. Inside that day's section, find the first markdown table using `pc.find_table` / `pc.parse_table_rows`.
4. For each row, resolve `row["exercise"]` → `exercise_id` via `pc.resolve_exercise_id(name)`. The matching row is the one whose resolved id equals `changes.exercise_id`.
5. Rewrite that row's cells:
   - `working weight` ← `changes.target_weight_raw`
   - `reps` ← `str(changes.target_reps)`
   - `sets` ← `str(changes.target_sets)`
   - Skip any field not in `changes`.
6. Preserve column alignment: pad each cell to the prior column width if it remains larger, else let the table widen as needed.
7. Write the file back via `Path.write_text()`.
8. Append an audit entry to `data/applied_routine_edits.json`: `{routine_id, day_of_week, exercise_id, changes, applied_at}`.

### Failure modes

- **Exercise row not found** (deleted from MD between edit and sync, or row name no longer resolves to expected id) → audit to `data/failed_routine_edits.json`, drop the entry, **never** insert a new row.
- **Day section not found** (day_of_week doesn't exist in the MD) → audit + drop.
- **Vault file missing** (routine MD doesn't exist) → audit + drop.
- **Malformed table** (`pc.parse_table_rows` returns rows missing expected columns) → audit + drop.

All failure modes are non-fatal; sync continues with remaining entries. The web app's edit is lost in any failure; the user has to redo it.

### iCloud materialization

Already handled by the Cowork wrapper before sync runs (`docs/COWORK_WRAPPER_PROMPT.md`). No new logic.

## Trade-offs acknowledged

- **Markdown writeback is inherently fragile.** A hand-edit to the MD between web-app edit and sync run could break the row match. The narrow scope (specific cells in specific rows of specific day sections) + resolve-via-`exercise_id` minimizes the surface area, but a malformed MD silently drops edits. Audit files exist so drops are spottable.
- **Round-trip latency.** A tweak saved Sunday at 3 PM doesn't land in vault MD until Monday 8:03 AM. The web app's in-memory render shows the new target immediately, so this matters only if comparing vault MD against app view before sync runs.
- **No conflict resolution.** If the vault MD is edited by hand and the web app is edited for the same row in the same day, the web app's `routine_edit` wins (it runs first in drain order). The hand-edit's other-cell changes survive because we only rewrite specific cells.

## Testing

### Unit (`sync.py`)

No existing Python test setup in the repo (no `tests/`, `pyproject.toml`, `pytest.ini`, or test files). Use stdlib `unittest`, runnable via `python3 -m unittest tests.test_sync_routine_edit`. Add `tests/__init__.py` + `tests/test_sync_routine_edit.py` with fixtures: a sample Weekly Plan MD + sample pending entries. Cover:

- Weight-only edit → only `working weight` cell changes.
- Reps-only edit → only `reps` cell changes.
- Sets-only edit → only `sets` cell changes.
- All-three edit → all three cells change.
- Exercise not found in target day → audit file written, MD untouched.
- Day not found in MD → audit file written, MD untouched.
- File missing → audit file written, no exception.
- Multiple edits to same exercise → dedupe (handled at web-app append, not sync, but verify sync handles a single entry per (routine, day, exercise) correctly).
- `target_weight_raw` with `ea` suffix preserved end-to-end.
- Hand-edited MD with extra column → `parse_table_rows` rejects, audit + drop.

### Manual (web app)

After implementation, walk through:

1. Load app on iPhone PWA + desktop, sign in.
2. Pill shows current routine → tap → dropdown shows W18, W19, W20, W21 with `past`/`current`/`upcoming` chips and date ranges.
3. Select W21 → banner `🔮 Upcoming…`, day toggle shows W21's Mon–Sun, exercise cards render W21 targets.
4. Tap a target line → inline editor appears → change weight 35 → 40 → Save → target line shows 40 immediately. Open `data/pending.json` on GitHub: `routine_edit` entry present with new value.
5. Save again with weight 40 → 45 → pending still has only ONE entry for that exercise (dedupe verified).
6. Switch to W18 → banner `📜 Read-only…`, inputs disabled, actual logged sets layered under each exercise card.
7. Confirm Submit/Skip hidden in both past and future modes.
8. Switch back to W20 (current) → banner gone, full logging UI restored.
9. Run `python3 scripts/sync.py` against a vault clone with the pending entry → confirm:
   - W21 Weekly Plan MD now has the new value in the right row
   - `data/applied_routine_edits.json` has the audit entry
   - `data/routines/2026-W21-Phase-2-Week-2-Progression.json` re-derives with new target

### Negative cases to verify

- Pending entry for nonexistent routine_id → goes to failed audit, sync continues.
- Pending entry for an exercise the MD no longer has → goes to failed audit.
- Pending entry for current routine (not just future) → should also work (no special-casing by mode).
- Edit on current routine that you've already logged for the day → editing the target does NOT change the existing log.

## Files touched

- `index.html` — routine pill → dropdown, mode banners, tap-to-edit, past-week overlay, `routine_edit` append
- `scripts/sync.py` — new `routine_edit` drain step
- `scripts/sync.py` — new helper for "rewrite a specific row's specific cells in a markdown table" lives here; only sync needs it.
- `tests/__init__.py` + `tests/test_sync_routine_edit.py` — new test file using stdlib `unittest`
- `CLAUDE.md` — add `routine_edit` to the pending-entry-types list under "Schema highlights" and to convention #5 (pre-dedupe)
- `docs/COWORK_SYNC_TASK.md` — document the new entry type and writeback behavior (per the wrap-up checkpoint in `CLAUDE.md`)

## Open questions for implementation plan

- Should `data/failed_routine_edits.json` and `data/applied_routine_edits.json` be committed by sync, or kept local-only? Recommend committed — gives a git trail of what flowed and lets you spot drops from the GitHub UI.
- The dropdown UI: native `<select>` vs custom popover? Native is simpler but harder to style on iOS. Recommend custom popover styled like the existing pill aesthetic, with simple absolute positioning beneath the pill.
