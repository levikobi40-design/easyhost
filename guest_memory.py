"""
Learning log — append-only conversation storage per tenant (JSON lines).
Used alongside maya_service JSON memory for durable guest/Maya transcripts.
"""
from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

_LOCK = threading.Lock()
_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_MAX_LINES_PER_FILE = 5000


def _safe_tenant(tenant_id: str) -> str:
    return re.sub(r"[^\w\-.]", "_", (tenant_id or "demo").strip() or "demo")


def _path(tenant_id: str) -> str:
    return os.path.join(_DATA_DIR, f"guest_memory_{_safe_tenant(tenant_id)}.jsonl")


def append_turn(
    tenant_id: str,
    role: str,
    content: str,
    meta: Optional[Dict[str, Any]] = None,
) -> None:
    if not content or not str(content).strip():
        return
    os.makedirs(_DATA_DIR, exist_ok=True)
    line = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "role": (role or "user").strip().lower(),
        "content": str(content)[:16000],
        "meta": meta or {},
    }
    p = _path(tenant_id)
    with _LOCK:
        with open(p, "a", encoding="utf-8") as f:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
        _trim_file_if_needed(p)


def _trim_file_if_needed(path: str) -> None:
    try:
        if not os.path.isfile(path):
            return
        with open(path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        if len(lines) <= _MAX_LINES_PER_FILE:
            return
        keep = lines[-_MAX_LINES_PER_FILE:]
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.writelines(keep)
        os.replace(tmp, path)
    except Exception:
        pass


def get_recent_lines(tenant_id: str, limit: int = 80) -> List[Dict[str, Any]]:
    p = _path(tenant_id)
    if not os.path.isfile(p):
        return []
    out: List[Dict[str, Any]] = []
    with _LOCK:
        try:
            with open(p, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        out.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        except Exception:
            return []
    return out[-limit:] if limit else out
