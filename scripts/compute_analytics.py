#!/usr/bin/env python3
"""Aggregate data/logs/*.json + data/exercises/*.json → data/analytics.json.

The analytics page reads only this file — never raw logs in-browser.

Aggregates (see Web-App-Build-Brief for schema):
  - lifts_per_week:        ISO week → {day_of_week: type}
  - weekly_volume_by_muscle: list of {week, muscle, sets}
  - exercise_progression:   id → list of {date, top_set_weight_kg, top_set_reps, total_volume_kg}
  - prs:                   list of {exercise_id, date, weight_kg, reps, delta_kg}
  - session_compliance:    week → {planned, completed} (planned filled by sync from routine)
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from datetime import date as _date
from pathlib import Path


def _load_json(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def _iso_week(date_str: str) -> str:
    y, m, d = date_str.split("-")
    iso = _date(int(y), int(m), int(d)).isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def _exercise_index(exercises_dir: Path) -> dict[str, dict]:
    out: dict[str, dict] = {}
    if not exercises_dir.exists():
        return out
    for f in sorted(exercises_dir.glob("*.json")):
        try:
            ex = _load_json(f)
            out[ex["id"]] = ex
        except Exception as e:
            print(f"  WARN: bad exercise json {f.name}: {e}", file=sys.stderr)
    return out


def compute(repo_root: Path) -> dict:
    logs_dir = repo_root / "data" / "logs"
    exercises_dir = repo_root / "data" / "exercises"

    exercises = _exercise_index(exercises_dir)
    logs: list[dict] = []
    if logs_dir.exists():
        for f in sorted(logs_dir.glob("*.json")):
            try:
                logs.append(_load_json(f))
            except Exception as e:
                print(f"  WARN: bad log json {f.name}: {e}", file=sys.stderr)
    logs.sort(key=lambda x: x.get("date", ""))

    # lifts_per_week
    lifts_per_week: dict[str, dict] = defaultdict(dict)
    for log in logs:
        week = _iso_week(log["date"])
        lifts_per_week[week][log["day_of_week"]] = log["type"]

    # weekly_volume_by_muscle (count working sets per primary muscle per week)
    volume_acc: dict[tuple[str, str], int] = defaultdict(int)
    for log in logs:
        week = _iso_week(log["date"])
        for ex in log.get("exercises", []):
            ex_meta = exercises.get(ex["exercise_id"], {})
            primary = ex_meta.get("primary_muscle") or "other"
            n_sets = len(ex.get("sets", []))
            volume_acc[(week, primary)] += n_sets
    weekly_volume = [
        {"week": w, "muscle": m, "sets": n}
        for (w, m), n in sorted(volume_acc.items())
    ]

    # exercise_progression: per exercise id, ordered list of session aggregates
    progression: dict[str, list[dict]] = defaultdict(list)
    for log in logs:
        for ex in log.get("exercises", []):
            sets = ex.get("sets", [])
            if not sets:
                continue
            top_set = max(sets, key=lambda s: (s.get("weight_kg") or 0, s.get("reps") or 0))
            total_volume = sum(
                (s.get("weight_kg") or 0) * (s.get("reps") or 0) for s in sets
            )
            progression[ex["exercise_id"]].append({
                "date": log["date"],
                "top_set_weight_kg": top_set.get("weight_kg") or 0,
                "top_set_reps": top_set.get("reps") or 0,
                "total_volume_kg": round(total_volume, 1),
                "sets_count": len(sets),
            })

    # PRs: any session where weight_kg > prior best for that exercise
    prs: list[dict] = []
    for ex_id, entries in progression.items():
        best_kg = -1.0
        for e in entries:
            w = e["top_set_weight_kg"] or 0
            if w > best_kg and best_kg >= 0:
                prs.append({
                    "exercise_id": ex_id,
                    "date": e["date"],
                    "weight_kg": w,
                    "reps": e["top_set_reps"],
                    "delta_kg": round(w - best_kg, 1),
                })
                best_kg = w
            elif best_kg < 0:
                best_kg = w
    prs.sort(key=lambda x: x["date"], reverse=True)

    # session_compliance: completed = number of distinct days logged that week.
    # planned is filled by sync.py from routine JSONs (left empty here).
    completed_per_week: dict[str, int] = defaultdict(int)
    for log in logs:
        completed_per_week[_iso_week(log["date"])] += 1
    session_compliance = {
        w: {"planned": None, "completed": n}
        for w, n in sorted(completed_per_week.items())
    }

    return {
        "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
            .replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "log_count": len(logs),
        "lifts_per_week": dict(sorted(lifts_per_week.items())),
        "weekly_volume_by_muscle": weekly_volume,
        "exercise_progression": dict(progression),
        "prs": prs,
        "session_compliance": session_compliance,
    }


def main() -> int:
    repo_root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    result = compute(repo_root)
    out_path = repo_root / "data" / "analytics.json"
    out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {out_path.relative_to(repo_root)} ({result['log_count']} logs aggregated, {len(result['prs'])} PRs detected).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
