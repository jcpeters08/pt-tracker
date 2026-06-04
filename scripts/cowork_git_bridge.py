#!/usr/bin/env python3
"""Run Cowork sync Git operations from a disposable clone.

Cowork's sandbox can mount the host checkout with lock-file semantics that
break normal Git cleanup inside .git/. This bridge reads the mounted repo's
origin URL without invoking Git there, prepares a disposable checkout under
/tmp, then runs the sync from that disposable checkout.

The bridge is robust against two sandbox-specific failure modes observed in
practice:

* The default workdir under ``/tmp`` may already exist but be owned by a
  *different* sandbox uid (Cowork rotates sandbox identities). ``/tmp`` has the
  sticky bit, so the current run cannot delete or rewrite it. When that
  happens, the bridge falls back to a uid-scoped sibling path it does own.
* Fresh sandboxes have no global ``user.email`` / ``user.name`` and no
  ``safe.directory`` entry for the workdir, so ``git commit`` and even
  ``git remote set-url`` refuse to run. The bridge configures both on demand —
  ``safe.directory`` globally for the resolved workdir, ``user.email`` /
  ``user.name`` locally on the disposable clone — leaving the host's real Git
  identity untouched.
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

# Local-only identity for commits made from the disposable clone. Scoped to
# the workdir's .git/config — never written to global config.
DEFAULT_COMMIT_EMAIL = "jcpeters08@gmail.com"
DEFAULT_COMMIT_NAME = "Jonathan Peters (Cowork Sync)"


def run(cmd: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd,
        cwd=str(cwd) if cwd is not None else None,
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )


def _can_use_dir(path: Path) -> bool:
    """True if ``path`` is usable as a workdir for the current uid.

    Usable means either (a) it doesn't exist (we'll create it), or (b) it
    exists, is a directory, and the current uid can write into it. The /tmp
    sticky bit means a dir owned by another uid is NOT writable to us even if
    its mode bits are 0777, so this check is what determines fallback.
    """
    if not path.exists():
        return True
    if not path.is_dir():
        return False
    return os.access(path, os.W_OK | os.X_OK)


def _resolve_workdir(workdir: Path) -> Path:
    """Return the requested workdir if usable, else a uid-scoped sibling.

    Idempotent: the same uid always resolves to the same fallback path, so
    repeated runs reuse the existing clone instead of re-cloning each time.
    """
    if _can_use_dir(workdir):
        return workdir
    fallback = workdir.parent / f"{workdir.name}-uid{os.getuid()}"
    return fallback


def _ensure_safe_directory(workdir: Path) -> None:
    """Add ``workdir`` to global ``safe.directory`` if not already present.

    Required because Git refuses to operate on a repo whose .git is owned by a
    different uid (the sandbox case). Idempotent — only writes the entry once.
    """
    target = str(workdir)
    existing = subprocess.run(
        ["git", "config", "--global", "--get-all", "safe.directory"],
        capture_output=True,
        text=True,
        check=False,
    )
    entries = (existing.stdout or "").splitlines()
    if target in entries:
        return
    subprocess.run(
        ["git", "config", "--global", "--add", "safe.directory", target],
        check=True,
        capture_output=True,
        text=True,
    )


def _configure_clone_identity(workdir: Path) -> None:
    """Ensure the disposable clone has a committer identity.

    Sets ``user.email`` / ``user.name`` in the clone's local config (NOT
    global), so the host's identity is unchanged. Idempotent — only fills in
    fields that aren't already set, so a hand-configured identity wins.
    """
    for key, value in (("user.email", DEFAULT_COMMIT_EMAIL), ("user.name", DEFAULT_COMMIT_NAME)):
        existing = subprocess.run(
            ["git", "config", "--local", "--get", key],
            cwd=str(workdir),
            capture_output=True,
            text=True,
            check=False,
        )
        if existing.returncode == 0 and existing.stdout.strip():
            continue
        run(["git", "config", "--local", key, value], cwd=workdir)


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
    """Clone or refresh a disposable Git workdir without touching source .git.

    Resolves a usable workdir for the current uid (see ``_resolve_workdir``),
    ensures Git will operate on it (``_ensure_safe_directory``), and configures
    a committer identity on the clone so the sync's commit step works on a
    fresh sandbox (``_configure_clone_identity``).
    """
    origin = read_origin_url(source_repo)
    workdir = _resolve_workdir(workdir)
    workdir.parent.mkdir(parents=True, exist_ok=True)
    _ensure_safe_directory(workdir)

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

    _configure_clone_identity(workdir)
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
