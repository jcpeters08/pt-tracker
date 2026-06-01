# Codex Reports Handoff — 2026-06-01

This file summarizes the local, uncommitted reports work for Claude to validate,
test, and decide whether documentation needs updates.

## Current Git State

At the time this handoff was written, the work is **not committed** and **not
pushed**. `main` is aligned with `origin/main`, and the following files have
local modifications:

- `index.html`
- `js/reports.js`
- `js/reports.test.js`
- `js/workout.js`
- `reports.html`
- `scripts/audit_data.py`
- `tests/test_manifest_and_audits.py`

## User-Reported Issues Addressed

1. W23 Monday rope triceps showed `24 lbs`, but Planet Fitness uses 5-lb
   increments and the authored target is `25 lbs (11 kg)`.
2. Lift progression report appeared wavy because it visually connected points
   across non-performed days.
3. Training calendar was a continuous grid and did not clearly show a month.
4. PR report rendered kg values and was one long ungrouped list.
5. User requested additional useful reports after research and self-critique.

## Implementation Summary

### Target Weight Display And Editing

`js/workout.js`

- Exported `formatTargetText()` for testing.
- Changed target rendering so, when the user preference is lbs and
  `target_weight_raw` contains an authored lbs value, the UI preserves that raw
  lbs string instead of recomputing from rounded `target_weight_kg`.
- This specifically prevents `25 lbs (11 kg)` from rendering as `24 lbs`.

`index.html`

- Changed inline routine target editor weight input step from `0.5` to `5`.
- Added a submit guard that refuses non-finite or non-5-lb-increment target
  edits with the toast: `Use a PF-available 5-lb increment`.
- This prevents new `routine_edit` entries from writing impossible PF targets
  such as `24 lbs`.

### Reports Helper Changes

`js/reports.js`

Added or changed:

- lbs conversion helpers for PR display.
- `prDeltaText()` now renders load and volume deltas in pounds.
- `personalRecordRowsHtml()` now renders PR weight in pounds.
- `bodyAreaForExercise()` groups primary muscles into:
  - Chest
  - Back
  - Shoulders
  - Arms
  - Lower Body
  - Core
  - Other
- `monthCalendarCells()` builds month-shaped calendar grids with leading blank
  cells, workout markers, and recovery markers.
- `readinessRows()` reports latest logged exercises that met programmed
  weight/reps/set count.
- `actualVsPlannedRows()` compares routine-week planned training days with logs.
- `muscleTargetBandRows()` rolls muscle-level weekly set data up into body-area
  bands.
- `staleLiftRows()` flags active routine exercises not logged recently.
- `recoveryCorrelationRows()` combines weekly compliance, recovery minutes, and
  PR counts.
- `readinessRows()` uses authored `target_weight_raw` lbs when present, so the
  readiness table does not reintroduce the `25 -> 24 lbs` bug.

### Reports Page UI

`reports.html`

Existing reports changed:

- **Lift progression**
  - Uses point-only datasets (`showLine: false`) so the chart does not imply
    non-workout-day values.
  - Converts top-set and total-volume axes/labels to pounds.
  - Uses date x-values for performed dates only.

- **Training calendar**
  - Replaced continuous date-strip rendering with a true month selector.
  - Calendar includes weekday headers, leading blank cells, workout dots, and
    recovery dots/outlines.

- **PRs**
  - Renders PR weight and deltas in pounds.
  - Groups PRs by body area.
  - Adds a body-area dropdown with `All` plus the available body areas.

New reports added:

- **Ready to progress**
  - Shows exercises whose latest logged sets met programmed weight/reps/set
    count.
  - Columns: Exercise, Date, Target, Actual, Signal.

- **Actual vs planned**
  - Compares routine days with logged sessions for a selected routine week.
  - Defaults to the active routine from `data/profile.json.active_routine`, not
    merely the latest routine JSON, because future routines may exist.
  - Columns: Day, Status, Planned, Completed.

- **Body-area target bands**
  - Rolls `analytics.weekly_volume_by_muscle` into body-area set totals.
  - Uses pragmatic weekly target bands:
    - Chest: 6-12
    - Back: 8-16
    - Shoulders: 6-14
    - Arms: 4-12
    - Lower Body: 10-20
    - Core: 3-10
    - Other: 0-99
  - Statuses are `Low`, `In range`, or `High`.

- **Stale lifts**
  - Uses the active routine from `data/profile.json.active_routine`.
  - Flags active routine exercises that are never logged or stale by 7+/14+/21+
    days.

- **Recovery correlation**
  - Shows compliance, recovery sessions, total recovery minutes, and PR signals
    for recent weeks.

