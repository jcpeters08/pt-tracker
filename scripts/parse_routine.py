#!/usr/bin/env python3
"""Parse a vault Weekly Plan markdown file into a routine JSON.

Usage:
    python3 parse_routine.py <path/to/Weekly Plans/YYYY-WXX-name.md> > routines/<id>.json
    python3 parse_routine.py <vault-plans-dir> <out-routines-dir>   # batch mode

The routine schema matches data/routines/{id}.json as documented in the
Web-App-Build-Brief. Fields not derivable from the MD (image_url, video_url)
live in data/exercises/<id>.json instead.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date as _date
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import pt_common as pc  # noqa: E402

DAY_HEADER_RE = re.compile(
    r"^##\s+(?P<day>\w+)\s+(?P<dm>\d{1,2}/\d{1,2})\s+[—\-–]\s+(?P<label>.+)$"
)


def _routine_id_from_filename(name: str) -> str:
    return Path(name).stem


def _start_date_from_id(routine_id: str, fallback: str | None) -> str | None:
    """Pull start date from frontmatter or routine id (`YYYY-WXX-...`)."""
    if fallback:
        return fallback
    m = re.match(r"(\d{4})-W(\d{1,2})", routine_id)
    if not m:
        return None
    year, week = int(m.group(1)), int(m.group(2))
    # ISO week — Monday of that week
    try:
        return _date.fromisocalendar(year, week, 1).isoformat()
    except ValueError:
        return None


def parse_routine_md(text: str, *, routine_id: str) -> dict:
    fm, body = pc.parse_frontmatter(text)
    lines = body.splitlines()

    days: dict[str, dict] = {}
    cur_day: str | None = None
    cur_label: str | None = None
    cur_warmup = ""
    section_start: int | None = None

    def _flush(end_idx: int) -> None:
        nonlocal cur_day, cur_label, cur_warmup, section_start
        if cur_day is None or section_start is None:
            return
        section_lines = lines[section_start:end_idx]
        # Pull warm-up line
        warmup = ""
        for ln in section_lines:
            m = re.match(r"^\*\*Warm-?up.*?:?\*\*\s*(.*)$", ln, re.I)
            if m:
                warmup = m.group(1).strip()
                break
        # First table is the exercise table
        tbl = pc.find_table(section_lines, 0)
        exercises: list[dict] = []
        if tbl:
            rows = pc.parse_table_rows(section_lines, tbl[0], tbl[1])
            for row in rows:
                # Routine table headers: "#" | "exercise" | "working weight" | "reps" | "sets" | "notes"
                name = row.get("exercise", "") or ""
                if not name:
                    continue
                resolved = pc.resolve_exercise_id(name)
                if resolved is None:
                    continue
                ex_id, _ = resolved
                weight_kg, weight_raw = pc.parse_weight(row.get("working weight", ""))
                sets_n = pc.parse_sets(row.get("sets", ""))
                reps_list = pc.parse_reps(row.get("reps", ""), sets_n)
                target_reps = reps_list[0] if reps_list else 0
                exercises.append({
                    "exercise_id": ex_id,
                    "target_weight_kg": weight_kg,
                    "target_weight_raw": weight_raw,
                    "target_reps": target_reps,
                    "target_sets": sets_n,
                    "notes": (row.get("notes") or "").strip(),
                })
        days[cur_day] = {
            "label": cur_label or "",
            "warmup": warmup,
            "exercises": exercises,
        }
        cur_day = None
        cur_label = None
        cur_warmup = ""
        section_start = None

    for i, line in enumerate(lines):
        m = DAY_HEADER_RE.match(line)
        if m:
            if cur_day is not None:
                _flush(i)
            day_token = m.group("day")
            canonical = pc.canonical_day(day_token)
            if canonical is None:
                continue
            cur_day = canonical
            cur_label = m.group("label").strip()
            section_start = i + 1
        elif line.startswith("## ") and cur_day is not None:
            _flush(i)
    if cur_day is not None:
        _flush(len(lines))

    start_date = _start_date_from_id(routine_id, fm.get("start_date"))
    name = fm.get("aliases")
    display_name = name[0] if isinstance(name, list) and name else routine_id

    return {
        "id": routine_id,
        "name": display_name,
        "phase": str(fm.get("phase", "")) or _phase_from_tags(fm),
        "start_date": start_date,
        "end_date": fm.get("end_date"),
        "source_md": f"Weekly Plans/{routine_id}.md",
        "days": days,
    }


def _phase_from_tags(fm: dict) -> str:
    tags = fm.get("tags", [])
    if isinstance(tags, list):
        for t in tags:
            t = t.strip()
            if t.startswith("phase-"):
                return t[len("phase-"):]
    return ""


def _process_one(in_path: Path, out_path: Path) -> None:
    routine = parse_routine_md(in_path.read_text(encoding="utf-8"), routine_id=in_path.stem)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(routine, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__, file=sys.stderr)
        return 2
    if len(args) == 1:
        # Single file → stdout
        p = Path(args[0])
        routine = parse_routine_md(p.read_text(encoding="utf-8"), routine_id=p.stem)
        json.dump(routine, sys.stdout, indent=2, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0
    src_dir = Path(args[0])
    out_dir = Path(args[1])
    md_files = sorted(src_dir.glob("*.md"))
    n = 0
    for f in md_files:
        out = out_dir / (f.stem + ".json")
        _process_one(f, out)
        print(f"  routine: {f.name} → {out.relative_to(out_dir.parent)}")
        n += 1
    print(f"Processed {n} routine(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
