#!/usr/bin/env python3
"""Parse the vault Overview.md → a light profile dict (data/profile.json).

Usage:
    python3 parse_overview.py <path/to/Overview.md>            # → stdout

Pure stdlib. The Overview is hand-authored, so every field is best-effort:
missing fields are simply omitted rather than raising. Wired into sync.py so
data/profile.json is re-derived from the vault on each run (closes the
"Overview.md → data/profile.json" arrow in the architecture diagram).
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import pt_common as pc  # noqa: E402

WIKILINK_RE = re.compile(r"\[\[([^|\]]+)(?:\|([^\]]+))?\]\]")
_LEADING_STATUS_CHARS = "🟢🟡🔴⚪️ \t-—–"


def _strip_links(s: str) -> str:
    return WIKILINK_RE.sub(lambda m: (m.group(2) or m.group(1)), s)


def _section_lines(lines: list[str], title_re: re.Pattern) -> list[str]:
    """Lines under the first '## <title>' heading until the next '## '."""
    start = None
    for i, ln in enumerate(lines):
        if ln.startswith("## ") and title_re.search(ln):
            start = i + 1
            break
    if start is None:
        return []
    out: list[str] = []
    for j in range(start, len(lines)):
        if lines[j].startswith("## "):
            break
        out.append(lines[j])
    return out


def parse_overview_md(text: str) -> dict:
    """Best-effort extraction of a light training profile from Overview.md."""
    _fm, body = pc.parse_frontmatter(text)
    lines = body.splitlines()
    profile: dict = {}

    # --- Status line + phase ------------------------------------------------
    status_line = ""
    for ln in lines:
        s = ln.strip()
        if "phase" in s.lower() and ("active" in s.lower() or any(c in s for c in "🟢🟡🔴")):
            status_line = s
            break
    if status_line:
        profile["status"] = _strip_links(status_line.lstrip(_LEADING_STATUS_CHARS)).strip()

    phase = None
    m = re.search(r"phase\s*([0-9]+)", status_line, re.I)
    if m:
        phase = m.group(1)
    else:
        for ln in lines:
            mm = re.search(r"^#+\s*Phase\s*([0-9]+)\b", ln)
            if mm:
                phase = mm.group(1)
                break
    if phase:
        profile["phase"] = phase

    # --- Active routine (Status section: "Active routine: [[id|label]]") ----
    for ln in lines:
        mm = re.search(r"Active routine:\s*\[\[([^|\]]+)", ln)
        if mm:
            profile["active_routine"] = mm.group(1).split("/")[-1].strip()
            break

    # --- Current gym (from the status line "...at <Gym>.") ------------------
    mm = re.search(r"\bat\s+([A-Z][^.\n]+?)\.", status_line)
    if mm:
        profile["gym"] = mm.group(1).strip()

    # --- Goals (bullets under "## Goal") ------------------------------------
    goals: list[str] = []
    for ln in _section_lines(lines, re.compile(r"\bGoal\b", re.I)):
        s = ln.strip()
        if s.startswith("- "):
            goals.append(_strip_links(s[2:].replace("**", "")).strip())
    if goals:
        profile["goals"] = goals

    # --- Protein target (search the whole doc) ------------------------------
    mp = re.search(r"protein target[^\d]*([\d]+(?:\s*[–\-]\s*[\d]+)?\s*g)", text, re.I)
    if mp:
        profile["protein_target"] = re.sub(r"\s+", "", mp.group(1))

    return profile


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__, file=sys.stderr)
        return 2
    p = Path(args[0])
    profile = parse_overview_md(p.read_text(encoding="utf-8"))
    json.dump(profile, sys.stdout, indent=2, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