### Audit Changes

`scripts/audit_data.py`

- Renamed/broadened the PF target audit from only dumbbell `ea` checks to all
  Phase 2 routine target lbs values.
- `ea` targets must still be one of PF's actual dumbbell inventory values:
  `5, 10, ..., 80 lbs`.
- Non-`ea` machine/cable/barbell targets must be 5-lb increments, without the
  80-lb dumbbell ceiling.
- This catches impossible targets like `24 lbs (11 kg)` while allowing valid
  machine/barbell values like `95`, `220`, or `250 lbs`.

## Tests Added Or Updated

`js/reports.test.js`

Added coverage for:

- PR rows escaping while displaying pounds.
- PR load/volume deltas in pounds.
- Body-area grouping.
- Month calendar cells.
- `formatTargetText()` preserving authored lbs targets.
- `readinessRows()`.
- `actualVsPlannedRows()`.
- `muscleTargetBandRows()`.
- `staleLiftRows()`.
- `recoveryCorrelationRows()`.
- Readiness target display preserving authored `25 lbs (11 kg)` instead of
  recomputing `24 lbs` from `11 kg`.

`tests/test_manifest_and_audits.py`

Added coverage for:

- Phase 2 cable/machine/barbell targets that are not 5-lb increments.
- Existing dumbbell inventory validation remains covered.

## Validation Already Run

Commands run successfully:

```bash
npm test
python3 -m unittest discover tests
python3 scripts/audit_data.py .
```

Observed results:

- Vitest: 7 files passed, 44 tests passed.
- Python unittest: 40 tests passed.
- Data audit: `data audit passed`.

Browser smoke checks were also run against:

```text
http://127.0.0.1:4173/reports.html
```

Observed browser checks:

- New report sections rendered:
  - `readiness-host`
  - `actual-planned-host`
  - `volume-band-host`
  - `stale-lifts-host`
  - `recovery-correlation-host`
- Actual-vs-planned defaulted to `2026-W23`, matching
  `data/profile.json.active_routine`.
- Readiness report contained `25 lbs` and did **not** contain the bad
  `24 lbs × 12` target.
- PR report contained lbs and no kg text in the PR host.

## Suggested Claude Validation Plan

1. Review the diff for all modified files listed above.
2. Re-run:

   ```bash
   npm test
   python3 -m unittest discover tests
   python3 scripts/audit_data.py .
   ```

3. Start or reuse a static server:

   ```bash
   python3 -m http.server 4173
   ```

4. Open:

   ```text
   http://127.0.0.1:4173/reports.html
   ```

5. Validate visually:
   - Lift progression is point-only, not connected by lines.
   - Lift progression labels are pounds.
   - Training calendar is month-shaped.
   - PR report is in pounds and grouped by body area.
   - New five report sections are visible and populated.
   - Actual-vs-planned defaults to W23 while profile active routine is W23.
   - Readiness table shows `25 lbs` targets where the routine raw target is
     `25 lbs (11 kg)`.

6. Validate data edge cases:
   - Add a temporary routine fixture with `24 lbs (11 kg)` non-`ea`; audit
     should fail.
   - Add a temporary routine fixture with `22.5 lbs (10 kg) ea`; audit should
     fail.
   - Confirm valid machine/barbell weights above 80 lb do not fail merely for
     exceeding dumbbell inventory.

## Documentation Update Guidance

`docs/COWORK_SYNC_TASK.md`

- No required update. This work does not change sync inputs, pending entry
  shapes, generated snapshot locations, or vault rendering.

`AGENTS.md`

- Optional update only. Existing PF-weight and kg-canonical conventions already
  cover the important constraints.
- A small optional note could mention:
  - Reports now include progress-readiness, actual-vs-planned, body-area target
    bands, stale lifts, and recovery correlation.
  - `scripts/audit_data.py` now checks all Phase 2 routine target lbs values for
    valid PF 5-lb increments, while `ea` targets remain constrained to actual
    PF dumbbell inventory.

`README.md`

- Optional but reasonable. The reports section could be expanded to list the new
  available reports and clarify that reports display lbs while storage remains
  kg.

## Known Tradeoffs / Review Notes

- Body-area target bands are pragmatic hardcoded report bands, not a formal
  personalized prescription model.
- Readiness-to-progress is intentionally conservative: it only flags when the
  latest logged exercise meets or exceeds target weight and reps across the
  programmed set count.
- Recovery correlation is descriptive only. It does not claim causation.
- Stale lift reporting uses the active routine from `data/profile.json` when
  available; this avoids future routine JSONs making the report look ahead.

