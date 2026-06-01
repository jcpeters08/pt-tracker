from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import audit_data  # noqa: E402
import audit_docs  # noqa: E402
import generate_manifest  # noqa: E402
import parse_routine as pr  # noqa: E402


def _write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data), encoding="utf-8")


class TestManifestGeneration(unittest.TestCase):
    def test_manifest_lists_local_snapshots_and_latest_routine(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_json(root / "data/routines/2026-W20.json", {"id": "2026-W20", "start_date": "2026-05-11"})
            _write_json(root / "data/routines/2026-W21.json", {"id": "2026-W21", "start_date": "2026-05-18"})
            _write_json(root / "data/logs/2026-05-18-monday-push.json", {"id": "2026-05-18-monday-push"})
            _write_json(root / "data/recovery_logs/2026-05-18-embrace-north.json", {"id": "2026-05-18-embrace-north"})
            _write_json(root / "data/exercises/flat-db-bench-press.json", {"id": "flat-db-bench-press"})

            manifest = generate_manifest.build_manifest(root, generated_at="2026-05-31T12:00:00Z")

            self.assertEqual(manifest["generated_at"], "2026-05-31T12:00:00Z")
            self.assertEqual(manifest["routines"], ["2026-W20", "2026-W21"])
            self.assertEqual(manifest["logs"], ["2026-05-18-monday-push"])
            self.assertEqual(manifest["recovery_logs"], ["2026-05-18-embrace-north"])
            self.assertEqual(manifest["exercises"], ["flat-db-bench-press"])
            self.assertEqual(manifest["latest_routine_id"], "2026-W21")


class TestRoutineEndDates(unittest.TestCase):
    def test_derive_end_dates_uses_day_before_next_start_and_preserves_latest_open(self):
        routines = [
            {"id": "2026-W20", "start_date": "2026-05-11", "end_date": None},
            {"id": "2026-W21", "start_date": "2026-05-18", "end_date": None},
            {"id": "2026-W22", "start_date": "2026-05-25", "end_date": None},
        ]
        out = {r["id"]: r for r in pr.derive_end_dates(routines)}
        self.assertEqual(out["2026-W20"]["end_date"], "2026-05-17")
        self.assertEqual(out["2026-W21"]["end_date"], "2026-05-24")
        self.assertIsNone(out["2026-W22"]["end_date"])

    def test_explicit_end_date_is_preserved(self):
        routines = [
            {"id": "a", "start_date": "2026-05-01", "end_date": "2026-05-31"},
            {"id": "b", "start_date": "2026-05-08", "end_date": None},
        ]
        out = {r["id"]: r for r in pr.derive_end_dates(routines)}
        self.assertEqual(out["a"]["end_date"], "2026-05-31")


class TestDataAudit(unittest.TestCase):
    def test_good_repo_has_no_findings(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_json(root / "data/routines/r1.json", {
                "id": "r1",
                "start_date": "2026-05-11",
                "end_date": None,
                "days": {"monday": {"exercises": [{"exercise_id": "flat-db-bench-press"}]}},
            })
            _write_json(root / "data/logs/l1.json", {
                "id": "l1",
                "date": "2026-05-18",
                "day_of_week": "monday",
                "type": "push",
                "exercises": [{"exercise_id": "flat-db-bench-press", "sets": [{"weight_kg": 10, "reps": 10}]}],
            })
            _write_json(root / "data/exercises/flat-db-bench-press.json", {
                "id": "flat-db-bench-press",
                "image_url": "https://example.com/image.jpg",
                "video_url": "https://example.com/video",
                "image_source": "test",
                "image_match": "test",
            })
            _write_json(root / "data/cooldowns.json", {"library": {"push": {"moves": [{"name": "stretch", "image_url": "https://example.com/stretch.jpg"}]}}})
            self.assertEqual(audit_data.audit_repo(root), [])

    def test_non_latest_routine_missing_end_date_is_a_finding(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_json(root / "data/routines/2026-W20.json", {
                "id": "2026-W20",
                "start_date": "2026-05-11",
                "end_date": None,
                "days": {},
            })
            _write_json(root / "data/routines/2026-W21.json", {
                "id": "2026-W21",
                "start_date": "2026-05-18",
                "end_date": None,
                "days": {},
            })
            _write_json(root / "data/cooldowns.json", {"library": {}})
            findings = audit_data.audit_repo(root)
            self.assertTrue(any("expected 2026-05-17" in f for f in findings))

    def test_missing_referenced_exercise_and_null_images_are_findings(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_json(root / "data/routines/r1.json", {
                "id": "r1",
                "days": {"monday": {"exercises": [{"exercise_id": "missing-ex"}]}},
            })
            _write_json(root / "data/exercises/bad.json", {"id": "bad", "image_url": None})
            _write_json(root / "data/cooldowns.json", {"library": {"push": {"moves": [{"name": "stretch", "image_url": ""}]}}})
            findings = audit_data.audit_repo(root)
            joined = "\n".join(findings)
            self.assertIn("missing-ex", joined)
            self.assertIn("bad.json", joined)
            self.assertIn("cooldowns", joined)


class TestDocAudit(unittest.TestCase):
    def test_doc_audit_flags_known_stale_phrases(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "README.md").write_text("the task body lives in SKILL.md\n", encoding="utf-8")
            (root / "CLAUDE.md").write_text("pt_tracker_draft_v1:<date>|<day>|<type>\n", encoding="utf-8")
            findings = audit_docs.audit_repo(root)
            self.assertGreaterEqual(len(findings), 2)
            self.assertTrue(any("SKILL.md" in f for f in findings))
            self.assertTrue(any("pt_tracker_draft_v1" in f for f in findings))


if __name__ == "__main__":
    unittest.main()
