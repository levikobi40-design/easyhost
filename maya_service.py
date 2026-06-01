"""
Maya long-term memory — JSON log per tenant (no vector DB required for demo).
Persists under data/maya_memory_<tenant_id>.json so restarts keep history.

Gemini model selection, 404 fallbacks, and generateContent calls live in app.py
(_gemini_preferred_models_prefix, _gemini_model_candidates, _gemini_err_is_model_not_found).
"""
from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

USE_AI = False  # legacy flag — Gemini lives in app.py

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_LOCK = threading.Lock()
_MAX_TURNS = 200

# Filtered from prompts + pruned from disk — repetitive “I'm here” / board boilerplate.
MAYA_BOILERPLATE_SUBSTRINGS = (
    "קובי, אני כאן",
    "קובי אני כאן",
    "אני כאן בשבילך",
    "אני כאן לצידך",
    "i'm here",
    "im here",
    "the board is back",
    "הלוח חזר",
    "מאיה מוכנה",
)


def _turn_is_boilerplate(turn: Dict[str, Any]) -> bool:
    txt = (turn.get("content") or "").strip().lower()
    if not txt:
        return True
    return any(s.lower() in txt for s in MAYA_BOILERPLATE_SUBSTRINGS)


def prune_boilerplate_turns(tenant_id: str) -> int:
    """Remove repetitive assistant boilerplate from on-disk memory. Returns number of turns removed."""
    path = _memory_path(tenant_id)
    with _LOCK:
        data = _load_file(path)
        turns: List[Dict[str, Any]] = list(data.get("turns") or [])
        kept = [t for t in turns if not _turn_is_boilerplate(t)]
        removed = len(turns) - len(kept)
        if removed:
            data["turns"] = kept
            _save_file(path, data)
        return removed


def _memory_max_chars() -> int:
    try:
        return int(os.getenv("MAYA_MEMORY_MAX_CHARS", "32000") or "32000")
    except (TypeError, ValueError):
        return 32000


def _memory_path(tenant_id: str) -> str:
    safe = re.sub(r"[^\w\-.]", "_", (tenant_id or "demo").strip() or "demo")
    return os.path.join(_DATA_DIR, f"maya_memory_{safe}.json")


def _load_file(path: str) -> Dict[str, Any]:
    if not os.path.isfile(path):
        return {"tenant_id": "demo", "turns": []}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"tenant_id": "demo", "turns": []}
        data.setdefault("turns", [])
        return data
    except Exception:
        return {"tenant_id": "demo", "turns": []}


def _save_file(path: str, data: Dict[str, Any]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=0)
    os.replace(tmp, path)


def append_turn(tenant_id: str, role: str, content: str, meta: Optional[Dict[str, Any]] = None) -> None:
    """Append one chat turn (user | assistant | system)."""
    if not content or not str(content).strip():
        return
    path = _memory_path(tenant_id)
    with _LOCK:
        data = _load_file(path)
        data["tenant_id"] = tenant_id
        turns: List[Dict[str, Any]] = data.get("turns") or []
        turns.append(
            {
                "ts": datetime.now(timezone.utc).isoformat(),
                "role": (role or "user").strip().lower(),
                "content": str(content)[:8000],
                "meta": meta or {},
            }
        )
        data["turns"] = turns[-_MAX_TURNS:]
        _save_file(path, data)


def get_recent_turns(tenant_id: str, limit: int = 40) -> List[Dict[str, Any]]:
    path = _memory_path(tenant_id)
    with _LOCK:
        data = _load_file(path)
    turns = data.get("turns") or []
    return turns[-limit:] if limit else turns


def format_memory_context(tenant_id: str, max_chars: int = None) -> str:
    """Compact transcript for Gemini / Maya prompts — uses full stored turn history up to _MAX_TURNS."""
    mc = max_chars if max_chars is not None else _memory_max_chars()
    turns = get_recent_turns(tenant_id, _MAX_TURNS)
    if not turns:
        return ""
    lines = []
    for t in turns:
        if _turn_is_boilerplate(t):
            continue
        role = t.get("role", "user")
        txt = (t.get("content") or "").strip().replace("\n", " ")
        if not txt:
            continue
        lines.append(f"- [{role}] {txt}")
    blob = "\n".join(lines)
    if len(blob) > mc:
        blob = blob[-mc:]
    return (
        "Prior conversation memory (same tenant — use for status / follow-up questions):\n"
        + blob
    )


