#!/usr/bin/env python3
"""Parse a vault Recovery Log markdown file into a recovery-session JSON.

Vault file shape (matches sync.render_recovery_md):

    ---
    type: recovery-log
    status: completed
    tags:
      - fitness
      - recovery
      - thermocycling
    aliases:
      - Embrace North 2026-05-13
    ---

    # 🧊 2026-05-13 — Embrace North

    **Date:** 2026-05-13
    **Location:** Embrace North
    **Rounds:** 3
    **Sauna per round:** 15 min
    **Plunge per round:** 4 min
    **Total time:** ~57 min
    **Submitted:** 2026-05-13T17:00:00Z
    **Logged via:** PT Tracker web app

    ## Notes
    - free-form

Hand-edits are tolerated — any missing field falls back to a sensible default
or empty.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import pt_common as pc  # noqa: E402

FIELD_RE = re.compile(r"^\*\*(?P<key>[^*]+?):\*\*\s*(?P<val>.*)$")

FIELD_MAP = {
    "date":             "date",
    "location":         "location",
    "rounds":           "rounds",
    "sauna per round":  "sauna_min",
    "plunge per round": "plunge_min",
    "cold plunge per round": "plunge_min",
    "total time":       "total_min",
    "submitted":        "submitted_at",
}

RECOVERY_FILENAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-(.+)\.md$")


def _to_int(s: str) -> int | None:
    m = re.search(r"\d+", s)
    return int(m.group(0)) if m else None


def parse_recovery_md(text: str, *, filename: str | None = None) -> dict | None:
    fm, body = pc.parse_frontmatter(text)
    if fm.get("status") == "skipped":
        return None
    if (fm.get("type") or "").strip() != "recovery-log":
        # Tolerate missing type if the filename matches and tags include recovery
        tags = fm.get("tags", [])
        if not (isinstance(tags, list) and any("recovery" in t for t in tags)):
            return None

    lines = body.splitlines()
    data: dict = {}
    notes_lines: list[str] = []
    in_notes = False

    for ln in lines:
        if re.match(r"^##\s+notes?\s*$", ln, re.I):
            in_notes = True
            continue
        if ln.startswith("## ") and in_notes:
            in_notes = False
        if in_notes:
            stripped = ln.strip()
            # Stop at a horizontal rule (---) which separates the notes section
            # from "See Also" or the trailer.
            if stripped == "---":
                in_notes = False
                continue
            if stripped.startswith("- "):
                notes_lines.append(stripped[2:])
            elif stripped:
                notes_lines.append(stripped)
            continue
        m = FIELD_RE.match(ln.strip())
        if not m:
            continue
        key = m.group("key").strip().lower()
        val = m.group("val").strip()
        target = FIELD_MAP.get(key)
        if not target:
            continue
        if target in ("rounds", "sauna_min", "plunge_min", "total_min"):
            data[target] = _to_int(val)
        else:
            data[target] = val

    # Filename fallback for date
    if "date" not in data and filename:
        m = RECOVERY_FILENAME_RE.match(filename)
        if m:
            data["date"] = m.group(1)

    if not data.get("date"):
        return None

    location_slug = pc.slugify(data.get("location") or "recovery")
    rec_id = f"{data['date']}-{location_slug}"

    return {
        "id": rec_id,
        "date": data["date"],
        "location": data.get("location") or "",
        "rounds": data.get("rounds"),
        "sauna_min": data.get("sauna_min"),
        "plunge_min": data.get("plunge_min"),
        "total_min": data.get("total_min"),
        "submitted_at": data.get("submitted_at"),
        "notes": "\n".join(notes_lines).strip(),
        "source_md": f"Recovery Log/{filename}" if filename else None,
    }


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__, file=sys.stderr)
        return 2
    if len(args) == 1:
        p = Path(args[0])
        rec = parse_recovery_md(p.read_text(encoding="utf-8"), filename=p.name)
        json.dump(rec, sys.stdout, indent=2, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0
    src_dir = Path(args[0])
    out_dir = Path(args[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    n = 0
    for f in sorted(src_dir.glob("*.md")):
        rec = parse_recovery_md(f.read_text(encoding="utf-8"), filename=f.name)
        if rec is None:
            continue
        (out_dir / (rec["id"] + ".json")).write_text(
            json.dumps(rec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        n += 1
    print(f"Processed {n} recovery log(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
