#!/usr/bin/env python3
"""Lightweight documentation drift checks for PT Tracker.

This is intentionally regex-based. It catches the known duplicate-fact failures
that previously caused agents to work from stale operational assumptions.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path


CHECKS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"TODO_EXERCISES\.md"), "stale TODO_EXERCISES.md reference"),
    (re.compile(r"every exercise (has|with)\s+`?image_url`?\s*:\s*null", re.I), "stale claim that exercise images are null"),
    (re.compile(r"`?image_url`?\s+is null for every move in `?data/cooldowns\.json`?", re.I), "stale claim that cooldown images are null"),
    (re.compile(r"pt_tracker_draft_v1:<date>\|<day>\|<type>"), "stale workout draft v1 key"),
    (re.compile(r"task body lives in .*SKILL\.md", re.I), "stale Cowork SKILL.md task-body model"),
    (re.compile(r"\b8:00\s*(AM\s*)?CT\b", re.I), "stale 8:00 CT sync time"),
    (re.compile(r"git pull --rebase"), "stale pull --rebase instruction"),
    (re.compile(r"skip with a warning", re.I), "stale skip-on-existing-session wording"),
]

DOCS = [
    "README.md",
    "CLAUDE.md",
    "AGENTS.md",
    "docs/COWORK_SYNC_TASK.md",
    "docs/COWORK_WRAPPER_PROMPT.md",
]


def audit_repo(repo_root: Path) -> list[str]:
    findings: list[str] = []
    for rel in DOCS:
        path = repo_root / rel
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        for i, line in enumerate(text.splitlines(), start=1):
            for pattern, label in CHECKS:
                if pattern.search(line):
                    findings.append(f"{rel}:{i}: {label}: {line.strip()}")
    return findings


def main() -> int:
    repo_root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    findings = audit_repo(repo_root)
    if findings:
        for f in findings:
            print(f"FAIL: {f}")
        return 1
    print("doc audit passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
