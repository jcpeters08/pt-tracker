#!/usr/bin/env python3
"""Generate data/manifest.json for same-origin browser reads.

The web app and reports page are static GitHub Pages files. They should not
need GitHub Contents directory listings for public read paths, so sync writes a
small manifest listing the JSON snapshots that already exist under data/.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _ids(root: Path, subdir: str) -> list[str]:
    folder = root / "data" / subdir
    if not folder.exists():
        return []
    return sorted(p.stem for p in folder.glob("*.json"))


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _latest_routine_id(root: Path, routine_ids: list[str]) -> str | None:
    best: tuple[str, str] | None = None
    for rid in routine_ids:
        try:
            routine = _load_json(root / "data" / "routines" / f"{rid}.json")
        except Exception:
            continue
        start = routine.get("start_date") or ""
        if not start:
            continue
        candidate = (start, rid)
        if best is None or candidate > best:
            best = candidate
    return best[1] if best else (routine_ids[-1] if routine_ids else None)


def build_manifest(repo_root: Path, *, generated_at: str | None = None) -> dict:
    routines = _ids(repo_root, "routines")
    logs = _ids(repo_root, "logs")
    recovery_logs = _ids(repo_root, "recovery_logs")
    exercises = _ids(repo_root, "exercises")
    return {
        "generated_at": generated_at or _now_iso(),
        "routines": routines,
        "logs": logs,
        "recovery_logs": recovery_logs,
        "exercises": exercises,
        "latest_routine_id": _latest_routine_id(repo_root, routines),
    }


def write_manifest(repo_root: Path, *, generated_at: str | None = None) -> dict:
    manifest = build_manifest(repo_root, generated_at=generated_at)
    out = repo_root / "data" / "manifest.json"
    out.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return manifest


def main() -> int:
    repo_root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    manifest = write_manifest(repo_root)
    print(
        f"Wrote data/manifest.json "
        f"({len(manifest['routines'])} routines, {len(manifest['logs'])} logs, "
        f"{len(manifest['recovery_logs'])} recovery logs, {len(manifest['exercises'])} exercises)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
