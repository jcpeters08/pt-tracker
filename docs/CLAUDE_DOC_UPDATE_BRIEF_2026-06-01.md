# Claude documentation update brief - 2026-06-01

Use this file as a handoff brief for updating the durable PT Tracker documentation after the 2026-06-01 bug-fix session. This is not intended to become the permanent source of truth; once the durable docs are updated, this file can either remain as an audit note or be removed in the same documentation commit.

## Applied — Claude session, 2026-06-01 (read this first)

A later Claude Code session validated these fixes, synced the durable docs, committed/pushed everything, and converged the routine data. Concrete outcomes (the rest of this brief is the original handoff, kept for reference):

- **Validation (fresh, independent):** vitest 44/44; Python unittest 41/41; the parser regression proven red→green (revert `scripts/pt_common.py` to HEAD → `11.0` fails; restore → `11.34` passes); targeted e2e 2/2; `audit_data.py` + `audit_docs.py` pass; `data/pending.json` preserved (the 2 entries); no orphaned browser processes after the e2e run.
- **Docs updated — commit `eb73c3b`:** `CLAUDE.md` + `AGENTS.md` gained a "Workout draft hydration gate — `workoutHydrationKey`, not `hydratedKeys`" gotcha, and the PF gotcha + draft convention #6 were extended with the authored-lbs set defaults and the first-unit-canonical `parse_weight` rule; `README.md` got a troubleshooting entry (impossible PF weights) + a dual-unit authoring note; `docs/COWORK_SYNC_TASK.md` got a first-unit-canonical note on the routine re-derive step. `docs/IOS_APP_ARCHITECTURE.md`, `docs/DOC_OWNERSHIP.md`, `docs/COWORK_WRAPPER_PROMPT.md` needed no change. **No vault MD change needed** — per `DOC_OWNERSHIP.md` the vault files are historical/training-status (not convention owners), and `data/profile.json` already points at the active W23 routine.
- **Routine data converged — commit `834a20b`:** regenerated `data/routines/*.json` from the vault Weekly Plans via the *same* path the daily sync uses (`parse_routine.parse_routine_md` + `derive_end_dates`). 167 Phase-2 `target_weight_kg` values converged onto the authored lbs (e.g. `11.0 → 11.34`, `7.0 → 6.8`); **only** `target_weight_kg` lines changed; `analytics.json`/`manifest.json` unaffected; all targets stay PF-valid. So the "next-sync convergence" the original brief anticipated **already happened** — the routine JSONs now carry the new kg, and the upcoming 8:03 sync's routine re-derive is a no-op (it will only drain the 2 pending entries + recompute analytics).
- **Follow-up spawned:** `hydratedKeys` is now write-only dead state (no `.has()` reads remain after the `workoutHydrationKey` change). A separate task was queued to remove it (declaration + all write sites) without behavior change and update the docs accordingly. Until then, **do not re-introduce `hydratedKeys` as a hydration gate** — `workoutHydrationKey` is the gate.

Everything above is on `main` and pushed. This brief is retained as an audit note.

## Purpose

Update project documentation so future Claude/Codex sessions preserve two fixed behaviors:

1. In-progress workout edits must survive switching to another workout day and then returning.
2. Phase 2 Planet Fitness default set-input weights must never be generated from rounded kg when authored pounds are available. Example: `25 lbs (11 kg)` must seed `25` in lbs inputs and submit `11.34 kg`, not display/submit `24 lbs` from `11 kg`.

## Current code status

As originally written, the bug-fix code was present in the working tree but not committed. **Update:** it was committed in `eb73c3b` (code + tests + docs) and the routine-data convergence in `834a20b`, both pushed to `main`. The file list below is the original snapshot.

Changed files:

- `index.html`
- `js/app-context.js`
- `js/workout.js`
- `scripts/pt_common.py`
- `e2e/day-navigation.spec.js`
- `tests/test_codex_fixes.py`
- `docs/CLAUDE_DOC_UPDATE_BRIEF_2026-06-01.md`

