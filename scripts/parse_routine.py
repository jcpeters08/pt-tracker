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
from datetime import date as _date, timedelta
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


def _start_date_from_day_header(routine_id: str, first_dm: str | None) -> str | None:
    """Derive start date from the first day-header's M/D (e.g. '5/4'), taking the
    year from the routine id's `YYYY-WXX` prefix. Preferred over the
    ISO-week-of-id fallback: the routine's dated day headers are the source of
    truth, so a file named ...-W18-... whose days run 5/4-5/7 starts 2026-05-04,
    not the ISO-week-18 Monday (2026-04-27)."""
    if not first_dm:
        return None
    m = re.match(r"(\d{4})-W(\d{1,2})", routine_id)
    if not m:
        return None
    year, week = int(m.group(1)), int(m.group(2))
    try:
        mo, dy = (int(x) for x in first_dm.split("/"))
    except (ValueError, AttributeError):
        return None
    # Year-boundary guard: a January day in a high-week file rolls to year+1;
    # a December day in a low-week file rolls to year-1.
    if mo == 1 and week >= 50:
        year += 1
    elif mo == 12 and week <= 2:
        year -= 1
    try:
        return _date(year, mo, dy).isoformat()
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
    first_dm: str | None = None

    def _flush(end_idx: int) -> None:
        nonlocal cur_day, cur_label, cur_warmup, section_start
        if cur_day is None or section_start is None:
            return
        section_lines = lines[section_start:end_idx]
        # Pull warm-up + cool-down lines (cool-down is optional)
        warmup = ""
        cooldown = ""
        for ln in section_lines:
            m = re.match(r"^\*\*Warm-?up.*?:?\*\*\s*(.*)$", ln, re.I)
            if m and not warmup:
                warmup = m.group(1).strip()
                continue
            m = re.match(r"^\*\*Cool-?down.*?:?\*\*\s*(.*)$", ln, re.I)
            if m and not cooldown:
                cooldown = m.group(1).strip()
                continue
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
            "cooldown": cooldown,
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
            if first_dm is None:
                first_dm = m.group("dm")
            cur_day = canonical
            cur_label = m.group("label").strip()
            section_start = i + 1
        elif line.startswith("## ") and cur_day is not None:
            _flush(i)
    if cur_day is not None:
        _flush(len(lines))

    start_date = (
        fm.get("start_date")
        or _start_date_from_day_header(routine_id, first_dm)
        or _start_date_from_id(routine_id, None)
    )
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


def derive_end_dates(routines: list[dict]) -> list[dict]:
    """Fill missing routine end_date values from the next routine's start_date.

    Explicit end_date frontmatter is preserved. Routines without start_date are
    returned unchanged because there is no reliable window to derive.
    """
    out = [dict(r) for r in routines]
    dated = sorted(
        ((r.get("start_date"), i) for i, r in enumerate(out) if r.get("start_date")),
        key=lambda x: x[0],
    )
    for pos, (_, idx) in enumerate(dated[:-1]):
        routine = out[idx]
        if routine.get("end_date"):
            continue
        next_start = dated[pos + 1][0]
        try:
            y, m, d = (int(x) for x in next_start.split("-"))
            routine["end_date"] = (_date(y, m, d) - timedelta(days=1)).isoformat()
        except Exception:
            pass
    return out


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
    parsed: list[tuple[Path, dict]] = []
    for f in md_files:
        parsed.append((f, parse_routine_md(f.read_text(encoding="utf-8"), routine_id=f.stem)))
    parsed_routines = {routine["id"]: routine for routine in derive_end_dates([r for _, r in parsed])}
    for f, routine in parsed:
        out = out_dir / (f.stem + ".json")
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(parsed_routines[routine["id"]], indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"  routine: {f.name} → {out.relative_to(out_dir.parent)}")
    n = len(parsed)
    print(f"Processed {n} routine(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
