"""Round-trip coverage for the vault render → parse path used by sync.py.

Regressions pinned here (all reproduced before the fix):
  - every data/exercises/<id>.json name must resolve back to its own id, or the
    MD→JSON re-derive rewrites a logged session's exercise_id;
  - a '|' in an exercise note is escaped as '\\|' on render, so the table splitter
    must honor that escape (and routine_edit must re-escape when it re-joins);
  - append_log_index_line must not let a '-Skipped' wikilink shadow the real
    session link for the same slot;
  - _format_weight must emit a value that pc.parse_weight turns back into the
    stored kg (storage is kg-canonical) for whole-lb, 2.5-lb and kg-mode entries.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import parse_log as pl       # noqa: E402
import parse_routine as pr   # noqa: E402
import pt_common as pc       # noqa: E402
import sync                  # noqa: E402

EXERCISES_DIR = REPO_ROOT / "data" / "exercises"


def _session(exercises=None, **overrides) -> dict:
    """Shape of js/payloads.js buildSessionPayload: display_name is the exercise
    file's name, sets carry only weight_kg (2 dp) + reps, no weight_raw."""
    s = {
        "date": "2026-10-19",
        "day_of_week": "monday",
        "type": "push",
        "submitted_at": "2026-10-19T18:00:00Z",
        "exercises": exercises if exercises is not None else [
            {
                "exercise_id": "flat-db-bench-press",
                "display_name": "Flat Dumbbell Bench Press",
                "sets": [{"set": i, "weight_kg": 27.22, "reps": r} for i, r in enumerate((12, 12, 11), 1)],
                "notes": "",
            }
        ],
        "session_notes": "",
    }
    s.update(overrides)
    return s


def _round_trip(session: dict) -> dict:
    md = sync.render_log_md(session, {})
    parsed = pl.parse_log_md(md, filename=sync._filename_for_session(session))
    assert parsed is not None
    return parsed


class TestExerciseNamesRoundTrip(unittest.TestCase):
    def test_every_exercise_file_name_resolves_to_its_own_id(self):
        files = sorted(EXERCISES_DIR.glob("*.json"))
        self.assertGreater(len(files), 0)
        mismatches = []
        for f in files:
            ex = json.loads(f.read_text(encoding="utf-8"))
            resolved = pc.resolve_exercise_id(ex["name"], warn=False)
            got = resolved[0] if resolved else None
            if got != ex["id"] or ex["id"] != f.stem:
                mismatches.append(f"{f.name}: name {ex['name']!r} -> {got!r}")
        self.assertEqual(mismatches, [])

    def test_previously_broken_names_resolve(self):
        self.assertEqual(pc.resolve_exercise_id("Bent-Over Dumbbell Row", warn=False)[0], "bent-over-db-row")
        self.assertEqual(pc.resolve_exercise_id("Dumbbell Front Raise", warn=False)[0], "db-front-raise")
        self.assertEqual(
            pc.resolve_exercise_id("Overhead Cable Tricep Extension (Rope)", warn=False)[0],
            "overhead-cable-tricep-extension",
        )


class TestEscapedPipe(unittest.TestCase):
    def test_split_table_row_honors_escaped_pipe(self):
        self.assertEqual(pc.split_table_row("| a \\| b | c |"), ["a | b", "c"])
        self.assertEqual(pc.split_table_row("| Exercise | Weight |"), ["Exercise", "Weight"])
        # A backslash not immediately before a pipe is ordinary cell content.
        self.assertEqual(pc.split_table_row("| a\\ | b |"), ["a\\", "b"])

    def test_join_table_row_is_inverse_of_split(self):
        cells = ["Flat DB Bench Press", "60 lbs (27 kg) ea", "10", "3", "left 10 | right 9"]
        row = pc.join_table_row(cells)
        self.assertEqual(row, "| Flat DB Bench Press | 60 lbs (27 kg) ea | 10 | 3 | left 10 \\| right 9 |")
        self.assertEqual(pc.split_table_row(row), cells)

    def test_exercise_note_with_pipe_survives_render_parse_round_trip(self):
        session = _session()
        session["exercises"][0]["notes"] = "left 10 | right 9"
        parsed = _round_trip(session)
        ex = parsed["exercises"]
        self.assertEqual(len(ex), 1)
        self.assertEqual(ex[0]["exercise_id"], "flat-db-bench-press")
        self.assertEqual(ex[0]["notes"], "left 10 | right 9")
        self.assertEqual([s["reps"] for s in ex[0]["sets"]], [12, 12, 11])

    def test_routine_edit_preserves_escaped_pipe_in_notes_cell(self):
        md_text = (
            "---\nstart_date: 2026-10-19\n---\n# Plan\n\n"
            "## Mon 10/19 — Push\n\n"
            "| # | Exercise | Working Weight | Reps | Sets | Notes |\n"
            "|---|----------|----------------|------|------|-------|\n"
            "| 1 | Flat DB Bench Press | 60 lbs (27 kg) ea | 10 | 3 | 12/12/12 → 65 \\| strict |\n"
        )
        with tempfile.TemporaryDirectory() as tmp:
            md_path = Path(tmp) / "Plan.md"
            md_path.write_text(md_text, encoding="utf-8")
            result = sync._apply_routine_edit(md_path, {
                "type": "routine_edit", "routine_id": "Plan", "day_of_week": "monday",
                "exercise_id": "flat-db-bench-press", "changes": {"target_reps": 12},
            })
            self.assertEqual(result["status"], "applied")
            text = md_path.read_text(encoding="utf-8")
            self.assertIn("| 1 | Flat DB Bench Press | 60 lbs (27 kg) ea | 12 | 3 | 12/12/12 → 65 \\| strict |", text)
            routine = pr.parse_routine_md(text, routine_id="Plan")
            ex = routine["days"]["monday"]["exercises"][0]
            self.assertEqual(ex["target_reps"], 12)
            self.assertEqual(ex["notes"], "12/12/12 → 65 | strict")


