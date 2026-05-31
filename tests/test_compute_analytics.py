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


if __name__ == "__main__":
    unittest.main()