def recall_relevant_snippets(tenant_id: str, query: str, max_lines: int = 10) -> str:
    """When user asks status / follow-up, surface earlier turns (e.g. AC at Bazaar)."""
    ql = (query or "").lower()
    he = query or ""
    status_ask = any(x in ql for x in ("status", "what's", "what is", "how is")) or any(
        x in he for x in ("סטטוס", "מה המצב", "איך זה", "מצב")
    )
    turns = get_recent_turns(tenant_id, 100)
    if not turns:
        return ""
    if not status_ask:
        return ""
    hits = []
    topic_keys = ("ac", "מזגן", "מזג", "תקל", "broken", "leak", "בזאר", "bazaar", "לובי", "lobby", "נזיל")
    for t in reversed(turns):
        if _turn_is_boilerplate(t):
            continue
        txt = (t.get("content") or "").strip()
        if not txt:
            continue
        tl = txt.lower()
        if any(k in tl for k in topic_keys):
            hits.append(f"[{t.get('role', '?')}] {txt[:320]}")
        if len(hits) >= max_lines:
            break
    if not hits:
        return ""
    return "Recalled topics from memory:\n" + "\n".join(hits)


def call_maya(prompt, context=None):
    if not USE_AI:
        return {"message": "AI disabled", "fallback": True}
    try:
        return {"message": "Maya response placeholder", "fallback": False}
    except Exception as e:
        print("❌ Maya Error:", str(e))
        return {"message": "AI unavailable", "fallback": True}


def guest_agent(data):
    prompt = f"New guest: {data}"
    return call_maya(prompt)


def booking_agent(data):
    prompt = f"Booking request: {data}"
    return call_maya(prompt)


def staff_agent(data):
    prompt = f"Staff task: {data}"
    return call_maya(prompt)


# ── Twilio / SMS — Ops stays DB-first: never lock the dashboard on quota/limit errors ──
TWILIO_INTERNAL_DASHBOARD_ONLY = False
TWILIO_INTERNAL_REASON = ""
# Intelligence override: do not treat Twilio limits as a gate for DB work (tasks, properties, room grid).
TWILIO_LIMITS_BLOCK_OPERATIONS = False


def set_twilio_internal_dashboard_only(reason: str = "") -> None:
    """Log only — internal-dashboard lock is disabled so Maya keeps full DB operational control."""
    global TWILIO_INTERNAL_REASON
    TWILIO_INTERNAL_REASON = (reason or "")[:500]
    print(
        "[Maya] Twilio notice (non-blocking, DB ops continue):",
        TWILIO_INTERNAL_REASON or "(no reason)",
        flush=True,
    )


def is_twilio_internal_dashboard_only() -> bool:
    """Always False when limits must not block status updates / property management."""
    if TWILIO_LIMITS_BLOCK_OPERATIONS:
        return TWILIO_INTERNAL_DASHBOARD_ONLY
    return False


def twilio_internal_reason() -> str:
    return TWILIO_INTERNAL_REASON or ""


def sms_or_whatsapp_failed_continue(exc: BaseException, context: str = "") -> None:
    """Twilio failures are logged; DB tasks and room state are never blocked."""
    ctx = (context or "sms").strip()[:80]
    print(f"[Maya] Twilio {ctx} non-fatal — DB ops continue:", exc, flush=True)


def upsert_property(tenant_id: str, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """
    Create or update a property in manual_rooms (SQLite / Postgres / Supabase via SQLAlchemy).
    Lazy-imports app.upsert_property_db to avoid circular import at startup.
    """
    if not isinstance(payload, dict):
        return None
    try:
        from app import upsert_property_db  # noqa: WPS433 — runtime import intentional

        return upsert_property_db(tenant_id, payload)
    except Exception as e:
        print("[maya_service.upsert_property]", e, flush=True)
        return None
