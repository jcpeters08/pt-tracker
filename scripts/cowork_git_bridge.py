#!/usr/bin/env python3
"""Run Cowork sync Git operations from a disposable clone.

Cowork's sandbox can mount the host checkout with lock-file semantics that
break normal Git cleanup inside .git/. This bridge reads the mounted repo's
origin URL without invoking Git there, prepares a disposable checkout under
/tmp, then runs the sync from that disposable checkout.
"""

from __future__ import annotations

import argparse
import configparser
import os
import shutil
import subprocess
import sys
from pathlib import Path

DEFAULT_SOURCE_REPO = Path("/Users/jonathanpeters/Git/pt-tracker")
DEFAULT_WORKDIR = Path("/tmp/pt-tracker-cowork-git")
DEFAULT_BRANCH = "main"


def run(cmd: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd is not None else None,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )


def _git_config_path(repo: Path) -> Path:
    dot_git = repo / ".git"
    if dot_git.is_dir():
        return dot_git / "config"
    if dot_git.is_file():
        for line in dot_git.read_text(encoding="utf-8").splitlines():
            if line.startswith("gitdir:"):
                gitdir = Path(line.split(":", 1)[1].strip())
                if not gitdir.is_absolute():
                    gitdir = repo / gitdir
                return gitdir / "config"
    raise FileNotFoundError(f"no .git config found for {repo}")


def read_origin_url(source_repo: Path) -> str:
    """Read remote.origin.url without running Git in the mounted source repo."""
    config_path = _git_config_path(source_repo)
    parser = configparser.RawConfigParser()
    parser.read(config_path, encoding="utf-8")
    section = 'remote "origin"'
    if not parser.has_option(section, "url"):
        raise RuntimeError(f"{config_path} has no remote.origin.url")
    return parser.get(section, "url").strip()


def prepare_workdir(source_repo: Path, workdir: Path, branch: str = DEFAULT_BRANCH) -> Path:
    """Clone or refresh a disposable Git workdir without touching source .git."""
    origin = read_origin_url(source_repo)
    workdir.parent.mkdir(parents=True, exist_ok=True)

    if not (workdir / ".git").exists():
        if workdir.exists():
            shutil.rmtree(workdir)
        run(["git", "clone", "--branch", branch, origin, str(workdir)])
    else:
        run(["git", "remote", "set-url", "origin", origin], cwd=workdir)
        run(["git", "fetch", "--prune", "origin"], cwd=workdir)
        run(["git", "reset", "--hard"], cwd=workdir)
        run(["git", "clean", "-fdx"], cwd=workdir)
        run(["git", "checkout", "-B", branch, f"origin/{branch}"], cwd=workdir)
        run(["git", "reset", "--hard", f"origin/{branch}"], cwd=workdir)
        run(["git", "clean", "-fdx"], cwd=workdir)

    return workdir


def run_sync(workdir: Path, sync_args: list[str] | None = None) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["PT_TRACKER_REPO_ROOT"] = str(workdir)
    return run([sys.executable, "scripts/sync.py", *(sync_args or [])], cwd=workdir, env=env)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-repo", type=Path, default=DEFAULT_SOURCE_REPO)
    parser.add_argument("--workdir", type=Path, default=DEFAULT_WORKDIR)
    parser.add_argument("--branch", default=DEFAULT_BRANCH)
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("sync_args", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)

    try:
        workdir = prepare_workdir(args.source_repo, args.workdir, branch=args.branch)
        print(f"COWORK_GIT_WORKDIR={workdir}")
        if args.prepare_only:
            return 0
        result = run_sync(workdir, args.sync_args)
        if result.stdout:
            print(result.stdout, end="")
        if result.stderr:
            print(result.stderr, end="", file=sys.stderr)
        return result.returncode
    except subprocess.CalledProcessError as e:
        if e.stdout:
            print(e.stdout, end="")
        if e.stderr:
            print(e.stderr, end="", file=sys.stderr)
        print(f"ERROR: command failed: {' '.join(e.cmd)}", file=sys.stderr)
        return e.returncode
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
