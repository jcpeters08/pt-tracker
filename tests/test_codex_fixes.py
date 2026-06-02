"""Regression tests for the Codex-validation fixes (2026-05-30).

Covers:
  - parse_routine: start_date derived from the first day-header date, not the
    ISO-week-of-id (C8).
  - parse_log: legacy block headings ("## Core Block", "## Chest / Triceps
    Block") parse as exercises, with inline "(warmup)" rows routed out of
    working volume; summary/progression tables are NOT pulled in (C13).
  - parse_overview: light profile extraction from Overview.md (C7).
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import parse_routine as pr   # noqa: E402
import parse_log as pl       # noqa: E402
import parse_overview as po  # noqa: E402


ROUTINE_W18 = """---
type: project
tags:
  - weekly-plan
---
# Week 18 — CDMX Closeout (Mon 5/4 - Thu 5/7)

## Mon 5/4 — Push (Chest / Shoulders / Triceps)

| # | Exercise | Working Weight | Reps | Sets | Notes |
|---|----------|----------------|------|------|-------|
| 1 | Flat DB Bench Press | 16 kg | 10 | 3 | x |

## Tue 5/5 — Pull (Back / Biceps)

| # | Exercise | Working Weight | Reps | Sets | Notes |
|---|----------|----------------|------|------|-------|
| 1 | Lat Pulldown | 41 kg | 12 | 3 | y |
"""

ROUTINE_FM_WINS = """---
start_date: 2026-06-01
---
# Plan

## Mon 5/4 — Push

| # | Exercise | Working Weight | Reps | Sets | Notes |
|---|----------|----------------|------|------|-------|
| 1 | Flat DB Bench Press | 16 kg | 10 | 3 | x |
"""

LOG_BLOCK = """---
type: log
tags:
  - fitness
  - workout-log
  - push-day
---
# Push + Core

**Phase:** 1

## Core Block

| Exercise | Weight | Reps | Sets | Notes |
|----------|--------|------|------|-------|
| V-up / Toe-Touch Hybrid | bodyweight | 15 | 2 | NEW |
| Plank | bodyweight | 60 sec | 2 | Hold |

## Chest / Triceps Block

| Exercise | Weight | Reps | Sets | Notes |
|----------|--------|------|------|-------|
| Incline Dumbbell Bench Press (warmup) | 5 kg | 12 | 2 | Warmup — not counted in working volume |
| Flat Dumbbell Bench Press | 18 kg | 15 | 3 | working |
| Rope Triceps Pushdown (Cable) | 20 kg | 15 | 3 | working |

## Volume Summary

| Muscle Group | Working Sets | Notes |
|---|---|---|
| Chest | 3 | should NOT be parsed as an exercise |
"""

OVERVIEW = """---
type: project
---
# Personal Trainer

## Goal
- **Weight:** ~180 lbs (secondary to body composition)
- **Body fat:** <=17% (primary target)

## Status
🟢 Phase 2 active — launched Mon 5/11 at Planet Fitness NE. Re-entry week holds ceilings.
- Active routine: [[2026-W22-Phase-2-Week-3-Reentry|W22 Phase 2 Week 3]]
"""


class TestRoutineStartDate(unittest.TestCase):
    def test_start_date_from_day_header_not_iso_week(self):
        routine = pr.parse_routine_md(ROUTINE_W18, routine_id="2026-W18-CDMX-Phase-1-Closeout")
        # ISO-week-18 Monday is 2026-04-27; the plan's first dated day is 5/4.
        self.assertEqual(routine["start_date"], "2026-05-04")

    def test_frontmatter_start_date_wins(self):
        routine = pr.parse_routine_md(ROUTINE_FM_WINS, routine_id="2026-W18-Whatever")
        self.assertEqual(routine["start_date"], "2026-06-01")

    def test_lbs_primary_weight_uses_authored_pounds_not_rounded_kg_parenthetical(self):
        routine = pr.parse_routine_md("""---
phase: 2
---
# Plan

## Mon 6/8 — Push

| # | Exercise | Working Weight | Reps | Sets | Notes |
|---|----------|----------------|------|------|-------|
| 1 | Rope Tricep Pushdown (Cable) | 25 lbs (11 kg) | 12 | 3 | x |
| 2 | Flat DB Bench Press | 16 kg (35 lbs) ea | 10 | 3 | y |
""", routine_id="2026-W24-Phase-2-Week-5-Progression")
        exercises = routine["days"]["monday"]["exercises"]
        self.assertAlmostEqual(exercises[0]["target_weight_kg"], 11.34)
        self.assertEqual(exercises[1]["target_weight_kg"], 16.0)


class TestLogBlockHeadings(unittest.TestCase):
    def setUp(self):
        self.log = pl.parse_log_md(LOG_BLOCK, filename="2026-04-29-Wednesday-Push.md")

    def test_working_exercises_parsed_from_block_headings(self):
        ids = [e["exercise_id"] for e in self.log["exercises"]]
        self.assertEqual(
            ids,
            ["v-up", "plank", "flat-db-bench-press", "rope-tricep-pushdown"],
        )

    def test_inline_warmup_row_routed_out_of_working(self):
        warm = [e["exercise_id"] for e in self.log["warmup_exercises"]]
        self.assertEqual(warm, ["incline-db-bench-press"])
        self.assertNotIn("incline-db-bench-press", [e["exercise_id"] for e in self.log["exercises"]])

    def test_volume_summary_table_not_parsed_as_exercise(self):
        ids = [e["exercise_id"] for e in self.log["exercises"]]
        self.assertNotIn("chest", ids)

    def test_total_working_sets(self):
        nsets = sum(len(e["sets"]) for e in self.log["exercises"])
        # v-up(2) + plank(2) + flat(3) + pushdown(3) = 10 working sets
        self.assertEqual(nsets, 10)


class TestParseOverview(unittest.TestCase):
    def setUp(self):
        self.profile = po.parse_overview_md(OVERVIEW)

    def test_phase(self):
        self.assertEqual(self.profile.get("phase"), "2")

    def test_active_routine(self):
        self.assertEqual(self.profile.get("active_routine"), "2026-W22-Phase-2-Week-3-Reentry")

    def test_gym(self):
        self.assertIn("Planet Fitness NE", self.profile.get("gym", ""))

    def test_goals(self):
        self.assertTrue(any("180" in g for g in self.profile.get("goals", [])))


if __name__ == "__main__":
    unittest.main()