Remote/user-submitted data was preserved before code edits. `data/pending.json` contains exactly two pending entries:

- `log`, `2026-06-01`, `monday`
- `recovery`, `2026-06-01`, `Embrace North`

Do not reset, overwrite, or delete `data/pending.json`.

## Bugs fixed

### 1. Day-switch workout draft loss

User-visible symptom:

- During a workout, the user clicked Done and edited reps/weights on the current day.
- They tapped another workout day, then tapped back.
- The set inputs returned to routine defaults and Done states disappeared.

Root cause:

- `state.log` is a single in-memory workout-log slot.
- The app used `state.hydratedKeys` as the gate for whether a `(date|day|type)` view needed hydration.
- Returning to a previously visited day skipped hydration because its key was already in `hydratedKeys`, even though `state.log` currently belonged to another day.

Code fix:

- Added `state.workoutHydrationKey` in `js/app-context.js`.
- `refreshActiveSession()` in `index.html` now hydrates whenever `state.workoutHydrationKey !== currentKey`.
- `hydratedKeys` remains for discard/reset bookkeeping, but it is no longer the hydration gate for the single `state.log` slot.
- Day changes in `js/workout.js` clear `state.log` and `state.workoutHydrationKey`, then rerender.
- Routine switches, date changes, submit, skip, and discard paths also reset `workoutHydrationKey`.

Documentation implication:

- Document that draft persistence is not just localStorage keying. The live app also needs current-view tracking because `state.log` is a single mutable slot.
- Future fixes must not restore the old `hydratedKeys` gate.

### 2. Impossible PF set defaults like 24 lbs

User-visible symptom:

- Routine target line correctly showed `25 lbs (11 kg)`.
- Set input defaults still showed `24` because the app converted rounded stored kg (`11 kg`) back to pounds.
- If the user clicked Done without editing the field, the payload could submit the impossible/defaulted value path rather than the intended authored pound value.

Root cause:

- `formatTargetText()` already preserved `target_weight_raw` for the target line.
- `ensureLogState()` still received `ex.target_weight_kg` directly for default set rows.
- For rows authored as `25 lbs (11 kg)`, routine JSON could contain `target_weight_kg: 11.0` because the parser preferred the first kg mention anywhere in the cell, including rounded parenthetical display text.

Code fix:

- `js/workout.js` now derives set defaults with `targetWeightForSetDefaults(ex)`.
- If `target_weight_raw` starts with authored pounds, e.g. `25 lbs`, the app converts that primary value to kg for set defaults (`25 lb -> 11.34 kg`).
- Otherwise it falls back to `target_weight_kg`.
- `scripts/pt_common.py::parse_weight()` now normalizes the first authored unit in the weight cell. Parenthetical secondary units are treated as display text.
- Example behavior:
  - `25 lbs (11 kg)` -> `11.34 kg`
  - `16 kg (35 lbs) ea` -> `16.0 kg`

Documentation implication:

- Current docs say display preserves authored pounds. Update them to say default set inputs and pending payloads also use authored primary pounds when available.
- Current docs mention `target_weight_raw` as display preservation. Expand that to parser/sync semantics: the first authored unit is authoritative for deriving `target_weight_kg`; parenthetical units may be rounded display text.

## Verification already run

These commands passed after the fix:

```bash
npx playwright test e2e/day-navigation.spec.js -g "switching workout days|PF target defaults"
npm test
python3 -m unittest discover -s tests
python3 scripts/audit_data.py .
```

Observed results:

- Targeted e2e: `2 passed`
- Vitest: `7 passed`, `44 tests passed`
- Python unittest discovery: `41 tests passed`
- Data audit: `data audit passed`

Additional exhaustive PF default check run after the user asked whether every day/type was covered:

```bash
python3 - <<'PY'
import json, re
from pathlib import Path
LBS_PER_KG = 2.20462
repo = Path('.')
failures = []
rows = []

def day_type(label, fallback):
    return (label or '').lower().split('(')[0].strip().replace(' ', '-') or fallback

def computed_input_lbs(ex):
    raw = str(ex.get('target_weight_raw') or '').strip()
    kg = ex.get('target_weight_kg')
    if kg is None or kg == 0:
        return None
    m = re.match(r'^(\\d+(?:\\.\\d+)?)\\s*lbs?\\b', raw, re.I)
    if m:
        return float(m.group(1))
    return round(float(kg) * LBS_PER_KG)

for path in sorted((repo/'data/routines').glob('*.json')):
    routine = json.loads(path.read_text())
    if str(routine.get('phase')) != '2':
        continue
    for day_name, day in sorted((routine.get('days') or {}).items()):
        dtype = day_type(day.get('label'), day_name)
        for ex in day.get('exercises') or []:
            lbs = computed_input_lbs(ex)
            raw = ex.get('target_weight_raw')
            if lbs is None:
                continue
            rows.append((routine['id'], day_name, dtype, ex.get('exercise_id'), lbs, raw))
            if lbs % 5 != 0:
                failures.append((routine['id'], day_name, dtype, ex.get('exercise_id'), lbs, raw))

print('phase2_weighted_defaults_checked', len(rows))
print('phase2_routines_checked', len({r[0] for r in rows}))
print('day_types_checked', sorted({r[2] for r in rows}))
print('failures', len(failures))
for f in failures:
    print('FAIL', f)
PY
```

Observed output:

```text
phase2_weighted_defaults_checked 167
phase2_routines_checked 5
day_types_checked ['legs', 'lower-hybrid', 'pull', 'push', 'upper-hybrid']
failures 0
```

Also checked for leftover Playwright processes:

```bash
pgrep -fl 'chrome-headless-shell|headless_shell|http.server 8788' || true
```

Observed output was empty.

## Documentation files to update

Use `docs/DOC_OWNERSHIP.md` to keep ownership boundaries clean.

### 1. `AGENTS.md`

Update this file for Codex-facing operating rules and gotchas.

Suggested updates:

- In the localStorage/draft convention, add a note that workout drafts are restored by current view key, not only by the historical `hydratedKeys` set. The important invariant is: `state.log` represents exactly one `(routine_id|date|day|type)` view at a time, and returning to a day must reload that day's draft if it exists.
- In the "Workout day-view session resolution + submit identity" gotcha, add the adjacent caution that `hydratedKeys` must not be used as the sole hydration gate because switching days mutates the single `state.log` slot.
- In "PF 5-lb weight enforcement + lbs display", extend the existing note:
  - Target labels preserve authored `target_weight_raw`.
  - Set input defaults also use primary authored pounds when `target_weight_raw` starts with lbs.
  - Pending payloads from untouched Done sets should therefore store the authored pounds converted to kg, e.g. `25 lbs -> 11.34 kg`, rather than rounded `11 kg -> 24 lbs`.
  - `scripts/pt_common.parse_weight()` now treats the first authored unit as authoritative and ignores parenthetical secondary display units for canonical kg derivation.
- Consider adding the exhaustive PF default command above as an audit snippet, or point to the new e2e regression and `audit_data.py`.

### 2. `CLAUDE.md`

Mirror the same Claude-facing rules as `AGENTS.md`. This file exists and should be updated if it has the same conventions/gotchas.

Suggested updates:

- Keep language parallel to `AGENTS.md` so Claude and Codex sessions receive the same constraints.
- Make sure it explicitly says not to revert the `workoutHydrationKey` behavior.
- Make sure it explicitly says not to compute PF set-input defaults by direct kg-to-lbs conversion when an authored pounds value exists.

### 3. `README.md`

Update only if there is a human-facing usage/troubleshooting or validation section that benefits from this.

Possible additions:

- In troubleshooting, add an entry for "Set inputs show impossible PF weights like 24 lbs" explaining the expected fixed behavior and the validation command:
  - Run `python3 scripts/audit_data.py .`
  - Optionally run the exhaustive Phase 2 default check from this brief.
