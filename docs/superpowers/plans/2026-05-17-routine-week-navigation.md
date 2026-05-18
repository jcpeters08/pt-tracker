# Forward/backward week navigation + pre-tune targets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the routine pill a dropdown to switch weeks; show past weeks read-only with logged sets overlaid; allow inline tap-to-edit of target weight/reps/sets on current/future weeks, with edits flowing through pending → sync → vault MD writeback.

**Architecture:** A new `routine_edit` entry type in `data/pending.json`. `sync.py` drains these by rewriting specific cells in the corresponding Weekly Plan MD before re-deriving JSON. The web app gains a popover-style dropdown on the routine pill, three modes (past/current/upcoming) driven by `pickRoutineForDate`, mode-specific banners + input lockout, inline tap-to-edit on the target line, and a past-mode overlay of logged sets fetched from `data/logs/`. All DOM rendering uses `createElement` / `textContent` (no `innerHTML` with interpolated data) to avoid XSS surface.

**Tech Stack:** Vanilla JS (`index.html`), Python stdlib (`scripts/sync.py`, stdlib `unittest`), markdown table writeback.

**Spec:** `docs/superpowers/specs/2026-05-17-routine-week-navigation-design.md`

---

## File Structure

**New files:**
- `tests/__init__.py` — package marker
- `tests/fixtures/__init__.py` — package marker
- `tests/fixtures/sample-routine.md` — minimal Weekly Plan MD for sync tests
- `tests/test_sync_routine_edit.py` — unittest suite for `_apply_routine_edit` and drain integration

**Modified files:**
- `scripts/sync.py` — new `_apply_routine_edit` helper, new drain branch, audit-file writes
- `index.html` — pill → dropdown popover, mode classification, banners, tap-to-edit editor, `routine_edit` pending append, past-week overlay
- `CLAUDE.md` — add `routine_edit` to schema highlights, extend convention #5 dedupe list
- `docs/COWORK_SYNC_TASK.md` — document the new entry type and writeback semantics

---

## Task 1: Test fixture + tests/ package skeleton

**Files:**
- Create: `tests/__init__.py`
- Create: `tests/fixtures/__init__.py`
- Create: `tests/fixtures/sample-routine.md`

- [ ] **Step 1: Create the tests package**

```bash
mkdir -p tests/fixtures
```

Create `tests/__init__.py` with empty content. Create `tests/fixtures/__init__.py` with empty content.

- [ ] **Step 2: Write the sample routine fixture**

Create `tests/fixtures/sample-routine.md`:

```markdown
---
type: project
status: active
tags:
  - fitness
  - weekly-plan
  - phase-2
aliases:
  - Sample Routine
---

# 🏋️ Sample Week — Test Fixture

## Mon 5/18 — Push (Chest / Shoulders / Triceps)

**Warm-up:** Treadmill 5 min + band pull-aparts × 15

| # | Exercise | Working Weight | Reps | Sets | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Flat Dumbbell Bench Press | 35 lbs (16 kg) ea | 10 | 3 | Earn 10-12 reps before bumping |
| 2 | Seated Dumbbell Shoulder Press | 30 lbs (14 kg) ea | 12 | 3 | Hold — earn 12/12/12 |
| 3 | Rope Tricep Pushdown | 20 lbs (9 kg) | 12 | 3 | Drop from 25 — pace this |

## Tue 5/19 — Pull (Back / Biceps / Rear Delts)

**Warm-up:** Rower 5 min

| # | Exercise | Working Weight | Reps | Sets | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | Lat Pulldown | 90 lbs (41 kg) | 10 | 3 | Re-establish — 4/21 PR was 100 lbs |
| 2 | Seated Cable Row | 80 lbs (36 kg) | 12 | 3 | Earn 12/12/12 clean |
```

- [ ] **Step 3: Verify the fixture parses with parse_routine.py**

Run:
```bash
python3 scripts/parse_routine.py tests/fixtures/sample-routine.md
```

Expected: prints a JSON object with `days.monday.exercises` containing 3 entries and `days.tuesday.exercises` containing 2 entries. If `resolve_exercise_id` warns about unknown exercise names, that's fine — the fixture exercises (`Flat Dumbbell Bench Press`, etc.) should already resolve since they're real names in `data/exercises/`.

- [ ] **Step 4: Commit**

