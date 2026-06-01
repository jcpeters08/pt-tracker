#!/usr/bin/env python3
"""Audit PT Tracker generated data invariants.

This codifies the convention that every referenced exercise has a metadata file
and a non-null image, plus a few cheap JSON/schema consistency checks.
"""

from __future__ import annotations

import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

PF_DUMBBELL_LBS = set(range(5, 85, 5))


def _load_json(path: Path, findings: list[str]) -> dict | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        findings.append(f"{path.relative_to(path.parents[1])}: invalid JSON ({exc})")
        return None


def _json_files(root: Path, subdir: str) -> list[Path]:
    folder = root / "data" / subdir
    if not folder.exists():
        return []
    return sorted(folder.glob("*.json"))


def _exercise_refs_from_routine(routine: dict) -> set[str]:
    refs: set[str] = set()
    for day in (routine.get("days") or {}).values():
        for ex in day.get("warmup_exercises") or []:
            if ex.get("exercise_id"):
                refs.add(ex["exercise_id"])
        for ex in day.get("exercises") or []:
            if ex.get("exercise_id"):
                refs.add(ex["exercise_id"])
    return refs


def _exercise_refs_from_log(log: dict) -> set[str]:
    refs: set[str] = set()
    for key in ("warmup_exercises", "exercises"):
        for ex in log.get(key) or []:
            if ex.get("exercise_id"):
                refs.add(ex["exercise_id"])
    return refs


def _iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _is_phase2_routine(routine: dict) -> bool:
    return str(routine.get("phase") or "") == "2" or "Phase-2" in str(routine.get("id") or "")


def _lbs_from_raw(raw: str) -> float | None:
    match = re.search(r"(\d+(?:\.\d+)?)\s*lbs?", raw.lower())
    return float(match.group(1)) if match else None


def _audit_pf_targets(path: Path, routine: dict, repo_root: Path, findings: list[str]) -> None:
    if not _is_phase2_routine(routine):
        return
    for day_name, day in (routine.get("days") or {}).items():
        for ex in day.get("exercises") or []:
            raw = str(ex.get("target_weight_raw") or "")
            lbs = _lbs_from_raw(raw)
            if lbs is None or lbs == 0:
                continue
            if "ea" in raw.lower():
                if lbs in PF_DUMBBELL_LBS:
                    continue
                findings.append(
                    f"{path.relative_to(repo_root)}: PF dumbbell target {raw!r} "
                    f"for {day_name}/{ex.get('exercise_id')} is not a real 5-lb dumbbell increment"
                )
            else:
                if lbs % 5 == 0:
                    continue
                findings.append(
                    f"{path.relative_to(repo_root)}: PF target {raw!r} "
                    f"for {day_name}/{ex.get('exercise_id')} is not a real 5-lb increment"
                )


def audit_repo(repo_root: Path) -> list[str]:
    findings: list[str] = []
    data_dir = repo_root / "data"
    if not data_dir.exists():
        return [f"missing data directory: {data_dir}"]

    referenced: set[str] = set()
    routines: list[tuple[Path, dict]] = []
    for subdir in ("routines", "logs", "recovery_logs", "exercises"):
        for path in _json_files(repo_root, subdir):
            obj = _load_json(path, findings)
            if obj is None:
                continue
            if obj.get("id") and obj["id"] != path.stem:
                findings.append(f"{path.relative_to(repo_root)}: id {obj['id']!r} does not match filename {path.stem!r}")
            if subdir == "routines":
                routines.append((path, obj))
                _audit_pf_targets(path, obj, repo_root, findings)
                referenced |= _exercise_refs_from_routine(obj)
            elif subdir == "logs":
                referenced |= _exercise_refs_from_log(obj)

    dated_routines = sorted(
        ((start, path, routine) for path, routine in routines if (start := _iso_date(routine.get("start_date")))),
        key=lambda item: item[0],
    )
    for idx, (start, path, routine) in enumerate(dated_routines[:-1]):
        next_start = dated_routines[idx + 1][0]
        end = _iso_date(routine.get("end_date"))
        if end is None:
            expected = next_start - timedelta(days=1)
            findings.append(f"{path.relative_to(repo_root)}: missing end_date before next routine; expected {expected.isoformat()}")
        elif end >= next_start:
            findings.append(f"{path.relative_to(repo_root)}: end_date {end.isoformat()} overlaps next routine start {next_start.isoformat()}")

    exercise_dir = repo_root / "data" / "exercises"
    exercise_files = {p.stem: p for p in exercise_dir.glob("*.json")} if exercise_dir.exists() else {}
    for ex_id in sorted(referenced):
        if ex_id not in exercise_files:
            findings.append(f"referenced exercise {ex_id!r} has no data/exercises/{ex_id}.json")

    for ex_id, path in sorted(exercise_files.items()):
        ex = _load_json(path, findings)
        if ex is None:
            continue
        if not ex.get("image_url"):
            findings.append(f"{path.relative_to(repo_root)}: image_url is null/empty")
        if "video_url" in ex and not ex.get("video_url"):
            findings.append(f"{path.relative_to(repo_root)}: video_url is null/empty")
        if ex.get("image_url") and not ex.get("image_source"):
            findings.append(f"{path.relative_to(repo_root)}: image_source missing")
        if ex.get("image_url") and not ex.get("image_match"):
            findings.append(f"{path.relative_to(repo_root)}: image_match missing")

    cooldown_path = repo_root / "data" / "cooldowns.json"
    if cooldown_path.exists():
        cooldowns = _load_json(cooldown_path, findings)
        if cooldowns is not None:
            for key, group in (cooldowns.get("library") or {}).items():
                for idx, move in enumerate(group.get("moves") or [], start=1):
                    if not move.get("image_url"):
                        name = move.get("name") or move.get("title") or f"move #{idx}"
                        findings.append(f"data/cooldowns.json: {key} {name!r} image_url is null/empty")
    else:
        findings.append("data/cooldowns.json: missing")

    return findings


def main() -> int:
    repo_root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    findings = audit_repo(repo_root)
    if findings:
        for f in findings:
            print(f"FAIL: {f}")
        return 1
    print("data audit passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
