#!/usr/bin/env python3
"""Tests for the Cowork disposable-clone Git bridge."""

from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

import cowork_git_bridge as bridge


def run(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=str(cwd), check=True, capture_output=True, text=True)


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


if __name__ == "__main__":
    unittest.main()
