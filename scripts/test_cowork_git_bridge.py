#!/usr/bin/env python3
"""Tests for the Cowork disposable-clone Git bridge."""

from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

import cowork_git_bridge as bridge


def run(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=str(cwd), check=True, capture_output=True, text=True)


def _isolate_home(td: Path) -> dict[str, str]:
    """Point HOME/XDG_CONFIG_HOME/GIT_CONFIG_GLOBAL at ``td`` and pin the
    default branch to ``main`` for any new repo created during the test.

    Without this, the host's ``init.defaultBranch`` (or the system default of
    ``master`` on older Git) leaks into the test fixtures and ``git push
    origin main`` fails because the local branch is named ``master``.
    """
    home = td / "home"
    home.mkdir(parents=True, exist_ok=True)
    overrides = {
        "HOME": str(home),
        "XDG_CONFIG_HOME": str(home / ".config"),
        "GIT_CONFIG_GLOBAL": str(home / ".gitconfig"),
    }
    for k, v in overrides.items():
        os.environ[k] = v
    subprocess.run(
        ["git", "config", "--global", "init.defaultBranch", "main"],
        check=True, capture_output=True, text=True,
    )
    return overrides


class CoworkGitBridgeTest(unittest.TestCase):
    def test_reads_origin_url_from_git_config_without_shelling_out_in_source_repo(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            repo = Path(td) / "mounted"
            git_dir = repo / ".git"
            git_dir.mkdir(parents=True)
            (git_dir / "config").write_text(
                "[remote \"origin\"]\n"
                "\turl = https://github.com/jcpeters08/pt-tracker.git\n"
                "\tfetch = +refs/heads/*:refs/remotes/origin/*\n",
                encoding="utf-8",
            )

            self.assertEqual(
                bridge.read_origin_url(repo),
                "https://github.com/jcpeters08/pt-tracker.git",
            )

    def test_prepare_workdir_clones_disposable_repo(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _isolate_home(root)
            remote = root / "remote.git"
            source = root / "mounted"
            workdir = root / "cowork-git"

            run(["git", "init", "--bare", str(remote)], cwd=root)
            run(["git", "clone", str(remote), str(source)], cwd=root)
            run(["git", "config", "user.name", "Test User"], cwd=source)
            run(["git", "config", "user.email", "test@example.com"], cwd=source)
            (source / "README.md").write_text("hello\n", encoding="utf-8")
            run(["git", "add", "README.md"], cwd=source)
            run(["git", "commit", "-m", "initial"], cwd=source)
            run(["git", "push", "origin", "main"], cwd=source)

            prepared = bridge.prepare_workdir(source, workdir, branch="main")

            self.assertEqual(prepared, workdir)
            self.assertEqual((workdir / "README.md").read_text(encoding="utf-8"), "hello\n")

    def test_prepare_workdir_refreshes_existing_clone_and_drops_local_junk(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _isolate_home(root)
            remote = root / "remote.git"
            source = root / "mounted"
            workdir = root / "cowork-git"

            run(["git", "init", "--bare", str(remote)], cwd=root)
            run(["git", "clone", str(remote), str(source)], cwd=root)
            run(["git", "config", "user.name", "Test User"], cwd=source)
            run(["git", "config", "user.email", "test@example.com"], cwd=source)
            (source / "README.md").write_text("v1\n", encoding="utf-8")
            run(["git", "add", "README.md"], cwd=source)
            run(["git", "commit", "-m", "initial"], cwd=source)
            run(["git", "push", "origin", "main"], cwd=source)
            bridge.prepare_workdir(source, workdir, branch="main")

            (workdir / "README.md").write_text("dirty\n", encoding="utf-8")
            (workdir / "scratch.txt").write_text("junk\n", encoding="utf-8")
            (source / "README.md").write_text("v2\n", encoding="utf-8")
            run(["git", "add", "README.md"], cwd=source)
            run(["git", "commit", "-m", "update"], cwd=source)
            run(["git", "push", "origin", "main"], cwd=source)

            bridge.prepare_workdir(source, workdir, branch="main")

            self.assertEqual((workdir / "README.md").read_text(encoding="utf-8"), "v2\n")
            self.assertFalse((workdir / "scratch.txt").exists())


    def test_prepare_workdir_falls_back_when_default_path_is_unwritable(self) -> None:
        """If the requested workdir exists but the current uid can't write to
        it (the cross-sandbox-uid case Cowork hits in /tmp), the bridge picks a
        uid-scoped sibling instead of failing."""
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            _isolate_home(td_path)
            remote = td_path / "remote.git"
            source = td_path / "mounted"
            blocked = td_path / "cowork-git"

            run(["git", "init", "--bare", str(remote)], cwd=td_path)
            run(["git", "clone", str(remote), str(source)], cwd=td_path)
            run(["git", "config", "user.name", "Test User"], cwd=source)
            run(["git", "config", "user.email", "test@example.com"], cwd=source)
            (source / "README.md").write_text("hello\n", encoding="utf-8")
            run(["git", "add", "README.md"], cwd=source)
            run(["git", "commit", "-m", "initial"], cwd=source)
            run(["git", "push", "origin", "main"], cwd=source)

            # Simulate an existing-but-unwritable workdir by stripping write
            # permission (the same effective state /tmp/pt-tracker-cowork-git
            # has when it was created under a previous sandbox uid).
            blocked.mkdir()
            (blocked / "leftover").write_text("from another uid\n", encoding="utf-8")
            os.chmod(blocked, 0o555)
            try:
                prepared = bridge.prepare_workdir(source, blocked, branch="main")
                self.assertNotEqual(prepared, blocked)
                self.assertTrue(prepared.name.endswith(f"-uid{os.getuid()}"))
                self.assertTrue((prepared / "README.md").exists())
                # Untouched blocked dir still has its original contents.
                self.assertTrue((blocked / "leftover").exists())
            finally:
                os.chmod(blocked, 0o755)

    def test_prepare_workdir_configures_committer_identity_on_disposable_clone(self) -> None:
        """A fresh sandbox has no global user.email / user.name. The bridge
        must seed both on the disposable clone so ``git commit`` works there
        without touching the host's identity."""
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            _isolate_home(td_path)
            remote = td_path / "remote.git"
            source = td_path / "mounted"
            workdir = td_path / "cowork-git"

            run(["git", "init", "--bare", str(remote)], cwd=td_path)
            run(["git", "clone", str(remote), str(source)], cwd=td_path)
            run(["git", "config", "user.name", "Test User"], cwd=source)
            run(["git", "config", "user.email", "test@example.com"], cwd=source)
            (source / "README.md").write_text("hello\n", encoding="utf-8")
            run(["git", "add", "README.md"], cwd=source)
            run(["git", "commit", "-m", "initial"], cwd=source)
            run(["git", "push", "origin", "main"], cwd=source)

            prepared = bridge.prepare_workdir(source, workdir, branch="main")

            email = subprocess.run(
                ["git", "config", "--local", "--get", "user.email"],
                cwd=str(prepared), capture_output=True, text=True, check=True,
            ).stdout.strip()
            name = subprocess.run(
                ["git", "config", "--local", "--get", "user.name"],
                cwd=str(prepared), capture_output=True, text=True, check=True,
            ).stdout.strip()
            self.assertEqual(email, bridge.DEFAULT_COMMIT_EMAIL)
            self.assertEqual(name, bridge.DEFAULT_COMMIT_NAME)

            # Sanity: commit succeeds end-to-end with no extra config.
            (prepared / "new.txt").write_text("x\n", encoding="utf-8")
            run(["git", "add", "new.txt"], cwd=prepared)
            run(["git", "commit", "-m", "from disposable clone"], cwd=prepared)

    def test_prepare_workdir_preserves_existing_committer_identity(self) -> None:
        """If the disposable clone already has a hand-configured identity, the
        bridge must not overwrite it."""
        with tempfile.TemporaryDirectory() as td:
            td_path = Path(td)
            _isolate_home(td_path)
            remote = td_path / "remote.git"
            source = td_path / "mounted"
            workdir = td_path / "cowork-git"

            run(["git", "init", "--bare", str(remote)], cwd=td_path)
            run(["git", "clone", str(remote), str(source)], cwd=td_path)
            run(["git", "config", "user.name", "Test User"], cwd=source)
            run(["git", "config", "user.email", "test@example.com"], cwd=source)
            (source / "README.md").write_text("hello\n", encoding="utf-8")
            run(["git", "add", "README.md"], cwd=source)
            run(["git", "commit", "-m", "initial"], cwd=source)
            run(["git", "push", "origin", "main"], cwd=source)

            bridge.prepare_workdir(source, workdir, branch="main")
            run(["git", "config", "--local", "user.email", "custom@example.com"], cwd=workdir)
            run(["git", "config", "--local", "user.name", "Custom Identity"], cwd=workdir)

            bridge.prepare_workdir(source, workdir, branch="main")

            email = subprocess.run(
                ["git", "config", "--local", "--get", "user.email"],
                cwd=str(workdir), capture_output=True, text=True, check=True,
            ).stdout.strip()
            name = subprocess.run(
                ["git", "config", "--local", "--get", "user.name"],
                cwd=str(workdir), capture_output=True, text=True, check=True,
            ).stdout.strip()
            self.assertEqual(email, "custom@example.com")
            self.assertEqual(name, "Custom Identity")


if __name__ == "__main__":
    unittest.main()