```bash
git add tests/__init__.py tests/fixtures/__init__.py tests/fixtures/sample-routine.md
git commit -m "tests: add sample Weekly Plan fixture for sync tests

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Failing test — weight-only routine_edit

**Files:**
- Create: `tests/test_sync_routine_edit.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_sync_routine_edit.py`:

```python
"""Tests for sync.py's routine_edit handling."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import sync  # noqa: E402

FIXTURE = REPO_ROOT / "tests" / "fixtures" / "sample-routine.md"


class TestApplyRoutineEdit(unittest.TestCase):
    def _load_fixture(self, tmp_path: Path) -> Path:
        md = tmp_path / "Sample.md"
        md.write_text(FIXTURE.read_text(encoding="utf-8"), encoding="utf-8")
        return md

    def test_weight_only_edit_updates_working_weight_cell(self):
        with tempfile.TemporaryDirectory() as tmp:
            md_path = self._load_fixture(Path(tmp))
            entry = {
                "type": "routine_edit",
                "routine_id": "Sample",
                "day_of_week": "monday",
                "exercise_id": "flat-db-bench-press",
                "changes": {
                    "target_weight_kg": 18.0,
                    "target_weight_raw": "40 lbs (18 kg) ea",
                },
                "created_at": "2026-05-17T15:42:10Z",
            }
            result = sync._apply_routine_edit(md_path, entry)
            self.assertEqual(result["status"], "applied")
            text = md_path.read_text(encoding="utf-8")
            self.assertIn("| Flat Dumbbell Bench Press | 40 lbs (18 kg) ea | 10 | 3 |", text)
            # Other rows untouched
            self.assertIn("| Seated Dumbbell Shoulder Press | 30 lbs (14 kg) ea | 12 | 3 |", text)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```bash
python3 -m unittest tests.test_sync_routine_edit -v
```

Expected: FAIL with `AttributeError: module 'sync' has no attribute '_apply_routine_edit'`.

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/test_sync_routine_edit.py
git commit -m "tests: failing test for routine_edit weight-only writeback

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Implement `_apply_routine_edit`

**Files:**
- Modify: `scripts/sync.py`

- [ ] **Step 1: Add the helper to `scripts/sync.py`**

Add this function to `scripts/sync.py` just before `def main()` (around line 408):

```python
# ---------------------------------------------------------------------------
# routine_edit — rewrite specific cells in a Weekly Plan MD's day-table.
# Source of truth is the vault MD; the web app appends routine_edit entries
# to data/pending.json; this helper applies one entry. Failure modes return
# {status: "failed", reason} rather than raising.
# ---------------------------------------------------------------------------

def _apply_routine_edit(md_path: Path, entry: dict) -> dict:
    """Rewrite specific cells of a routine MD per a routine_edit entry.

    Returns {status, reason?} — 'applied' on success, 'failed' otherwise."""
    if not md_path.exists():
        return {"status": "failed", "reason": f"vault MD missing: {md_path}"}

    day_of_week = (entry.get("day_of_week") or "").lower()
    exercise_id = entry.get("exercise_id") or ""
    changes = entry.get("changes") or {}
    if not day_of_week or not exercise_id or not changes:
        return {"status": "failed", "reason": "entry missing required fields"}

    text = md_path.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=False)

    # Find the day-header line matching day_of_week.
    day_header_idx = None
    for i, line in enumerate(lines):
        m = pr.DAY_HEADER_RE.match(line)
        if not m:
            continue
        if pc.canonical_day(m.group("day")) == day_of_week:
            day_header_idx = i
            break
    if day_header_idx is None:
        return {"status": "failed", "reason": f"day not found: {day_of_week}"}

    # Bound the day section at the next "## " header.
    section_end = len(lines)
    for j in range(day_header_idx + 1, len(lines)):
        if lines[j].startswith("## "):
            section_end = j
            break

    # Find the first table inside the day section.
    tbl = pc.find_table(lines, day_header_idx + 1)
    if tbl is None or tbl[0] >= section_end:
        return {"status": "failed", "reason": f"no table in day {day_of_week}"}

    header_idx, end_idx = tbl
    end_idx = min(end_idx, section_end)
    headers = [h.lower() for h in pc.split_table_row(lines[header_idx])]

    def _col(name: str):
        try:
            return headers.index(name)
        except ValueError:
            return None

    col_exercise = _col("exercise")
    col_weight = _col("working weight")
    col_reps = _col("reps")
    col_sets = _col("sets")
    if col_exercise is None:
        return {"status": "failed", "reason": "table missing 'exercise' column"}

    # Find the row whose exercise resolves to the target id.
    target_row_idx = None
    for k in range(header_idx + 2, end_idx):
        cells = pc.split_table_row(lines[k])
        if len(cells) <= col_exercise:
            continue
        resolved = pc.resolve_exercise_id(cells[col_exercise], warn=False)
        if resolved is not None and resolved[0] == exercise_id:
            target_row_idx = k
            break
    if target_row_idx is None:
        return {"status": "failed", "reason": f"exercise not found: {exercise_id}"}

    # Rewrite the cells we have changes for.
    cells = pc.split_table_row(lines[target_row_idx])
    while len(cells) < len(headers):
        cells.append("")
    if "target_weight_raw" in changes and col_weight is not None:
        cells[col_weight] = str(changes["target_weight_raw"])
    if "target_reps" in changes and col_reps is not None:
        cells[col_reps] = str(changes["target_reps"])
    if "target_sets" in changes and col_sets is not None:
        cells[col_sets] = str(changes["target_sets"])

    lines[target_row_idx] = "| " + " | ".join(cells) + " |"
    md_path.write_text("\n".join(lines) + ("\n" if text.endswith("\n") else ""), encoding="utf-8")
    return {"status": "applied"}
```

`pr` and `pc` are already imported at the top of `sync.py` (lines 42, 43).

- [ ] **Step 2: Run the test to verify it passes**

```bash
python3 -m unittest tests.test_sync_routine_edit -v
```

Expected: 1 test PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/sync.py
git commit -m "feat: _apply_routine_edit helper for vault MD writeback

Rewrites specific cells in a Weekly Plan MD's day-table per a
routine_edit pending entry. Returns {status} instead of raising on
expected failures.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: More edit-path tests (reps, sets, all-three, notes preserved)

**Files:**
- Modify: `tests/test_sync_routine_edit.py`

- [ ] **Step 1: Append four tests to `TestApplyRoutineEdit`**

```python
    def test_reps_only_edit_updates_reps_cell(self):
        with tempfile.TemporaryDirectory() as tmp:
            md_path = self._load_fixture(Path(tmp))
            entry = {
                "type": "routine_edit",
                "routine_id": "Sample",
                "day_of_week": "monday",
                "exercise_id": "seated-db-shoulder-press",
                "changes": {"target_reps": 15},
            }
            result = sync._apply_routine_edit(md_path, entry)
            self.assertEqual(result["status"], "applied")
            text = md_path.read_text(encoding="utf-8")
            self.assertIn("| Seated Dumbbell Shoulder Press | 30 lbs (14 kg) ea | 15 | 3 |", text)

    def test_sets_only_edit_updates_sets_cell(self):
        with tempfile.TemporaryDirectory() as tmp:
            md_path = self._load_fixture(Path(tmp))
            entry = {
                "type": "routine_edit",
                "routine_id": "Sample",
                "day_of_week": "monday",
                "exercise_id": "rope-tricep-pushdown",
                "changes": {"target_sets": 4},
            }
            result = sync._apply_routine_edit(md_path, entry)
            self.assertEqual(result["status"], "applied")
            text = md_path.read_text(encoding="utf-8")
            self.assertIn("| Rope Tricep Pushdown | 20 lbs (9 kg) | 12 | 4 |", text)

    def test_all_three_edit_on_tuesday(self):
        with tempfile.TemporaryDirectory() as tmp:
            md_path = self._load_fixture(Path(tmp))
            entry = {
                "type": "routine_edit",
                "routine_id": "Sample",
                "day_of_week": "tuesday",
                "exercise_id": "lat-pulldown",
                "changes": {
                    "target_weight_kg": 45.0,
                    "target_weight_raw": "100 lbs (45 kg)",
                    "target_reps": 8,
                    "target_sets": 4,
                },
            }
            result = sync._apply_routine_edit(md_path, entry)
            self.assertEqual(result["status"], "applied")
            text = md_path.read_text(encoding="utf-8")
            self.assertIn("| Lat Pulldown | 100 lbs (45 kg) | 8 | 4 |", text)
            # Tuesday's other row untouched
            self.assertIn("| Seated Cable Row | 80 lbs (36 kg) | 12 | 3 |", text)

    def test_edit_preserves_notes_column(self):
        with tempfile.TemporaryDirectory() as tmp:
            md_path = self._load_fixture(Path(tmp))
            entry = {
                "type": "routine_edit",
                "routine_id": "Sample",
                "day_of_week": "monday",
                "exercise_id": "flat-db-bench-press",
                "changes": {
                    "target_weight_kg": 18.0,
                    "target_weight_raw": "40 lbs (18 kg) ea",
                },
            }
            sync._apply_routine_edit(md_path, entry)
            text = md_path.read_text(encoding="utf-8")
            self.assertIn("Earn 10-12 reps before bumping", text)
```

- [ ] **Step 2: Run all tests**

```bash
python3 -m unittest tests.test_sync_routine_edit -v
```

Expected: 5 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/test_sync_routine_edit.py
git commit -m "tests: cover reps-only, sets-only, all-three, notes-preserved

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Failure-mode tests

**Files:**
- Modify: `tests/test_sync_routine_edit.py`

- [ ] **Step 1: Append failure tests**

```python
    def test_missing_md_file_returns_failed(self):
        entry = {
            "type": "routine_edit",
            "routine_id": "Nonexistent",
            "day_of_week": "monday",
            "exercise_id": "flat-db-bench-press",
            "changes": {"target_reps": 10},
        }
        result = sync._apply_routine_edit(Path("/tmp/does-not-exist-zzz.md"), entry)
        self.assertEqual(result["status"], "failed")
        self.assertIn("missing", result["reason"].lower())

    def test_day_not_found_returns_failed(self):
        with tempfile.TemporaryDirectory() as tmp:
            md_path = self._load_fixture(Path(tmp))
            original = md_path.read_text(encoding="utf-8")
            entry = {
                "type": "routine_edit",
                "routine_id": "Sample",
                "day_of_week": "saturday",
                "exercise_id": "flat-db-bench-press",
                "changes": {"target_reps": 10},
            }
            result = sync._apply_routine_edit(md_path, entry)
            self.assertEqual(result["status"], "failed")
            self.assertIn("day", result["reason"].lower())
            self.assertEqual(md_path.read_text(encoding="utf-8"), original)

    def test_exercise_not_found_returns_failed(self):
        with tempfile.TemporaryDirectory() as tmp:
            md_path = self._load_fixture(Path(tmp))
            original = md_path.read_text(encoding="utf-8")
            entry = {
                "type": "routine_edit",
                "routine_id": "Sample",
                "day_of_week": "monday",
                "exercise_id": "barbell-back-squat",
                "changes": {"target_reps": 10},
            }
            result = sync._apply_routine_edit(md_path, entry)
            self.assertEqual(result["status"], "failed")
            self.assertIn("exercise", result["reason"].lower())
            self.assertEqual(md_path.read_text(encoding="utf-8"), original)

    def test_missing_required_fields_returns_failed(self):
        with tempfile.TemporaryDirectory() as tmp:
            md_path = self._load_fixture(Path(tmp))
            entry = {
                "type": "routine_edit",
                "routine_id": "Sample",
                "day_of_week": "monday",
                "changes": {"target_reps": 10},
            }
            result = sync._apply_routine_edit(md_path, entry)
            self.assertEqual(result["status"], "failed")

    def test_empty_changes_returns_failed(self):
        with tempfile.TemporaryDirectory() as tmp:
            md_path = self._load_fixture(Path(tmp))
            entry = {
                "type": "routine_edit",
                "routine_id": "Sample",
                "day_of_week": "monday",
                "exercise_id": "flat-db-bench-press",
                "changes": {},
            }
            result = sync._apply_routine_edit(md_path, entry)
            self.assertEqual(result["status"], "failed")
```

- [ ] **Step 2: Run all tests**

```bash
python3 -m unittest tests.test_sync_routine_edit -v
```

Expected: 10 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/test_sync_routine_edit.py
git commit -m "tests: cover failure modes (file/day/exercise missing, empty changes)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Wire `routine_edit` into the sync drain loop

**Files:**
- Modify: `scripts/sync.py`
- Modify: `tests/test_sync_routine_edit.py`

- [ ] **Step 1: Add the routine_edit drain block in `main()`**

In `scripts/sync.py`, locate the drain loop in `main()` (starts at line 464 with `for entry in entries:`). Just BEFORE that `for entry in entries:` line, insert the new routine_edit drain block:

```python
    # routine_edit entries are processed BEFORE log/skip/recovery so that
    # the subsequent re-derive step picks up the freshly-edited MD.
    applied_routine_edits: list[dict] = []
    failed_routine_edits: list[dict] = []
    for entry in entries:
        if entry.get("type") != "routine_edit":
            continue
        routine_id = entry.get("routine_id") or ""
        md_path = plans_dir / f"{routine_id}.md"
        result = _apply_routine_edit(md_path, entry)
        audit = {
            "routine_id": routine_id,
            "day_of_week": entry.get("day_of_week"),
            "exercise_id": entry.get("exercise_id"),
            "changes": entry.get("changes") or {},
            "applied_at": now_iso(),
        }
        if result["status"] == "applied":
            applied_routine_edits.append(audit)
            drained.append(f"routine_edit: {routine_id} {entry.get('day_of_week')} {entry.get('exercise_id')}")
        else:
            audit["reason"] = result.get("reason", "unknown")
            failed_routine_edits.append(audit)
            skipped.append(f"routine_edit failed: {audit['reason']}")

```

- [ ] **Step 2: Skip routine_edit in the existing log/skip/recovery loop**

In the existing `for entry in entries:` block, at the very top (right after `kind = entry.get("type")`), add:

```python
        if kind == "routine_edit":
            continue  # already handled above
```

Also, update the `else: skipped.append(...)` branch to no longer include `routine_edit` as unknown (it already wouldn't match since we `continue` above).

- [ ] **Step 3: Persist audit files after the drain**

After the `for entry in entries:` loop ends (i.e., right before `# Step 3: re-derive routine + log JSONs` around line 510), insert:

```python
    # Persist audit files for routine_edit outcomes.
    if applied_routine_edits:
        applied_path = repo_root / "data" / "applied_routine_edits.json"
        existing = []
        if applied_path.exists():
            try:
                existing = json.loads(applied_path.read_text()).get("entries", [])
            except Exception:
                existing = []
        write_json(applied_path, {"entries": existing + applied_routine_edits})
    if failed_routine_edits:
        failed_path = repo_root / "data" / "failed_routine_edits.json"
        existing = []
        if failed_path.exists():
            try:
                existing = json.loads(failed_path.read_text()).get("entries", [])
            except Exception:
                existing = []
        write_json(failed_path, {"entries": existing + failed_routine_edits})
```

- [ ] **Step 4: Add a drain integration test**

Append to `tests/test_sync_routine_edit.py` (outside the existing class):

```python
class TestDrainIntegration(unittest.TestCase):
    """Verify routine_edit entries flow through sync.main() to the MD."""

    def test_main_applies_routine_edit_and_writes_audit(self):
        import json
        import os
        import shutil
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            # Build fake vault layout matching sync.py's expectations
            vault = tmp_path / "vault"
            project = vault / "🎯 Projects" / "🏋️ Personal Trainer"
            plans = project / "Weekly Plans"
            plans.mkdir(parents=True)
            (project / "Workout Log").mkdir()
            (project / "Recovery Log").mkdir()
            (project / "Log.md").write_text("# Log\n", encoding="utf-8")
            (project / "Recovery Log.md").write_text("# Recovery\n", encoding="utf-8")
            shutil.copy(FIXTURE, plans / "Sample.md")

            repo = tmp_path / "repo"
            (repo / "data" / "routines").mkdir(parents=True)
            (repo / "data" / "exercises").mkdir(parents=True)
            (repo / "data" / "logs").mkdir(parents=True)
            (repo / "data" / "recovery_logs").mkdir(parents=True)
            pending = {
                "entries": [
                    {
                        "type": "routine_edit",
                        "routine_id": "Sample",
                        "day_of_week": "monday",
                        "exercise_id": "flat-db-bench-press",
                        "changes": {
                            "target_weight_kg": 18.0,
                            "target_weight_raw": "40 lbs (18 kg) ea",
                        },
                        "created_at": "2026-05-17T15:42:10Z",
                    }
                ]
            }
            (repo / "data" / "pending.json").write_text(json.dumps(pending), encoding="utf-8")

            os.environ["PT_TRACKER_VAULT_ROOT"] = str(vault)
            os.environ["PT_TRACKER_REPO_ROOT"] = str(repo)
            try:
                rc = sync.main()
            finally:
                del os.environ["PT_TRACKER_VAULT_ROOT"]
                del os.environ["PT_TRACKER_REPO_ROOT"]

            self.assertEqual(rc, 0)
            text = (plans / "Sample.md").read_text(encoding="utf-8")
            self.assertIn("| Flat Dumbbell Bench Press | 40 lbs (18 kg) ea | 10 | 3 |", text)
            applied = json.loads((repo / "data" / "applied_routine_edits.json").read_text())
            self.assertEqual(len(applied["entries"]), 1)
            self.assertEqual(applied["entries"][0]["exercise_id"], "flat-db-bench-press")
            # Pending should be reset
            pending_after = json.loads((repo / "data" / "pending.json").read_text())
            self.assertEqual(pending_after["entries"], [])
```

- [ ] **Step 5: Run all tests**

```bash
python3 -m unittest tests.test_sync_routine_edit -v
```

Expected: 11 tests PASS.

If `sync.main()` errors because the temp repo isn't a git repo, that's expected behavior and the test should still work — `sync.py` already checks `(repo_root / ".git").exists()` before git operations and short-circuits when missing.

- [ ] **Step 6: Commit**

```bash
git add scripts/sync.py tests/test_sync_routine_edit.py
git commit -m "feat: sync drain handles routine_edit entries

Drains routine_edit pending entries before log/skip/recovery and
before the re-derive step. Writes applied/failed audit files.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Web app — pill becomes a button + popover skeleton

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Replace the routine-pill div with a button + popover container**

In `index.html`, locate the `.routine-row` block (line 544):

```html
    <div class="routine-row">
      <div class="routine-pill" id="routine-label" title="Active routine">Loading…</div>
    </div>
```

Replace with:

```html
    <div class="routine-row" style="position: relative;">
      <button type="button" class="routine-pill" id="routine-label" title="Switch routine" aria-haspopup="listbox" aria-expanded="false"><span id="routine-label-text">Loading…</span></button>
      <div class="routine-popover hidden" id="routine-popover" role="listbox"></div>
    </div>
```

The nested `<span id="routine-label-text">` lets us update the text without disturbing the button structure.

- [ ] **Step 2: Update any existing JS that sets the pill label**

Search:
```bash
grep -n 'routine-label' index.html
```

Find every place that sets `routine-label.textContent` or `routine-label.innerText`. Change each to set `routine-label-text` instead. Example (around the `loadRoutines` flow):

Before: `document.getElementById("routine-label").textContent = state.routine.name;`
After: `document.getElementById("routine-label-text").textContent = state.routine.name;`

- [ ] **Step 3: Style the button + popover**

Locate the `.routine-pill` CSS rule (around line 74). Replace with:

```css
  .routine-pill {
    font-size: 13px; color: var(--ink-soft);
    background: var(--bg-soft); border: 1px solid var(--rule);
    padding: 6px 12px; border-radius: 999px;
    max-width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    cursor: pointer; font-family: inherit; font-weight: 500;
    text-align: left;
  }
  .routine-pill:hover { background: var(--bg-card); }
  .routine-pill[aria-expanded="true"] { background: var(--bg-card); }
  .routine-popover {
    position: absolute; z-index: 60; top: 100%; left: 0;
    margin-top: 6px;
    background: var(--bg-card); border: 1px solid var(--rule); border-radius: 12px;
    box-shadow: var(--shadow);
    min-width: 280px; max-width: calc(100vw - 32px);
    padding: 6px;
  }
  .routine-popover-item {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px; border-radius: 8px;
    cursor: pointer; user-select: none;
  }
  .routine-popover-item:hover { background: var(--bg-soft); }
  .routine-popover-item.active { background: var(--accent-soft); }
  .routine-popover-name { flex: 1; font-size: 13px; color: var(--ink); }
  .routine-popover-chip {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    padding: 2px 8px; border-radius: 999px;
    background: var(--bg-soft); color: var(--ink-muted);
  }
  .routine-popover-chip.current { background: var(--accent); color: var(--accent-ink); }
  .routine-popover-chip.upcoming { background: #c7e6ff; color: #1a4a78; }
  .routine-popover-chip.past { background: var(--bg-soft); color: var(--ink-muted); }
  .routine-popover-dates { font-size: 11px; color: var(--ink-muted); display: block; margin-top: 2px; }
```

- [ ] **Step 4: Add a click handler that toggles the popover**

In the JS, near other event bindings (search for `signout-btn` to find the area), add:

```javascript
// Routine picker popover
const _routineBtn = document.getElementById("routine-label");
const _routinePop = document.getElementById("routine-popover");
let _routinePopOpen = false;

function toggleRoutinePopover(force) {
  const open = force === undefined ? !_routinePopOpen : !!force;
  _routinePopOpen = open;
  _routineBtn.setAttribute("aria-expanded", open ? "true" : "false");
  _routinePop.classList.toggle("hidden", !open);
  if (open) renderRoutinePopover();
}

_routineBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  toggleRoutinePopover();
});
document.addEventListener("click", (e) => {
  if (_routinePopOpen && !_routinePop.contains(e.target) && e.target !== _routineBtn) {
    toggleRoutinePopover(false);
  }
});

function renderRoutinePopover() {
  // Placeholder — populated in Task 8.
  while (_routinePop.firstChild) _routinePop.removeChild(_routinePop.firstChild);
  const ph = document.createElement("div");
  ph.className = "routine-popover-item";
  const name = document.createElement("span");
  name.className = "routine-popover-name";
  name.textContent = "(populated next task)";
  ph.appendChild(name);
  _routinePop.appendChild(ph);
}
```

- [ ] **Step 5: Manual verification**

```bash
python3 -m http.server 8765
```

Open `http://localhost:8765/`, sign in. Verify:
- Pill is clickable (cursor changes on hover)
- Tap opens the popover beneath it with the placeholder text
- Tap outside closes it
- Tap pill again closes it
- DevTools shows `aria-expanded` toggling

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "web app: routine pill becomes a clickable popover trigger

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Web app — populate popover with current ± 2 routines

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add window + mode helpers**

In the JS, place this near `pickRoutineForDate` (line 1120):

```javascript
// Return up to 5 routines centered on today's auto-picked routine.
function pickRoutineWindow() {
  const meta = (state.routineMeta || []).filter(m => m.start_date);
  if (!meta.length) return [];
  const sorted = meta.slice().sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""));
  const autoId = pickRoutineForDate(localDateIso());
  const idx = sorted.findIndex(m => m.id === autoId);
  if (idx < 0) return sorted.slice(0, 5);
  const start = Math.max(0, idx - 2);
  return sorted.slice(start, start + 5);
}

// Classify a routine's mode relative to today's auto-pick.
function getRoutineMode(routine) {
  if (!routine) return "current";
  const autoId = pickRoutineForDate(localDateIso());
  if (routine.id === autoId) return "current";
  const today = localDateIso();
  if (routine.start_date && routine.start_date > today) return "upcoming";
  return "past";
}

function shortDate(iso) {
  if (!iso) return "?";
  const parts = iso.split("-");
  return `${parseInt(parts[1], 10)}/${parseInt(parts[2], 10)}`;
}
```

- [ ] **Step 2: Replace the placeholder `renderRoutinePopover` with the real one**

Replace the placeholder from Task 7 Step 4 with:

```javascript
function renderRoutinePopover() {
  while (_routinePop.firstChild) _routinePop.removeChild(_routinePop.firstChild);
  const window_ = pickRoutineWindow();
  const currentId = state.routine?.id;
  if (!window_.length) {
    const empty = document.createElement("div");
    empty.className = "routine-popover-item";
    const name = document.createElement("span");
    name.className = "routine-popover-name";
    name.textContent = "No routines available";
    empty.appendChild(name);
    _routinePop.appendChild(empty);
    return;
  }
  for (const m of window_) {
    const mode = getRoutineMode(m);
    const range = m.end_date ? `${shortDate(m.start_date)} – ${shortDate(m.end_date)}` : `${shortDate(m.start_date)} – ?`;
    const item = document.createElement("div");
    item.className = "routine-popover-item" + (m.id === currentId ? " active" : "");
    item.setAttribute("data-id", m.id);
    item.setAttribute("role", "option");

    const name = document.createElement("span");
    name.className = "routine-popover-name";
    name.textContent = m.name || m.id;
    const dates = document.createElement("span");
    dates.className = "routine-popover-dates";
    dates.textContent = range;
    name.appendChild(dates);

    const chip = document.createElement("span");
    chip.className = "routine-popover-chip " + mode;
    chip.textContent = mode;

    item.appendChild(name);
    item.appendChild(chip);
    item.addEventListener("click", () => selectRoutine(m.id));
    _routinePop.appendChild(item);
  }
}
```

- [ ] **Step 3: Add `selectRoutine`**

Place near `loadRoutines()` (line 1084):

```javascript
async function selectRoutine(id) {
  if (!state.routines.includes(id)) return;
  toggleRoutinePopover(false);
  state.routine = await fetchJson(`data/routines/${id}.json`);
  localStorage.setItem(ROUTINE_KEY, id);
  document.getElementById("routine-label-text").textContent = state.routine.name || id;
  for (const day of Object.values(state.routine.days || {})) {
    for (const ex of (day.exercises || [])) await loadExercise(ex.exercise_id);
  }
  renderApp();
}
```

Verify `loadExercise` exists — search:
```bash
grep -n "loadExercise\b" index.html
```

If `loadExercise` does not exist, look at how `loadRoutines()` pre-fetches exercises (around line 1110) and adapt that inline pattern instead. The skeleton is `await fetchJson(`data/exercises/${id}.json`)` caching into a global map.

- [ ] **Step 4: Manual verification**

Reload. Verify:
- Popover shows up to 5 routines, current highlighted
- Each row: name on top, date range below, mode chip on right
- Tap a different row → popover closes, pill label updates, day toggle updates, exercise cards render for the new routine

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "web app: routine popover lists current ± 2 weeks with mode chips

Selecting a routine swaps state.routine and re-renders.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Web app — mode banners + lockout in past/upcoming modes

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add a banner host above the main app content**

In `index.html`, locate `<main id="app" class="hidden">` (around line 591). Insert as the first child:

```html
    <div id="mode-banner-host"></div>
```

- [ ] **Step 2: Style the banners + mode-based input lockout**

Add to the CSS block (place near other mode-related styles):

```css
  .mode-banner {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px; margin: 0 0 12px;
    border-radius: 10px;
    font-size: 13px; font-weight: 600;
  }
  .mode-banner.past { background: var(--bg-soft); color: var(--ink-soft); border: 1px solid var(--rule); }
  .mode-banner.upcoming { background: #eaf3ff; color: #1a4a78; border: 1px solid #c7e6ff; }
  body.mode-past .submit-row,
  body.mode-upcoming .submit-row { display: none !important; }
  body.mode-past .recovery-panel { display: none !important; }
  body.mode-past input,
  body.mode-past textarea,
  body.mode-past button:not(.routine-pill):not(.routine-popover-item):not(.signout-btn) {
    pointer-events: none; opacity: 0.6;
  }
```

- [ ] **Step 3: Apply mode + render banner on every re-render**

Add this helper in the JS (place near `renderApp`):

```javascript
function applyModeBanner() {
  const host = document.getElementById("mode-banner-host");
  while (host.firstChild) host.removeChild(host.firstChild);
  const mode = getRoutineMode(state.routine);
  document.body.classList.remove("mode-past", "mode-current", "mode-upcoming");
  document.body.classList.add(`mode-${mode}`);
  if (mode === "current") return;
  const banner = document.createElement("div");
  banner.className = "mode-banner " + mode;
  banner.textContent = mode === "past"
    ? "📜 Read-only — historical routine"
    : "🔮 Upcoming routine — pre-tune targets, can't log yet";
  host.appendChild(banner);
}
```

Call `applyModeBanner()` from `renderApp()` (top of the function, before exercise cards render) and from inside `selectRoutine` (right before the final `renderApp()` call).

- [ ] **Step 4: Manual verification**

Reload. Switch between routines:
- Upcoming routine → blue 🔮 banner, Submit button hidden, recovery panel hidden
- Past routine → gray 📜 banner, inputs grayed out, Submit hidden
- Current → no banner, normal UI

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "web app: mode banners + input lockout for past/upcoming routines

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Web app — tap-to-edit inline editor on target line

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Locate where the target line is rendered**

Search:
```bash
grep -n "target_weight_raw\|target_reps\|target_sets" index.html | head -20
```

Identify the function that builds the per-exercise card (look for usage of `target_weight_raw`). Note the local variable names available there (`routine_id`, `day_of_week`, `exercise_id`, the entry fields).

- [ ] **Step 2: Render the target line as a tappable span with data attributes**

When constructing the exercise card, build the target-line element using DOM methods. Where the target string is rendered, replace the existing line construction with:

```javascript
// Inside the exercise-card render function. Adapt variable names to the function's locals.
const targetLine = document.createElement("span");
targetLine.className = "target-line";
targetLine.dataset.routineId = state.routine.id;
targetLine.dataset.day = selectedDay; // the current day_of_week being rendered
targetLine.dataset.exerciseId = exerciseEntry.exercise_id;
targetLine.dataset.weightKg = exerciseEntry.target_weight_kg ?? 0;
targetLine.dataset.weightRaw = exerciseEntry.target_weight_raw ?? "";
targetLine.dataset.reps = exerciseEntry.target_reps ?? 0;
targetLine.dataset.sets = exerciseEntry.target_sets ?? 0;
targetLine.textContent = `${exerciseEntry.target_weight_raw || ""} × ${exerciseEntry.target_reps} × ${exerciseEntry.target_sets}`;
// Append targetLine where the old line went.
```

- [ ] **Step 3: Style the target line + editor**

Append to CSS:

```css
  body.mode-current .target-line,
  body.mode-upcoming .target-line {
    cursor: pointer; text-decoration: underline dotted var(--ink-muted);
  }
  body.mode-past .target-line { cursor: default; }
  .target-editor {
    display: inline-flex; gap: 6px; align-items: center;
    background: var(--bg-soft); border: 1px solid var(--rule);
    border-radius: 8px; padding: 4px 8px; flex-wrap: wrap;
  }
  .target-editor input {
    width: 56px; padding: 4px 6px; font-size: 13px;
    border: 1px solid var(--rule); border-radius: 6px; background: var(--bg-card);
  }
  .target-editor .editor-btn {
    background: var(--accent); color: var(--accent-ink);
    border: none; border-radius: 6px; padding: 4px 8px; font-size: 12px;
    cursor: pointer;
  }
  .target-editor .editor-btn.cancel { background: var(--bg-soft); color: var(--ink-muted); }
```

- [ ] **Step 4: Wire the tap-to-edit handler**

Add near the bottom of the JS:

```javascript
document.addEventListener("click", (e) => {
  const el = e.target.closest(".target-line");
  if (!el) return;
  const mode = getRoutineMode(state.routine);
  if (mode === "past") return;
  if (el.querySelector(".target-editor")) return;
  openTargetEditor(el);
});

function openTargetEditor(el) {
  const weightRaw = el.dataset.weightRaw || "";
  const weightKg = parseFloat(el.dataset.weightKg || "0");
  const reps = parseInt(el.dataset.reps || "0", 10);
  const sets = parseInt(el.dataset.sets || "0", 10);

  const lbsMatch = weightRaw.match(/(\d+(?:\.\d+)?)\s*lbs?/i);
  const lbs = lbsMatch ? parseFloat(lbsMatch[1]) : Math.round(weightKg / 0.4536);
  const hasEaSuffix = / ea$/i.test(weightRaw);
  const originalText = el.textContent;

  while (el.firstChild) el.removeChild(el.firstChild);
  const editor = document.createElement("span");
  editor.className = "target-editor";

  const lbsIn = document.createElement("input");
  lbsIn.type = "number"; lbsIn.step = "0.5"; lbsIn.min = "0"; lbsIn.value = String(lbs);
  lbsIn.dataset.field = "lbs";

  const repsIn = document.createElement("input");
  repsIn.type = "number"; repsIn.step = "1"; repsIn.min = "0"; repsIn.value = String(reps);
  repsIn.dataset.field = "reps";

  const setsIn = document.createElement("input");
  setsIn.type = "number"; setsIn.step = "1"; setsIn.min = "0"; setsIn.value = String(sets);
  setsIn.dataset.field = "sets";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button"; saveBtn.className = "editor-btn save"; saveBtn.textContent = "Save";
  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button"; cancelBtn.className = "editor-btn cancel"; cancelBtn.textContent = "Cancel";

  editor.append(lbsIn, document.createTextNode(" lbs × "), repsIn, document.createTextNode(" × "), setsIn, saveBtn, cancelBtn);
  el.appendChild(editor);

  cancelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    el.textContent = originalText;
  });
  saveBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const newLbs = parseFloat(lbsIn.value);
    const newReps = parseInt(repsIn.value, 10);
    const newSets = parseInt(setsIn.value, 10);
    const newKgRaw = newLbs * 0.4536;
    const newKg = Math.round(newKgRaw * 2) / 2;  // 0.5 kg granularity
    const kgStr = newKg % 1 === 0 ? newKg.toFixed(0) : newKg.toFixed(1);
    const newRaw = `${Math.round(newLbs)} lbs (${kgStr} kg)${hasEaSuffix ? " ea" : ""}`;
    await saveRoutineEdit({
      routine_id: el.dataset.routineId,
      day_of_week: el.dataset.day,
      exercise_id: el.dataset.exerciseId,
      changes: {
        target_weight_kg: newKg,
        target_weight_raw: newRaw,
        target_reps: newReps,
        target_sets: newSets,
      },
    });
    el.dataset.weightKg = String(newKg);
    el.dataset.weightRaw = newRaw;
    el.dataset.reps = String(newReps);
    el.dataset.sets = String(newSets);
    el.textContent = `${newRaw} × ${newReps} × ${newSets}`;
  });
}

async function saveRoutineEdit(payload) {
  const entry = {
    type: "routine_edit",
    routine_id: payload.routine_id,
    day_of_week: payload.day_of_week,
    exercise_id: payload.exercise_id,
    changes: payload.changes,
    created_at: isoNow(),
    client_id: "web",
  };
  await appendPending(entry);
}
```

- [ ] **Step 5: Add dedupe rule for routine_edit in `appendPending`**

Find `appendPending` (line 1188). It currently builds a dedupe key for `log`/`skip`/`recovery` entries before pushing. Add an `else if (entry.type === "routine_edit")` branch that filters out any existing pending entry with the same `(routine_id, day_of_week, exercise_id)`. Read the existing function and match its style; example:

```javascript
} else if (entry.type === "routine_edit") {
  const sig = `${entry.routine_id}|${entry.day_of_week}|${entry.exercise_id}`;
  entries = entries.filter(e => !(e.type === "routine_edit" &&
    `${e.routine_id}|${e.day_of_week}|${e.exercise_id}` === sig));
}
```

- [ ] **Step 6: Manual verification**

Reload:
- Tap target line on an upcoming routine's exercise → inline editor with three inputs
- Change weight 35 → 40, click Save → target shows `40 lbs (18 kg) ea × 10 × 3`
- Open `data/pending.json` on GitHub: a `routine_edit` entry exists with the new values
- Tap target again, change 40 → 45 → Save → pending.json has only ONE entry for that exercise (dedupe verified)
- On a past routine: target line has no dotted underline and tap does nothing

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "web app: tap-to-edit target weight/reps/sets on current+upcoming routines

Edits append routine_edit entries to data/pending.json with pre-dedupe
by (routine, day, exercise). UI updates immediately; daily sync writes
back to vault MD.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Web app — past-week overlay of logged sets

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add `loadPastLogsForRoutine` helper**

In the JS, near `loadRoutines()`:

```javascript
async function loadPastLogsForRoutine(routine) {
  if (!routine || !routine.start_date) return {};
  const startDate = routine.start_date;
  let endDate = routine.end_date;
  if (!endDate) {
    const d = new Date(startDate + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 6);
    endDate = d.toISOString().slice(0, 10);
  }
  let logsListing;
  try {
    logsListing = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/data/logs`).then(r => r.ok ? r.json() : []);
  } catch (e) {
    console.warn("logs listing failed", e);
    return {};
  }
  const files = (Array.isArray(logsListing) ? logsListing : [])
    .filter(f => f.name && f.name.endsWith(".json"))
    .map(f => f.name.replace(/\.json$/, ""));
  const matching = files.filter(name => {
    const date = name.slice(0, 10);
    return date >= startDate && date <= endDate;
  });
  const byDay = {};
  for (const fileId of matching) {
    try {
      const log = await fetchJson(`data/logs/${fileId}.json`);
      if (log && log.day_of_week) byDay[log.day_of_week] = log;
    } catch (e) {
      // skip a single bad log
    }
  }
  return byDay;
}
```

- [ ] **Step 2: Trigger the fetch when switching to a past routine**

Update `selectRoutine` to call the fetch when past:

```javascript
async function selectRoutine(id) {
  if (!state.routines.includes(id)) return;
  toggleRoutinePopover(false);
  state.routine = await fetchJson(`data/routines/${id}.json`);
  localStorage.setItem(ROUTINE_KEY, id);
  document.getElementById("routine-label-text").textContent = state.routine.name || id;
  for (const day of Object.values(state.routine.days || {})) {
    for (const ex of (day.exercises || [])) await loadExercise(ex.exercise_id);
  }
  state.pastLogsByDay = getRoutineMode(state.routine) === "past"
    ? await loadPastLogsForRoutine(state.routine)
    : null;
  renderApp();
}
```

Also call this past-fetch from the initial `loadRoutines()` flow after `state.routine` is first set (in case the auto-picked routine itself is past).

- [ ] **Step 3: Render the actual-sets line on each exercise card in past mode**

In the function that renders an exercise card, after the target-line element is appended, add:

```javascript
if (getRoutineMode(state.routine) === "past") {
  const log = state.pastLogsByDay?.[selectedDay];
  const actualEl = document.createElement("div");
  actualEl.className = "actual-line";
  actualEl.textContent = buildActualText(log, exerciseEntry.exercise_id);
  // Append actualEl to the same container the target-line went into.
}
```

Add `buildActualText` near other render helpers:

```javascript
function buildActualText(log, exerciseId) {
  if (!log) return "actual: —";
  const ex = (log.exercises || []).find(e => e.exercise_id === exerciseId);
  if (!ex || !Array.isArray(ex.sets) || !ex.sets.length) return "actual: —";
  const parts = ex.sets.map(s => {
    const lbs = s.weight_kg != null ? Math.round(s.weight_kg / 0.4536) : "?";
    return `${lbs} lbs × ${s.reps ?? "?"}`;
  });
  return "actual: " + parts.join(", ");
}
```

CSS:

```css
  .actual-line {
    font-size: 12px; color: var(--ink-muted);
    margin-top: 4px; font-style: italic;
  }
```

- [ ] **Step 4: Manual verification**

Switch to a past routine (e.g., W18):
- Each exercise card shows `actual: 35 lbs × 12, 35 × 10, 30 × 10` (or `actual: —` if not logged)
- Inputs disabled (from Task 9), banner visible
- Switch back to current → no `actual:` lines

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "web app: past-routine view overlays actual logged sets

Logs are matched to the routine by date range (start_date to end_date,
or start_date + 6 days when end_date is null). Read-only view.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Update CLAUDE.md and COWORK_SYNC_TASK.md

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/COWORK_SYNC_TASK.md`

- [ ] **Step 1: Add `routine_edit` to CLAUDE.md schema highlights**

In `CLAUDE.md`, find "Schema highlights". Replace the first bullet:

Before:
```
- **Pending entry types**: `log` (workout), `skip` (didn't do the workout), `recovery` (sauna/plunge)
```

After:
```
- **Pending entry types**: `log` (workout), `skip` (didn't do the workout), `recovery` (sauna/plunge), `routine_edit` (in-app target tweak — rewrites a cell in the Weekly Plan MD on next sync)
```

Add a new bullet to the same list:

```
- **`routine_edit` entry shape**: `{type: "routine_edit", routine_id, day_of_week, exercise_id, changes: {target_weight_kg?, target_weight_raw?, target_reps?, target_sets?}, created_at}`. `changes` is partial — only edited fields are present. `target_weight_raw` is included whenever `target_weight_kg` changes (web app pre-formats the lbs/kg string and preserves any `ea` suffix from the prior raw value).
```

- [ ] **Step 2: Extend convention #5**

Find convention #5:

Before:
```
5. **Pre-dedupe on append**: the web app's `appendPending()` removes any existing pending entry for the same slot before pushing a new one. Workouts dedupe by `(date, day_of_week, type)`; recovery by `(date, location)`.
```

After:
```
5. **Pre-dedupe on append**: the web app's `appendPending()` removes any existing pending entry for the same slot before pushing a new one. Workouts dedupe by `(date, day_of_week, type)`; recovery by `(date, location)`; routine_edit by `(routine_id, day_of_week, exercise_id)`.
```

- [ ] **Step 3: Document the new behavior in `docs/COWORK_SYNC_TASK.md`**

Read the file:
```bash
cat docs/COWORK_SYNC_TASK.md
```

Find the section that describes how `log` / `skip` / `recovery` entries are drained from `pending.json`. Add a parallel paragraph for `routine_edit`. The new paragraph must say:

- `routine_edit` is drained BEFORE log/skip/recovery so the re-derive step picks up the edited MD.
- For each entry, `sync.py` opens `Weekly Plans/{routine_id}.md`, finds the matching day section and exercise row, and rewrites cells for any of `working weight` / `reps` / `sets` that appear in `changes`. The `notes` column is never touched.
- Failure modes (missing file, day-not-found, exercise-not-found, malformed table) are non-fatal — the entry is recorded to `data/failed_routine_edits.json`, sync continues with the remaining entries.
- Successful applications are recorded to `data/applied_routine_edits.json` for audit. Both audit files are committed by the daily sync.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/COWORK_SYNC_TASK.md
git commit -m "docs: document routine_edit pending type and writeback behavior

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: End-to-end manual verification + dry-run sync

**Files:**
- No code changes; verification only.

- [ ] **Step 1: Walk through the web-app test plan**

```bash
python3 -m http.server 8765
```

Open `http://localhost:8765/`, sign in. Verify each:

1. Pill shows current routine name → tap → popover lists up to 5 routines with chips + date ranges.
2. Select W21 (upcoming) → blue 🔮 banner, day toggle shows W21's days, W21 targets render.
3. Tap a target line → inline editor → 35 → 40 → Save → target shows 40 immediately.
4. Check `data/pending.json` on GitHub: one `routine_edit` entry with the new value.
5. Tap target again, 40 → 45 → Save → pending.json still has only ONE entry (dedupe).
6. Switch to W18 (past) → gray 📜 banner, inputs disabled, `actual: ...` lines beneath each exercise.
7. Switch back to current → no banner, full UI restored, Submit visible.

- [ ] **Step 2: Dry-run sync against a vault copy**

Make a throwaway vault copy so we don't touch the real one:

```bash
mkdir -p "/tmp/pt-vault-test/🎯 Projects"
cp -R "$HOME/Documents/Jonathan's Vault/🎯 Projects/🏋️ Personal Trainer" "/tmp/pt-vault-test/🎯 Projects/"
cp -R . /tmp/pt-repo-test
rm -rf /tmp/pt-repo-test/.git  # avoid touching the real branch state
PT_TRACKER_VAULT_ROOT="/tmp/pt-vault-test" PT_TRACKER_REPO_ROOT="/tmp/pt-repo-test" python3 scripts/sync.py
```

Verify after the run:
- The relevant Weekly Plan MD in `/tmp/pt-vault-test/.../Weekly Plans/` has the updated cell value.
- `/tmp/pt-repo-test/data/applied_routine_edits.json` exists and contains an audit entry.
- `/tmp/pt-repo-test/data/routines/{routine_id}.json` has the new target values.
- `/tmp/pt-repo-test/data/pending.json` was reset to `{entries: []}`.

If anything fails, capture stderr and revisit the relevant task.

- [ ] **Step 3: Run the full test suite**

```bash
python3 -m unittest tests.test_sync_routine_edit -v
```

Expected: 11 tests PASS.

- [ ] **Step 4: Optional cleanup commit**

If verification revealed any small fixes, commit them:

```bash
git add -A
git commit -m "polish: verification fixes from end-to-end walkthrough

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Do NOT push to remote unless the user explicitly requests it.

---

## Self-Review Notes

- All popover/editor DOM construction uses `createElement` + `textContent` (no `innerHTML` interpolation of data). Avoids XSS surface even though routine/exercise names come from a trusted repo.
- The `loadExercise` function is referenced in `selectRoutine` (Task 8). If it doesn't exist, Task 8 Step 3 directs the implementer to adapt the inline pre-fetch pattern from `loadRoutines`.
- The drain integration test (Task 6) relies on `sync.main()` short-circuiting git when no `.git` exists in `repo_root` — verified via `(repo_root / ".git").exists()` check at line 431 of `sync.py`.
- The pill-label text update strategy uses a nested `<span id="routine-label-text">` (Task 7 Step 1, 2) so the button's children remain stable.
- Failure modes for `_apply_routine_edit` return `{status: "failed", reason}`; the integration test does not exercise these end-to-end through `main()` — that's covered by the unit tests in Task 5.
- Spec coverage check: section 1 (UI) → Tasks 7–11; section 2 (pending schema + dedupe) → Tasks 6, 10; section 3 (sync writeback) → Tasks 3, 6; section 4 (past-week overlay) → Task 11; section 5 (testing) → Tasks 2–6 + Task 13. All spec sections have at least one task.
