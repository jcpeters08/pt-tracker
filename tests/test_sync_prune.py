"""Tests for sync.py stale-snapshot pruning.

`data/{routines,logs,recovery_logs}/*.json` are re-derived from vault MD on
every sync. A snapshot whose source MD was deleted or renamed must be removed
too (otherwise it keeps being served and listed in data/manifest.json), but a
transiently iCloud-evicted vault must never mass-delete snapshots.
"""

from __future__ import annotations

import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import sync  # noqa: E402

FIXTURE = REPO_ROOT / "tests" / "fixtures" / "sample-routine.md"

LOG_MD = """---
type: log
status: completed
tags:
  - fitness
  - workout-log
---

# 🏋️ {date} — {day} · {label}

**Workout date:** {date}
**Phase:** 2

## Exercises

| Exercise | Weight | Reps | Sets | Notes |
|---|---|---|---|---|
| Flat Dumbbell Bench Press | 50 lbs (22.7 kg) | 12 | 3 |  |
"""

RECOVERY_MD = """---
type: recovery-log
status: completed
tags:
  - fitness
  - recovery
---

# 🧊 {date} — Embrace North

**Date:** {date}
**Location:** Embrace North
**Rounds:** 1

## Rounds

| # | Sauna (min) | Plunge (min) |
|---|---|---|
| 1 | 15 | 4 |
"""


def _build_fixture(tmp: Path) -> tuple[Path, Path, Path]:
    """Fake vault + repo laid out the way sync.main() expects."""
    vault = tmp / "vault"
    project = vault / "🎯 Projects" / "🏋️ Personal Trainer"
    plans = project / "Weekly Plans"
    plans.mkdir(parents=True)
    (project / "Workout Log").mkdir()
    (project / "Recovery Log").mkdir()
    (project / "Log.md").write_text("# Log\n", encoding="utf-8")
    (project / "Recovery Log.md").write_text("# Recovery\n", encoding="utf-8")
    shutil.copy(FIXTURE, plans / "Sample.md")
    shutil.copy(FIXTURE, plans / "Sample-Old.md")
    (project / "Workout Log" / "2026-05-18-Monday-Push.md").write_text(
        LOG_MD.format(date="2026-05-18", day="Monday", label="Push"), encoding="utf-8")
    (project / "Workout Log" / "2026-05-19-Tuesday-Pull.md").write_text(
        LOG_MD.format(date="2026-05-19", day="Tuesday", label="Pull"), encoding="utf-8")
    (project / "Recovery Log" / "2026-05-14-Embrace-North.md").write_text(
        RECOVERY_MD.format(date="2026-05-14"), encoding="utf-8")

    repo = tmp / "repo"
    for sub in ("routines", "exercises", "logs", "recovery_logs"):
        (repo / "data" / sub).mkdir(parents=True)
    (repo / "data" / "pending.json").write_text(json.dumps({"entries": []}), encoding="utf-8")
    return vault, project, repo


def _run_sync(vault: Path, repo: Path) -> tuple[int, str]:
    os.environ["PT_TRACKER_VAULT_ROOT"] = str(vault)
    os.environ["PT_TRACKER_REPO_ROOT"] = str(repo)
    err = io.StringIO()
    try:
        with redirect_stdout(io.StringIO()), redirect_stderr(err):
            rc = sync.main()
    finally:
        del os.environ["PT_TRACKER_VAULT_ROOT"]
        del os.environ["PT_TRACKER_REPO_ROOT"]
    return rc, err.getvalue()


def _ids(folder: Path) -> list[str]:
    return sorted(p.stem for p in folder.glob("*.json"))


