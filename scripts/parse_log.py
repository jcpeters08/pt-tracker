#!/usr/bin/env python3
"""Parse a vault Workout Log markdown file into a session log JSON.

Usage:
    python3 parse_log.py <path/to/Workout Log/YYYY-MM-DD-Day-Type.md>          # → stdout
    python3 parse_log.py <vault-logs-dir> <out-logs-dir>                       # batch

The log schema matches data/logs/{id}.json as documented in the build brief.
Tolerant of format variation across hand-authored MD files.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

import pt_common as pc  # noqa: E402

# Section headings we care about (case-insensitive).
SECTION_PATTERNS = {
    "exercises":   re.compile(r"^##\s+exercises\s*$", re.I),
    "warmup":      re.compile(r"^##\s+warm-?up\s*$", re.I),
    "session":     re.compile(r"^##\s+session\s+notes\s*$", re.I),
    "volume":      re.compile(r"^##\s+volume\s+summary\s*$", re.I),
}

META_KEYS = {
    "Location": "location",
    "Phase": "phase",
    "Trainer": "trainer",
    "Training partner": "training_partner",
    "Thermocycling post-workout": "thermocycling",
    "Time": "time_of_day",
    "Pre (T-15 min)": "pre_workout",
    "Post (within 30 min)": "post_workout",
    "Recovery state": "recovery_state",
    "Session context": "session_context",
}


def _section_bounds(lines: list[str], pattern: re.Pattern) -> tuple[int, int] | None:
    start = None
    for i, ln in enumerate(lines):
        if pattern.match(ln):
            start = i + 1
            break
    if start is None:
        return None
    end = len(lines)
    for j in range(start, len(lines)):
        if lines[j].startswith("## "):
            end = j
            break
    return start, end


def _parse_meta(lines: list[str]) -> dict:
    """Pull the bullet/colon-style meta block at the top of the log."""
    meta: dict = {}
    for ln in lines:
        if ln.startswith("## "):
            break
        m = re.match(r"^\*\*([^*:]+):\*\*\s*(.*)$", ln)
        if not m:
            continue
        raw_key, raw_val = m.group(1).strip(), m.group(2).strip()
        key = META_KEYS.get(raw_key)
        if key:
            meta[key] = _normalize_meta_value(key, raw_val)
    return meta


def _normalize_meta_value(key: str, val: str):
    if key in ("thermocycling",):
        return val.strip().lower().startswith("y")
    if key == "training_partner":
        # Accept "[[jacob|Jacob]] — back recovered..." or "—" or empty
        cleaned = re.sub(r"\[\[([^|\]]+)(?:\|([^\]]+))?\]\]", lambda m: m.group(2) or m.group(1), val)
        cleaned = cleaned.strip()
        if not cleaned or cleaned.startswith("—") or cleaned.lower() == "none":
            return None
        return cleaned.split("—")[0].strip() or None
    return val


def _parse_exercise_table(section_lines: list[str]) -> list[dict]:
    tbl = pc.find_table(section_lines, 0)
    if not tbl:
        return []
    rows = pc.parse_table_rows(section_lines, tbl[0], tbl[1])
    out: list[dict] = []
    for row in rows:
        name = row.get("exercise", "") or row.get("exercise ", "")
        if not name:
            continue
        resolved = pc.resolve_exercise_id(name)
        if resolved is None:
            continue
        ex_id, display = resolved
        weight_kg, weight_raw = pc.parse_weight(row.get("weight", ""))
        sets_n = pc.parse_sets(row.get("sets", ""))
        reps_list = pc.parse_reps(row.get("reps", ""), sets_n)
        sets = [
            {"set": i + 1, "weight_kg": weight_kg, "reps": reps_list[i] if i < len(reps_list) else 0}
            for i in range(sets_n)
        ]
        out.append({
            "exercise_id": ex_id,
            "display_name": display,
            "weight_raw": weight_raw,
            "sets": sets,
            "notes": (row.get("notes") or "").strip(),
        })
    return out


def _parse_session_notes(section_lines: list[str]) -> str:
    """Concatenate non-empty lines (strip leading dashes)."""
    text_lines: list[str] = []
    for ln in section_lines:
        if ln.startswith("## ") or ln.startswith("---"):
            break
        s = ln.strip()
        if not s:
            continue
        if s.startswith("- "):
            s = s[2:]
        text_lines.append(s)
    return "\n".join(text_lines)


def parse_log_md(text: str, *, filename: str) -> dict:
    info = pc.parse_log_filename(filename)
    if not info:
        raise ValueError(f"Cannot parse filename: {filename!r}")

    fm, body = pc.parse_frontmatter(text)
    lines = body.splitlines()
    meta = _parse_meta(lines)

    exercises: list[dict] = []
    warmup_exercises: list[dict] = []

    ex_bounds = _section_bounds(lines, SECTION_PATTERNS["exercises"])
    if ex_bounds:
        exercises = _parse_exercise_table(lines[ex_bounds[0]:ex_bounds[1]])
    wu_bounds = _section_bounds(lines, SECTION_PATTERNS["warmup"])
    if wu_bounds:
        warmup_exercises = _parse_exercise_table(lines[wu_bounds[0]:wu_bounds[1]])

    sn_bounds = _section_bounds(lines, SECTION_PATTERNS["session"])
    session_notes = _parse_session_notes(lines[sn_bounds[0]:sn_bounds[1]]) if sn_bounds else ""

    # Muscle groups from frontmatter tags (anything that's not "fitness", "workout-log", "phase-X")
    muscle_groups: list[str] = []
    for tag in fm.get("tags", []) if isinstance(fm.get("tags"), list) else []:
        t = tag.strip()
        if t in ("fitness", "workout-log") or t.startswith("phase-") or t.endswith("-day"):
            continue
        muscle_groups.append(t)

    fasted = "fasted" in (meta.get("time_of_day") or "").lower() or \
             "fasted" in (meta.get("pre_workout") or "").lower()

    return {
        "id": info["id"],
        "date": info["date"],
        "day_of_week": info["day_of_week"],
        "type": info["type"],
        "muscle_groups": muscle_groups,
        "phase": meta.get("phase"),
        "location": meta.get("location"),
        "trainer": meta.get("trainer"),
        "training_partner": meta.get("training_partner"),
        "thermocycling": bool(meta.get("thermocycling", False)),
        "fasted": fasted,
        "warmup_exercises": warmup_exercises,
        "exercises": exercises,
        "session_notes": session_notes,
        "source_md": f"Workout Log/{filename}",
    }


def _process_one(in_path: Path, out_dir: Path) -> Path:
    log = parse_log_md(in_path.read_text(encoding="utf-8"), filename=in_path.name)
    out_path = out_dir / (log["id"] + ".json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(log, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return out_path


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__, file=sys.stderr)
        return 2
    if len(args) == 1:
        p = Path(args[0])
        log = parse_log_md(p.read_text(encoding="utf-8"), filename=p.name)
        json.dump(log, sys.stdout, indent=2, ensure_ascii=False)
        sys.stdout.write("\n")
        return 0
    src_dir = Path(args[0])
    out_dir = Path(args[1])
    md_files = sorted(src_dir.glob("*.md"))
    n = 0
    for f in md_files:
        try:
            out_path = _process_one(f, out_dir)
            print(f"  log: {f.name} → {out_path.name}")
            n += 1
        except Exception as e:
            print(f"  ERROR parsing {f.name}: {e}", file=sys.stderr)
    print(f"Processed {n} log(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
