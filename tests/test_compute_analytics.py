"""Tests for scripts/compute_analytics.py aggregations.

Covers:
  - Recovery weekly totals from `rounds_detail` (uneven rounds must not be
    overcounted by rounds * rounded-average) + legacy fallback (P1.2).
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import compute_analytics as ca  # noqa: E402
import pt_common as pc  # noqa: E402
import sync  # noqa: E402


def _compute_with_recovery(entries: list[dict]) -> dict:
    """Run ca.compute against a temp repo containing only the given recovery logs."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "data" / "recovery_logs").mkdir(parents=True)
        (root / "data" / "logs").mkdir(parents=True)
        (root / "data" / "exercises").mkdir(parents=True)
        for e in entries:
            (root / "data" / "recovery_logs" / f"{e['id']}.json").write_text(
                json.dumps(e), encoding="utf-8"
            )
        return ca.compute(root)


def _compute_repo(routines: list[dict] | None = None, logs: list[dict] | None = None,
                  recovery: list[dict] | None = None) -> dict:
    """Run ca.compute against a temp repo built from the given JSON entries."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        for sub in ("routines", "logs", "recovery_logs", "exercises"):
            (root / "data" / sub).mkdir(parents=True)
        for r in routines or []:
            (root / "data" / "routines" / f"{r['id']}.json").write_text(json.dumps(r), encoding="utf-8")
        for lg in logs or []:
            (root / "data" / "logs" / f"{lg['id']}.json").write_text(json.dumps(lg), encoding="utf-8")
        for rec in recovery or []:
            (root / "data" / "recovery_logs" / f"{rec['id']}.json").write_text(json.dumps(rec), encoding="utf-8")
        return ca.compute(root)


class TestRecoveryAnalytics(unittest.TestCase):
    def test_uneven_rounds_detail_uses_direct_sum_not_rounds_times_average(self):
        # rounds_detail sums to (35, 8). The rounded per-round averages are
        # sauna_min=18 (round(35/2)), plunge_min=4, so the old formula
        # rounds(2) * avg gave (36, 8) — an overcount. New code must use 35/8.
        entry = {
            "id": "2026-05-14-embrace-north",
            "date": "2026-05-14",
            "location": "Embrace North",
            "rounds": 2,
            "sauna_min": 18,
            "plunge_min": 4,
            "total_min": 43,
            "rounds_detail": [
                {"round": 1, "sauna_min": 18, "plunge_min": 4},
                {"round": 2, "sauna_min": 17, "plunge_min": 4},
            ],
        }
        out = _compute_with_recovery([entry])
        wk = ca._iso_week("2026-05-14")
        rbw = out["recovery_by_week"][wk]
        self.assertEqual(rbw["sauna_min_total"], 35)   # not 2 * 18 = 36
        self.assertEqual(rbw["plunge_min_total"], 8)
        self.assertEqual(rbw["sessions"], 1)

    def test_rounds_detail_with_null_per_round_values_are_treated_as_zero(self):
        entry = {
            "id": "2026-06-01-embrace-north",
            "date": "2026-06-01",
            "location": "Embrace North",
            "rounds": 2,
            "rounds_detail": [
                {"round": 1, "sauna_min": 15, "plunge_min": None},
                {"round": 2, "sauna_min": None, "plunge_min": 5},
            ],
        }
        out = _compute_with_recovery([entry])
        wk = ca._iso_week("2026-06-01")
        rbw = out["recovery_by_week"][wk]
        self.assertEqual(rbw["sauna_min_total"], 15)
        self.assertEqual(rbw["plunge_min_total"], 5)

    def test_legacy_entry_without_detail_uses_rounds_times_per_round(self):
        # Backward compatibility: uniform-round entries with no rounds_detail
        # still aggregate as rounds * per-round.
        entry = {
            "id": "2026-05-21-embrace-north",
            "date": "2026-05-21",
            "location": "Embrace North",
            "rounds": 3,
            "sauna_min": 15,
            "plunge_min": 4,
            "total_min": 57,
            "rounds_detail": None,
        }
        out = _compute_with_recovery([entry])
        wk = ca._iso_week("2026-05-21")
        rbw = out["recovery_by_week"][wk]
        self.assertEqual(rbw["sauna_min_total"], 45)   # 3 * 15
        self.assertEqual(rbw["plunge_min_total"], 12)  # 3 * 4


class TestSessionCompliance(unittest.TestCase):
    @staticmethod
    def _routine(rid, start_date, exercise_days, empty_days=()):
        days = {}
        for d in exercise_days:
            days[d] = {"label": d, "exercises": [
                {"exercise_id": "plank", "sets": [{"set": 1, "weight_kg": 0, "reps": 10}]}]}
        for d in empty_days:
            days[d] = {"label": d, "exercises": []}
        return {"id": rid, "name": rid, "start_date": start_date, "end_date": None, "days": days}

    @staticmethod
    def _log(date, day, type_="push"):
        return {"id": f"{date}-{day}-{type_}", "date": date, "day_of_week": day,
                "type": type_, "exercises": []}

    def test_planned_counts_nonempty_days_only(self):
        r = self._routine("2026-W21-x", "2026-05-18",
                           ["monday", "wednesday", "thursday", "friday"], empty_days=["tuesday"])
        out = _compute_repo(routines=[r])
        wk = ca._iso_week("2026-05-18")  # 2026-W21
        self.assertEqual(out["session_compliance"][wk]["planned"], 4)  # Tue OFF excluded

    def test_completed_and_completion_rate(self):
        r = self._routine("2026-W21-x", "2026-05-18",
                           ["monday", "wednesday", "thursday", "friday"])
        logs = [self._log("2026-05-18", "monday"), self._log("2026-05-20", "wednesday")]
        out = _compute_repo(routines=[r], logs=logs)
        sc = out["session_compliance"][ca._iso_week("2026-05-18")]
        self.assertEqual(sc["planned"], 4)
        self.assertEqual(sc["completed"], 2)
        self.assertEqual(sc["completion_rate"], 0.5)

    def test_week_with_logs_but_no_routine_has_null_planned(self):
        logs = [self._log("2026-04-27", "monday", "legs")]  # ISO W18 — no routine maps here
        out = _compute_repo(logs=logs)
        sc = out["session_compliance"][ca._iso_week("2026-04-27")]
        self.assertIsNone(sc["planned"])
        self.assertEqual(sc["completed"], 1)
        self.assertIsNone(sc["completion_rate"])

    def test_planned_keys_by_iso_week_of_start_date_w18_lands_on_w19(self):
        # A routine named W18 but starting 2026-05-04 maps to ISO W19 (post-C8 fix),
        # not W18 — planned follows the calendar week of start_date.
        r = self._routine("2026-W18-CDMX", "2026-05-04",
                           ["monday", "tuesday", "wednesday", "thursday"])
        out = _compute_repo(routines=[r])
        self.assertEqual(out["session_compliance"]["2026-W19"]["planned"], 4)
        self.assertNotIn("2026-W18", out["session_compliance"])


class TestPersonalRecords(unittest.TestCase):
    @staticmethod
    def _log(date, weight, reps, ex="flat-db-bench-press"):
        return {"id": f"{date}-monday-push", "date": date, "day_of_week": "monday",
                "type": "push",
                "exercises": [{"exercise_id": ex, "sets": [{"set": 1, "weight_kg": weight, "reps": reps}]}]}

    def _records(self, logs, ex="flat-db-bench-press"):
        out = _compute_repo(logs=logs)
        return [r for r in out["personal_records"] if r["exercise_id"] == ex], out

    def test_load_rep_and_volume_prs(self):
        # 16x10 (baseline) -> 16x12 (rep_pr + volume_pr) -> 18x8 (load_pr).
        logs = [self._log("2026-05-01", 16, 10),
                self._log("2026-05-08", 16, 12),
                self._log("2026-05-15", 18, 8)]
        recs, _ = self._records(logs)
        self.assertTrue(any(r["type"] == "rep_pr" and r["date"] == "2026-05-08" and r["delta_reps"] == 2 for r in recs))
        self.assertTrue(any(r["type"] == "volume_pr" and r["date"] == "2026-05-08" and r["delta_volume_kg"] == 32 for r in recs))
        self.assertTrue(any(r["type"] == "load_pr" and r["date"] == "2026-05-15" and r["delta_kg"] == 2 for r in recs))
        # First session establishes baselines — no records on it.
        self.assertFalse(any(r["date"] == "2026-05-01" for r in recs))

    def test_legacy_prs_remains_load_only(self):
        logs = [self._log("2026-05-01", 16, 10),
                self._log("2026-05-08", 16, 12),   # rep gain — NOT a legacy PR
                self._log("2026-05-15", 18, 8)]    # load gain — the only legacy PR
        _, out = self._records(logs)
        prs = [r for r in out["prs"] if r["exercise_id"] == "flat-db-bench-press"]
        self.assertEqual(len(prs), 1)
        self.assertEqual(prs[0]["date"], "2026-05-15")
        self.assertEqual(prs[0]["weight_kg"], 18)

    def test_lighter_weight_more_reps_is_not_a_rep_pr(self):
        # After hitting 20kg, doing 16kg for more reps is backoff volume, not a rep PR.
        logs = [self._log("2026-05-01", 20, 5),
                self._log("2026-05-08", 16, 20)]
        recs, _ = self._records(logs)
        self.assertFalse(any(r["type"] == "rep_pr" for r in recs))
        self.assertFalse(any(r["type"] == "load_pr" for r in recs))  # 16 < 20


class TestLoadPrUnitRoundTrip(unittest.TestCase):
    """Load/rep PRs compare on PF-rounded lbs (5-lb increments), not raw kg.

    Stored kg goes through integer-lb rendering in vault MD and comes back
    slightly different (27.2 kg → "60 lbs" → 27.22 kg), and Phase-1 kg plates
    map to the nearest PF dumbbell (20 kg → 45 lb = 20.41 kg). Neither is a
    heavier lift, so neither may register a phantom "+0 lbs" / "+1 lbs" PR.
    """

    @staticmethod
    def _log(date, weight, reps, ex="flat-db-bench-press"):
        return {"id": f"{date}-monday-push", "date": date, "day_of_week": "monday",
                "type": "push",
                "exercises": [{"exercise_id": ex, "sets": [{"set": 1, "weight_kg": weight, "reps": reps}]}]}

    def _records(self, logs, ex="flat-db-bench-press"):
        out = _compute_repo(logs=logs)
        recs = [r for r in out["personal_records"] if r["exercise_id"] == ex]
        legacy = [r for r in out["prs"] if r["exercise_id"] == ex]
        return recs, legacy

    def test_pf_lbs_rounds_to_nearest_5lb_increment_half_up(self):
        self.assertEqual(ca.pf_lbs(27.2), 60)     # 59.97 lb
        self.assertEqual(ca.pf_lbs(27.22), 60)    # 60.01 lb
        self.assertEqual(ca.pf_lbs(20.0), 45)     # 44.09 lb (CDMX 20 kg plate)
        self.assertEqual(ca.pf_lbs(20.41), 45)    # 45 lb PF dumbbell
        self.assertEqual(ca.pf_lbs(22.68), 50)
        self.assertEqual(ca.pf_lbs(1.134), 5)     # exactly 2.5 lb → half-up, deterministic
        self.assertEqual(ca.pf_lbs(0), 0)
        self.assertEqual(ca.pf_lbs(None), 0)

    def test_60lb_round_trip_through_integer_lbs_is_not_a_pr(self):
        # 27.2 kg renders in vault MD as "60 lbs (27.2 kg)"; re-parsing that cell
        # makes the authored lbs canonical → 27.22 kg. Same lift, not a PR.
        rendered = sync._format_weight({"sets": [{"weight_kg": 27.2}]})
        self.assertEqual(rendered, "60 lbs (27.2 kg)")
        round_tripped, _ = pc.parse_weight(rendered)
        self.assertEqual(round_tripped, 27.22)
        logs = [self._log("2026-06-01", 27.2, 10),
                self._log("2026-06-08", round_tripped, 10)]
        recs, legacy = self._records(logs)
        self.assertEqual(legacy, [])
        self.assertFalse(any(r["type"] == "load_pr" for r in recs))

    def test_phase1_kg_plate_to_nearest_pf_dumbbell_is_not_a_pr(self):
        # 20 kg (CDMX) → 45 lb (PF, 20.41 kg) is the same load class; 50 lb is a PR,
        # measured from the 45-lb session rather than the 20 kg one.
        logs = [self._log("2026-05-01", 20.0, 10),
                self._log("2026-06-01", 20.41, 10),
                self._log("2026-06-08", 22.68, 8)]
        recs, legacy = self._records(logs)
        load = [r for r in recs if r["type"] == "load_pr"]
        self.assertEqual([r["date"] for r in load], ["2026-06-08"])
        self.assertEqual(load[0]["delta_kg"], 2.3)
        self.assertEqual([r["date"] for r in legacy], ["2026-06-08"])
        self.assertEqual(legacy[0]["delta_kg"], 2.3)

    def test_rep_pr_compares_within_the_same_pf_weight_class(self):
        # 20 kg × 12, then 45 lb × 10 (same class, fewer reps: nothing), then 45 lb × 14.
        logs = [self._log("2026-05-01", 20.0, 12),
                self._log("2026-06-01", 20.41, 10),
                self._log("2026-06-08", 20.41, 14)]
        recs, _ = self._records(logs)
        self.assertFalse(any(r["type"] == "load_pr" for r in recs))
        reps = [(r["date"], r["delta_reps"]) for r in recs if r["type"] == "rep_pr"]
        self.assertEqual(reps, [("2026-06-08", 2)])


if __name__ == "__main__":
    unittest.main()