- In routine authoring guidance, clarify that when routine MDs use dual units, the first authored unit is authoritative. Examples:
  - `25 lbs (11 kg)` means 25 lb is the intended PF value.
  - `16 kg (35 lbs) ea` means 16 kg is the intended value.

Do not over-document internal state mechanics in README unless needed for troubleshooting; README is human-facing.

### 4. `docs/COWORK_SYNC_TASK.md`

Update because daily sync re-derives `data/routines/*.json` from vault Weekly Plan MDs, and the parser semantics changed.

Suggested update location:

- Under Step 2, bullet "Re-derives `data/routines/*.json` from vault `Weekly Plans/*.md`..."

Suggested content:

- Add that routine weight parsing treats the first authored unit in a Working Weight cell as authoritative for `target_weight_kg`.
- Parenthetical secondary units are display text and may be rounded.
- This prevents rows like `25 lbs (11 kg)` from being regenerated as canonical `11 kg` and later displayed as impossible PF values.

No Cowork UI wrapper update is needed unless `docs/COWORK_WRAPPER_PROMPT.md` itself changes. This is a sync-task behavior detail, not wrapper behavior.

### 5. `docs/DOC_OWNERSHIP.md`

Probably no update needed. Use it as guidance only.

### 6. `docs/COWORK_WRAPPER_PROMPT.md`

No update expected. The wrapper still only prepares the disposable checkout, materializes the vault, and points at `docs/COWORK_SYNC_TASK.md`.

### 7. `docs/IOS_APP_ARCHITECTURE.md`

Probably no update needed unless it contains PWA state-management details. A quick scan is enough.

## Tests to preserve or expand

New regression coverage added:

- `e2e/day-navigation.spec.js`
  - `Bug 1 regression: switching workout days and back keeps in-progress Done sets`
  - `PF target defaults use authored pounds for set inputs and pending payloads`
- `tests/test_codex_fixes.py`
  - `test_lbs_primary_weight_uses_authored_pounds_not_rounded_kg_parenthetical`

If docs mention tests, reference these exact tests.

## Commands Claude should run after doc edits

Minimum after documentation-only edits:

```bash
python3 scripts/audit_docs.py .
git diff --check
git status --short
```

If Claude also touches code or parser behavior:

```bash
npm test
python3 -m unittest discover -s tests
python3 scripts/audit_data.py .
npx playwright test e2e/day-navigation.spec.js -g "switching workout days|PF target defaults"
```

Be careful with Playwright. Per project convention, do not run the full e2e suite repeatedly. If a run is interrupted, check for orphaned browser/server processes:

```bash
pgrep -fl 'chrome-headless-shell|headless_shell|http.server' || true
```

Recovery command only if needed:

```bash
pkill -9 -f headless_shell
pkill -9 -f 'http.server'
```

## Suggested final documentation checklist

Claude should verify each of these before calling the documentation update complete:

- `AGENTS.md` documents current workout draft hydration behavior.
- `CLAUDE.md` mirrors the same hydration and PF-default conventions.
- `AGENTS.md` and `CLAUDE.md` both warn against using `hydratedKeys` alone to decide whether to hydrate `state.log`.
- `AGENTS.md` and `CLAUDE.md` both state that authored lbs in `target_weight_raw` drive set-input defaults and pending payload kg conversion.
- `AGENTS.md` and `CLAUDE.md` both state that `parse_weight()` uses the first authored unit as canonical when re-deriving routine JSON from vault MD.
- `docs/COWORK_SYNC_TASK.md` documents the parser behavior in the routine re-derive step.
- `README.md` is updated only where useful for human-facing routine authoring or troubleshooting.
- `docs/COWORK_WRAPPER_PROMPT.md` is unchanged unless wrapper mechanics changed.
- `python3 scripts/audit_docs.py .` passes.
- `data/pending.json` still contains the two 2026-06-01 pending entries unless the user explicitly asks to drain or alter them.