class TestPruneStaleSnapshots(unittest.TestCase):
    def _dir_with(self, tmp: Path, *names: str) -> Path:
        out = tmp / "out"
        out.mkdir()
        for n in names:
            (out / f"{n}.json").write_text("{}", encoding="utf-8")
        return out

    def test_removes_only_snapshots_not_derived_this_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out = self._dir_with(root, "a", "b", "c")
            src = root / "src"
            src.mkdir()
            (src / "a.md").write_text("x", encoding="utf-8")
            removed = sync.prune_stale_snapshots(out, {"a"}, source_dir=src, label="logs")
            self.assertEqual(removed, ["b", "c"])
            self.assertEqual(_ids(out), ["a"])

    def test_skips_when_icloud_placeholders_are_present(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out = self._dir_with(root, "a", "b")
            src = root / "src"
            src.mkdir()
            (src / "a.md").write_text("x", encoding="utf-8")
            (src / ".b.md.icloud").write_bytes(b"")  # evicted, not deleted
            err = io.StringIO()
            with redirect_stderr(err):
                removed = sync.prune_stale_snapshots(out, {"a"}, source_dir=src, label="logs")
            self.assertEqual(removed, [])
            self.assertEqual(_ids(out), ["a", "b"])
            self.assertIn("WARN", err.getvalue())
            self.assertIn("icloud", err.getvalue().lower())

    def test_skips_when_nothing_was_derived(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out = self._dir_with(root, "a", "b")
            src = root / "src"
            src.mkdir()
            err = io.StringIO()
            with redirect_stderr(err):
                removed = sync.prune_stale_snapshots(out, set(), source_dir=src, label="logs")
            self.assertEqual(removed, [])
            self.assertEqual(_ids(out), ["a", "b"])
            self.assertIn("WARN", err.getvalue())

    def test_skips_when_source_dir_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out = self._dir_with(root, "a")
            err = io.StringIO()
            with redirect_stderr(err):
                removed = sync.prune_stale_snapshots(out, {"zzz"}, source_dir=root / "nope", label="logs")
            self.assertEqual(removed, [])
            self.assertEqual(_ids(out), ["a"])

    def test_skips_when_a_source_file_failed_to_parse(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            out = self._dir_with(root, "a", "b")
            src = root / "src"
            src.mkdir()
            (src / "a.md").write_text("x", encoding="utf-8")
            (src / "b.md").write_text("garbage", encoding="utf-8")
            err = io.StringIO()
            with redirect_stderr(err):
                removed = sync.prune_stale_snapshots(out, {"a"}, source_dir=src, label="logs", parse_failures=1)
            self.assertEqual(removed, [])
            self.assertEqual(_ids(out), ["a", "b"])
            self.assertIn("WARN", err.getvalue())


class TestMainPrunesStaleSnapshots(unittest.TestCase):
    def test_deleted_or_renamed_vault_md_drops_its_snapshot_and_manifest_entry(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault, project, repo = _build_fixture(Path(tmp))
            rc, _ = _run_sync(vault, repo)
            self.assertEqual(rc, 0)
            self.assertEqual(_ids(repo / "data" / "routines"), ["Sample", "Sample-Old"])
            self.assertEqual(_ids(repo / "data" / "logs"),
                             ["2026-05-18-monday-push", "2026-05-19-tuesday-pull"])
            self.assertEqual(_ids(repo / "data" / "recovery_logs"), ["2026-05-14-embrace-north"])

            # Delete a plan and a log; rename (move) the recovery session to a new date.
            (project / "Weekly Plans" / "Sample-Old.md").unlink()
            (project / "Workout Log" / "2026-05-19-Tuesday-Pull.md").unlink()
            (project / "Recovery Log" / "2026-05-14-Embrace-North.md").unlink()
            (project / "Recovery Log" / "2026-05-15-Embrace-North.md").write_text(
                RECOVERY_MD.format(date="2026-05-15"), encoding="utf-8")

            rc, _ = _run_sync(vault, repo)
            self.assertEqual(rc, 0)
            self.assertEqual(_ids(repo / "data" / "routines"), ["Sample"])
            self.assertEqual(_ids(repo / "data" / "logs"), ["2026-05-18-monday-push"])
            self.assertEqual(_ids(repo / "data" / "recovery_logs"), ["2026-05-15-embrace-north"])
            manifest = json.loads((repo / "data" / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["routines"], ["Sample"])
            self.assertEqual(manifest["logs"], ["2026-05-18-monday-push"])
            self.assertEqual(manifest["recovery_logs"], ["2026-05-15-embrace-north"])

    def test_icloud_evicted_log_folder_keeps_snapshots(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault, project, repo = _build_fixture(Path(tmp))
            rc, _ = _run_sync(vault, repo)
            self.assertEqual(rc, 0)

            # iCloud evicts a file: the MD is replaced by a dot-placeholder that
            # glob("*.md") no longer sees. That must not look like a deletion.
            (project / "Workout Log" / "2026-05-19-Tuesday-Pull.md").unlink()
            (project / "Workout Log" / ".2026-05-19-Tuesday-Pull.md.icloud").write_bytes(b"")

            rc, err = _run_sync(vault, repo)
            self.assertEqual(rc, 0)
            self.assertEqual(_ids(repo / "data" / "logs"),
                             ["2026-05-18-monday-push", "2026-05-19-tuesday-pull"])
            self.assertIn("icloud", err.lower())


if __name__ == "__main__":
    unittest.main()
