"""sync.py git guards.

  - a failed `git pull --ff-only` aborts before pending.json is read or anything
    in the vault / data/ is written;
  - a rejected `git push` exits non-zero with a clear message instead of
    reporting "Synced".

sync.main() is driven against a temp vault/repo with sync.run monkeypatched to
a fake git runner — no real git is invoked.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import sync  # noqa: E402

LOG_ENTRY = {
    "type": "log",
    "submitted_at": "2026-10-19T18:00:00Z",
    "session": {
        "date": "2026-10-19",
        "day_of_week": "monday",
        "type": "push",
        "exercises": [
            {
                "exercise_id": "flat-db-bench-press",
                "display_name": "Flat Dumbbell Bench Press",
                "sets": [{"set": 1, "weight_kg": 27.22, "reps": 12}],
                "notes": "",
            }
        ],
        "session_notes": "",
    },
}


class FakeGit:
    """Stands in for sync.run: records every call, raises CalledProcessError for
    any git subcommand named in `fail`, and answers `remote` / `status` the way
    a checkout with an origin and dirty data/ would."""

    def __init__(self, fail: dict[str, str] | None = None):
        self.fail = fail or {}
        self.calls: list[list[str]] = []

    def __call__(self, cmd, cwd, check=True):
        self.calls.append(list(cmd))
        sub = cmd[1]
        if sub in self.fail:
            raise subprocess.CalledProcessError(1, cmd, output="", stderr=self.fail[sub])
        stdout = ""
        if sub == "remote":
            stdout = "origin\n"
        elif sub == "status":
            stdout = " M data/analytics.json\n"
        return subprocess.CompletedProcess(cmd, 0, stdout=stdout, stderr="")

    @property
    def subcommands(self) -> list[str]:
        return [c[1] for c in self.calls]


def _build(tmp: Path) -> tuple[Path, Path, Path]:
    vault = tmp / "vault"
    project = vault / "🎯 Projects" / "🏋️ Personal Trainer"
    (project / "Weekly Plans").mkdir(parents=True)
    (project / "Log.md").write_text("# Log\n", encoding="utf-8")
    # "Workout Log" is deliberately NOT created: sync creates it, so its absence
    # after an aborted run proves nothing was written.
    repo = tmp / "repo"
    for sub in ("routines", "exercises", "logs", "recovery_logs"):
        (repo / "data" / sub).mkdir(parents=True)
    (repo / ".git").mkdir()  # makes sync treat it as a checkout; FakeGit handles every git call
    (repo / "data" / "pending.json").write_text(json.dumps({"entries": [LOG_ENTRY]}), encoding="utf-8")
    return vault, project, repo


def _run_sync(vault: Path, repo: Path, fake: FakeGit) -> tuple[int, str, str]:
    env = {"PT_TRACKER_VAULT_ROOT": str(vault), "PT_TRACKER_REPO_ROOT": str(repo)}
    out, err = io.StringIO(), io.StringIO()
    with mock.patch.dict(os.environ, env), mock.patch.object(sync, "run", fake), \
            contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
        rc = sync.main()
    return rc, out.getvalue(), err.getvalue()


class TestGitGuards(unittest.TestCase):
    def test_failed_pull_aborts_before_any_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault, project, repo = _build(Path(tmp))
            pending_before = (repo / "data" / "pending.json").read_text(encoding="utf-8")
            fake = FakeGit(fail={"pull": "fatal: Not possible to fast-forward, aborting."})
            rc, out, err = _run_sync(vault, repo, fake)

            self.assertEqual(rc, 1)
            self.assertIn("git pull --ff-only failed", err)
            self.assertIn("Not possible to fast-forward", err)
            self.assertNotIn("Synced", out)
            # Nothing read or written after the failed pull.
            self.assertEqual(fake.subcommands, ["remote", "pull"])
            self.assertEqual((repo / "data" / "pending.json").read_text(encoding="utf-8"), pending_before)
            self.assertFalse((project / "Workout Log").exists())
            self.assertEqual((project / "Log.md").read_text(encoding="utf-8"), "# Log\n")
            self.assertEqual(list((repo / "data" / "logs").iterdir()), [])
            self.assertFalse((repo / "data" / "analytics.json").exists())
            self.assertFalse((repo / "data" / "manifest.json").exists())

    def test_rejected_push_exits_nonzero_with_clear_message(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault, project, repo = _build(Path(tmp))
            fake = FakeGit(fail={"push": "! [rejected] main -> main (fetch first)"})
            rc, out, err = _run_sync(vault, repo, fake)

            self.assertEqual(rc, 1)
            self.assertIn("git push was rejected", err)
            self.assertIn("origin/main was NOT updated", err)
            self.assertIn("[rejected] main -> main", err)
            self.assertNotIn("Synced", out)
            self.assertIn("push did NOT land", out)
            self.assertEqual(fake.subcommands, ["remote", "pull", "status", "add", "commit", "push"])
            # The state the message describes: the drained session is safe in the
            # vault and the (pending-reset) commit exists locally.
            self.assertTrue((project / "Workout Log" / "2026-10-19-Monday-Push.md").exists())
            self.assertIn("[[2026-10-19-Monday-Push|Monday Push]]", (project / "Log.md").read_text(encoding="utf-8"))
            pending_after = json.loads((repo / "data" / "pending.json").read_text(encoding="utf-8"))
            self.assertEqual(pending_after["entries"], [])

    def test_clean_pull_and_push_returns_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            vault, project, repo = _build(Path(tmp))
            fake = FakeGit()
            rc, out, err = _run_sync(vault, repo, fake)

            self.assertEqual(rc, 0)
            self.assertIn("Synced 1 session(s)", out)
            self.assertNotIn("ERROR", err)
            self.assertEqual(fake.subcommands, ["remote", "pull", "status", "add", "commit", "push"])
            self.assertTrue((project / "Workout Log" / "2026-10-19-Monday-Push.md").exists())
            self.assertTrue((repo / "data" / "logs" / "2026-10-19-monday-push.json").exists())


if __name__ == "__main__":
    unittest.main()
