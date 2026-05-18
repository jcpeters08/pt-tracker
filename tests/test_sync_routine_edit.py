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


if __name__ == "__main__":
    unittest.main()
