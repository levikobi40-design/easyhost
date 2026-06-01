"""
Maya truth / grounding layer — intent classification and response metadata.

Keeps operational claims tied to verified backend data. No Flask imports here.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

# Intent labels (stable API for logs and JSON)
INTENT_AVAILABILITY = "availability"
INTENT_MEETING_ROOMS = "meeting_rooms"
INTENT_ROOM_CAPACITY = "room_capacity"
INTENT_BRANCH_PROPERTY = "branch_property"
INTENT_PRICING = "pricing"
INTENT_GUEST_LEAD = "guest_lead"
INTENT_OPERATIONAL_TASK = "operational_task"
INTENT_GENERAL = "general_conversation"
INTENT_UNSUPPORTED = "unsupported_unknown"

# Intents that run DB/tool grounding and may short-circuit (not greetings / generic chat).
OPERATIONAL_TRUTH_INTENTS = frozenset(
    {
        INTENT_AVAILABILITY,
        INTENT_MEETING_ROOMS,
        INTENT_ROOM_CAPACITY,
        INTENT_BRANCH_PROPERTY,
        INTENT_PRICING,
        INTENT_GUEST_LEAD,
    }
)


def is_operational_truth_intent(intent: str) -> bool:
    return intent in OPERATIONAL_TRUTH_INTENTS


NO_VERIFIED_LIVE_DATA_HE = (
    "אין לי כרגע נתונים מאומתים מהמערכת החיה עבור הבקשה הזו. "
    "לא בדקתי לוח שנה או מלאי בזמן אמת — אפשר לבדוק מול מערכת ההזמנות או הצוות."
)

NO_VERIFIED_LIVE_DATA_EN = (
    "I don't have verified live data from the system for this request. "
    "No calendar or inventory was checked in real time — please check directly with the booking system or staff."
)

NO_VERIFIED_PRICING_HE = (
    "אין לי מחירון מאומת מהמערכת עבור הבקשה הזו. "
    "אפשר לבדוק ידנית או לעדכן מחירים בניהול הנכס."
)

# When tools/intent pipeline throws — user-facing only (details go to server logs).
TRUTH_GRACEFUL_FALLBACK_HE = (
    "אין לי כרגע תשובה מאומתת מהמערכת על זה, אבל אני יכולה לעזור לך לבדוק לפי עיר, סוג נכס או קיבולת."
)

# Policy lines injected into every truth-layer grounded prompt
TRUTH_POLICY_NO_FAKE_LIVE = (
    "CALENDAR TOOL POLICY: "
    "If VERIFIED_TOOL_OUTPUT contains a LIVE_CALENDAR block, the tool fetch_calendar_availability "
    "was already executed — you MUST cite that data and MUST NOT say 'I haven't checked', "
    "'לא בדקתי', or 'אין לי גישה'. "
    "If NO LIVE_CALENDAR block is present, do not claim you performed a live calendar check or "
    "confirmed real-time availability."
)
TRUTH_POLICY_SINGLE_COUNT_SOURCE = (
    "Use STATS_JSON.total_tasks as the single source for open-task counts throughout this response. "
    "Do not report a different count elsewhere in the same message."
)


def classify_maya_intent(text: str) -> Tuple[str, float]:
    """
    Lightweight rule-based intent for grounding policy (not a second LLM).
    Returns (intent, confidence in 0..1).
    """
    raw = (text or "").strip()
    if not raw:
        return INTENT_UNSUPPORTED, 0.0
    low = raw.lower()
    he = raw

    # Small talk & identity first — avoids mis-labeling greetings as availability/meeting queries.
    _ops_substrings = (
        "\u05d7\u05d3\u05e8",
        "\u05d7\u05d3\u05e8\u05d9\u05dd",
        "\u05e0\u05db\u05e1",
        "\u05de\u05e9\u05e8\u05d3",
        "\u05e4\u05e0\u05d5\u05d9",
        "\u05d6\u05de\u05d9\u05df",
        "\u05de\u05d7\u05d9\u05e8",
        "\u05d9\u05e9\u05d9\u05d1\u05d5\u05ea",
        "room",
        "rooms",
        "office",
        "booking",
        "meeting",
        "price",
        "available",
    )
    if len(raw) <= 120 and not any(s in he or s in low for s in _ops_substrings):
        _chat = (
            "\u05d4\u05d9\u05d9",
            "\u05d4\u05d9 ",
            "\u05e9\u05dc\u05d5\u05dd",
            "\u05de\u05d4 \u05e0\u05e9\u05de\u05e2",
            "\u05de\u05d4 \u05e9\u05dc\u05d5\u05de\u05da",
            "\u05de\u05d4 \u05e7\u05d5\u05e8\u05d4",
            "\u05de\u05d4 \u05d4\u05e2\u05e0\u05d9\u05d9\u05e0\u05d9\u05dd",
            "\u05de\u05d9 \u05d0\u05ea",
            "\u05de\u05d9 \u05d6\u05d0\u05ea",
            "\u05de\u05d9 \u05d0\u05ea\u05d4",
            "\u05d0\u05d9\u05da \u05e7\u05d5\u05e8\u05d0\u05d9\u05dd",
            "\u05d1\u05d5\u05e7\u05e8 \u05d8\u05d5\u05d1",
            "\u05e2\u05e8\u05d1 \u05d8\u05d5\u05d1",
            "\u05dc\u05d9\u05dc\u05d4 \u05d8\u05d5\u05d1",
            "\u05ea\u05d5\u05d3\u05d4",
            "\u05ea\u05d5\u05d3\u05d4 \u05e8\u05d1\u05d4",
            "\u05e1\u05d1\u05d1\u05d4",
            "hello",
            "hi ",
            "hey ",
            "thanks",
            "thank you",
            "what's up",
            "whats up",
        )
        if any(c in he or c.strip() in low for c in _chat if c):
            return INTENT_GENERAL, 0.82
        if len(raw) <= 36 and any(low.startswith(x) for x in ("hey", "hi", "hello", "yo ", "sup")):
            return INTENT_GENERAL, 0.78

    # Task-like dispatch (often handled earlier in app.py)
    task_kw = (
        "\u05ea\u05e7\u05df",
        "\u05ea\u05ea\u05e7\u05df",
        "\u05e0\u05d6\u05d9\u05dc\u05d4",
        "\u05d3\u05dc\u05d9\u05e4\u05d4",
        "\u05ea\u05e7\u05dc\u05d4",
        "\u05e0\u05d9\u05e7\u05d9\u05d5\u05df",
        "\u05de\u05e9\u05d9\u05de\u05d4",
        "\u05d7\u05d3\u05e8 1",
        "\u05d7\u05d3\u05e8 2",
        "fix",
        "repair",
        "clean",
        "send cleaner",
        "open a task",
        "add task",
    )
    if any(k in he or k in low for k in task_kw):
        return INTENT_OPERATIONAL_TASK, 0.75

    # Availability / booking (needs real calendar — usually ungrounded)
    avail_kw = (
        "\u05e4\u05e0\u05d5\u05d9",
        "\u05d6\u05de\u05d9\u05df",
        "availability",
        "available",
        "\u05d4\u05d6\u05de\u05e0\u05d4",
        "booking",
        "reserve",
        "\u05e1\u05d5\u05e4\u05e9",
        "\u05dc\u05d9\u05dc\u05d4",
        "\u05dc\u05e9\u05d1\u05ea",
        "\u05de\u05d7\u05e8",
        "\u05de\u05d7\u05e8\u05ea\u05d9\u05d9\u05dd",
        "\u05ea\u05d0\u05e8\u05d9\u05da",
        "\u05d1\u05ea\u05d0\u05e8\u05d9\u05da",
        "check-in",
        "checkout",
        "\u05e6'\u05e7 \u05d0\u05d9\u05df",
        "\u05e6\u05e7 \u05d0\u05d9\u05df",
    )
    time_kw = (
        r"\d{1,2}:\d{2}",
        r"\b10\b",
        r"\b11\b",
        "\u05d1\u05d5\u05e7\u05e8",
        "\u05e6\u05d4\u05e8\u05d9\u05d9\u05dd",
        "\u05e2\u05e8\u05d1",
        "\u05e8\u05d0\u05e9\u05d5\u05df",
        "\u05e9\u05e0\u05d9",
        "\u05e9\u05dc\u05d9\u05e9\u05d9",
        "\u05e8\u05d1\u05d9\u05e2\u05d9",
        "\u05d7\u05de\u05d9\u05e9\u05d9",
        "\u05e9\u05d9\u05e9\u05d9",
        "\u05e9\u05d1\u05ea",
        "sunday",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
    )
    has_avail_kw = any(k in low or k in he for k in avail_kw)
    has_time = False
    for p in time_kw:
        try:
            if re.search(p, low) or re.search(p, he):
                has_time = True
                break
        except re.error:
            if p in low or p in he:
                has_time = True
                break
    booking_context = any(
        w in he or w in low
        for w in (
            "\u05d7\u05d3\u05e8",
            "\u05d7\u05d3\u05e8\u05d9\u05dd",
            "room",
            "rooms",
            "\u05dc\u05d4\u05d6\u05de\u05d9\u05df",
            "\u05dc\u05d4\u05e9\u05db\u05d9\u05e8",
            "\u05de\u05dc\u05d5\u05df",
            "hotel",
            "\u05e1\u05e0\u05d9\u05e3",
            "\u05e0\u05db\u05e1",
        )
    )
    if has_avail_kw:
        return INTENT_AVAILABILITY, 0.85
    if has_time and booking_context:
        return INTENT_AVAILABILITY, 0.55

    meeting_kw = (
        "\u05d7\u05d3\u05e8 \u05d9\u05e9\u05d9\u05d1\u05d5\u05ea",
        "\u05d7\u05d3\u05e8\u05d9 \u05d9\u05e9\u05d9\u05d1\u05d5\u05ea",
        "meeting room",
        "conference room",
        "\u05e7\u05d5\u05e0\u05e4\u05e8\u05e0\u05e1",
    )
    if any(k in low or k in he for k in meeting_kw):
        return INTENT_MEETING_ROOMS, 0.8

    cap_kw = (
        "\u05db\u05de\u05d4 \u05d0\u05e0\u05e9\u05d9\u05dd",
        "\u05e2\u05d3 \u05db\u05de\u05d4",
        "capacity",
        "\u05de\u05ea\u05d0\u05d9\u05dd \u05dc",
        "\u05d0\u05e0\u05e9\u05d9\u05dd \u05d1\u05d7\u05d3\u05e8",
        "\u05db\u05de\u05d4 \u05de\u05e7\u05d5\u05de\u05d5\u05ea",
    )
    if any(k in low or k in he for k in cap_kw):
        return INTENT_ROOM_CAPACITY, 0.72

    branch_kw = (
        "\u05d0\u05d9\u05d6\u05d4 \u05e1\u05e0\u05d9\u05e3",
        "\u05d1\u05d0\u05d9\u05d6\u05d4 \u05e0\u05db\u05e1",
        "which branch",
        "which property",
        "\u05d0\u05d9\u05e4\u05d4 \u05d9\u05e9 \u05dc\u05db\u05dd",
        "\u05e1\u05e0\u05d9\u05e3 \u05d1",
        "\u05e0\u05db\u05e1 \u05d1",
        "\u05de\u05e9\u05e8\u05d3\u05d9\u05dd",
        "\u05de\u05e9\u05e8\u05d3 ",
        "offices",
        "office ",
    )
    if any(k in low or k in he for k in branch_kw):
        return INTENT_BRANCH_PROPERTY, 0.7

    price_kw = (
        "\u05de\u05d7\u05d9\u05e8",
        "\u05de\u05d7\u05d9\u05e8\u05d5\u05df",
        "\u05db\u05de\u05d4 \u05e2\u05d5\u05dc\u05d4",
        "\u05db\u05de\u05d4 \u05d6\u05d4 \u05e2\u05d5\u05dc\u05d4",
        "pricing",
        "rate",
        "tariff",
        "\u05e2\u05dc\u05d5\u05ea \u05dc\u05dc\u05d9\u05dc\u05d4",
    )
    if any(k in low or k in he for k in price_kw):
        return INTENT_PRICING, 0.78

    lead_kw = (
        "\u05dc\u05d9\u05d3",
        "lead",
        "\u05e4\u05e0\u05d9\u05d9\u05d4",
        "\u05de\u05d9\u05dc\u05d5\u05d9 \u05d8\u05d5\u05e4\u05e1",
        "guest email",
        "\u05d0\u05d5\u05e8\u05d7 \u05d7\u05d3\u05e9",
    )
    if any(k in low or k in he for k in lead_kw):
        return INTENT_GUEST_LEAD, 0.65

    gen_kw = (
        "\u05d4\u05d9\u05d9",
        "\u05e9\u05dc\u05d5\u05dd",
        "\u05ea\u05d5\u05d3\u05d4",
        "\u05de\u05d0\u05d9\u05d4",
        "\u05d1\u05d5\u05e7\u05e8 \u05d8\u05d5\u05d1",
        "\u05e2\u05e8\u05d1 \u05d8\u05d5\u05d1",
        "hello",
        "hi ",
        "thanks",
    )
    if any(low.startswith(k) or f" {k}" in low for k in ("hi", "hey", "hello")):
        return INTENT_GENERAL, 0.6
    if any(k in he or k in low for k in gen_kw) and len(raw) < 80:
        return INTENT_GENERAL, 0.55

    return INTENT_UNSUPPORTED, 0.35


def merge_truth_fields(
    payload: Dict[str, Any],
    *,
    intent: str,
    intent_confidence: float,
    tool_calls: List[Dict[str, Any]],
    grounded: bool,
    source_name: Optional[str],
    source_details: Optional[str],
    action_taken: str,
    confidence: float,
) -> Dict[str, Any]:
    """Attach truth metadata without breaking existing clients (extra keys)."""
    out = dict(payload)
    out["truthIntent"] = intent
    out["intent"] = intent
    out["truthIntentConfidence"] = round(float(intent_confidence), 3)
    out["truthToolCalls"] = tool_calls
    out["grounded"] = bool(grounded)
    out["truthSourceName"] = source_name
    out["truthSourceDetails"] = (source_details or "")[:2000]
    out["truthActionTaken"] = action_taken
    out["truthConfidence"] = round(float(confidence), 3)
    _msg = (out.get("displayMessage") or out.get("message") or out.get("response") or "") or ""
    out["answer_text"] = str(_msg) if _msg is not None else ""
    if out.get("brainErrorCode"):
        out["error_code"] = out.get("brainErrorCode")
    return out


def format_audit_log(
    *,
    tenant_id: str,
    user_message: str,
    intent: str,
    tool_calls: List[Dict[str, Any]],
    grounded: bool,
    fallback_reason: Optional[str],
) -> str:
    names = [t.get("name") for t in tool_calls if t.get("name")]
    return (
        f"[Maya truth] tenant={tenant_id!r} intent={intent} tools={names} "
        f"grounded={grounded} fallback={fallback_reason!r} msg={user_message[:200]!r}"
    )
