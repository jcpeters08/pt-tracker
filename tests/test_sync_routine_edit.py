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


if __name__ == "__main__":
    unittest.main()