class TestLogIndexLine(unittest.TestCase):
    def test_log_index_line_added_after_skip_for_same_slot(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_md = Path(tmp) / "Log.md"
            skip = {"date": "2026-10-19", "day_of_week": "monday", "type": "push", "reason": "sick"}
            sync.append_skip_index_line(log_md, skip)
            sync.append_log_index_line(log_md, _session())
            text = log_md.read_text(encoding="utf-8")
            self.assertIn("[[2026-10-19-Monday-Push-Skipped|Monday Push]] — **skipped**", text)
            self.assertIn("[[2026-10-19-Monday-Push|Monday Push]] — 1 exercises", text)

    def test_index_lines_are_not_duplicated(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_md = Path(tmp) / "Log.md"
            sync.append_log_index_line(log_md, _session())
            sync.append_log_index_line(log_md, _session())
            skip = {"date": "2026-10-19", "day_of_week": "monday", "type": "push"}
            sync.append_skip_index_line(log_md, skip)
            sync.append_skip_index_line(log_md, skip)
            lines = [ln for ln in log_md.read_text(encoding="utf-8").splitlines() if ln.startswith("- ")]
            self.assertEqual(len(lines), 2)


def _fw(kg: float) -> str:
    return sync._format_weight({"sets": [{"set": 1, "weight_kg": kg, "reps": 10}]})


class TestFormatWeight(unittest.TestCase):
    def test_whole_pound_output_unchanged(self):
        # App-stored (round(lbs * 0.453592, 2)) and parse-derived (0.4536) whole-lb values.
        self.assertEqual(_fw(27.22), "60 lbs (27.2 kg)")
        self.assertEqual(_fw(9.07), "20 lbs (9.1 kg)")
        self.assertEqual(_fw(36.29), "80 lbs (36.3 kg)")
        self.assertEqual(_fw(2.27), "5 lbs (2.3 kg)")
        self.assertEqual(_fw(61.23), "135 lbs (61.2 kg)")   # 135 * 0.453592 rounds down
        self.assertEqual(_fw(61.24), "135 lbs (61.2 kg)")   # 135 * 0.4536 rounds up
        self.assertEqual(_fw(0), "bodyweight")

    def test_half_pound_renders_one_decimal(self):
        self.assertEqual(_fw(64.64), "142.5 lbs (64.6 kg)")
        self.assertEqual(_fw(12.47), "27.5 lbs (12.5 kg)")
        self.assertEqual(_fw(3.4), "7.5 lbs (3.4 kg)")

    def test_kg_mode_value_renders_kg_first(self):
        self.assertEqual(_fw(27.5), "27.5 kg (61 lbs)")
        self.assertEqual(_fw(20), "20 kg (44 lbs)")     # 44.1 lbs would parse back to 20.0, but is not a plate load
        self.assertEqual(_fw(45), "45 kg (99 lbs)")     # likewise 99.2 lbs
        self.assertEqual(_fw(5), "5 kg (11 lbs)")
        self.assertEqual(_fw(2.5), "2.5 kg (6 lbs)")
        self.assertEqual(_fw(64.55), "64.55 kg (142 lbs)")  # 142.3 lbs typed in lbs mode: kept exact, kg first

    def test_rendered_weight_parses_back_to_stored_kg(self):
        for kg in (27.22, 9.07, 2.27, 64.64, 12.47, 3.4, 27.5, 20, 45, 110, 5, 2.5, 24.5, 64.55, 142.5, 0):
            with self.subTest(kg=kg):
                parsed_kg, _ = pc.parse_weight(_fw(kg))
                self.assertEqual(parsed_kg, round(kg, 2))

    def test_session_weights_survive_render_parse_round_trip(self):
        session = _session(exercises=[
            {"exercise_id": "barbell-rdl", "display_name": "Barbell Romanian Deadlift",
             "sets": [{"set": 1, "weight_kg": 64.64, "reps": 8}, {"set": 2, "weight_kg": 64.64, "reps": 8}],
             "notes": ""},
            {"exercise_id": "lat-pulldown", "display_name": "Lat Pulldown",
             "sets": [{"set": 1, "weight_kg": 27.5, "reps": 12}], "notes": "kg mode"},
            {"exercise_id": "plank", "display_name": "Plank",
             "sets": [{"set": 1, "weight_kg": 0, "reps": 60}], "notes": ""},
        ])
        parsed = _round_trip(session)
        got = [(e["exercise_id"], [s["weight_kg"] for s in e["sets"]]) for e in parsed["exercises"]]
        self.assertEqual(got, [
            ("barbell-rdl", [64.64, 64.64]),
            ("lat-pulldown", [27.5]),
            ("plank", [0.0]),
        ])


if __name__ == "__main__":
    unittest.main()
