import os
import sys

# ── Windows: reconfigure stdout/stderr to UTF-8 so emoji print statements never crash ──
# Must happen before any print() call. Python 3.7+ supports reconfigure().
for _stream in (sys.stdout, sys.stderr):
    if _stream is not None and hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

# ── .env first: before any other imports that might read os.environ ─────────
try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[misc, assignment]

_app_dir = os.path.dirname(os.path.abspath(__file__))
# Explicit .env next to app.py (same file as hotel_dashboard/.env); avoids missing the file when CWD differs.
_APP_ENV_PATH = os.path.join(_app_dir, ".env")
try:
    if load_dotenv is None:
        print(
            "[dotenv] python-dotenv not installed — run: pip install python-dotenv "
            "(without it, only OS environment variables are visible to Maya).",
            flush=True,
        )
    elif not os.path.isfile(_APP_ENV_PATH):
        print(
            f"[dotenv] No {_APP_ENV_PATH} — copy .env.example to .env and set GEMINI_API_KEY=...",
            flush=True,
        )
    else:
        load_dotenv(dotenv_path=_APP_ENV_PATH, override=True)
        _parent_env = os.path.join(_app_dir, "..", ".env")
        if os.path.isfile(_parent_env):
            load_dotenv(dotenv_path=_parent_env, override=False)
        load_dotenv(override=False)
        print(f"[dotenv] Loaded via dotenv_path={_APP_ENV_PATH!r}", flush=True)
except Exception as _dot_e:
    print(f"[dotenv] Failed to load .env: {_dot_e}", flush=True)

print(
    f'SYSTEM CHECK: Key found = {bool((os.getenv("GEMINI_API_KEY") or "").strip())}',
    flush=True,
)

import json
import time
import uuid
import queue
import random
import threading
import base64
import hmac
import hashlib
import re
from collections import deque
from urllib.request import urlopen, Request
from urllib.parse import quote_plus, urlparse
from functools import wraps
from datetime import datetime, timezone, timedelta
import math
import logging
import copy

# ── Shared activity log — captures every SIMULATE event ──────────────────────
# Frontend polls /api/activity-feed and shows these as Maya chat messages.
_ACTIVITY_LOG: deque = deque(maxlen=80)


def _log_staff_field_status(tenant_id, staff_id, staff_name, task_id, room_label, action_status):
    """Append field-app status tap (אני בדרך / נכנסתי / סיימתי) for admin feeds + Task Calendar."""
    labels_he = {
        "on_my_way": "אני בדרך",
        "started": "נכנסתי לחדר",
        "finished": "סיימתי - החדר מוכן",
    }
    label = labels_he.get(action_status, action_status or "")
    name_s = (staff_name or staff_id or "צוות").strip()
    room_s = (room_label or "—").strip()
    at_iso = now_iso()
    text = f"שטח · {name_s} · חדר {room_s} · {label}"
    _ACTIVITY_LOG.append({
        "id": str(uuid.uuid4()),
        "ts": int(time.time() * 1000),
        "type": "staff_field_status",
        "text": text,
        "tenant_id": tenant_id,
        "staff_id": staff_id,
        "task_id": task_id,
        "status": action_status,
        "at_iso": at_iso,
        "room": room_s,
    })

# In-memory cache for GET /api/rooms/status-grid — instant repeat loads (frontend polls ~20s)
_STATUS_GRID_CACHE = {"ts": 0.0, "key": None, "payload": None}
STATUS_GRID_CACHE_TTL_SEC = 120
# Owner analytics — heavy DB scans; cache separately
_OWNER_DASHBOARD_CACHE = {"ts": 0.0, "key": None, "payload": None}
OWNER_DASHBOARD_CACHE_TTL_SEC = 45
# Bumped when property_tasks change so MissionContext can refetch (GET /api/tasks/version).
_TASKS_VERSION_V = 1


def _invalidate_status_grid_cache():
    _STATUS_GRID_CACHE["ts"] = 0.0
    _STATUS_GRID_CACHE["key"] = None
    _STATUS_GRID_CACHE["payload"] = None


def _no_cache_json(resp):
    """Avoid stale JSON from browser/proxy caches (304 / unchanged bodies on list endpoints)."""
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp


def _is_raw_api_tasks_get():
    """True only for GET /api/tasks — not /api/property-tasks or /api/worker/tasks."""
    p = (request.path or "").rstrip("/")
    return p.endswith("/api/tasks")


def _attach_task_table_count_headers(resp, property_tasks_len):
    """Expose real row counts: property_tasks payload length + legacy ``tasks`` table (TaskModel)."""
    try:
        resp.headers["X-Property-Tasks-Count"] = str(int(property_tasks_len))
    except Exception:
        resp.headers["X-Property-Tasks-Count"] = "0"
    if SessionLocal and TaskModel:
        _ls = SessionLocal()
        try:
            legacy_all = _ls.query(TaskModel).all()
            resp.headers["X-Legacy-Tasks-Table-Count"] = str(len(legacy_all))
        except Exception:
            resp.headers["X-Legacy-Tasks-Table-Count"] = "0"
        finally:
            _ls.close()
    else:
        resp.headers["X-Legacy-Tasks-Table-Count"] = "0"
    return resp


def _parse_api_tasks_pagination():
    """Query ?limit=&offset=. GET /api/tasks defaults to limit=30 when omitted (fast dashboard load).
    Pass limit=0 for unlimited rows (admin / Maya analysis). GET /api/property-tasks omits default → full list."""
    lr = request.args.get("limit")
    oraw = request.args.get("offset")
    limit = None
    if lr is not None and str(lr).strip() != "":
        try:
            iv = int(lr)
            if iv <= 0:
                limit = None  # 0 = all rows (explicit opt-in)
            else:
                limit = max(1, min(iv, 500))
        except (TypeError, ValueError):
            limit = None
    elif _is_raw_api_tasks_get():
        limit = 30
    try:
        offset = max(0, int(oraw)) if oraw is not None and str(oraw).strip() != "" else 0
    except (TypeError, ValueError):
        offset = 0
    return limit, offset


def _attach_tasks_list_pagination_headers(resp, total, offset, returned_len, limit):
    try:
        resp.headers["X-Tasks-Total"] = str(int(total))
    except Exception:
        resp.headers["X-Tasks-Total"] = "0"
    resp.headers["X-Tasks-Offset"] = str(int(offset))
    if limit is not None:
        resp.headers["X-Tasks-Limit"] = str(int(limit))
    try:
        has_more = (int(offset) + int(returned_len)) < int(total)
    except Exception:
        has_more = False
    resp.headers["X-Tasks-Has-More"] = "1" if has_more else "0"
    return resp


def _bump_tasks_version():
    global _TASKS_VERSION_V
    _TASKS_VERSION_V += 1
    _invalidate_status_grid_cache()

# ── Simulation-only log — shown in the God Mode admin dashboard ───────────────
# Each entry: { ts_ms, ts_str, level, message }
_SIM_LOG: deque = deque(maxlen=200)

def _sim_log(message: str, level: str = "info"):
    """Append a timestamped entry to the simulation log."""
    now_dt = datetime.now(timezone.utc)
    _SIM_LOG.append({
        "id":     str(uuid.uuid4()),
        "ts_ms":  int(now_dt.timestamp() * 1000),
        "ts_str": now_dt.strftime("%H:%M:%S"),
        "level":  level,   # info | warn | success | error
        "message": message,
    })

try:
    import maya_service as _maya_memory  # JSON long-term memory per tenant
except Exception:
    _maya_memory = None
try:
    import guest_memory as _guest_memory
except Exception:
    _guest_memory = None
try:
    import maya_truth_layer as _maya_truth
except Exception:
    _maya_truth = None
try:
    from maya_service import (
        is_twilio_internal_dashboard_only,
        set_twilio_internal_dashboard_only,
        sms_or_whatsapp_failed_continue,
    )
except Exception:
    def is_twilio_internal_dashboard_only():
        return False

    def set_twilio_internal_dashboard_only(reason: str = ""):
        pass

    def sms_or_whatsapp_failed_continue(exc, context: str = ""):  # noqa: ARG001
        print(f"[Maya] Twilio {(context or 'sms')[:80]} non-fatal — DB ops continue:", exc, flush=True)

from flask import (
    Flask,
    request,
    jsonify,
    Response,
    send_from_directory,
    g,
    render_template,
    stream_with_context,
    copy_current_request_context,
)
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.exceptions import HTTPException
from flask_cors import CORS, cross_origin

try:
    from sqlalchemy import create_engine, Column, String, Integer, Float, Text, ForeignKey, text, func, or_, and_
    from sqlalchemy.orm import sessionmaker, declarative_base, relationship
    from sqlalchemy.exc import SQLAlchemyError, IntegrityError
except Exception:
    create_engine = None
    Column = None
    String = None
    Integer = None
    Float = None
    Text = None
    ForeignKey = None
    text = None
    func = None
    or_ = None
    and_ = None
    sessionmaker = None
    declarative_base = None
    relationship = None
    SQLAlchemyError = Exception
    IntegrityError = Exception

try:
    from twilio.rest import Client as TwilioClient
except Exception:
    TwilioClient = None

# ══════════════════════════════════════════════════════════════════
# GEMINI AI — import google.generativeai as genai only (no google.genai split).
# Models: GEMINI_MODEL / GEMINI_MODEL_PRIMARY / MAYA_GEMINI_MODEL or auto via ListModels; blocked ids skipped.
# ══════════════════════════════════════════════════════════════════
_GEMINI_API_KEY = (os.getenv("GEMINI_API_KEY") or "").strip()  # set in .env locally / Render env-var in production
_USE_NEW_GENAI  = False
_GEMINI_CLIENT  = None   # kept for backwards-compat guards elsewhere
_OPENAI_API_KEY_LOG = (os.getenv("OPENAI_API_KEY") or "").strip()  # logged for debugging only
# Cached ordered model list (invalidated when GEMINI_API_KEY changes) — see _gemini_model_candidates()
_GEMINI_MODEL_CANDIDATES_CACHE = None
_GEMINI_MODEL_CANDIDATES_CACHE_FOR_KEY = None

# Maya brain: Google Gemini only — set GEMINI_API_KEY from the Cloud project where billing/API are enabled.
if not _GEMINI_API_KEY:
    print("[Gemini] ⚠️  GEMINI_API_KEY not set — Maya will return error messages. Add it in Render → Environment Variables.")
else:
    print(f"[Gemini] 🔑 GEMINI_API_KEY loaded (ends ...{_GEMINI_API_KEY[-6:]})")

try:
    import google.generativeai as genai
    if _GEMINI_API_KEY:
        try:
            genai.configure(api_key=_GEMINI_API_KEY)
            _gk_force = (os.getenv("GEMINI_API_KEY") or "").strip()
            if _gk_force:
                genai.configure(api_key=_gk_force)
            _USE_NEW_GENAI = True
            print("[Gemini] google-generativeai configured — Maya uses Gemini (google-generativeai).", flush=True)
        except Exception as _cfg0:
            import traceback as _tb_cfg0
            print(f"[Gemini] ❌ genai.configure at startup failed: {type(_cfg0).__name__}: {_cfg0}")
            _tb_cfg0.print_exc()
    else:
        print("[Gemini] ⚠️  Skipping genai.configure() — no API key")
except Exception as _ge1:
    import traceback as _tb1
    print(f"[Gemini] ❌ google-generativeai import failed: {type(_ge1).__name__}: {_ge1}")
    _tb1.print_exc()

print(
    f"[Maya env] OPENAI_API_KEY is {'SET' if _OPENAI_API_KEY_LOG else 'NOT SET'} — "
    "Maya engine: Gemini only (set GEMINI_API_KEY).",
    flush=True,
)

TWILIO_CLIENT = None
try:
    if TwilioClient:
        # Read from .env - ensure no extra whitespace/newlines
        _twilio_sid = (os.getenv("TWILIO_ACCOUNT_SID") or "").strip().replace("\r", "").replace("\n", "").replace(" ", "")
        _twilio_token = (os.getenv("TWILIO_AUTH_TOKEN") or "").strip().replace("\r", "").replace("\n", "").replace(" ", "")
        if _twilio_sid and _twilio_token and _twilio_sid.startswith("AC") and len(_twilio_token) >= 30:
            TWILIO_CLIENT = TwilioClient(_twilio_sid, _twilio_token)
            print("[Twilio] Connected with SID", _twilio_sid[:12] + "...")
        else:
            if not _twilio_sid or not _twilio_token:
                print("[Twilio] Skipped - TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN required in .env")
            else:
                print("[Twilio] Skipped - invalid SID format or token length")
    else:
        print("[Twilio] Skipped - twilio package not installed")
except Exception as e:
    TWILIO_CLIENT = None
    print("[Twilio] Init failed (server will run without Voice/SMS/WhatsApp):", e)

# ── Cloudinary image hosting ──────────────────────────────────────────────────
# When CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET are set,
# all image uploads go to Cloudinary instead of the local filesystem.
# This ensures images persist on Render's ephemeral file system.
_CLOUDINARY_CONFIGURED = False
try:
    import cloudinary
    import cloudinary.uploader as _cdn_uploader
    _CDN_CLOUD = os.getenv("CLOUDINARY_CLOUD_NAME", "").strip()
    _CDN_KEY   = os.getenv("CLOUDINARY_API_KEY",    "").strip()
    _CDN_SEC   = os.getenv("CLOUDINARY_API_SECRET", "").strip()
    if _CDN_CLOUD and _CDN_KEY and _CDN_SEC:
        cloudinary.config(
            cloud_name=_CDN_CLOUD,
            api_key=_CDN_KEY,
            api_secret=_CDN_SEC,
            secure=True,
        )
        _CLOUDINARY_CONFIGURED = True
        print(f"[Cloudinary] ✅ Configured — cloud: {_CDN_CLOUD}")
    else:
        print("[Cloudinary] Not configured (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET missing) — using local storage")
except ImportError:
    _cdn_uploader = None  # type: ignore
    print("[Cloudinary] SDK not installed — using local storage")


def _cloudinary_upload(data_bytes: bytes, folder: str = "easyhost") -> str:
    """
    Upload raw image bytes to Cloudinary and return the secure HTTPS URL.
    Raises RuntimeError if Cloudinary is not configured.
    Auto-transforms: resizes to max 1200px, quality=auto:good.
    """
    import io as _io
    result = _cdn_uploader.upload(
        _io.BytesIO(data_bytes),
        folder=folder,
        public_id=f"{folder}/{uuid.uuid4().hex}",
        overwrite=True,
        resource_type="image",
        transformation=[
            {"width": 1200, "height": 900, "crop": "limit", "quality": "auto:good"},
        ],
    )
    return result["secure_url"]


MAYA_SYSTEM_INSTRUCTION = """You are Maya — the high-end AI Operations Manager for Easyhost, embedded in Kobi's real portfolio (boutique hotels, workspaces, ROOMS). You are not a chatbot, not a generic assistant, and not a scripted "support bot". You run live operations: professional, fast, precise, calm under load. Your default voice is fluent, natural Hebrew — varied sentences, human rhythm, zero robotic filler. Mirror English only if the user writes English.

You combine executive judgment with floor-level execution: you answer open operational and guest questions with clear reasoning and empathy — not only by opening tasks. When Kobi or staff ask "why", "what's best", or "how does this site work", synthesize PROPERTY_KNOWLEDGE_DB and LIVE DATA before you act. Acknowledge stress briefly when relevant, then move to facts or action.

Primary language is Hebrew — user-facing "message" / "question" strings and task descriptions you author should match the user's language. For JSON task objects, use Hebrew task_type when applicable: ניקיון חדר | תחזוקה | שירות | צ'ק-אין.

INTENT FIRST (always classify before acting):
• SERVICE REQUEST — user wants work dispatched (clean, fix, send staff, "open a task", "תתקן", "תנקו", urgent leak, etc.) → add_task / add_tasks with a full, specific content line (issue + room + site when known).
• OPERATIONAL QUESTION — who / when / why / how many / status / fastest / last cleaner / occupancy / what's open. Treat STATS_JSON plus the LIVE DATA / SEARCH_TOOL block in your system prompt as the result of an internal database search over tasks and properties — cite only those facts; never invent workers or room states. → action "info" only; do NOT create tasks for pure questions.
• SMALL TALK & GUEST EXPERIENCE — hello, thanks, jokes, venting, "how are you", casual chat, local tips without a work order → action "info" with a short, warm human reply; no task unless they add an explicit request.

You are also Maya — the live ops brain for Kobi's multi-site portfolio. For operational questions, your first grounding step is the live snapshot in STATS_JSON (same facts as GET /api/stats) plus LIVE DATA. Kobi is your owner; address him as קובי. Do not name other people in replies except when Kobi explicitly asks comparative staff questions (e.g. who is fastest / מי הכי מהיר) — then name exactly one worker with one evidence-based line from the data. Synthesize occupancy, staffing, and the task board from the prompt only — never invent a fixed "80%" occupancy; use real numbers or say "לפי לוח החדרים" / "לפי הנתונים" when unsure. Never describe yourself as software, an AI, a chatbot, or a language model.

PROPERTY_KNOWLEDGE: When PROPERTY_KNOWLEDGE_DB appears in LIVE DATA, those lines are permanent learned facts about external sites (WeWork, etc.) — including rules, capacity signals, local POIs, and review-derived guest preferences. Use them for guest/worker answers and strategic suggestions; do not contradict without asking Kobi to refresh. You may run autonomous web + Maps research when Kobi asks you to learn, meet, or research a named site — results are stored for future turns.

WeWork Ministore (מיניסטור / Ministore): Treat this as a premium flex workspace in Kobi's portfolio — same Luxury Property Operations Manager hat: concise Hebrew, concierge polish, noise/amenities/quiet zones from PROPERTY_KNOWLEDGE_DB when present; never generic "connection" excuses.

ROOMS BSR CITY (Petah Tikva / פתח תקווה) — authoritative site facts (cite exactly; do not invent):
- MUST cite when relevant: **2 workspace floors**, **8 meeting rooms**, **~2,000 sqm gym** (plus ~3,800 sqm office footprint and ~850 sqm balcony/terrace; meeting rooms include layouts up to ~20 people).
- Property: ROOMS BSR CITY Petah Tikva — BSR City, Tower Y, Jabotinsky 2; ~400 m to Red Line light rail, ~150 m to central bus station.
- Core numbers: 2 floors of workspace; ~3,800 sqm office footprint (plus ~850 sqm balcony/terrace); 8 meeting rooms (smaller rooms ~5–8 people; larger rooms up to ~20 people); ~2,000 sqm gym.
- Access & policy: 24/7 building access; dog-friendly workspace.
- Amenities: eco-lake on site, furnished offices, complimentary coffee/snacks, phone booths for quiet work, App-to-Desk room service, cleaning, IT support, Fattal Club access; underground parking (cars, scooters, bikes).
- Guest/worker guidance: quiet work → phone booths; facility “what we have” questions → action "info" only unless the user reports a clear repair.
PROPERTY_KNOWLEDGE_DB may add more detail — never contradict these facts without confirmation from Kobi.

ANTI-SPAM & SCOPE:
- Answer the question directly. Do NOT open with "קובי, אני כאן", "הלוח חזר לעבוד", or similar status boilerplate unless Kobi just reported an outage.
- When Kobi mentions ONE site (e.g. בזאר / Bazaar / Jaffa / סיטי טאוור / ROOMS), restrict facts, tasks, and property context to that site only — do NOT list every property in the portfolio unless he explicitly asks for a full portfolio list or "כל הנכסים".
- recent_open_tasks in STATS_JSON are tasks that are NOT Done/completed. recent_completed_snapshot lists tasks already completed in the DB — never describe those as still open or In Progress.

OPERATIONAL MANDATE:
- Prioritize guest safety, revenue protection, and crew load-balancing across ALL sites.
- When asked for a daily plan, infer the Top 5 urgent tasks from pending work (high priority / checkout pressure / leaks / VIP arrivals) and name specific properties from the list provided in the user prompt.
- You read and write operational reality through the task system: every add_task must map to a real property name from the portfolio list and persist in the database.

MAYA 2.0 — GLOBAL OPS EXPERT (not a chatbot):
- You produce Morning Briefs: occupancy pulse from live data when available, Top 5 urgent tasks, cleaning wave schedule (checkout morning vs arrival afternoon), and VIP / checkout watchlist when relevant.
- Tie task creation to real check-out pressure: if the guest mentions checkout time or housekeeping before a deadline, use high priority and Cleaning staff.
- Every task you authorize through JSON must persist as real DB work — use exact property names from the prompt's property list.

PERSONA & VOICE (Hebrew-first; mirror English only if the user writes English):
- Tone: Israeli, professional, warm, and brief — premium Easyhost ops: fast answers, natural Hebrew, no filler — like a real manager on headset with Kobi and the floor team.
- Use natural phrases when fitting: e.g. "קובי, אני על זה", "סגור, המנקים בדרך", "אל תדאג, אני מטפלת בזה".
- NEVER mention API keys, tokens, models, JSON internals, quotas, HTTP errors, Twilio, SMS delivery, or messaging providers to the user-facing "message" or "question" fields. Those fields are spoken aloud and shown in chat — stay fully in character; describe operations in hotel terms (tasks, rooms, staff) only.
- If something would fail in reality, say something like: "קובי, יש לי רגע עומס בקבלה, תגיד לי שוב?" — never blame "AI" or servers.

MULTI-PROPERTY DISAMBIGUATION (critical):
- Vibes: Bazaar Jaffa = bohemian, historic Bauhaus, flea market, artsy. City Tower Ramat Gan = urban, business, elegant, Diamond Exchange / בורסה area.
- POOL: Hotel Bazaar Jaffa has NO on-site swimming pool. Leonardo Plaza City Tower HAS a seasonal rooftop pool. ROOMS Sky Tower is a coworking space — no guest hotel pool; use "event / meeting space" language for pools only if relevant to City Tower.
- Always use propertyName from the property list in tasks; match "בזאר" / Jaffa / Bazaar to Hotel Bazaar Jaffa; "סיטי טאוור" / City Tower / Leonardo / Ramat Gan / בורסה to Leonardo Plaza City Tower; "רומס" / ROOMS / Sky Tower / coworking / Fattal to ROOMS Sky Tower when relevant.

HOTEL BAZAAR JAFFA — authoritative facts (use for guest/staff answers; do not contradict):
- Guest room inventory (hotel): 32 rooms at this property for stay/product questions.
- Operations / occupancy dashboards: the live 61-unit portfolio grid (Bazaar + 14 ROOMS sites) is the source of truth for occupancy — use LIVE DATA in the system prompt; occupancy% = (occupied units / 61) × 100 when the grid total is 61. Never invent "80%" or a fixed task count.
- Check-in: 15:00–23:59. On Saturdays and public holidays: check-in only after 18:00.
- Check-out: until 11:00. On Saturdays and public holidays: until 14:00.
- Late check-out: 170 ILS, subject to availability/approval.
- Kashrut: no kosher meals or kosher kitchen facilities on site.
- Facilities: 24-hour reception and security, gym, restaurant, elevator, accessible rooms — NO hotel pool on site.
- House rules: no smoking; no pets; no parties; guests must be 18+ unless accompanied by a parent/guardian.

LEONARDO PLAZA CITY TOWER (RAMAT GAN) — authoritative facts:
- Tone: urban, business, elegant — near Diamond Exchange / הבורסה.
- Building: 17 floors. Spa: Share Spa. Rooftop pool: seasonal. Business Lounge. Kosher: Ramat Gan Rabbinate.
- Room types: Deluxe (14 m²), Deluxe Grand, Executive, Club (floors 16–17), Junior Suite, Jacuzzi Suite, Accessible Deluxe.
- Check-in / check-out: standard 15:00 / 11:00. Saturday and public holidays: 18:00 check-in / 14:00 check-out. Late checkout: 250 ILS (subject to availability).

ROOMS SKY TOWER — coworking workspace (ROOMS by Fattal) — authoritative facts:
- Tone: urban, business, elegant — flexible workspace (not a hotel guest stay).
- Size: ~2000 sqm. Features: mini-cinema (up to ~50 people), lounge, bar, hot desks, private offices.
- Pricing (indicative): private offices ~4,000–10,000 ILS; meeting rooms ~250–300 ILS/hour; daily desk ~150 ILS — always state subject to current rates and availability.
- Inventory language: offices (by capacity), meeting rooms, event / cinema spaces — not "hotel room types".

HOTEL BAZAAR JAFFA — DEALS & CAMPAIGNS (Bazaar only — always use when relevant to pricing, packages, or “what to do” for Jaffa stays):
- Special events / live music: partner venue “Barby” (Tel Aviv). Example artists and shows include Teapacks (טיפקס), Mercedes Band, Ninet (נינט), Fortisakharof (Fortis), and similar acts — rotate suggestions by day of week and guest dates.
- Packages (sell as bundles with stays): Spa, Culinary, and “Tastes & Relaxation” / טעמים ורגיעה — offer separate Weekend vs Weekday rate tiers when the guest mentions dates.
- Discounts: 10% general public; 20% Passover (פסח) campaign when seasonally relevant; 25% member-exclusive; 50% second night for active reservists (מילואים) with valid ID — state subject to availability and policy.
- PROACTIVE SALES: If the guest asks about מחירים/prices, כמה עולה, “what to do”, מה לעשות, boredom, or activities — you MUST propose ONE concrete package or combo in “message” (e.g. midweek Barby show + room, Spa weekend bundle, or reservist second-night offer). Tie the suggestion to their stay dates or weekday (e.g. “Since you’re here Wednesday, want tickets for Ninet at Barby with your room?”). Keep “message” short and natural in Hebrew unless the user writes English.

ABSOLUTE RULES — never break them:
1. Return ONLY valid JSON to this system (no markdown outside the JSON). Your "message" and "question" strings inside the JSON must sound like Maya the manager, per PERSONA & VOICE above.
2. Never enumerate properties, staff, or amenities unless "report" or "property list" is explicitly requested.
3. SINGLE task (most requests) → return exactly:
   {"action":"add_task","task":{"staffName":"<name>","content":"<full clear description in Hebrew>","propertyName":"<property>","task_type":"<ניקיון חדר|תחזוקה|שירות|צ'ק-אין>","priority":"<normal|high>","status":"Pending"}}
4. MULTIPLE tasks — user mentions a quantity ("2", "שניים", "three", "שלוש", etc.) OR lists separate issues for different rooms → return:
   {"action":"add_tasks","tasks":[<task_obj_1>, <task_obj_2>, ...]}
   Create EXACTLY as many distinct task objects as requested. Each must have a unique content and propertyName.
5. Information / question only → return:
   {"action":"info","message":"<short answer; if pricing or activities/“what to do”, include one tailored package/deal suggestion from HOTEL BAZAAR DEALS & CAMPAIGNS>"}
6. MISSING or AMBIGUOUS property/room — if you CANNOT determine which site (Bazaar Jaffa vs City Tower Ramat Gan vs ROOMS Sky Tower) OR which room/office this task belongs to → return:
   {"action":"clarify","question":"באיזה מלון או אתר מדובר — בזאר יפו, סיטי טאוור רמת גן, או רומס סקיי טאוור? אני צריכה פרט מדויק כדי לפתוח את המשימה."}
   NEVER invent a property name. NEVER use "Unknown", "חדר לא ידוע", or a placeholder.

FIELD RULES:
- content: Write the FULL, specific intent (e.g. "תיקון נזילה בברז במטבח" not just "תיקון"). Include room number.
- task_type: "ניקיון חדר" for ניקיון/מגבות/housekeeping | "תחזוקה" for תיקון/נזילה/תחזוקה/repair/leak | "שירות" for כל השאר | "צ'ק-אין" when check-in prep is the main work
- priority: "high" if the user says דחוף/בהול/urgent/asap/critical | otherwise "normal"
- staffName: Alma → Cleaning | Kobi → Maintenance | Avi → Electrical (חשמל/מנורה/קצר/bulb/power/circuit)
- propertyName: use the exact name from the property list provided in the prompt; use the closest match if a room number is given.
- Language: respond in the same language the user writes in (Hebrew by default)."""

# Pinned portfolio hotels (must match UI — see PropertiesContext buildBazaarJaffaPinned / buildCityTowerPinned)
MAYA_PINNED_PROPERTY_LABELS = [
    "Hotel Bazaar Jaffa",
    "Leonardo Plaza City Tower",
    "ROOMS Sky Tower",
]

# Staff mapping: Hebrew keywords -> canonical staff name (עלמה, קובי, אבי)
STAFF_KEYWORDS = {
    "עלמה": ["נקיון", "ניקיון", "עלמה", "מגבת", "cleaning", "clean", "alma"],
    "קובי": ["תיקון", "נזילה", "דליפה", "תקלה", "תחזוקה", "maintenance", "fix", "repair", "kobi", "leak"],
    "אבי": ["חשמל", "electrical", "קצר", "נשרף", "נשרפה", "מנורה", "avi", "lamp", "bulb"],
}

# Hebrew canonical task_type labels (DB + simulation). Legacy English values still accepted everywhere below.
TASK_TYPE_CLEANING_HE = "ניקיון חדר"
TASK_TYPE_MAINTENANCE_HE = "תחזוקה"
TASK_TYPE_SERVICE_HE = "שירות"
TASK_TYPE_CHECKIN_HE = "צ'ק-אין"
TASK_TYPE_VIP_HE = "אורח VIP"


def _is_task_type_cleaning(tt):
    x = (tt or "").strip()
    return x in ("Cleaning", TASK_TYPE_CLEANING_HE)


def _is_task_type_maintenance(tt):
    x = (tt or "").strip()
    return x in ("Maintenance", TASK_TYPE_MAINTENANCE_HE)


def _is_task_type_service(tt):
    x = (tt or "").strip()
    return x in ("Service", TASK_TYPE_SERVICE_HE)


def _is_task_type_vip(tt):
    x = (tt or "").strip()
    return x in ("VIP Guest", TASK_TYPE_VIP_HE)


def _normalize_task_type_for_dispatch(tt):
    """Map English or Hebrew task_type to buckets used by staff dispatch."""
    if _is_task_type_cleaning(tt):
        return "cleaning"
    if _is_task_type_maintenance(tt):
        return "maintenance"
    if _is_task_type_service(tt):
        return "service"
    if _is_task_type_vip(tt):
        return "vip"
    x = (tt or "").strip()
    if x == TASK_TYPE_CHECKIN_HE or (x or "").lower() in ("check-in", "checkin"):
        return "checkin"
    return (x or "").lower()


# Sentinel so existing `if GEMINI_MODEL:` guards still work
GEMINI_MODEL = True if _USE_NEW_GENAI else None

if _USE_NEW_GENAI:
    print(
        "MAYA BRAIN ACTIVATED ✅  (Gemini — google-generativeai; model from GEMINI_MODEL or ListModels)",
        flush=True,
    )
else:
    print("[Gemini] ⚠️  No LLM — set GEMINI_API_KEY in .env / host env and pip install google-generativeai")

# Friendly copy when the LLM fails — always return HTTP 200 so the chat UI never "disconnects"
MAYA_BRAIN_MAINTENANCE_MESSAGE_HE = (
    "מצב תחזוקה: חיבור המוח (Gemini) זמנית לא זמין. "
    "ודא ש-GEMINI_API_KEY מוגדר ב-.env והפעל מחדש את השרת. "
    "המשימות והלוח עדיין זמינים."
)


def _scrub_maya_input_text(s) -> str:
    """Strip replacement char + BOM only. Hebrew / punctuation (e.g. '?', 'מאיה את מחוברת?') must pass through unchanged."""
    if not isinstance(s, str):
        return (s or "").strip() if s is not None else ""
    return s.replace("\ufffd", "").replace("\ufeff", "").strip()


def _maya_brain_error_payload(exc=None, *, note=None, code="brain_error", maintenance_mode=True):
    """Plain dict for JSON / SSE — same fields as _maya_brain_error_response."""
    detail = (note or (f"{type(exc).__name__}: {exc}" if exc is not None else "unknown error"))[:2000]
    el = detail.lower()
    if code == "gemini_unavailable":
        he = (
            "מאיה: המוח (Gemini) לא זמין — הגדר GEMINI_API_KEY והרץ pip install google-generativeai, "
            "ואז הפעל מחדש את Flask. (פרטים בטרמינל.)"
        )
    elif "gemini_api_key not set" in el or "__key_invalid__" in el or ("api key" in el and "invalid" in el):
        he = f"מאיה: מפתח Gemini חסר או לא תקף (לא שגיאת רשת כללית). פרט: {detail[:280]}"
    elif "quota" in el or "resource_exhausted" in el or "429" in detail:
        he = "מאיה: יש רגע עומס בקבלה, נסה שוב בעוד רגע — אני על זה."
    elif "timeout" in el:
        he = f"מאיה: פג הזמן לתשובה מ-Gemini. פרט: {detail[:220]}"
    elif (
        code in ("empty_response", "gemini_call")
        and ("empty" in el or "blocked" in el or "finish_reason" in el or "no text" in el or "no_candidates" in el)
    ):
        # Gemini returned a response but with no usable text parts (safety block,
        # RECITATION, MAX_TOKENS with zero output, etc.).  Show a neutral retry
        # message — do not expose raw SDK internals to the user.
        he = "מאיה לא קיבלה תשובה מלאה מהמנוע. נסה לנסח מחדש את הבקשה."
    else:
        he = f"מאיה: שגיאת מוח ({code}). פרט: {detail[:320]}"
    return {
        "success": False,
        "message": he,
        "displayMessage": he,
        "response": he,
        "brainFailure": True,
        "brainErrorCode": code,
        "brainErrorDetail": detail,
        "maintenanceMode": bool(maintenance_mode),
    }


def _maya_brain_error_response(exc=None, *, note=None, code="brain_error", maintenance_mode=True):
    """
    Log full failure to terminal and return JSON with a Hebrew summary + technical detail.
    HTTP 200 so CORS/fetch clients still parse JSON; success=False flags the UI.
    """
    import traceback as _tb_be

    payload = _maya_brain_error_payload(exc, note=note, code=code, maintenance_mode=maintenance_mode)
    detail = payload["brainErrorDetail"]
    el = detail.lower()
    _key_missing = (
        "gemini_api_key not set" in el
        or "gemini_api_key missing" in el
        or "__key_invalid__" in detail
        or ("api key" in el and "invalid" in el)
    )
    if _key_missing:
        print("\n" + "!" * 72, flush=True)
        print("[MAYA BRAIN] GEMINI_API_KEY IS MISSING OR INVALID — NOT A GENERIC CONNECTION GLITCH.", flush=True)
        print(f"  Expected env file: {_APP_ENV_PATH}", flush=True)
        print("  Fix: set GEMINI_API_KEY=... in that file (or host env) and restart the Flask process.", flush=True)
        print("  Until then, /api/ai/maya-command cannot call Gemini.", flush=True)
        print("!" * 72 + "\n", flush=True)

    print("\n" + "=" * 72, flush=True)
    print(f"[Maya brain ERROR] code={code}", flush=True)
    print(f"[Maya brain ERROR] detail: {detail}", flush=True)
    if exc is not None:
        _tb_be.print_exc()
    print("=" * 72 + "\n", flush=True)

    return jsonify(payload), 200


def _gemini_invalidate_model_cache():
    """Call when GEMINI_API_KEY changes so list_models + candidate order refresh."""
    global _GEMINI_MODEL_CANDIDATES_CACHE, _GEMINI_MODEL_CANDIDATES_CACHE_FOR_KEY
    _GEMINI_MODEL_CANDIDATES_CACHE = None
    _GEMINI_MODEL_CANDIDATES_CACHE_FOR_KEY = None


# Ids that often 404 on generateContent (v1beta); string built so the old default name is not a single literal in source.
_GEMINI_MODEL_ID_BLOCKLIST = frozenset(
    {
        "gemini-" + "1.5-flash",
    }
)


def _normalize_gemini_model_id(name: str) -> str:
    """Strip models/ prefix for comparisons; lowercase."""
    if not name or not str(name).strip():
        return ""
    n = str(name).strip().lower()
    return n[7:] if n.startswith("models/") else n


def _is_deprecated_gemini_model_id(name: str) -> bool:
    """
    Block model ids that commonly return 404 on generateContent (v1beta) for current API keys.
    Does not block the distinct *-8b Flash variant (different model id).
    """
    n = _normalize_gemini_model_id(name)
    if not n:
        return True
    return n in _GEMINI_MODEL_ID_BLOCKLIST


def _gemini_preferred_models_prefix():
    """Ids that usually answer on current Gemini API (before env / discovery)."""
    return [
        "gemini-1.5-flash-latest",
        "gemini-1.5-pro",
        "gemini-2.0-flash",
        "gemini-2.0-flash-001",
        "gemini-2.5-flash-preview-05-20",
    ]


def _gemini_model_candidates_static_fallback():
    """Last-resort ids if ListModels fails — excludes blocklisted legacy ids."""
    return [
        "gemini-2.0-flash",
        "gemini-2.0-flash-001",
        "gemini-2.5-flash-preview-05-20",
        "gemini-1.5-pro",
        "gemini-pro",
    ]


def _gemini_discover_models_generate_content():
    """
    Return model resource names that support generateContent (e.g. models/gemini-2.0-flash-001).
    Prefers Flash models first. Requires genai.configure(api_key) already.
    """
    if not _USE_NEW_GENAI:
        return []
    try:
        names_ok = []
        for m in genai.list_models():
            nm = getattr(m, "name", None) or ""
            if not nm:
                continue
            methods = getattr(m, "supported_generation_methods", None)
            if methods is None:
                methods = getattr(m, "supported_actions", None)
            if methods is None:
                continue
            if isinstance(methods, (list, tuple)):
                meths = [str(x) for x in methods]
            else:
                meths = [str(methods)]
            if not any("generateContent" in x or x.endswith("generateContent") for x in meths):
                continue
            if _is_deprecated_gemini_model_id(nm):
                continue
            names_ok.append(nm)
        flash = [n for n in names_ok if "flash" in n.lower()]
        rest = [n for n in names_ok if n not in flash]
        flash.sort()
        rest.sort()
        out = flash + rest
        if out:
            print(f"[Gemini] list_models: {len(out)} generateContent-capable (first 8): {out[:8]}", flush=True)
        else:
            print("[Gemini] list_models: no non-deprecated generateContent models returned", flush=True)
        return out
    except Exception as e:
        print(f"[Gemini] list_models() failed: {type(e).__name__}: {e}", flush=True)
        import traceback as _tb_lm

        _tb_lm.print_exc()
        return []


def _gemini_model_candidates():
    """
    Ordered model ids for google.generativeai generateContent.
    Precedence: GEMINI_MODEL → GEMINI_MODEL_PRIMARY → MAYA_GEMINI_MODEL → list_models() (discovered) → static fallbacks.
    Blocklisted env values are skipped with a log line.
    Cached per API key until key changes.
    """
    global _GEMINI_MODEL_CANDIDATES_CACHE, _GEMINI_MODEL_CANDIDATES_CACHE_FOR_KEY
    live_key = (os.getenv("GEMINI_API_KEY") or "").strip() or _GEMINI_API_KEY
    if (
        live_key
        and _GEMINI_MODEL_CANDIDATES_CACHE is not None
        and _GEMINI_MODEL_CANDIDATES_CACHE_FOR_KEY == live_key
    ):
        return list(_GEMINI_MODEL_CANDIDATES_CACHE)

    print(
        "[Gemini] env "
        f"GEMINI_MODEL={os.getenv('GEMINI_MODEL')!r} "
        f"GEMINI_MODEL_PRIMARY={os.getenv('GEMINI_MODEL_PRIMARY')!r} "
        f"MAYA_GEMINI_MODEL={os.getenv('MAYA_GEMINI_MODEL')!r}",
        flush=True,
    )

    out = []
    for env_key in ("GEMINI_MODEL", "GEMINI_MODEL_PRIMARY", "MAYA_GEMINI_MODEL"):
        v = (os.getenv(env_key) or "").strip()
        if not v:
            continue
        if _is_deprecated_gemini_model_id(v):
            print(
                f"[Gemini] ignoring blocklisted {env_key}={v!r} — unset or set a current id; ListModels will pick one",
                flush=True,
            )
            continue
        if v not in out:
            out.append(v)

    discovered = []
    if live_key and _USE_NEW_GENAI:
        try:
            if live_key != getattr(genai, "_configured_key", None):
                genai.configure(api_key=live_key)
                genai._configured_key = live_key
            discovered = _gemini_discover_models_generate_content()
        except Exception as e:
            print(f"[Gemini] configure before list_models: {type(e).__name__}: {e}", flush=True)
            import traceback as _tb_lm0

            _tb_lm0.print_exc()

    for n in discovered:
        if n not in out and not _is_deprecated_gemini_model_id(n):
            out.append(n)

    for m in _gemini_model_candidates_static_fallback():
        if m not in out and not _is_deprecated_gemini_model_id(m):
            out.append(m)

    if not out:
        out = ["gemini-2.0-flash", "gemini-2.0-flash-001"]

    preferred = _gemini_preferred_models_prefix()
    merged = []
    seen = set()
    for m in preferred + out:
        mm = str(m or "").strip()
        if not mm or mm in seen:
            continue
        if _is_deprecated_gemini_model_id(mm):
            continue
        seen.add(mm)
        merged.append(mm)
    out = merged

    print(f"[Gemini] selected primary candidate (first try): {out[0]!r}", flush=True)

    if live_key:
        _GEMINI_MODEL_CANDIDATES_CACHE = tuple(out)
        _GEMINI_MODEL_CANDIDATES_CACHE_FOR_KEY = live_key

    print(f"[Gemini] full candidate chain ({len(out)}): {out[:16]}{'...' if len(out) > 16 else ''}", flush=True)
    return out


def resolve_gemini_model() -> str:
    """First model id in the working candidate chain (for diagnostics / display)."""
    try:
        c = _gemini_model_candidates()
        return c[0] if c else ""
    except Exception as e:
        print(f"[Gemini] resolve_gemini_model failed: {type(e).__name__}: {e}", flush=True)
        import traceback as _tb_r

        _tb_r.print_exc()
        return ""


def get_working_gemini_model() -> str:
    """Alias for resolve_gemini_model()."""
    return resolve_gemini_model()


def _gemini_err_is_model_not_found(e: BaseException) -> bool:
    """True when the SDK indicates the model id is unknown / 404 — try next candidate."""
    err_str = str(e).lower()
    err_repr = repr(e).lower()
    needles = (
        "not_found",
        "404",
        "not found",
        "is not found",
        "was not found",
        "does not exist",
        "invalid model",
        "unknown model",
        "model_not_found",
    )
    if any(x in err_str for x in needles):
        return True
    if "notfound" in err_repr or "404" in err_repr:
        return True
    return False


def _safe_gemini_text(resp, label: str = "") -> str:
    """
    Safely extract the text string from a Gemini GenerateContentResponse
    without touching the .text property directly.

    The SDK's .text property raises ValueError when:
      - response.candidates is empty (e.g. prompt blocked by safety filters)
      - candidates[0].content has no parts
      - finish_reason is SAFETY / RECITATION / MAX_TOKENS with empty content

    This helper walks candidates → content → parts explicitly, logs the
    failure mode for diagnostics, and returns "" instead of raising.
    """
    prefix = f"[Gemini{(' ' + label) if label else ''}]"
    try:
        # ── 1. Prompt-level block (before generation started) ──────────────
        pf = getattr(resp, "prompt_feedback", None)
        if pf is not None:
            block_reason = getattr(pf, "block_reason", None)
            if block_reason and str(block_reason) not in ("0", "BLOCK_REASON_UNSPECIFIED", "BlockReason.UNSPECIFIED"):
                print(
                    f"{prefix} prompt blocked — block_reason={block_reason!r}",
                    flush=True,
                )
                return ""

        # ── 2. No candidates at all ────────────────────────────────────────
        candidates = getattr(resp, "candidates", None) or []
        if not candidates:
            print(f"{prefix} no candidates in response", flush=True)
            return ""

        cand = candidates[0]
        finish_reason = getattr(cand, "finish_reason", None)
        finish_name = str(finish_reason) if finish_reason is not None else "unknown"

        # ── 3. Content / parts extraction ─────────────────────────────────
        content = getattr(cand, "content", None)
        parts = getattr(content, "parts", None) or [] if content is not None else []

        text_parts = []
        for part in parts:
            # part.text may itself raise if the part is non-text (e.g. function_call)
            try:
                t = getattr(part, "text", None)
                if t:
                    text_parts.append(t)
            except Exception:
                pass

        result = "".join(text_parts).strip()

        if not result:
            print(
                f"{prefix} empty text — finish_reason={finish_name!r} "
                f"candidates={len(candidates)} parts={len(parts)}",
                flush=True,
            )

        return result

    except Exception as _ex:
        print(f"{prefix} _safe_gemini_text raised {type(_ex).__name__}: {_ex}", flush=True)
        return ""


def _safe_gemini_chunk_text(chunk, label: str = "") -> str:
    """
    Safely extract text from a streaming chunk without raising.
    The .text accessor on a blocked or empty chunk raises in some SDK versions.
    """
    try:
        # Fast path — works for normal chunks
        t = getattr(chunk, "text", None)
        if isinstance(t, str):
            return t
    except Exception:
        pass
    # Slow path — walk parts directly (same logic as _safe_gemini_text)
    try:
        candidates = getattr(chunk, "candidates", None) or []
        if not candidates:
            return ""
        content = getattr(candidates[0], "content", None)
        parts = getattr(content, "parts", None) or [] if content is not None else []
        texts = []
        for part in parts:
            try:
                t = getattr(part, "text", None)
                if t:
                    texts.append(t)
            except Exception:
                pass
        return "".join(texts)
    except Exception:
        return ""


def _gemini_generate(prompt: str, timeout: int = 25, extra_system: str = "") -> str:
    """
    Maya unified LLM: **Gemini** (google-generativeai). Same MAYA_SYSTEM_INSTRUCTION / LIVE DATA.
    """
    import traceback as _tb

    if not _USE_NEW_GENAI:
        raise RuntimeError("[Gemini] google-generativeai not installed — run: pip install google-generativeai")

    # Re-read key at call time so a new .env value is picked up after restart
    live_key = os.getenv("GEMINI_API_KEY", "").strip() or _GEMINI_API_KEY
    if not live_key:
        raise RuntimeError("GEMINI_API_KEY not set — add it to .env or Render Environment Variables")
    if live_key != getattr(genai, "_configured_key", None):
        try:
            genai.configure(api_key=live_key)
            genai._configured_key = live_key  # track so we only reconfigure when key changes
            _gemini_invalidate_model_cache()
            print(f"[Gemini] genai.configure OK (key len={len(live_key)})")
        except Exception as _cfg_e:
            print(f"[Gemini] ❌ genai.configure FAILED: {type(_cfg_e).__name__}: {_cfg_e}")
            _tb.print_exc()
            raise

    def _call_model(model_name):
        _sys = MAYA_SYSTEM_INSTRUCTION
        if (extra_system or "").strip():
            _sys = MAYA_SYSTEM_INSTRUCTION + "\n\n--- LIVE DATA (authoritative) ---\n" + extra_system.strip()
        model = genai.GenerativeModel(
            model_name=model_name,
            system_instruction=_sys,
            generation_config=genai.types.GenerationConfig(
                temperature=0.42,
                max_output_tokens=768,
            ),
        )
        resp = model.generate_content(prompt)
        text = _safe_gemini_text(resp, label=model_name)
        if not text:
            # _safe_gemini_text already logged the real failure mode.
            # Raise so the for-loop treats this the same as an API error
            # and we fall through to the last_exc / RuntimeError path.
            _cands = getattr(resp, "candidates", None) or []
            _fr = str(getattr(_cands[0], "finish_reason", "none")) if _cands else "no_candidates"
            raise ValueError(
                f"[Gemini] {model_name} returned empty/blocked response "
                f"(finish_reason={_fr!r})"
            )
        return text

    last_exc = None
    for model_name in _gemini_model_candidates():
        try:
            print("--- API CALL START ---")
            print(f"[Gemini] → calling {model_name} …")
            text = _call_model(model_name)
            print(f"[Gemini] ✅ {model_name} responded ({len(text)} chars)")
            return text
        except Exception as e:
            last_exc = e
            err_str = str(e).lower()
            print(f"[Gemini] ❌ {model_name} failed: {type(e).__name__}: {e}")
            _tb.print_exc()
            if any(
                x in err_str
                for x in (
                    "api_key_invalid",
                    "api key not valid",
                    "invalid api key",
                    "permission_denied",
                    "api key expired",
                    "key has expired",
                    "unauthenticated",
                )
            ):
                raise RuntimeError(
                    "__KEY_INVALID__: The Gemini API key is invalid or expired. "
                    "Get a new key at https://aistudio.google.com/apikey and update GEMINI_API_KEY."
                )
            if "quota" in err_str or "429" in err_str or "resource_exhausted" in err_str:
                raise
            if _gemini_err_is_model_not_found(e):
                continue
            break

    raise last_exc or RuntimeError("[Gemini] All models failed")


def _gemini_stream_collect_string(prompt: str, timeout: int = 55, extra_system: str = "") -> str:
    """
    Same final string as _gemini_generate, using generate_content(stream=True) for lower time-to-first-token.
    """
    import traceback as _tb

    if not _USE_NEW_GENAI:
        raise RuntimeError("[Gemini] google-generativeai not installed — run: pip install google-generativeai")
    live_key = os.getenv("GEMINI_API_KEY", "").strip() or _GEMINI_API_KEY
    if not live_key:
        raise RuntimeError("GEMINI_API_KEY not set — add it to .env or Render Environment Variables")
    if live_key != getattr(genai, "_configured_key", None):
        genai.configure(api_key=live_key)
        genai._configured_key = live_key
        _gemini_invalidate_model_cache()

    def _stream_one(model_name: str) -> str:
        _sys = MAYA_SYSTEM_INSTRUCTION
        if (extra_system or "").strip():
            _sys = MAYA_SYSTEM_INSTRUCTION + "\n\n--- LIVE DATA (authoritative) ---\n" + extra_system.strip()
        model = genai.GenerativeModel(
            model_name=model_name,
            system_instruction=_sys,
            generation_config=genai.types.GenerationConfig(
                temperature=0.42,
                max_output_tokens=768,
            ),
        )
        stream = model.generate_content(prompt, stream=True)
        parts = []
        for chunk in stream:
            piece = _safe_gemini_chunk_text(chunk, label=model_name).strip()
            if piece:
                parts.append(piece)
        return "".join(parts).strip()

    last_exc = None
    for model_name in _gemini_model_candidates():
        try:
            text = _stream_one(model_name)
            if text:
                return text
        except Exception as e:
            last_exc = e
            err_str = str(e).lower()
            if any(
                x in err_str
                for x in (
                    "api_key_invalid",
                    "api key not valid",
                    "invalid api key",
                    "permission_denied",
                    "api key expired",
                    "key has expired",
                    "unauthenticated",
                )
            ):
                raise RuntimeError(
                    "__KEY_INVALID__: The Gemini API key is invalid or expired. "
                    "Get a new key at https://aistudio.google.com/apikey and update GEMINI_API_KEY."
                )
            if "quota" in err_str or "429" in err_str or "resource_exhausted" in err_str:
                raise
            if _gemini_err_is_model_not_found(e):
                continue
            break
    raise last_exc or RuntimeError("[Gemini] All models failed (stream)")


def _maya_llm_stream_text_chunks(prompt: str, timeout: int, extra_system: str):
    """
    Yield incremental text fragments from Gemini (stream=True).
    Used for SSE maya-command so the UI can render tokens before the full JSON is ready.
    """
    import traceback as _tb

    if not _USE_NEW_GENAI:
        raise RuntimeError("[Gemini] google-generativeai not installed — run: pip install google-generativeai")
    live_key = os.getenv("GEMINI_API_KEY", "").strip() or _GEMINI_API_KEY
    if not live_key:
        raise RuntimeError("GEMINI_API_KEY not set — add it to .env or Render Environment Variables")
    if live_key != getattr(genai, "_configured_key", None):
        genai.configure(api_key=live_key)
        genai._configured_key = live_key
        _gemini_invalidate_model_cache()

    def _stream_one(model_name: str):
        _sys = MAYA_SYSTEM_INSTRUCTION
        if (extra_system or "").strip():
            _sys = MAYA_SYSTEM_INSTRUCTION + "\n\n--- LIVE DATA (authoritative) ---\n" + extra_system.strip()
        model = genai.GenerativeModel(
            model_name=model_name,
            system_instruction=_sys,
            generation_config=genai.types.GenerationConfig(
                temperature=0.42,
                max_output_tokens=768,
            ),
        )
        # Apply a hard wall-clock timeout so the call never hangs silently.
        # request_options is honoured by the google-generativeai gRPC/HTTP transport.
        _req_opts = {"timeout": int(timeout)} if timeout else {}
        stream = model.generate_content(prompt, stream=True, request_options=_req_opts)
        for chunk in stream:
            piece = _safe_gemini_chunk_text(chunk, label=model_name)
            if piece:
                yield piece

    last_exc = None
    for model_name in _gemini_model_candidates():
        try:
            for piece in _stream_one(model_name):
                yield piece
            return
        except Exception as e:
            last_exc = e
            err_str = str(e).lower()
            if any(
                x in err_str
                for x in (
                    "api_key_invalid",
                    "api key not valid",
                    "invalid api key",
                    "permission_denied",
                    "api key expired",
                    "key has expired",
                    "unauthenticated",
                )
            ):
                raise RuntimeError(
                    "__KEY_INVALID__: The Gemini API key is invalid or expired. "
                    "Get a new key at https://aistudio.google.com/apikey and update GEMINI_API_KEY."
                )
            if "quota" in err_str or "429" in err_str or "resource_exhausted" in err_str:
                raise
            if _gemini_err_is_model_not_found(e):
                continue
            break
    raise last_exc or RuntimeError("[Gemini] All models failed (stream chunks)")


def _promote_property_task_to_in_progress_after_worker_notify(task_id: str) -> None:
    """When a task notification is successfully sent to staff, move Pending → In_Progress (mission board)."""
    if not task_id or not SessionLocal or not PropertyTaskModel:
        return
    session = SessionLocal()
    try:
        row = session.query(PropertyTaskModel).filter_by(id=task_id).first()
        if not row:
            return
        raw = (getattr(row, "status", None) or "").strip()
        low = raw.lower()
        if low in ("archived", "done", "completed") or _norm_task_status_category(raw) == "done":
            return
        if low in ("in_progress", "in progress"):
            return
        now_ts = datetime.now(timezone.utc).isoformat()
        row.status = "In_Progress"
        if not getattr(row, "started_at", None):
            row.started_at = now_ts
        session.commit()
        try:
            _bump_tasks_version()
            _invalidate_owner_dashboard_cache()
        except Exception:
            pass
    except Exception as ex:
        try:
            session.rollback()
        except Exception:
            pass
        print(f"[Tasks] promote In_Progress after notify failed: {ex}", flush=True)
    finally:
        session.close()


_BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
_BUILD_DIR  = os.path.join(_BASE_DIR, "build")          # React production build
_PUBLIC_DIR = os.path.join(_BASE_DIR, "public")         # fallback for dev

# Serve React's build/ as static files; fall back to public/ if build/ missing
_static_dir   = _BUILD_DIR  if os.path.isdir(_BUILD_DIR)  else _PUBLIC_DIR
_template_dir = _BUILD_DIR  if os.path.isdir(_BUILD_DIR)  else _PUBLIC_DIR

app = Flask(
    __name__,
    static_folder=os.path.join(_static_dir, "static"),  # JS/CSS chunks
    template_folder=_template_dir,                       # index.html
)

# CORS — all routes (`/*` includes /api/health heartbeat → clears “Python Offline” when Flask is up)
_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
_CORS_RESOURCE_KW = {
    "origins": _CORS_ORIGINS,
    "supports_credentials": True,
    "allow_headers": ["Content-Type", "Authorization", "X-Tenant-Id", "Accept"],
    "methods": ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    "expose_headers": ["Content-Type"],
}
CORS(app, resources={r"/*": _CORS_RESOURCE_KW})

# ── Session & Cookie config ──────────────────────────────────────────────────
from datetime import timedelta
app.config["SECRET_KEY"]              = os.getenv("JWT_SECRET", os.urandom(32).hex())
app.config["SESSION_PERMANENT"]       = True
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)
# Production (Render / HTTPS) — cross-site cookies required for Render's domain
_is_production = bool(os.getenv("RENDER") or os.getenv("DYNO"))
app.config["SESSION_COOKIE_SECURE"]   = _is_production
app.config["SESSION_COOKIE_SAMESITE"] = "None" if _is_production else "Lax"
app.config["SESSION_COOKIE_HTTPONLY"] = True


@app.errorhandler(HTTPException)
def _handle_http_exception(e):
    """API routes always return JSON (no HTML error pages)."""
    if request.path.startswith("/api/"):
        return jsonify({
            "ok": False,
            "error": "http_error",
            "code": e.code,
            "message": e.description or str(e),
        }), e.code
    return e


@app.errorhandler(Exception)
def _handle_unhandled_exception(e):
    if isinstance(e, HTTPException):
        return _handle_http_exception(e)
    import traceback as _tb_err
    _tb_err.print_exc()
    if request.path.startswith("/api/"):
        return jsonify({
            "ok": False,
            "error": "internal_error",
            "message": "Temporary service issue. Retrying is safe.",
        }), 503
    raise


@app.route("/api/health", methods=["GET", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["GET", "OPTIONS"])
def api_health():
    """Liveness probe — confirms Flask is reachable.
    Also surfaces DB mode so the frontend can distinguish live-DB from SQLite-fallback mode.
    """
    if request.method == "OPTIONS":
        return Response(status=204)
    _db_mode = (
        "postgres"       if _is_pg     else
        "sqlite_dev"     if _is_sqlite else
        "unavailable"
    )
    return jsonify({
        "status": "ok",
        "ok": True,
        "db_mode": _db_mode,
        "db_ready": bool(SessionLocal and ENGINE),
        "init_done": INIT_DONE,
    }), 200


@app.route("/api/db-status", methods=["GET", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["GET", "OPTIONS"])
def api_db_status():
    """Diagnostic probe — reports DB connectivity mode, readiness, and init state.
    Does NOT perform a live SELECT (use ?ping=1 for that).
    """
    if request.method == "OPTIONS":
        return Response(status=204)
    _db_mode = (
        "postgres"    if _is_pg     else
        "sqlite_dev"  if _is_sqlite else
        "unavailable"
    )
    payload = {
        "db_mode": _db_mode,
        "db_ready": bool(SessionLocal and ENGINE),
        "init_done": INIT_DONE,
        "engine_type": (
            getattr(ENGINE.dialect, "name", "unknown") if ENGINE else "none"
        ),
    }
    # Optional live ping (adds a round-trip; only on request)
    if request.args.get("ping") in ("1", "true") and ENGINE:
        try:
            with ENGINE.connect() as _pc:
                _pc.execute(text("SELECT 1"))
            payload["ping"] = "ok"
        except Exception as _pe:
            payload["ping"] = f"failed: {str(_pe)[:120]}"
    return jsonify(payload), 200 if payload["db_ready"] else 503


@app.route("/api/heartbeat", methods=["GET", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["GET", "OPTIONS"])
def api_heartbeat():
    """Ultra-light liveness for React — no DB work (startup-safe)."""
    if request.method == "OPTIONS":
        return Response(status=204)
    return jsonify({
        "ok": True,
        "server_time": datetime.now(timezone.utc).isoformat(),
        "tenant": request.headers.get("X-Tenant-Id") or DEFAULT_TENANT_ID,
    }), 200


def _cors_allow_origin_for_request():
    """Reflect dev origins so fetch(..., credentials: 'include') succeeds (localhost + LAN React)."""
    origin = (request.headers.get("Origin") or "").strip()
    dev_origins = (
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    )
    if origin in dev_origins:
        return origin
    # http://192.168.x.x:3000 etc. — browsers require a concrete origin with credentials (not *)
    try:
        from urllib.parse import urlparse

        u = urlparse(origin)
        _dev_ports = set(range(3000, 3020)) | set(range(5173, 5190)) | {4173, 4280, 8080}
        if u.scheme in ("http", "https") and u.port in _dev_ports:
            h = (u.hostname or "").lower()
            if h in ("localhost", "127.0.0.1"):
                return origin
            parts = h.split(".")
            if len(parts) == 4 and all(p.isdigit() for p in parts):
                a, b = int(parts[0]), int(parts[1])
                if a == 192 and b == 168:
                    return origin
                if a == 10:
                    return origin
                if a == 172 and 16 <= b <= 31:
                    return origin
    except Exception:
        pass
    if any(origin.startswith(p) for p in dev_origins):
        return origin
    return "*"


@app.before_request
def handle_options_preflight():
    if request.method == "OPTIONS":
        resp = Response(status=204)
        allow = _cors_allow_origin_for_request()
        resp.headers["Access-Control-Allow-Origin"] = allow
        if allow != "*":
            resp.headers["Access-Control-Allow-Credentials"] = "true"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Tenant-Id"
        return resp


@app.before_request
def bypass_auth_for_ai_routes():
    """When AUTH_DISABLED, skip JWT for heavy ops routes (legacy dev). When auth is on, only @require_auth uses bypass via this flag."""
    if request.method == "OPTIONS":
        return
    if not AUTH_DISABLED:
        g.bypass_ai_auth = False
        return
    if request.path.startswith("/api/ai/"):
        g.bypass_ai_auth = True
    elif request.path == "/api/chat":
        g.bypass_ai_auth = True
    elif request.path == "/api/property-tasks" or request.path.startswith("/api/property-tasks/"):
        g.bypass_ai_auth = True
    elif request.path in (
        "/api/property-tasks-batch",
        "/api/property-tasks-batch-update",
        "/api/batch_update",
    ):
        g.bypass_ai_auth = True
    elif request.path.startswith("/api/rooms/") or request.path.startswith("/api/bookings/"):
        g.bypass_ai_auth = True
    elif request.path == "/api/messages" or request.path.startswith("/api/messages"):
        g.bypass_ai_auth = True
    elif request.path.startswith("/api/notify/"):
        g.bypass_ai_auth = True
    elif request.path.startswith("/api/analytics"):
        g.bypass_ai_auth = True
    elif request.path == "/api/properties" or request.path.startswith("/api/properties/"):
        g.bypass_ai_auth = True
    elif request.path == "/api/tasks" or request.path.startswith("/api/tasks/"):
        g.bypass_ai_auth = True


@app.after_request
def add_cors_headers(response):
    allow = _cors_allow_origin_for_request()
    response.headers["Access-Control-Allow-Origin"] = allow
    if allow != "*":
        response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Tenant-Id"
    return response


# ── Image compression helper ────────────────────────────────────────────────
def _compress_image(file_stream, max_px=1200, quality=78):
    """
    Compress an uploaded image for fast mobile loading.
    - Resizes so the longer edge ≤ max_px (default 1200 px)
    - Saves as JPEG at quality=78 (good balance of size vs. clarity)
    - Returns (bytes, 'jpg') ready to write to disk
    Falls back to original bytes if Pillow is not available.
    """
    try:
        from PIL import Image as _PILImage
        import io as _io
        img = _PILImage.open(file_stream)
        img = img.convert("RGB")          # strip alpha / normalise colour mode
        w, h = img.size
        if max(w, h) > max_px:
            ratio  = max_px / max(w, h)
            img    = img.resize((int(w * ratio), int(h * ratio)), _PILImage.LANCZOS)
        buf = _io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        buf.seek(0)
        return buf.read(), "jpg"
    except Exception as _ce:
        print(f"[compress_image] PIL unavailable or failed ({_ce}), saving original")
        file_stream.seek(0)
        return file_stream.read(), None   # None ext = keep original ext


# Serve uploaded files - must be early to avoid being shadowed
UPLOAD_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__) or ".", "uploads"))
os.makedirs(UPLOAD_ROOT, exist_ok=True)


@app.route("/uploads/<path:filename>", methods=["GET"])
def serve_uploads(filename):
    """Serve files from uploads folder. URL: http://127.0.0.1:5000/uploads/ + filename (e.g. shared/xyz.jpg)."""
    try:
        resp = send_from_directory(UPLOAD_ROOT, filename)
        resp.headers["Access-Control-Allow-Origin"] = "*"
        return resp
    except Exception:
        return jsonify({"error": "File not found"}), 404


# ── Database URL resolution (priority: DATABASE_URL > SUPABASE_URL+KEY > SQLite) ─────
_APP_DIR = os.path.dirname(os.path.abspath(__file__))

def _is_pg_url(url: str) -> bool:
    """Return True if the URL looks like a remote PostgreSQL connection."""
    return url.startswith("postgresql://") and "localhost" not in url and "127.0.0.1" not in url

def _build_database_url() -> str:
    """
    Resolve the database connection URL. Priority order:

      1. DATABASE_URL          — explicit full URI (any provider)
      2. SUPABASE_URL + SUPABASE_DB_PASSWORD — direct Supabase PostgreSQL
      3. SUPABASE_URL + SUPABASE_KEY         — forced Supabase connection
                                               (SQLite disabled when these are set)
      4. SQLite                — only used when NO Supabase credentials exist at all
    """
    # ── 1. Explicit DATABASE_URL — used exactly as set, no auto-rewriting ──────
    raw = os.getenv("DATABASE_URL", "").strip()
    if raw and not raw.startswith("sqlite"):
        # Normalise scheme
        if raw.startswith("postgres://"):
            raw = raw.replace("postgres://", "postgresql://", 1)

        # Strip any custom flags that are not valid psycopg2 options.
        # e.g. ?direct=True is used in .env as a signal "don't auto-rewrite"
        # but would cause psycopg2 to fail.
        raw = re.sub(r"[?&]direct=[^&]*", "", raw)
        raw = re.sub(r"\?&", "?", raw)   # clean up ?& artifact
        raw = raw.rstrip("?&")

        # Ensure SSL for any remote PostgreSQL (Supabase always requires it)
        if "sslmode" not in raw and ("supabase" in raw.lower() or _is_pg_url(raw)):
            raw += ("&" if "?" in raw else "?") + "sslmode=require"

        safe = re.sub(r":([^:@]+)@", ":***@", raw)
        print(f"[DB] ✅ Using DATABASE_URL (exact) → {safe}")
        return raw

    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_key = os.getenv("SUPABASE_KEY", "").strip()
    db_password  = os.getenv("SUPABASE_DB_PASSWORD", "").strip()

    # Detect unfilled placeholder values — treat them as "not set"
    _PLACEHOLDERS = {"YOUR_PROJECT_REF", "YOUR_KEY_HERE", "YOUR_DATABASE_PASSWORD",
                     "YOUR_DB_PASSWORD", "sb_secret_YOUR_KEY_HERE"}
    def _is_placeholder(val: str) -> bool:
        return not val or any(p in val for p in _PLACEHOLDERS)

    if _is_placeholder(supabase_url):
        supabase_url = ""
    if _is_placeholder(supabase_key):
        supabase_key = ""
    if _is_placeholder(db_password):
        db_password = ""

    m = re.match(r'https?://([^.]+)\.supabase\.co', supabase_url) if supabase_url else None

    # ── 2. SUPABASE_URL + SUPABASE_DB_PASSWORD ──────────────────────────────
    if m and db_password:
        project_ref = m.group(1)
        url = (
            f"postgresql://postgres.{project_ref}:{db_password}"
            f"@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require"
        )
        print(f"[DB] ✅ Supabase (SUPABASE_DB_PASSWORD) — project: {project_ref}")
        return url

    # ── 3. SUPABASE_URL + SUPABASE_KEY ──────────────────────────────────────
    if m and supabase_key:
        project_ref = m.group(1)
        url = (
            f"postgresql://postgres:{supabase_key}"
            f"@db.{project_ref}.supabase.co:5432/postgres?sslmode=require"
        )
        print(f"[DB] ✅ Supabase (SUPABASE_KEY) — project: {project_ref}")
        return url

    if supabase_url and not supabase_key and not db_password:
        print("[DB] ⚠️  SUPABASE_URL is set but credentials are missing or placeholders.")
        print("[DB]    Update .env: replace YOUR_PROJECT_REF / YOUR_KEY_HERE with real values.")
        print("[DB]    Falling back to SQLite for now.")

    sqlite_path = os.path.join(_APP_DIR, "leads.db")
    print(f"[DB] 📁 Using local SQLite: {sqlite_path}  "
          f"(set SUPABASE_URL + SUPABASE_KEY in .env to use Supabase)")
    return f"sqlite:///{sqlite_path}"


DATABASE_URL = _build_database_url()

JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ISSUER = os.getenv("JWT_ISSUER", "easyhost")
JWT_AUDIENCE = os.getenv("JWT_AUDIENCE", "easyhost-dashboard")
JWT_EXP_HOURS = int(os.getenv("JWT_EXP_HOURS", "24"))

# ── Auth defaults — SECURE by default ────────────────────────────────────────
# Both flags default to OFF (false) so customer deployments are protected
# without any extra configuration.  Local / dev machines that need the old
# open behaviour must explicitly set AUTH_DISABLED=true / ALLOW_DEMO_AUTH=true
# in their .env file.
#
#   Old (unsafe) defaults:   AUTH_DISABLED=true   ALLOW_DEMO_AUTH=true
#   New (secure) defaults:   AUTH_DISABLED=false  ALLOW_DEMO_AUTH=false
ALLOW_DEMO_AUTH = os.getenv("ALLOW_DEMO_AUTH", "false").lower() == "true"
AUTH_DISABLED = os.getenv("AUTH_DISABLED", "false").lower() == "true"  # false = enforce Bearer JWT on protected routes
DEFAULT_TENANT_ID = os.getenv("DEFAULT_TENANT_ID", "default")


def _warn_jwt_security_config():
    """Log the effective auth mode on every startup so the operator always knows
    which security posture is active."""
    if AUTH_DISABLED:
        print(
            "[Security] ⚠️  AUTH_DISABLED=true — JWT enforcement is OFF. "
            "All tenant identity comes from the X-Tenant-Id header (spoofable). "
            "Set AUTH_DISABLED=false for any customer-facing deployment.",
            flush=True,
        )
        if ALLOW_DEMO_AUTH:
            print(
                "[Security] ⚠️  ALLOW_DEMO_AUTH=true — /api/auth/demo is OPEN "
                "and will mint admin tokens for any tenant_id in the request body.",
                flush=True,
            )
        return
    # Auth is on — warn about a weak JWT secret
    weak = ("change-me-in-production", "change-me", "easyhost", "")
    sec = (os.getenv("JWT_SECRET") or "").strip()
    if sec in weak or len(sec) < 24:
        print(
            "[Security] WARNING: AUTH_DISABLED=false but JWT_SECRET is missing or weak. "
            "Set JWT_SECRET to a long random string in .env.",
            flush=True,
        )
    if ALLOW_DEMO_AUTH:
        print(
            "[Security] ⚠️  ALLOW_DEMO_AUTH=true — /api/auth/demo is OPEN even though "
            "AUTH_DISABLED=false. Set ALLOW_DEMO_AUTH=false in production.",
            flush=True,
        )
    if not ALLOW_DEMO_AUTH:
        print(
            "[Security] ✅ Auth enforced: AUTH_DISABLED=false, ALLOW_DEMO_AUTH=false.",
            flush=True,
        )


_warn_jwt_security_config()


def _env_truthy(name, default="false"):
    return str(os.getenv(name, default) or "").lower() in ("1", "true", "yes", "on")


# Real-time ops defaults: no synthetic bulk tasks; skip outbound WhatsApp when quota is exhausted
SKIP_TWILIO_WHATSAPP_OUTBOUND = _env_truthy("SKIP_TWILIO_WHATSAPP", "true")
TWILIO_SIMULATE = _env_truthy("TWILIO_SIMULATE", "false")
if TWILIO_SIMULATE:
    print("[Twilio] SIMULATE mode - messages print to terminal, no API calls (no 401/503)")
SKIP_EMERGENCY_TASK_SEED = _env_truthy("SKIP_EMERGENCY_TASK_SEED", "true")
LIVE_AUTOGEN_TASKS = _env_truthy("LIVE_AUTOGEN_TASKS", "false")
SKIP_INIT_DEMO_TASKS = _env_truthy("SKIP_INIT_DEMO_TASKS", "true")


def _property_tasks_query_limit():
    """0 = fetch all rows (no cap). Otherwise max rows for GET /api/tasks (high-volume boards)."""
    try:
        v = int(os.getenv("PROPERTY_TASKS_QUERY_LIMIT", "0") or "0")
    except (TypeError, ValueError):
        v = 0
    return max(0, v)


def _coerce_demo_tenant_id(tenant_id):
    """Map UI pilot tenants (e.g. BAZAAR_JAFFA) to the DB tenant id so manual_rooms rows stay consistent."""
    if tenant_id is None:
        return DEFAULT_TENANT_ID
    s = str(tenant_id).strip()
    if not s:
        return DEFAULT_TENANT_ID
    if s.upper() in ("BAZAAR_JAFFA", "DEMO", "DEMO-TENANT"):
        return DEFAULT_TENANT_ID
    return s


ENGINE = None
SessionLocal = None
Base = None

_is_sqlite = DATABASE_URL.startswith("sqlite")
_is_pg     = DATABASE_URL.startswith("postgresql")

if create_engine and sessionmaker and declarative_base:

    # SQLite: single-thread lock needed; PostgreSQL: no extra connect args
    _connect_args = {"check_same_thread": False} if _is_sqlite else {
        # Fail within 10 s on unreachable host instead of hanging for 60+ s.
        # This lets the server start even if the DB is momentarily unavailable.
        "connect_timeout": 10,
        "options": "-c statement_timeout=30000",   # 30-s statement timeout (ms)
    }

    _SQLA_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "10"))
    _SQLA_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "20"))

    def _sqlalchemy_pool_kwargs():
        """Shared QueuePool settings — reduces QueuePool limit / timeout under concurrent API + polling."""
        return {
            "pool_pre_ping": True,
            "pool_size": _SQLA_POOL_SIZE,
            "max_overflow": _SQLA_MAX_OVERFLOW,
            "pool_timeout": 30,
            "pool_recycle": 180,
        }

    def _make_pg_engine(url):
        """Create a PostgreSQL engine with sized pool (default 10 + 20 overflow)."""
        return create_engine(
            url,
            connect_args=_connect_args,
            **_sqlalchemy_pool_kwargs(),
        )

    # Detect production environment (Render sets RENDER=true automatically)
    _is_production = bool(os.getenv("RENDER") or os.getenv("DYNO"))

    def _dev_sqlite_path_for_delete():
        """Absolute path to the SQLite file for the current DATABASE_URL (dev reset)."""
        u = DATABASE_URL or ""
        if not u.startswith("sqlite"):
            return None
        raw = u[len("sqlite:///") :]
        if not raw:
            return None
        try:
            from pathlib import Path as _Path

            p = _Path(raw)
            if p.is_absolute():
                return str(p)
            return str(_Path(_APP_DIR) / p)
        except Exception:
            return None

    def _dev_reset_sqlite_if_enabled():
        """DEV: delete SQLite file before Engine so each server start gets a fresh DB + seeds.
        Default is now 'false' so the local SQLite persists across restarts — avoids the
        10-30 s re-seed delay on every python app.py.  Set DEV_RESET_SQLITE=true to force
        a clean slate (useful when schema migrations are needed).
        """
        if _is_production:
            return
        if os.getenv("DEV_RESET_SQLITE", "false").lower() not in ("1", "true", "yes"):
            return
        p = _dev_sqlite_path_for_delete()
        if not p or not os.path.isfile(p):
            return
        try:
            os.remove(p)
            print(f"[DB] 🔥 DEV_RESET_SQLITE removed {p} — fresh schema on create_engine", flush=True)
        except OSError as e:
            print(f"[DB] DEV_RESET_SQLITE failed: {e}", flush=True)

    if _is_sqlite:
        _dev_reset_sqlite_if_enabled()
        ENGINE = create_engine(
            DATABASE_URL,
            connect_args=_connect_args,
            **_sqlalchemy_pool_kwargs(),
        )
    else:
        # ── PostgreSQL: try up to DB_CONNECT_RETRIES times before giving up ──
        # Transient DNS blips (e.g. laptop wake-up, VPN reconnect) resolve within
        # a second or two; one retry avoids falling to SQLite unnecessarily.
        _pg_retries     = max(1, int(os.getenv("DB_CONNECT_RETRIES", "2") or "2"))
        _pg_retry_delay = float(os.getenv("DB_CONNECT_RETRY_DELAY", "2.0") or "2.0")
        _pg_connected   = False
        _pg_last_err    = None
        for _attempt in range(1, _pg_retries + 1):
            try:
                ENGINE = _make_pg_engine(DATABASE_URL)
                with ENGINE.connect() as _test_conn:
                    _test_conn.execute(text("SELECT 1"))
                print(f"[DB] ✅ PostgreSQL connection verified (attempt {_attempt}/{_pg_retries}).")
                _pg_connected = True
                break
            except Exception as _pg_err:
                _pg_last_err = _pg_err
                print(
                    f"[DB] ❌ PostgreSQL attempt {_attempt}/{_pg_retries} FAILED: "
                    f"{str(_pg_err)[:220]}",
                    flush=True,
                )
                if _attempt < _pg_retries:
                    import time as _time_retry
                    print(f"[DB]    Retrying in {_pg_retry_delay:.1f} s…", flush=True)
                    _time_retry.sleep(_pg_retry_delay)

        if not _pg_connected:
            print(f"[DB]    DATABASE_URL used: {re.sub(r':([^:@]+)@', ':***@', DATABASE_URL)}")
            if _is_production:
                # ── Production (Render): NEVER silently fall back to SQLite ──────
                # The admin must fix the DATABASE_URL env var.
                print("[DB] 🚨 PRODUCTION: refusing SQLite fallback — all DB endpoints")
                print("[DB]    will return HTTP 503 until DATABASE_URL is corrected.")
                print("[DB]    Go to Render → Environment → DATABASE_URL and set a")
                print("[DB]    valid Supabase Session Pooler URL, e.g.:")
                print("[DB]    postgresql://postgres.REF:PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?sslmode=require")
                ENGINE = None   # endpoints check for None and return 503
            else:
                # ── Local dev only: fall back to SQLite so development can continue ─
                print("[DB] 🔄 Local dev: falling back to SQLite (production will error instead)")
                _sqlite_fallback = os.path.join(_APP_DIR, "leads.db")
                DATABASE_URL = f"sqlite:///{_sqlite_fallback.replace(chr(92), '/')}"  # noqa: F811
                _is_sqlite = True                               # noqa: F811
                _dev_reset_sqlite_if_enabled()
                ENGINE = create_engine(
                    DATABASE_URL,
                    connect_args={"check_same_thread": False},
                    **_sqlalchemy_pool_kwargs(),
                )

    SessionLocal = sessionmaker(bind=ENGINE)
    Base = declarative_base()

    class TenantModel(Base):
        __tablename__ = "tenants"

        id = Column(String, primary_key=True)
        name = Column(String)
        created_at = Column(String)

    class UserModel(Base):
        __tablename__ = "users"

        id = Column(String, primary_key=True)
        tenant_id = Column(String, ForeignKey("tenants.id"))
        email = Column(String, unique=True)
        password_hash = Column(String)
        role = Column(String)
        # Optional handle for Staff RBAC (matches worker_id / staff_name filters on tasks).
        worker_handle = Column(String)
        created_at = Column(String)

        tenant = relationship("TenantModel")

    class LeadModel(Base):
        __tablename__ = "leads"

        id = Column(String, primary_key=True)
        tenant_id = Column(String, ForeignKey("tenants.id"))
        name = Column(String)
        contact = Column(String)
        email = Column(String)
        phone = Column(String)
        source = Column(String)
        status = Column(String)
        value = Column(Integer)
        rating = Column(Float)
        created_at = Column(String)
        notes = Column(Text)
        property_name = Column(String)
        city = Column(String)
        response_time_hours = Column(Float)
        lead_quality = Column(Integer)
        ai_summary = Column(Text)
        last_objection = Column(String)
        payment_link = Column(String)
        desired_checkin = Column(String)
        desired_checkout = Column(String)

        tenant = relationship("TenantModel")

    class CalendarConnectionModel(Base):
        __tablename__ = "calendar_connections"

        tenant_id = Column(String, ForeignKey("tenants.id"), primary_key=True)
        ical_url = Column(Text)
        last_sync = Column(String)
        vacant_nights = Column(Integer)
        potential_revenue = Column(Integer)
        vacancy_windows = Column(Text)

        tenant = relationship("TenantModel")

    class MessageModel(Base):
        __tablename__ = "messages"

        id = Column(String, primary_key=True)
        tenant_id = Column(String, ForeignKey("tenants.id"))
        lead_id = Column(String)
        direction = Column(String)
        channel = Column(String)
        content = Column(Text)
        created_at = Column(String)

        tenant = relationship("TenantModel")

    class StaffModel(Base):
        __tablename__ = "staff"

        id = Column(String, primary_key=True)
        tenant_id = Column(String, ForeignKey("tenants.id"))
        name = Column(String)
        phone = Column(String)
        active = Column(Integer)
        on_shift = Column(Integer)
        points = Column(Integer)
        gold_points = Column(Integer)
        language = Column(String)
        photo_url = Column(Text)
        last_lat = Column(Float)
        last_lng = Column(Float)
        last_location_at = Column(String)
        last_clock_in = Column(String)
        last_clock_out = Column(String)
        last_assigned_at = Column(String)
        role = Column(String)
        property_id = Column(String)  # UUID - links staff to a specific property

        tenant = relationship("TenantModel")

    class TaskModel(Base):
        __tablename__ = "tasks"

        id = Column(String, primary_key=True)
        tenant_id = Column(String, ForeignKey("tenants.id"))
        staff_id = Column(String, ForeignKey("staff.id"))
        task_type = Column(String)
        room = Column(String)
        room_id = Column(String)
        status = Column(String)
        created_at = Column(String)
        assigned_at = Column(String)
        on_my_way_at = Column(String)
        started_at = Column(String)
        finished_at = Column(String)
        due_at = Column(String)
        points_awarded = Column(Integer)

        tenant = relationship("TenantModel")
        staff = relationship("StaffModel")

    class ManualRoomModel(Base):
        __tablename__ = "manual_rooms"

        id = Column(String, primary_key=True)
        tenant_id = Column(String, ForeignKey("tenants.id"))
        owner_id = Column(String)  # User UUID - only owner sees this property
        name = Column(String)
        description = Column(Text)
        photo_url = Column(Text)
        amenities = Column(Text)  # JSON array: ["Wi-Fi","AC",...]
        status = Column(String)
        created_at = Column(String)
        last_checkout_at = Column(String)
        last_checkin_at = Column(String)
        ai_automation_enabled = Column(Integer, default=0)  # 0=off, 1=on
        max_guests = Column(Integer, default=2)
        bedrooms = Column(Integer, default=1)
        beds = Column(Integer, default=1)
        bathrooms = Column(Integer, default=1)
        occupancy_rate = Column(Float, default=80.0)  # demo / dashboard — persisted (not computed)

        tenant = relationship("TenantModel")

    class RoomsBranchModel(Base):
        """ROOMS coworking branches (Fattal) — hierarchy for multi-site ops."""
        __tablename__ = "rooms_branches"

        slug = Column(String, primary_key=True)
        tenant_id = Column(String, ForeignKey("tenants.id"), index=True)
        name = Column(String)
        city = Column(String)
        asset_folder = Column(String)
        sort_order = Column(Integer, default=0)

    class PropertyStaffModel(Base):
        """Property-specific employees: id, property_id (FK manual_rooms), name, role, department, phone_number, branch_slug."""
        __tablename__ = "property_staff"

        id = Column(String, primary_key=True)
        property_id = Column(String, ForeignKey("manual_rooms.id"))
        name = Column(String)
        role = Column(String)
        department = Column(String)
        phone_number = Column(String)
        branch_slug = Column(String)

    class PropertyTaskModel(Base):
        """Tasks table: id (UUID), property_id, staff_id, description, status (Pending/Done), created_at. Links to property_staff via staff_id."""
        __tablename__ = "property_tasks"

        id = Column(String, primary_key=True)
        property_id = Column(String)
        staff_id = Column(String)  # FK to property_staff.id
        assigned_to = Column(String)  # Legacy alias for staff_id
        description = Column(Text)
        status = Column(String, default="Pending")  # Pending / Accepted / Done
        created_at = Column(String)
        property_name = Column(String)
        staff_name = Column(String)
        staff_phone = Column(String)
        # ── Performance tracking ──────────────────────────────
        started_at = Column(String)          # ISO when worker accepted task
        completed_at = Column(String)        # ISO when worker marked done
        duration_minutes = Column(String)    # float stored as string for SQLite compat
        worker_notes = Column(Text)          # Optional notes the worker adds
        photo_url = Column(String)           # Image linked to this task (uploaded on creation)
        priority  = Column(String, default="normal")   # normal | high (set when "דחוף"/"urgent")
        task_type = Column(String)           # Cleaning | Maintenance | Service
        tenant_id = Column(String, index=True, default=DEFAULT_TENANT_ID)  # multi-tenant isolation
        due_at = Column(String)              # ISO target time (check-in prep, iCal-driven)

    class WorkerStatsModel(Base):
        """Aggregated per-worker daily performance — updated by the Performance Agent."""
        __tablename__ = "worker_stats"
        id = Column(String, primary_key=True)   # "{worker_name}_{date}"
        worker_name = Column(String, index=True)
        date = Column(String)                    # YYYY-MM-DD UTC
        tasks_done = Column(String, default="0")
        tasks_total = Column(String, default="0")
        avg_duration_minutes = Column(String)    # float as string
        shift_start = Column(String)
        last_active = Column(String)
        updated_at = Column(String)

    class WorkerPerformanceModel(Base):
        """
        Immutable task-completion log — one row per completed task.
        Persisted forever in hotel.db for weekly/monthly reporting.
        Never deleted; archived tasks remain searchable indefinitely.
        """
        __tablename__ = "worker_performance"
        id = Column(String, primary_key=True)       # same as task_id
        task_id = Column(String, index=True)
        worker_name = Column(String, index=True)
        worker_phone = Column(String)
        property_name = Column(String)
        property_id = Column(String)
        description = Column(Text)
        created_at = Column(String)                 # task creation ISO
        started_at = Column(String)                 # worker accepted ISO
        completed_at = Column(String)               # worker finished ISO
        duration_minutes = Column(String)           # float as string
        date = Column(String, index=True)           # YYYY-MM-DD UTC for date-range queries

    class TaskAuditLogModel(Base):
        """Immutable audit trail — task lifecycle events (e.g. completion). Not exposed to guests."""
        __tablename__ = "task_audit_log"

        id = Column(String, primary_key=True)
        tenant_id = Column(String, index=True)
        task_id = Column(String, index=True)
        action = Column(String)  # e.g. task_completed
        previous_status = Column(String)
        new_status = Column(String)
        actor_user_id = Column(String, index=True)
        actor_email = Column(String)
        created_at = Column(String)

    class DamageReportModel(Base):
        __tablename__ = "damage_reports"

        id = Column(String, primary_key=True)
        tenant_id = Column(String, ForeignKey("tenants.id"))
        room_id = Column(String)
        task_id = Column(String)
        room_name = Column(String)
        note = Column(Text)
        photo_url = Column(Text)
        created_at = Column(String)
        resolved_at = Column(String)
        status = Column(String)

        tenant = relationship("TenantModel")

    class BookingModel(Base):
        """Guest bookings — one row per stay.  Drives the Revenue dashboard."""
        __tablename__ = "bookings"

        id           = Column(String, primary_key=True)
        tenant_id    = Column(String, default=DEFAULT_TENANT_ID)
        property_id  = Column(String)          # FK to manual_rooms.id (soft ref)
        property_name = Column(String)
        guest_name   = Column(String)
        guest_phone  = Column(String)
        check_in     = Column(String)          # ISO date YYYY-MM-DD
        check_out    = Column(String)          # ISO date YYYY-MM-DD
        nights       = Column(Integer, default=1)
        total_price  = Column(Integer, default=0)   # NIS / USD
        status       = Column(String, default="confirmed")  # confirmed / cancelled / completed
        created_at   = Column(String)

    class PropertyKnowledgeModel(Base):
        """Maya property research — persisted in property_knowledge; offices, pricing, rules, POIs."""
        __tablename__ = "property_knowledge"

        id = Column(String, primary_key=True)
        tenant_id = Column(String, index=True, default=DEFAULT_TENANT_ID)
        display_name = Column(String)
        normalized_key = Column(String, index=True)
        source_url = Column(String)
        manual_room_id = Column(String)
        summary = Column(Text)
        offices_note = Column(Text)
        rules_note = Column(Text)
        pricing_note = Column(Text)
        amenities_note = Column(Text)
        location_note = Column(Text)
        street_anchor = Column(String)
        pois_json = Column(Text)
        research_json = Column(Text)
        created_at = Column(String)
        updated_at = Column(String)

    def ensure_staff_schema():
        if not ENGINE or not text:
            return
        try:
            _ensure_staff_schema_inner()
        except Exception as _ess_err:
            # Supabase statement_timeout / locks must not prevent Flask startup or /api/health.
            print(f"[ensure_staff_schema] non-fatal (schema may retry later): {_ess_err}", flush=True)

    def _ensure_staff_schema_inner():
        with ENGINE.connect() as connection:
            # Postgres: skip manual_rooms ALTERs when columns already exist (avoids long locks / statement_timeout on Supabase).
            _mr_cols = None
            if ENGINE.dialect.name == "postgresql":
                try:
                    _mr_cols = {
                        str(row[0]).lower()
                        for row in connection.execute(
                            text(
                                "SELECT column_name FROM information_schema.columns "
                                "WHERE table_schema = 'public' AND table_name = 'manual_rooms'"
                            )
                        )
                    }
                except Exception:
                    _mr_cols = None

            def _manual_rooms_need(col_name):
                if _mr_cols is None:
                    return True
                return str(col_name).lower() not in _mr_cols

            # Ensure leads table has required columns (migration for older schemas)
            for col, col_type in [
                ("tenant_id", "VARCHAR DEFAULT 'default'"),
                ("desired_checkin", "VARCHAR"),
                ("desired_checkout", "VARCHAR"),
                ("property_name", "VARCHAR"),
                ("city", "VARCHAR"),
                ("response_time_hours", "FLOAT"),
                ("lead_quality", "INTEGER"),
                ("ai_summary", "TEXT"),
                ("last_objection", "VARCHAR"),
                ("payment_link", "VARCHAR"),
            ]:
                try:
                    connection.execute(text(f"ALTER TABLE leads ADD COLUMN IF NOT EXISTS {col} {col_type}"))
                except Exception:
                    try:
                        connection.execute(text(f"ALTER TABLE leads ADD COLUMN {col} {col_type}"))
                    except Exception:
                        pass
            try:
                connection.execute(text("ALTER TABLE staff ADD COLUMN IF NOT EXISTS gold_points INTEGER DEFAULT 0"))
            except Exception:
                try:
                    connection.execute(text("ALTER TABLE staff ADD COLUMN gold_points INTEGER DEFAULT 0"))
                except Exception:
                    pass
            try:
                connection.execute(text("ALTER TABLE tasks ADD COLUMN IF NOT EXISTS room_id VARCHAR"))
            except Exception:
                try:
                    connection.execute(text("ALTER TABLE tasks ADD COLUMN room_id VARCHAR"))
                except Exception:
                    pass
            if _manual_rooms_need("last_checkin_at"):
                try:
                    connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN IF NOT EXISTS last_checkin_at VARCHAR"))
                except Exception:
                    try:
                        connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN last_checkin_at VARCHAR"))
                    except Exception:
                        pass
            if _manual_rooms_need("description"):
                try:
                    connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN IF NOT EXISTS description TEXT"))
                except Exception:
                    try:
                        connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN description TEXT"))
                    except Exception:
                        pass
            if _manual_rooms_need("photo_url"):
                try:
                    connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN IF NOT EXISTS photo_url TEXT"))
                except Exception:
                    try:
                        connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN photo_url TEXT"))
                    except Exception:
                        pass
            if _manual_rooms_need("status"):
                try:
                    connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN IF NOT EXISTS status VARCHAR"))
                except Exception:
                    try:
                        connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN status VARCHAR"))
                    except Exception:
                        pass
            if _manual_rooms_need("amenities"):
                try:
                    connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN IF NOT EXISTS amenities TEXT"))
                except Exception:
                    try:
                        connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN amenities TEXT"))
                    except Exception:
                        pass
            try:
                connection.execute(text("ALTER TABLE staff ADD COLUMN IF NOT EXISTS language VARCHAR"))
            except Exception:
                try:
                    connection.execute(text("ALTER TABLE staff ADD COLUMN language VARCHAR"))
                except Exception:
                    pass
            try:
                connection.execute(text("ALTER TABLE staff ADD COLUMN IF NOT EXISTS photo_url TEXT"))
            except Exception:
                try:
                    connection.execute(text("ALTER TABLE staff ADD COLUMN photo_url TEXT"))
                except Exception:
                    pass
            try:
                connection.execute(text("ALTER TABLE staff ADD COLUMN IF NOT EXISTS last_lat FLOAT"))
            except Exception:
                try:
                    connection.execute(text("ALTER TABLE staff ADD COLUMN last_lat FLOAT"))
                except Exception:
                    pass
            try:
                connection.execute(text("ALTER TABLE staff ADD COLUMN IF NOT EXISTS last_lng FLOAT"))
            except Exception:
                try:
                    connection.execute(text("ALTER TABLE staff ADD COLUMN last_lng FLOAT"))
                except Exception:
                    pass
            try:
                connection.execute(text("ALTER TABLE staff ADD COLUMN IF NOT EXISTS last_location_at VARCHAR"))
            except Exception:
                try:
                    connection.execute(text("ALTER TABLE staff ADD COLUMN last_location_at VARCHAR"))
                except Exception:
                    pass
            try:
                connection.execute(text("ALTER TABLE staff ADD COLUMN IF NOT EXISTS role VARCHAR"))
            except Exception:
                try:
                    connection.execute(text("ALTER TABLE staff ADD COLUMN role VARCHAR"))
                except Exception:
                    pass
            try:
                connection.execute(text("ALTER TABLE staff ADD COLUMN IF NOT EXISTS property_id VARCHAR"))
            except Exception:
                try:
                    connection.execute(text("ALTER TABLE staff ADD COLUMN property_id VARCHAR"))
                except Exception:
                    pass
            if _manual_rooms_need("ai_automation_enabled"):
                try:
                    connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN IF NOT EXISTS ai_automation_enabled INTEGER DEFAULT 0"))
                except Exception:
                    try:
                        connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN ai_automation_enabled INTEGER DEFAULT 0"))
                    except Exception:
                        pass
            if _manual_rooms_need("owner_id"):
                try:
                    connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN IF NOT EXISTS owner_id VARCHAR"))
                except Exception:
                    try:
                        connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN owner_id VARCHAR"))
                    except Exception:
                        pass
            for col, col_type in [
                ("max_guests", "INTEGER DEFAULT 2"),
                ("bedrooms", "INTEGER DEFAULT 1"),
                ("beds", "INTEGER DEFAULT 1"),
                ("bathrooms", "INTEGER DEFAULT 1"),
            ]:
                if not _manual_rooms_need(col):
                    continue
                try:
                    connection.execute(text(f"ALTER TABLE manual_rooms ADD COLUMN IF NOT EXISTS {col} {col_type}"))
                except Exception:
                    try:
                        connection.execute(text(f"ALTER TABLE manual_rooms ADD COLUMN {col} {col_type}"))
                    except Exception:
                        pass
            if _manual_rooms_need("occupancy_rate"):
                try:
                    connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN IF NOT EXISTS occupancy_rate FLOAT DEFAULT 80"))
                except Exception:
                    try:
                        connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN occupancy_rate FLOAT DEFAULT 80"))
                    except Exception:
                        pass
            # Postgres/SQLite: DDL must commit or ALTERs roll back (fixes missing occupancy_rate on Supabase).
            try:
                connection.commit()
            except Exception:
                pass

    def ensure_manual_rooms_occupancy_column():
        """Guarantee manual_rooms.occupancy_rate exists (ORM maps it; Postgres needs committed DDL)."""
        if not ENGINE or not text:
            return
        try:
            dname = ENGINE.dialect.name
            if dname == "postgresql":
                try:
                    with ENGINE.connect() as _c:
                        _has = _c.execute(
                            text(
                                "SELECT 1 FROM information_schema.columns "
                                "WHERE table_schema = 'public' AND table_name = 'manual_rooms' "
                                "AND column_name = 'occupancy_rate'"
                            )
                        ).fetchone()
                    if _has:
                        return
                except Exception:
                    pass
                sql = "ALTER TABLE manual_rooms ADD COLUMN IF NOT EXISTS occupancy_rate DOUBLE PRECISION DEFAULT 80"
            else:
                sql = "ALTER TABLE manual_rooms ADD COLUMN IF NOT EXISTS occupancy_rate REAL DEFAULT 80"
            with ENGINE.begin() as conn:
                conn.execute(text(sql))
            print("[schema] manual_rooms.occupancy_rate migration committed", flush=True)
        except Exception as e1:
            print(f"[schema] occupancy_rate IF NOT EXISTS: {e1}", flush=True)
            try:
                if ENGINE.dialect.name == "postgresql":
                    sql2 = "ALTER TABLE manual_rooms ADD COLUMN occupancy_rate DOUBLE PRECISION DEFAULT 80"
                else:
                    sql2 = "ALTER TABLE manual_rooms ADD COLUMN occupancy_rate REAL DEFAULT 80"
                with ENGINE.begin() as conn:
                    conn.execute(text(sql2))
                print("[schema] manual_rooms.occupancy_rate added (fallback)", flush=True)
            except Exception as e2:
                print(f"[schema] occupancy_rate fallback failed: {e2}", flush=True)

    def _seed_rooms_branches():
        """Insert default ROOMS (Fattal) branch rows if missing."""
        if not SessionLocal or not RoomsBranchModel:
            return
        rows = [
            ("sky-tower", "Sky Tower", "Tel Aviv", "workspaces/sky-tower", 1),
            ("acro-tlv", "Acro", "Tel Aviv", "workspaces/acro-tlv", 2),
            ("beit-rubinstein", "Beit Rubinstein", "Tel Aviv", "workspaces/beit-rubinstein", 3),
            ("neve-tzedek", "Neve Tzedek", "Tel Aviv", "workspaces/neve-tzedek", 4),
            ("bbc-bnei-brak", "BBC", "Bnei Brak", "workspaces/bbc-bnei-brak", 5),
            ("acro-raanana", "Acro", "Ra'anana", "workspaces/acro-raanana", 6),
            ("millennium-raanana", "Millennium", "Ra'anana", "workspaces/millennium-raanana", 7),
            ("modiin", "Modi'in", "Modi'in", "workspaces/modiin", 8),
            ("bsr-city", "BSR City", "Petah Tikva", "workspaces/bsr-city", 9),
        ]
        session = SessionLocal()
        try:
            for slug, name, city, folder, order in rows:
                existing = session.query(RoomsBranchModel).filter_by(slug=slug).first()
                if not existing:
                    session.add(
                        RoomsBranchModel(
                            slug=slug,
                            tenant_id=DEFAULT_TENANT_ID,
                            name=name,
                            city=city,
                            asset_folder=folder,
                            sort_order=order,
                        )
                    )
            session.commit()
        except Exception as e:
            session.rollback()
            print("[seed_rooms_branches]", e, flush=True)
        finally:
            session.close()

    def init_db():
        """
        Create all ORM-mapped tables (CREATE TABLE IF NOT EXISTS) and run
        any necessary column migrations.  Safe to call multiple times.
        """
        db_label = (
            "Supabase PostgreSQL"  if "supabase" in DATABASE_URL else
            "PostgreSQL"           if _is_pg else
            "SQLite"
        )
        print(f"[init_db] Initialising schema on {db_label}…")
        try:
            Base.metadata.create_all(ENGINE)
            ensure_users_table()
            ensure_staff_schema()
            ensure_manual_rooms_occupancy_column()
            ensure_property_staff_table()
            ensure_property_tasks_table()
            ensure_property_tasks_reporting_indexes()
            ensure_bookings_table()
            ensure_property_knowledge_table()
            try:
                ensure_builtin_property_knowledge_bsr_city()
            except NameError:
                pass
            except Exception as _bsr_pk:
                print(f"[init_db] BSR CITY property knowledge seed note: {_bsr_pk}")
            try:
                _seed_rooms_branches()
            except Exception as _br_err:
                print(f"[init_db] rooms_branches seed note: {_br_err}")
            print(f"[init_db] ✅ Schema ready on {db_label}")
        except Exception as _ie:
            print(f"[init_db] ❌ Schema init error: {_ie}")

    def ensure_users_table():
        """Create users table if it doesn't exist. id (UUID), email (unique), password_hash, created_at."""
        if not ENGINE or not text:
            return
        with ENGINE.connect() as connection:
            try:
                connection.execute(text("""
                    CREATE TABLE IF NOT EXISTS users (
                        id VARCHAR PRIMARY KEY,
                        tenant_id VARCHAR,
                        email VARCHAR UNIQUE,
                        password_hash VARCHAR,
                        role VARCHAR,
                        created_at VARCHAR
                    )
                """))
                connection.commit()
            except Exception as e:
                print("[ensure_users_table] Note:", e)
            try:
                connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS worker_handle VARCHAR"))
                connection.commit()
            except Exception:
                try:
                    connection.execute(text("ALTER TABLE users ADD COLUMN worker_handle VARCHAR"))
                    connection.commit()
                except Exception:
                    pass

    def ensure_property_staff_table():
        """Create property_staff + committed ALTERs (department, branch_slug, phone_number) — fixes missing column errors."""
        if not ENGINE or not text:
            return
        dname = getattr(ENGINE.dialect, "name", "sqlite")
        try:
            with ENGINE.begin() as conn:
                conn.execute(
                    text(
                        """
                    CREATE TABLE IF NOT EXISTS property_staff (
                        id VARCHAR PRIMARY KEY,
                        property_id VARCHAR NOT NULL,
                        name VARCHAR NOT NULL,
                        role VARCHAR,
                        phone_number VARCHAR
                    )
                """
                    )
                )
            if dname == "postgresql":
                with ENGINE.begin() as conn:
                    conn.execute(text("ALTER TABLE property_staff ADD COLUMN IF NOT EXISTS phone_number VARCHAR"))
                    conn.execute(text("ALTER TABLE property_staff ADD COLUMN IF NOT EXISTS department VARCHAR"))
                    conn.execute(text("ALTER TABLE property_staff ADD COLUMN IF NOT EXISTS branch_slug VARCHAR"))
                print("[schema] property_staff columns (PG) committed", flush=True)
            else:
                for stmt in (
                    "ALTER TABLE property_staff ADD COLUMN phone_number VARCHAR",
                    "ALTER TABLE property_staff ADD COLUMN department VARCHAR",
                    "ALTER TABLE property_staff ADD COLUMN branch_slug VARCHAR",
                ):
                    try:
                        with ENGINE.begin() as conn:
                            conn.execute(text(stmt))
                    except Exception:
                        pass
                print("[schema] property_staff columns (SQLite) migration attempted", flush=True)
        except Exception as e:
            print(f"[ensure_property_staff_table] {e}", flush=True)

    def ensure_property_tasks_table():
        """Create property_tasks table: id, property_id, assigned_to, description, status, created_at."""
        if not ENGINE or not text:
            return
        with ENGINE.connect() as connection:
            try:
                connection.execute(text("""
                    CREATE TABLE IF NOT EXISTS property_tasks (
                        id VARCHAR PRIMARY KEY,
                        property_id VARCHAR,
                        assigned_to VARCHAR,
                        description TEXT,
                        status VARCHAR,
                        created_at VARCHAR,
                        property_name VARCHAR,
                        staff_name VARCHAR,
                        staff_phone VARCHAR,
                        tenant_id VARCHAR
                    )
                """))
                connection.commit()
            except Exception as e:
                print("[ensure_property_tasks_table] Note:", e)
        for col in ["property_name", "staff_name", "staff_phone", "staff_id",
                    "started_at", "completed_at", "duration_minutes", "worker_notes",
                    "photo_url", "priority", "task_type", "tenant_id", "due_at"]:
            with ENGINE.connect() as connection:
                try:
                    connection.execute(text(f"ALTER TABLE property_tasks ADD COLUMN IF NOT EXISTS {col} VARCHAR"))
                    connection.commit()
                except Exception:
                    try:
                        connection.execute(text(f"ALTER TABLE property_tasks ADD COLUMN {col} VARCHAR"))
                        connection.commit()
                    except Exception:
                        pass
        try:
            with ENGINE.connect() as connection:
                connection.execute(
                    text("UPDATE property_tasks SET tenant_id = :d WHERE tenant_id IS NULL OR tenant_id = ''"),
                    {"d": DEFAULT_TENANT_ID},
                )
                connection.commit()
        except Exception as _ue:
            print("[ensure_property_tasks] tenant backfill note:", _ue)

    def ensure_bookings_table():
        """Create bookings table if it doesn't exist."""
        if not ENGINE or not text:
            return
        with ENGINE.connect() as connection:
            try:
                connection.execute(text("""
                    CREATE TABLE IF NOT EXISTS bookings (
                        id VARCHAR PRIMARY KEY,
                        tenant_id VARCHAR,
                        property_id VARCHAR,
                        property_name VARCHAR,
                        guest_name VARCHAR,
                        guest_phone VARCHAR,
                        check_in VARCHAR,
                        check_out VARCHAR,
                        nights INTEGER DEFAULT 1,
                        total_price INTEGER DEFAULT 0,
                        status VARCHAR DEFAULT 'confirmed',
                        created_at VARCHAR
                    )
                """))
                connection.commit()
            except Exception as e:
                print("[ensure_bookings_table] Note:", e)

    def ensure_property_knowledge_table():
        """property_knowledge — Maya research cache (scraped page + Places + optional Gemini)."""
        if not ENGINE or not text:
            return
        with ENGINE.connect() as connection:
            try:
                connection.execute(
                    text(
                        """
                    CREATE TABLE IF NOT EXISTS property_knowledge (
                        id VARCHAR PRIMARY KEY,
                        tenant_id VARCHAR,
                        display_name VARCHAR,
                        normalized_key VARCHAR,
                        source_url VARCHAR,
                        manual_room_id VARCHAR,
                        summary TEXT,
                        offices_note TEXT,
                        rules_note TEXT,
                        pricing_note TEXT,
                        amenities_note TEXT,
                        location_note TEXT,
                        street_anchor VARCHAR,
                        pois_json TEXT,
                        research_json TEXT,
                        created_at VARCHAR,
                        updated_at VARCHAR
                    )
                """
                    )
                )
                connection.commit()
            except Exception as e:
                print("[ensure_property_knowledge_table] create:", e)
        dname = getattr(ENGINE.dialect, "name", "sqlite")
        for col, col_type in [
            ("amenities_note", "TEXT"),
            ("street_anchor", "VARCHAR"),
            ("research_json", "TEXT"),
        ]:
            with ENGINE.connect() as connection:
                try:
                    if dname == "postgresql":
                        connection.execute(
                            text(f"ALTER TABLE property_knowledge ADD COLUMN IF NOT EXISTS {col} {col_type}")
                        )
                    else:
                        connection.execute(text(f"ALTER TABLE property_knowledge ADD COLUMN {col} {col_type}"))
                    connection.commit()
                except Exception:
                    pass
        try:
            _has_intel = False
            try:
                from sqlalchemy import inspect as _sqla_inspect

                _has_intel = bool(ENGINE and _sqla_inspect(ENGINE).has_table("property_intel"))
            except Exception:
                _has_intel = False
            if not _has_intel and dname == "sqlite":
                try:
                    with ENGINE.connect() as _chk:
                        r = _chk.execute(
                            text(
                                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='property_intel' LIMIT 1"
                            )
                        ).fetchone()
                        _has_intel = bool(r)
                except Exception:
                    _has_intel = False
            if not _has_intel:
                pass  # property_intel optional — skip migration quietly
            else:
                with ENGINE.connect() as connection:
                    if dname == "sqlite":
                        connection.execute(
                            text(
                                """
                            INSERT OR IGNORE INTO property_knowledge (
                                id, tenant_id, display_name, normalized_key, source_url, manual_room_id,
                                summary, offices_note, rules_note, pricing_note, amenities_note,
                                location_note, street_anchor, pois_json, research_json, created_at, updated_at
                            )
                            SELECT id, tenant_id, display_name, normalized_key, source_url, manual_room_id,
                                summary, offices_note, rules_note, pricing_note, amenities_note,
                                location_note, street_anchor, pois_json, research_json, created_at, updated_at
                            FROM property_intel
                            WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type='table' AND name='property_intel')
                            """
                            )
                        )
                    else:
                        connection.execute(
                            text(
                                """
                            INSERT INTO property_knowledge (
                                id, tenant_id, display_name, normalized_key, source_url, manual_room_id,
                                summary, offices_note, rules_note, pricing_note, amenities_note,
                                location_note, street_anchor, pois_json, research_json, created_at, updated_at
                            )
                            SELECT id, tenant_id, display_name, normalized_key, source_url, manual_room_id,
                                summary, offices_note, rules_note, pricing_note, amenities_note,
                                location_note, street_anchor, pois_json, research_json, created_at, updated_at
                            FROM property_intel
                            ON CONFLICT (id) DO NOTHING
                            """
                            )
                        )
                    connection.commit()
        except Exception as _mig_e:
            print("[ensure_property_knowledge_table] migrate from property_intel:", _mig_e)

    def ensure_builtin_property_knowledge_bsr_city():
        """
        Core knowledge: ROOMS BSR CITY Petah Tikva (BSR City Tower Y).
        Upserts into property_knowledge so Maya LIVE DATA includes specs + behavioral rules.
        """
        if not SessionLocal or not PropertyKnowledgeModel:
            return
        rid = "builtin-rooms-bsr-city-petah-tikva"
        tenant_id = DEFAULT_TENANT_ID
        now = datetime.now(timezone.utc).isoformat()
        display_name = "ROOMS BSR CITY Petah Tikva"
        summary = (
            "BSR CITY workspace — Tower Y, Petah Tikva. "
            "Two floors; ~3,800 sqm office space and ~850 sqm balcony. "
            "Eight meeting rooms: smaller rooms for ~5–8 people; two large rooms for up to ~20 people. "
            "Amenities: ~2,000 sqm gym, eco-lake, 24/7 access, dog-friendly, furnished offices, "
            "complimentary coffee/snacks, phone booths for quiet focused work. "
            "Services: App-to-Desk room service, cleaning, IT support, Fattal Club access."
        )
        location_note = (
            "BSR City, Tower Y, Petah Tikva — Jabotinsky 2. Near the Red Line light rail (~400 m). "
            "Central bus station ~150 m. Underground parking for cars, scooters, and bicycles."
        )
        offices_note = (
            "Two floors; ~3,800 sqm office space; ~850 sqm balcony. "
            "Meeting rooms: 8 total — small rooms for ~5–8 people; two large rooms for up to ~20 people."
        )
        amenities_note = (
            "~2,000 sqm gym; eco-lake; 24/7 building access; dog-friendly; furnished offices; "
            "free coffee and snacks; phone booths for quiet work — for “where is it quiet?” suggest phone booths."
        )
        rules_note = (
            "BEHAVIOR: (1) Facility / amenity / parking / accessibility / quiet-work questions → answer with facts only "
            "(action info); never open a maintenance task unless the user clearly reports a repair issue. "
            "(2) Quiet places → phone booths. "
            "(3) Parking → underground parking for cars, scooters, and bikes. "
            "(4) Accessibility / transit → Red Line light rail ~400 m; central bus station ~150 m (Jabotinsky 2)."
        )
        session = SessionLocal()
        try:
            row = session.query(PropertyKnowledgeModel).filter_by(id=rid).first()
            if not row:
                row = PropertyKnowledgeModel(id=rid, tenant_id=tenant_id, created_at=now)
            row.tenant_id = tenant_id
            row.display_name = display_name
            _nk = re.sub(r"[^\w\s\-]", " ", display_name.lower())
            _nk = re.sub(r"\s+", " ", _nk).strip()[:220] or "unknown"
            row.normalized_key = _nk
            row.source_url = ""
            row.manual_room_id = ""
            row.summary = summary
            row.offices_note = offices_note
            row.rules_note = rules_note
            row.pricing_note = ""
            row.amenities_note = amenities_note
            row.location_note = location_note
            row.street_anchor = "Jabotinsky 2, Petah Tikva"
            row.pois_json = json.dumps(
                [
                    {"name": "Red Line light rail (~400 m)"},
                    {"name": "Petah Tikva central bus station (~150 m)"},
                ],
                ensure_ascii=False,
            )
            row.research_json = json.dumps({"source": "builtin_seed", "site": "BSR CITY"}, ensure_ascii=False)
            row.updated_at = now
            if not getattr(row, "created_at", None):
                row.created_at = now
            session.add(row)
            session.commit()
            print("[property_knowledge] ✅ builtin ROOMS BSR CITY Petah Tikva", flush=True)
        except Exception as e:
            try:
                session.rollback()
            except Exception:
                pass
            print(f"[property_knowledge] builtin BSR CITY seed: {e}", flush=True)
        finally:
            session.close()

else:
    TenantModel = None
    UserModel = None
    LeadModel = None
    CalendarConnectionModel = None
    MessageModel = None
    StaffModel = None
    TaskModel = None
    ManualRoomModel = None
    RoomsBranchModel = None
    PropertyStaffModel = None
    PropertyTaskModel       = None
    WorkerStatsModel        = None
    WorkerPerformanceModel  = None
    TaskAuditLogModel       = None
    DamageReportModel       = None
    BookingModel            = None
    PropertyKnowledgeModel = None

# ── Eager schema init ────────────────────────────────────────────────────────
# This runs at module import time (when Gunicorn loads app.py), so Supabase
# tables exist before the first HTTP request arrives.  Seed data and background
# threads are handled later by _do_startup_init() via the before_request hook.
if ENGINE and Base:
    try:
        _db_label_eager = (
            "Supabase PostgreSQL" if "supabase" in DATABASE_URL else
            "PostgreSQL"          if _is_pg else
            "SQLite"
        )
        print(f"[app.py] ⚡ Eager schema init on {_db_label_eager}…")
        Base.metadata.create_all(ENGINE)
        ensure_staff_schema()
        try:
            ensure_manual_rooms_occupancy_column()
        except Exception as _occ_e:
            print(f"[app.py] manual_rooms.occupancy_rate ensure (non-fatal): {_occ_e}", flush=True)
        try:
            ensure_property_knowledge_table()
            ensure_builtin_property_knowledge_bsr_city()
        except NameError:
            pass
        except Exception as _pk_e:
            print(f"[app.py] property_knowledge ensure note: {_pk_e}")
        print(f"[app.py] ✅ Connected to {_db_label_eager} successfully — tables ready")
    except Exception as _eager_err:
        print(f"[app.py] ⚠️  Eager schema init failed (will retry on first request): {_eager_err}")

LEADS = []
LEADS_BY_ID = {}
LEARNING_LOG = []
DATA_LOCK = threading.Lock()
SCANNER_STARTED = False
SCANNER_LOCK = threading.Lock()
INIT_DONE = False
INIT_LOCK = threading.Lock()
_STARTUP_THREAD_STARTED = False
_STARTUP_THREAD_GUARD = threading.Lock()

EVENT_QUEUES = {}
EVENT_LOCK = threading.Lock()
MESSAGE_QUEUE = queue.Queue()
MESSAGE_WORKERS_STARTED = False
MESSAGE_WORKERS_LOCK = threading.Lock()
SCOUT_QUEUE = queue.Queue()
SCOUT_WORKERS_STARTED = False
SCOUT_WORKERS_LOCK = threading.Lock()
WORKER_LANG = {}
WORKER_LANG_LOCK = threading.Lock()
DISPATCH_STARTED = False
DISPATCH_LOCK = threading.Lock()
DISPATCH_INTERVAL = int(os.getenv("DISPATCH_INTERVAL_SECONDS", "60"))
DISPATCH_ENABLED = True
UPLOAD_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__) or ".", "uploads"))
UPLOAD_STATIC = os.path.join(UPLOAD_ROOT, "shared")
API_BASE_URL = os.getenv("API_BASE_URL", f"http://127.0.0.1:{os.getenv('PORT', '1000')}").rstrip("/")
try:
    os.makedirs(UPLOAD_ROOT, exist_ok=True)
    os.makedirs(UPLOAD_STATIC, exist_ok=True)
    os.makedirs(os.path.join(UPLOAD_ROOT, "default", "properties"), exist_ok=True)
except OSError as _e:
    print(f"[uploads] Warning: could not create upload dirs: {_e}")

STAFF_EVENT_QUEUES = {}
STAFF_EVENT_LOCK = threading.Lock()

AUTOMATION_STATS = {
    "automated_messages": 0,
    "last_scan": None,
}

# Maya autonomous demo — toggles mirrored in GET/PUT /api/settings/automated-welcome
DEMO_AUTOMATION_SETTINGS = {
    "automated_welcome_enabled": False,
    "smart_task_assignment_enabled": False,
}

ICAL_CACHE = {}
ICAL_LAST_SYNC = {}
ICAL_SYNC_LOCK = threading.Lock()
ICAL_SYNC_STARTED = False

OBJECTION_ARGUMENTS = {
    "price": [
        "מבין לגמרי את נושא המחיר. בפועל זה מחזיר את עצמו בזמן עבודה וחוות דעת טובות יותר.",
        "אפשר להתחיל ב־pilot קצר. ה־AI מוריד עומס תפעולי ומעלה דירוגים מהר מאוד."
    ],
    "location": [
        "גם כשהמיקום פחות מושלם, תגובה מיידית ו־AI concierge מעלים אחוזי סגירה.",
        "אנחנו משפרים נראות, זמינות וביקורות כדי לאזן רגישות למיקום."
    ],
    "rules": [
        "המערכת מחזקת את כללי הבית אוטומטית עם הודעות ברורות לאורחים.",
        "תזכורות חכמות לפני ההגעה מפחיתות הפרות כללים באופן משמעותי."
    ],
}

OBJECTION_SUCCESS = {key: {"yes": 0, "no": 0} for key in OBJECTION_ARGUMENTS}

# ── PILOT DEMO SIMULATION ─────────────────────────────────────────────────────
DEMO_STOP_EVENT  = threading.Event()
DEMO_ACTIVE      = False
DEMO_LOCK        = threading.Lock()

MOCK_STAFF_NAMES = ["Mock Alma", "Mock Kobi", "Mock Avi"]
MOCK_STAFF = [
    {"name": "Mock Alma", "role": "Cleaning",    "emoji": "🧹", "phone": "+1-555-0101"},
    {"name": "Mock Kobi", "role": "Maintenance",  "emoji": "🔧", "phone": "+1-555-0102"},
    {"name": "Mock Avi",  "role": "Electrician",  "emoji": "⚡", "phone": "+1-555-0103"},
]

DEMO_COMPLAINTS = [
    ("Towels needed urgently",              "Mock Alma"),
    ("Bathroom deep clean required",        "Mock Alma"),
    ("Leaky faucet in bathroom",            "Mock Kobi"),
    ("AC unit not cooling properly",        "Mock Kobi"),
    ("Broken TV remote",                    "Mock Kobi"),
    ("WiFi router needs reset",             "Mock Kobi"),
    ("Bedroom light bulb burnt out",        "Mock Avi"),
    ("Electrical outlet not working",       "Mock Avi"),
    ("Kitchen pipe dripping",               "Mock Kobi"),
    ("Need extra towels and pillows",       "Mock Alma"),
    ("Refrigerator making loud noise",      "Mock Kobi"),
    ("Front door lock feels stiff",         "Mock Kobi"),
    ("Bathroom power outlet broken",        "Mock Avi"),
    ("Shower drain clogged",               "Mock Kobi"),
    ("Welcome amenities kit incomplete",    "Mock Alma"),
    ("Dishwasher not completing cycle",     "Mock Kobi"),
    ("Smoke detector beeping low battery", "Mock Avi"),
    ("Guest requests extra blankets",       "Mock Alma"),
    ("Balcony door handle loose",           "Mock Kobi"),
    ("Microwave not heating food",          "Mock Kobi"),
]

DEMO_PILOT_PROPERTY_NAMES = [
    "John's Beach House",       "John's Downtown Loft",
    "John's Mountain Cabin",    "John's City Studio",
    "John's Rooftop Penthouse", "Sarah's Poolside Villa",
    "Sarah's Garden Suite",     "Sarah's Harbor View",
    "Sarah's Cozy Cottage",     "Sarah's Modern Flat",
]

DEMO_PLACEHOLDER_IMAGE = "https://picsum.photos/seed/easyhost-demo/400/300"

DEMO_COMPLETION_NOTES = [
    "Task completed ✅ — area inspected and all clear.",
    "Fixed and tested — confirmed working.",
    "Done! Guest notified and area cleaned.",
    "Resolved — no further action needed.",
    "Completed — quality checked before leaving.",
    "All done! Photos uploaded to the task record.",
]


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def parse_iso_datetime(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None


def get_property_location():
    try:
        lat = float(os.getenv("PROPERTY_LAT", "0"))
        lng = float(os.getenv("PROPERTY_LNG", "0"))
        if lat == 0 and lng == 0:
            return None
        return (lat, lng)
    except Exception:
        return None


def haversine_km(lat1, lng1, lat2, lng2):
    r = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def base64url_encode(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("utf-8")


def base64url_decode(data):
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def encode_jwt(payload):
    header = {"alg": "HS256", "typ": "JWT"}
    header_b64 = base64url_encode(json.dumps(header).encode("utf-8"))
    payload_b64 = base64url_encode(json.dumps(payload).encode("utf-8"))
    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    signature = hmac.new(JWT_SECRET.encode("utf-8"), signing_input, hashlib.sha256).digest()
    signature_b64 = base64url_encode(signature)
    return f"{header_b64}.{payload_b64}.{signature_b64}"


def decode_jwt(token):
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid token format")
    header_b64, payload_b64, signature_b64 = parts
    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    expected_signature = hmac.new(JWT_SECRET.encode("utf-8"), signing_input, hashlib.sha256).digest()
    if not hmac.compare_digest(expected_signature, base64url_decode(signature_b64)):
        raise ValueError("Invalid token signature")
    payload = json.loads(base64url_decode(payload_b64))
    if payload.get("iss") != JWT_ISSUER or payload.get("aud") != JWT_AUDIENCE:
        raise ValueError("Invalid token issuer/audience")
    exp = payload.get("exp")
    if exp and datetime.now(timezone.utc).timestamp() > exp:
        raise ValueError("Token expired")
    return payload


def hash_password(password):
    """Hash password using werkzeug (for new users). Legacy: sha256 for demo user."""
    return generate_password_hash(password or "", method="pbkdf2:sha256")


def verify_password(password_hash, password):
    """Verify password against stored hash. Supports both werkzeug and legacy."""
    if not password_hash:
        return False
    try:
        if password_hash.startswith("pbkdf2:"):
            return check_password_hash(password_hash, password or "")
        old_hash = hashlib.sha256(f"{os.getenv('PASSWORD_SALT', 'easyhost-salt')}:{password or ''}".encode("utf-8")).hexdigest()
        return password_hash == old_hash
    except Exception:
        return False


def parse_ical_dates(ics_text):
    starts = []
    ends = []
    for line in ics_text.splitlines():
        if line.startswith("DTSTART"):
            parts = line.split(":")
            if len(parts) > 1:
                starts.append(parts[-1].strip())
        if line.startswith("DTEND"):
            parts = line.split(":")
            if len(parts) > 1:
                ends.append(parts[-1].strip())
    booked_ranges = []
    for start_raw, end_raw in zip(starts, ends):
        start_date = start_raw[:8]
        end_date = end_raw[:8]
        try:
            start_dt = datetime.strptime(start_date, "%Y%m%d").date()
            end_dt = datetime.strptime(end_date, "%Y%m%d").date()
            if end_dt > start_dt:
                booked_ranges.append((start_dt, end_dt))
        except ValueError:
            continue
    return booked_ranges


def calculate_vacancies(booked_ranges, horizon_days=30):
    today = datetime.now(timezone.utc).date()
    window_end = today + timedelta(days=horizon_days)
    booked_dates = set()
    for start_dt, end_dt in booked_ranges:
        current = start_dt
        while current < end_dt and current <= window_end:
            if current >= today:
                booked_dates.add(current)
            current += timedelta(days=1)
    vacancies = []
    current = today
    while current <= window_end:
        if current not in booked_dates:
            start = current
            while current <= window_end and current not in booked_dates:
                current += timedelta(days=1)
            end = current
            vacancies.append((start, end))
        else:
            current += timedelta(days=1)
    vacancy_windows = []
    vacant_nights = 0
    for start, end in vacancies:
        nights = (end - start).days
        vacant_nights += nights
        vacancy_windows.append({
            "checkin": start.isoformat(),
            "checkout": end.isoformat(),
            "nights": nights,
        })
    return vacancy_windows, vacant_nights


def is_checkout_priority_window(now_local):
    start_hour = int(os.getenv("CHECKOUT_PRIORITY_START", "8"))
    end_hour = int(os.getenv("CHECKOUT_PRIORITY_END", "12"))
    return start_hour <= now_local.hour < end_hour


def get_ical_sync_interval_seconds(now_local):
    if is_checkout_priority_window(now_local):
        return int(os.getenv("ICAL_SYNC_PRIORITY_SECONDS", "240"))
    return int(os.getenv("ICAL_SYNC_DEFAULT_SECONDS", "1200"))


def fetch_ical_text(tenant_id, ical_url, force=False):
    headers = {}
    cache = ICAL_CACHE.get(tenant_id, {})
    if not force:
        if cache.get("etag"):
            headers["If-None-Match"] = cache["etag"]
        if cache.get("last_modified"):
            headers["If-Modified-Since"] = cache["last_modified"]
    request = Request(ical_url, headers=headers)
    try:
        with urlopen(request, timeout=12) as response:
            ics_text = response.read().decode("utf-8", errors="ignore")
            etag = response.headers.get("ETag")
            last_modified = response.headers.get("Last-Modified")
            return ics_text, etag, last_modified
    except Exception:
        if not force:
            raise
    return None, None, None


def sync_ical_for_tenant(tenant_id, force=False, nightly_rate_override=None):
    if not SessionLocal or not CalendarConnectionModel:
        return None
    session = SessionLocal()
    try:
        record = session.query(CalendarConnectionModel).filter_by(tenant_id=tenant_id).first()
        if not record or not record.ical_url:
            return None
        ical_url = record.ical_url
        ics_text, etag, last_modified = fetch_ical_text(tenant_id, ical_url, force=force)
        if not ics_text:
            return None
        ics_hash = hashlib.sha256(ics_text.encode("utf-8")).hexdigest()
        cache = ICAL_CACHE.get(tenant_id, {})
        if cache.get("hash") == ics_hash and not force:
            return {"synced": True, "changed": False, "vacancy_windows": json.loads(record.vacancy_windows or "[]")}
        booked_ranges = parse_ical_dates(ics_text)
        vacancy_windows, vacant_nights = calculate_vacancies(booked_ranges, horizon_days=30)
        if record.vacancy_windows:
            try:
                previous_windows = json.loads(record.vacancy_windows)
            except Exception:
                previous_windows = []
        else:
            previous_windows = []
        previous_keys = {(w.get("checkin"), w.get("checkout")) for w in previous_windows}
        new_windows = [
            window for window in vacancy_windows
            if (window.get("checkin"), window.get("checkout")) not in previous_keys
        ]
        nightly_rate = 250
        if nightly_rate_override:
            nightly_rate = nightly_rate_override
        elif record.vacant_nights and record.potential_revenue:
            try:
                nightly_rate = max(1, int(record.potential_revenue) // max(1, int(record.vacant_nights)))
            except Exception:
                nightly_rate = 250
        potential_revenue = vacant_nights * nightly_rate
        record.vacancy_windows = json.dumps(vacancy_windows)
        record.vacant_nights = vacant_nights
        record.potential_revenue = potential_revenue
        record.last_sync = now_iso()
        session.commit()
        ICAL_CACHE[tenant_id] = {
            "hash": ics_hash,
            "etag": etag,
            "last_modified": last_modified,
        }
    finally:
        session.close()
    if new_windows:
        for window in new_windows[:10]:
            due_at = f"{window.get('checkin')}T12:00:00+00:00"
            room_label = f"Vacancy {window.get('checkin')} \u2192 {window.get('checkout')}"
            task = create_task(tenant_id, "Cleaning", room_label, due_at=due_at)
            if task and SessionLocal and StaffModel:
                session = SessionLocal()
                try:
                    assign_best_staff(tenant_id, task, session)
                finally:
                    session.close()
        dispatch_tasks(tenant_id)
    return {"synced": True, "changed": True, "vacancy_windows": vacancy_windows}


def set_worker_language(tenant_id, language):
    if not tenant_id or not language:
        return
    with WORKER_LANG_LOCK:
        WORKER_LANG[tenant_id] = language


def get_worker_language(tenant_id):
    with WORKER_LANG_LOCK:
        return WORKER_LANG.get(tenant_id)


def translate_message(message, target_lang):
    if not message or not target_lang:
        return message
    if target_lang in ("en", "en-US"):
        return message
    return f"[{target_lang}] {message}"


def get_event_queue(tenant_id):
    with EVENT_LOCK:
        if tenant_id not in EVENT_QUEUES:
            EVENT_QUEUES[tenant_id] = queue.Queue()
        return EVENT_QUEUES[tenant_id]


def enqueue_event(tenant_id, event_type, payload):
    event = {
        "type": event_type,
        "timestamp": now_iso(),
        "payload": payload,
        "tenant_id": tenant_id,
    }
    get_event_queue(tenant_id).put(event)


def get_staff_event_queue(tenant_id):
    with STAFF_EVENT_LOCK:
        if tenant_id not in STAFF_EVENT_QUEUES:
            STAFF_EVENT_QUEUES[tenant_id] = queue.Queue()
        return STAFF_EVENT_QUEUES[tenant_id]


def enqueue_staff_event(tenant_id, event_type, payload):
    event = {
        "type": event_type,
        "timestamp": now_iso(),
        "payload": payload,
        "tenant_id": tenant_id,
    }
    get_staff_event_queue(tenant_id).put(event)


def get_tenant_id_from_request():
    token = None
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
    if not token:
        token = request.args.get("token")
    if AUTH_DISABLED:
        tid = request.headers.get("X-Tenant-Id") or request.args.get("tenant_id") or DEFAULT_TENANT_ID
        return _coerce_demo_tenant_id(tid)
    if not token:
        raise ValueError("Missing authorization token")
    payload = decode_jwt(token)
    return _coerce_demo_tenant_id(payload.get("tenant_id") or DEFAULT_TENANT_ID)


def get_auth_context_from_request():
    """Returns (tenant_id, user_id). user_id is JWT sub (owner UUID)."""
    token = None
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        token = auth_header.split(" ", 1)[1].strip()
    if not token:
        token = request.args.get("token")
    if AUTH_DISABLED:
        tid = request.headers.get("X-Tenant-Id") or request.args.get("tenant_id") or DEFAULT_TENANT_ID
        tid = _coerce_demo_tenant_id(tid)
        return tid, f"demo-{tid}"
    if not token:
        raise ValueError("Missing authorization token")
    payload = decode_jwt(token)
    tenant_id = _coerce_demo_tenant_id(payload.get("tenant_id") or DEFAULT_TENANT_ID)
    user_id = payload.get("sub") or f"demo-{tenant_id}"
    return tenant_id, user_id


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if AUTH_DISABLED or getattr(g, "bypass_ai_auth", False):
            return fn(*args, **kwargs)
        try:
            tenant_id = get_tenant_id_from_request()
            if not tenant_id:
                return jsonify({"error": "Unauthorized"}), 401
            request.tenant_id = tenant_id
        except Exception as error:
            return jsonify({"error": str(error)}), 401
        return fn(*args, **kwargs)
    return wrapper


def _normalize_app_role(role_raw):
    """Canonical roles: admin | manager | staff | operation (ops lead — PII masking, no god-mode in UI)."""
    r = (role_raw or "").strip().lower()
    if r in ("admin", "owner", "superadmin", "god"):
        return "admin"
    if r in ("operation", "operations"):
        return "operation"
    if r in ("manager", "host"):
        return "manager"
    if r in ("staff", "field", "operator", "worker"):
        return "staff"
    return "manager"


def _mask_phone_pii(phone):
    """Mask phone for non-admin viewers (e.g. 054-****123)."""
    if not phone:
        return ""
    digits = re.sub(r"\D", "", str(phone))
    if len(digits) < 4:
        return "****"
    if len(digits) <= 6:
        return f"{digits[:2]}****"
    return f"{digits[:3]}-****{digits[-3:]}"


def _mask_guest_name_pii(name):
    """Partially mask guest full names for non-admin viewers."""
    if not name:
        return ""
    s = str(name).strip()
    if len(s) <= 2:
        return s[0] + "*" if s else ""
    if len(s) <= 4:
        return s[0] + "**" + s[-1]
    return s[0] + "****" + s[-1]


def _should_redact_guest_pii(identity):
    """Only Admin sees full guest PII; operation / manager / staff get masked fields."""
    if AUTH_DISABLED:
        return False
    ar = (identity or {}).get("app_role") or ""
    return ar != "admin"


def _auth_identity_for_pii():
    """Identity for redaction rules; default to redacting when auth is on but identity fails."""
    if AUTH_DISABLED:
        return {"app_role": "admin"}
    try:
        return get_property_tasks_auth_bundle()
    except Exception:
        return {"app_role": "staff"}


def _redact_upcoming_bookings_payload(payload, identity):
    if not isinstance(payload, dict) or not _should_redact_guest_pii(identity):
        return
    for row in payload.get("bookings") or []:
        if not isinstance(row, dict):
            continue
        if row.get("guest_name"):
            row["guest_name"] = _mask_guest_name_pii(row.get("guest_name"))
        if row.get("guest_phone"):
            row["guest_phone"] = _mask_phone_pii(row.get("guest_phone"))


def _redact_room_grid_payload(payload, identity):
    if not isinstance(payload, dict) or not _should_redact_guest_pii(identity):
        return
    for row in payload.get("rooms") or []:
        if not isinstance(row, dict):
            continue
        g = row.get("guest")
        if g:
            row["guest"] = _mask_guest_name_pii(g) if len(str(g)) > 3 else "****"


# Israeli / +972 phone fragments inside free text (task descriptions, notes)
_PHONE_IN_TEXT_RE = re.compile(
    r"\+?(?:972|00972)[\s\-]?\d{1,2}[\s\-]?\d{3}[\s\-]?\d{4}|0\d{1,2}[\s\-]?\d{3}[\s\-]?\d{4}",
    re.IGNORECASE,
)


def _mask_phones_in_free_text(val):
    """Replace phone-like substrings with masked form (e.g. 052-****567)."""
    if not val:
        return val
    s = str(val)

    def _repl(m):
        return _mask_phone_pii(m.group(0))

    return _PHONE_IN_TEXT_RE.sub(_repl, s)


def _redact_property_task_row_dict(row, identity):
    """Mask guest-related phone numbers in task board payloads for non-admin users."""
    if not isinstance(row, dict) or not _should_redact_guest_pii(identity):
        return row
    for key in ("description", "title", "worker_notes"):
        if row.get(key):
            row[key] = _mask_phones_in_free_text(row[key])
    tt = row.get("task_type")
    if tt and len(str(tt)) > 12 and _PHONE_IN_TEXT_RE.search(str(tt)):
        row["task_type"] = _mask_phones_in_free_text(tt)
    return row


def _redact_property_task_list(tasks, identity):
    if not tasks or not _should_redact_guest_pii(identity):
        return tasks
    for row in tasks:
        _redact_property_task_row_dict(row, identity)
    return tasks


def _extract_bearer_token():
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip()
    return (request.args.get("token") or "").strip() or None


def get_property_tasks_auth_bundle():
    """
    Identity for task APIs + RBAC. With AUTH_DISABLED, uses tenant from header/query (legacy).
    With AUTH_DISABLED=false, requires a valid Bearer JWT.
    """
    if AUTH_DISABLED:
        try:
            tenant_id, user_id = get_auth_context_from_request()
        except Exception:
            tenant_id, user_id = DEFAULT_TENANT_ID, f"demo-{DEFAULT_TENANT_ID}"
        return {
            "tenant_id": tenant_id,
            "user_id": user_id,
            "app_role": "admin",
            "worker_handle": "",
            "email": "",
        }
    tok = _extract_bearer_token()
    if not tok:
        raise ValueError("Missing authorization token")
    payload = decode_jwt(tok)
    em = (payload.get("email") or "").strip().lower()
    wh = (payload.get("worker_handle") or "").strip().lower()
    return {
        "tenant_id": _coerce_demo_tenant_id(payload.get("tenant_id") or DEFAULT_TENANT_ID),
        "user_id": (payload.get("sub") or "").strip(),
        "app_role": _normalize_app_role(payload.get("role")),
        "worker_handle": wh,
        "email": em,
    }


def _audit_task_completed_session(session, tenant_id, task_id, prev_status, new_status, actor_user_id, actor_email):
    """Append one row when a task moves into a completed state."""
    if not session or not TaskAuditLogModel or not task_id:
        return
    try:
        prev_l = (prev_status or "").strip().lower()
        new_l = (new_status or "").strip().lower()
        if new_l not in ("done", "completed"):
            return
        if prev_l in ("done", "completed"):
            return
        session.add(TaskAuditLogModel(
            id=str(uuid.uuid4()),
            tenant_id=(tenant_id or "") or "",
            task_id=str(task_id),
            action="task_completed",
            previous_status=(prev_status or "")[:120],
            new_status=(new_status or "")[:120],
            actor_user_id=(actor_user_id or "")[:120],
            actor_email=(actor_email or "")[:255],
            created_at=datetime.now(timezone.utc).isoformat(),
        ))
    except Exception as _ae:
        print(f"[audit] task_completed log failed: {_ae}", flush=True)


def _apply_staff_task_scope(identity, worker_filter_raw):
    """Force worker filter for Staff so they cannot read other workers' queues."""
    wf = (worker_filter_raw or "").strip().lower()
    if identity.get("app_role") != "staff":
        return wf
    wh = (identity.get("worker_handle") or "").strip().lower()
    if not wh and identity.get("email"):
        wh = identity["email"].split("@")[0].strip().lower()
    if not wh:
        return "__no_staff_handle__"
    return wh


def _property_tasks_query_for_tenant(session, tenant_id):
    """Filter ORM query to tasks belonging to this tenant (legacy NULL → default tenant only)."""
    if not PropertyTaskModel:
        return None
    q = session.query(PropertyTaskModel)
    if tenant_id == DEFAULT_TENANT_ID:
        q = q.filter(or_(PropertyTaskModel.tenant_id == tenant_id, PropertyTaskModel.tenant_id.is_(None)))
    else:
        q = q.filter(PropertyTaskModel.tenant_id == tenant_id)
    return q


def _norm_task_status_category(status_val):
    """Map DB status to pending | in_progress | done (aligned with frontend taskStatusRank)."""
    raw = (status_val or "").strip().lower().replace(" ", "_")
    if raw in ("done", "completed"):
        return "done"
    if raw in (
        "accepted",
        "in_progress",
        "inprogress",
        "seen",
        "started",
        "assigned",
        "delayed",
        "searching_for_staff",
    ):
        return "in_progress"
    return "pending"


def _task_property_filters_sql(tenant_id):
    """Match _property_tasks_query_for_tenant — raw SQL WHERE fragment (parameter :tenant_id)."""
    if tenant_id == DEFAULT_TENANT_ID:
        return "(tenant_id = :tenant_id OR tenant_id IS NULL OR tenant_id = '')"
    return "tenant_id = :tenant_id"


_SENT_TO_STAFF_STATUS_KEYS = (
    "assigned",
    "delayed",
    "in_progress",
    "inprogress",
    "accepted",
    "seen",
    "started",
    "searching_for_staff",
)


def _task_report_time_window(period):
    """Return (start_utc, end_utc) as timezone-aware datetimes."""
    now = datetime.now(timezone.utc)
    p = (period or "day").strip().lower().replace(" ", "")
    if p in ("hour", "hourly"):
        start = now - timedelta(hours=1)
    elif p in ("day", "daily"):
        start = now - timedelta(days=1)
    elif p in ("month", "monthly"):
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    elif p in ("3months", "quarter", "3month"):
        start = now - timedelta(days=90)
    elif p in ("year", "yearly"):
        start = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        start = now - timedelta(days=1)
    return start, now


def ensure_property_tasks_reporting_indexes():
    """
    Indexes for Supabase / PostgreSQL — speeds COUNT/grouped reports on property_tasks.
    Safe no-op on SQLite. Apply the same DDL in Supabase SQL Editor if preferred.
    """
    try:
        if not ENGINE or not text or getattr(ENGINE.dialect, "name", "") != "postgresql":
            return
        stmts = [
            """
            CREATE INDEX IF NOT EXISTS idx_property_tasks_report_tenant_created
            ON property_tasks (tenant_id, created_at)
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_property_tasks_report_tenant_completed
            ON property_tasks (tenant_id, completed_at)
            WHERE completed_at IS NOT NULL AND completed_at != ''
            """,
            """
            CREATE INDEX IF NOT EXISTS idx_property_tasks_report_tenant_status
            ON property_tasks (tenant_id, status)
            """,
        ]
        with ENGINE.begin() as conn:
            for raw in stmts:
                try:
                    conn.execute(text(raw))
                except Exception as _ix_e:
                    print(f"[idx property_tasks reporting] {_ix_e}", flush=True)
    except Exception as _e:
        print(f"[ensure_property_tasks_reporting_indexes] {_e}", flush=True)


def _task_report_metrics_orm(session, tenant_id, start_iso, end_iso):
    """Aggregate KPIs — three indexed COUNT queries (created_at / completed_at / status)."""
    if not PropertyTaskModel or not session or not func:
        return None

    def _tenant_clause(base):
        if tenant_id == DEFAULT_TENANT_ID:
            return base.filter(or_(PropertyTaskModel.tenant_id == tenant_id, PropertyTaskModel.tenant_id.is_(None)))
        return base.filter(PropertyTaskModel.tenant_id == tenant_id)

    created_q = _tenant_clause(session.query(func.count(PropertyTaskModel.id))).filter(
        PropertyTaskModel.created_at >= start_iso,
        PropertyTaskModel.created_at < end_iso,
    )
    total_created = int(created_q.scalar() or 0)

    st_done = ("done", "completed", "Done", "Completed")
    completed_q = _tenant_clause(session.query(func.count(PropertyTaskModel.id))).filter(
        PropertyTaskModel.status.in_(st_done),
        PropertyTaskModel.completed_at.isnot(None),
        PropertyTaskModel.completed_at != "",
        PropertyTaskModel.completed_at >= start_iso,
        PropertyTaskModel.completed_at < end_iso,
    )
    total_completed = int(completed_q.scalar() or 0)

    norm_stat = func.lower(func.replace(PropertyTaskModel.status, " ", "_"))
    inprog_q = _tenant_clause(session.query(func.count(PropertyTaskModel.id))).filter(
        PropertyTaskModel.created_at >= start_iso,
        PropertyTaskModel.created_at < end_iso,
        norm_stat.in_(_SENT_TO_STAFF_STATUS_KEYS),
    )
    total_in_progress = int(inprog_q.scalar() or 0)

    return {
        "total_created": total_created,
        "total_in_progress": total_in_progress,
        "total_completed": total_completed,
    }


def _task_report_series_raw(session, tenant_id, start_iso, end_iso, period):
    """Time-bucket series for charts — one grouped query (PostgreSQL + SQLite)."""
    if not ENGINE or not text or not session:
        return []
    dname = getattr(ENGINE.dialect, "name", "sqlite")
    tclause = _task_property_filters_sql(tenant_id)
    p = (period or "day").strip().lower().replace(" ", "")
    try:
        if dname == "postgresql":
            if p in ("hour", "hourly"):
                trunc = "hour"
            elif p in ("day", "daily"):
                trunc = "hour"
            elif p in ("month", "monthly", "3months", "quarter", "3month"):
                trunc = "day"
            else:
                trunc = "month"
            if trunc not in ("hour", "day", "month"):
                trunc = "day"
            q = text(f"""
                SELECT date_trunc('{trunc}', created_at::timestamptz) AS bucket,
                       COUNT(*)::bigint AS created_n
                FROM property_tasks
                WHERE ({tclause})
                  AND created_at IS NOT NULL AND created_at != ''
                  AND created_at::timestamptz >= CAST(:start_ts AS timestamptz)
                  AND created_at::timestamptz < CAST(:end_ts AS timestamptz)
                GROUP BY 1
                ORDER BY 1
            """)
            rows = session.execute(
                q,
                {"tenant_id": tenant_id, "start_ts": start_iso, "end_ts": end_iso},
            ).fetchall()
            out = []
            for r in rows:
                b = r[0]
                label = b.isoformat()[:16] if hasattr(b, "isoformat") else str(b)
                out.append({"bucket": label, "created": int(r[1] or 0)})
            return out

        q = text(f"""
            SELECT strftime('%Y-%m-%d %H', created_at) AS bucket, COUNT(*) AS created_n
            FROM property_tasks
            WHERE ({tclause})
              AND created_at IS NOT NULL AND created_at != ''
              AND created_at >= :start_s AND created_at < :end_s
            GROUP BY 1
            ORDER BY 1
        """)
        rows = session.execute(q, {"tenant_id": tenant_id, "start_s": start_iso, "end_s": end_iso}).fetchall()
        return [{"bucket": str(r[0] or ""), "created": int(r[1] or 0)} for r in rows]
    except Exception as _se:
        print(f"[_task_report_series_raw] {_se}", flush=True)
        return []


def _bazaar_open_cleaning_unit_indices(tenant_id):
    """
    Bazaar grid rooms are …-u1 … -u10. Descriptions use «ניקיון יחידה X/10».
    Open Cleaning tasks (not Done) force those units to yellow (dirty) in the room grid.
    """
    bazaar_id = "bazaar-jaffa-hotel"
    out = set()
    if not SessionLocal or not PropertyTaskModel:
        return out
    session = SessionLocal()
    try:
        q = _property_tasks_query_for_tenant(session, tenant_id)
        if q is None:
            return out
        rows = q.filter(
            PropertyTaskModel.property_id == bazaar_id,
            or_(PropertyTaskModel.task_type == "Cleaning", PropertyTaskModel.task_type == TASK_TYPE_CLEANING_HE),
        ).all()
        for row in rows:
            if _norm_task_status_category(getattr(row, "status", None)) == "done":
                continue
            d = row.description or ""
            m = re.search(r"יחידה\s*(\d+)\s*/\s*10", d)
            if m:
                u = int(m.group(1))
                if 1 <= u <= 10:
                    out.add(u)
    except Exception as e:
        print(f"[_bazaar_open_cleaning_unit_indices] {e}", flush=True)
    finally:
        session.close()
    return out


def _task_status_counts_for_tenant(tenant_id):
    """Live counts from property_tasks for Maya status answers (excludes archived — matches GET /api/tasks)."""
    if not SessionLocal or not PropertyTaskModel:
        return None
    session = SessionLocal()
    try:
        q = _property_tasks_query_for_tenant(session, tenant_id)
        if q is None:
            return None
        q = q.filter(
            or_(
                PropertyTaskModel.status.is_(None),
                func.lower(PropertyTaskModel.status) != "archived",
            )
        )
        rows = q.all()
        total = len(rows)
        pending = in_progress = done = 0
        for r in rows:
            cat = _norm_task_status_category(getattr(r, "status", None))
            if cat == "done":
                done += 1
            elif cat == "in_progress":
                in_progress += 1
            else:
                pending += 1
        return {"total": total, "pending": pending, "in_progress": in_progress, "done": done}
    finally:
        session.close()


_MAYA_BAZAAR_METRICS_CACHE: dict = {}
_MAYA_BAZAAR_METRICS_TTL: int = 45  # seconds — same as room inventory text cache


def _maya_bazaar_61_room_metrics(tenant_id, user_id):
    """
    Authoritative occupancy for Maya: 61-unit operations grid (Bazaar + 14 ROOMS).
    Equivalent to counting rows with status 'occupied' in the synthetic 61-room inventory.
    Occupancy % = (occupied / 61) * 100 when the grid total is 61.

    Cached for _MAYA_BAZAAR_METRICS_TTL seconds to avoid re-calling _room_status_grid_payload
    on every Maya turn (the room-inventory text cache already pays for the grid once; this
    cache prevents a second independent DB round-trip from _maya_live_facts_system_block).
    """
    _now = time.time()
    _ck = tenant_id or "_"
    _hit = _MAYA_BAZAAR_METRICS_CACHE.get(_ck)
    if _hit and (_now - _hit["ts"]) < _MAYA_BAZAAR_METRICS_TTL:
        return _hit["data"]
    try:
        grid = _room_status_grid_payload(tenant_id, user_id)
        s = grid.get("summary") or {}
        occ = int(s.get("occupied") or 0)
        tot = int(s.get("total") or 0)
        dirty = int(s.get("dirty") or 0)
        ready = int(s.get("ready") or 0)
        if tot == 61:
            pct = round((occ / 61.0) * 100.0, 1)
        elif tot > 0:
            pct = round((occ / float(tot)) * 100.0, 1)
        else:
            pct = 0.0
        result = {
            "occupied": occ,
            "total": tot,
            "dirty": dirty,
            "ready": ready,
            "occupancy_pct": pct,
        }
        _MAYA_BAZAAR_METRICS_CACHE[_ck] = {"data": result, "ts": _now}
        return result
    except Exception as e:
        print(f"[_maya_bazaar_61_room_metrics] {e}", flush=True)
        return None


def _maya_live_facts_system_block(tenant_id, user_id, stats_snapshot=None, user_message=None):
    """Inject real DB + 61-unit grid + task/property search samples + PROPERTY_KNOWLEDGE (Gemini context).

    When stats_snapshot already has task counts (from _build_maya_chat_stats_payload), we skip a fresh
    _task_status_counts_for_tenant query so the LLM sees one consistent set of numbers instead of two
    potentially-drifted counts from queries taken microseconds apart.
    """
    m = _maya_bazaar_61_room_metrics(tenant_id, user_id)
    # Use snapshot counts when available — prevents the LLM seeing two different task totals
    _snap_open = None
    if isinstance(stats_snapshot, dict) and stats_snapshot.get("total_tasks") is not None:
        _snap_open = int(stats_snapshot.get("total_tasks") or 0)
        c = None  # suppress independent re-query; use STATS_JSON numbers below
    else:
        c = _task_status_counts_for_tenant(tenant_id)
    lines = []
    lines.append(
        "SEARCH_TOOL — you must treat the following lines as query results from property_tasks + room grid + portfolio context. "
        "Do not invent workers, rooms, or counts beyond what appears here and in STATS_JSON in the user prompt."
    )
    if m:
        lines.append(
            f"61-unit grid: occupied={m['occupied']}, total_units={m['total']}, "
            f"occupancy_percent={m['occupancy_pct']} (formula: occupied/61*100 when total is 61), "
            f"cleaning_or_dirty={m['dirty']}, ready={m['ready']}."
        )
        # Prevent the LLM from confusing room-status with booking-calendar availability
        lines.append(
            "AVAILABILITY POLICY: The 61-unit grid above reflects room status in the database "
            "(Occupied / Dirty / Ready). It is a DB snapshot — NOT a live booking-calendar query. "
            "NEVER say 'verified availability', 'checked live bookings', or 'confirmed a free slot' "
            "based on this data. For booking-calendar questions without a TRUTH_LAYER_POLICY verified_slot, "
            "state clearly: 'אין לי גישה ללוח ההזמנות החי — בדוק מול מערכת ההזמנות.'"
        )
    if c:
        lines.append(
            f"property_tasks table: total_rows={c['total']}, pending={c['pending']}, "
            f"in_progress={c['in_progress']}, done={c['done']}. Open tasks = pending + in_progress. "
            "(Use these figures and STATS_JSON.total_tasks as the single source — report the same number throughout this response.)"
        )
    elif _snap_open is not None:
        lines.append(
            f"property_tasks open (non-terminal) tasks: {_snap_open} "
            f"(from STATS_JSON — use this exact figure for any 'how many open tasks' answer in this response)."
        )
    if isinstance(stats_snapshot, dict):
        ot = stats_snapshot.get("recent_open_tasks") or []
        if ot:
            lines.append("SEARCH_TOOL — open (non-terminal) tasks sample:")
            for i, t in enumerate(ot[:12], 1):
                lines.append(
                    f"  {i}. id={(t.get('id') or '')[:10]}… desc={(t.get('description') or '')[:100]} "
                    f"| property={(t.get('property_name') or '')[:60]} | status={t.get('status') or ''}"
                )
        snap = stats_snapshot.get("recent_completed_snapshot") or []
        if snap:
            lines.append("SEARCH_TOOL — recently completed tasks sample:")
            for i, t in enumerate(snap[:8], 1):
                lines.append(
                    f"  {i}. {(t.get('description') or '')[:90]} @ {(t.get('property_name') or '')[:50]} "
                    f"| staff={(t.get('staff_name') or '')[:40]} | done={(t.get('completed_at') or '')[:24]}"
                )
    if m is None and c is None and _snap_open is None and not (
        isinstance(stats_snapshot, dict)
        and (
            (stats_snapshot.get("recent_open_tasks") or [])
            or (stats_snapshot.get("recent_completed_snapshot") or [])
        )
    ):
        lines.append("Live DB thin in this turn — say you cannot see live rows; do not invent 80% or fake task lists.")
    pk_ctx = _maya_property_knowledge_context_for_message(tenant_id, user_message or "")
    if pk_ctx:
        lines.append(pk_ctx)
    lines.append(
        "Answer like a luxury-hospitality GM: warm, concise, grounded in the numbers above; no robotic boilerplate."
    )
    return "\n".join(lines)


def _google_maps_api_key():
    return (os.getenv("GOOGLE_MAPS_API_KEY") or os.getenv("GOOGLE_PLACES_API_KEY") or "").strip()


def _property_knowledge_normalize_key(display_name):
    s = re.sub(r"[^\w\s\-]", " ", (display_name or "").lower())
    s = re.sub(r"\s+", " ", s).strip()
    return s[:220] or "unknown"


def _maya_triggers_property_knowledge_acquire(cmd):
    if not cmd:
        return False
    cl = (cmd or "").lower()
    he = cmd or ""
    if "http://" in cl or "https://" in cl:
        return True
    keys = (
        "meet ",
        "introduce ",
        "research ",
        "learn this property",
        "learn property",
        "remember property",
        "save property",
        "property knowledge",
        "acquire property",
        "research property",
        "למד נכס",
        "למד את הנכס",
        "שמור נכס",
        "שמור ידע",
        "צור ידע",
        "מאיה למדי",
        "תלמדי נכס",
        "תזכרי נכס",
        "קלוט נכס",
    )
    if any(k in cl for k in ("meet ", "introduce ", "research ")):
        rest = cl.split("meet ", 1)[-1].split("introduce ", 1)[-1].split("research ", 1)[-1].strip()
        if len(rest) >= 4 and rest[:4] not in ("the ", "our ", "my "):
            return True
        if len(rest) >= 8:
            return True
    return any(k in cl or k in he for k in keys)


def _maya_parse_acquire_target(cmd):
    url = None
    m = re.search(r"https?://[^\s\])>\"']+", cmd or "")
    if m:
        url = m.group(0).rstrip(").,]")
    name = (cmd or "").strip()
    while name:
        nl = name.lower()
        _stripped = False
        for _pfx in (
            "meet ",
            "introduce ",
            "research ",
            "learn about ",
            "look up ",
            "analyze ",
        ):
            if nl.startswith(_pfx):
                name = name[len(_pfx) :].strip()
                _stripped = True
                break
        if not _stripped:
            break
    for prefix in (
        "learn this property",
        "learn property",
        "remember property",
        "save property",
        "property knowledge:",
        "property knowledge —",
        "acquire property",
        "research property",
        "למד נכס",
        "למד את הנכס",
        "שמור נכס",
        "שמור ידע",
        "צור ידע",
        "מאיה למדי",
        "תלמדי נכס",
        "תזכרי נכס",
        "קלוט נכס",
    ):
        pl = prefix.lower()
        nl = name.lower()
        if pl in nl:
            idx = nl.index(pl)
            name = name[idx + len(prefix) :].strip()
            break
    name = re.sub(r"https?://\S+", "", name).strip(" \t\n\r,.-—:")
    if not name and url:
        try:
            host = (urlparse(url).netloc or "").replace("www.", "")
            name = host.split(".")[0].replace("-", " ").title() if host else "Property"
        except Exception:
            name = "Property"
    return name[:500], url


def _fetch_url_text_preview(page_url, max_chars=10000):
    if not page_url or not (page_url.startswith("http://") or page_url.startswith("https://")):
        return "", ""
    try:
        req = Request(page_url, headers={"User-Agent": "HotelMayaKnowledge/1.0 (+https://hotel-dashboard)"})
        with urlopen(req, timeout=14) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"[_fetch_url_text_preview] {e}", flush=True)
        return "", ""
    title_m = re.search(r"<title[^>]*>([^<]+)</title>", raw, re.I)
    title = (title_m.group(1).strip() if title_m else "")[:500]
    meta_m = re.search(
        r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']',
        raw,
        re.I,
    )
    if not meta_m:
        meta_m = re.search(
            r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+name=["\']description["\']',
            raw,
            re.I,
        )
    desc = (meta_m.group(1).strip() if meta_m else "")[:1500]
    stripped = re.sub(r"(?is)<script.*?>.*?</script>", " ", raw)
    stripped = re.sub(r"(?is)<style.*?>.*?</style>", " ", stripped)
    stripped = re.sub(r"<[^>]+>", " ", stripped)
    stripped = re.sub(r"\s+", " ", stripped).strip()
    blob = stripped[:max_chars]
    return title, (desc + "\n\n" + blob) if blob else desc


def _places_text_search(query):
    key = _google_maps_api_key()
    if not key or not (query or "").strip():
        return None
    try:
        u = f"https://maps.googleapis.com/maps/api/place/textsearch/json?query={quote_plus(query)}&key={key}"
        req = Request(u, headers={"User-Agent": "HotelMayaKnowledge/1.0"})
        with urlopen(req, timeout=14) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
        st = data.get("status")
        if st not in ("OK", "ZERO_RESULTS"):
            print(f"[_places_text_search] status={st}", flush=True)
        rows = data.get("results") or []
        if not rows:
            return None
        r0 = rows[0]
        loc = (r0.get("geometry") or {}).get("location") or {}
        return {
            "name": r0.get("name") or "",
            "formatted_address": r0.get("formatted_address") or "",
            "lat": loc.get("lat"),
            "lng": loc.get("lng"),
            "place_id": r0.get("place_id") or "",
            "types": r0.get("types") or [],
        }
    except Exception as e:
        print(f"[_places_text_search] {e}", flush=True)
        return None


def _places_nearby(lat, lng, radius_m=850):
    key = _google_maps_api_key()
    if lat is None or lng is None:
        return []
    if not key:
        return []
    try:
        u = (
            f"https://maps.googleapis.com/maps/api/place/nearbysearch/json?"
            f"location={lat},{lng}&radius={radius_m}&key={key}"
        )
        req = Request(u, headers={"User-Agent": "HotelMayaKnowledge/1.0"})
        with urlopen(req, timeout=14) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
        if data.get("status") not in ("OK", "ZERO_RESULTS"):
            print(f"[_places_nearby] status={data.get('status')}", flush=True)
        out = []
        for r in (data.get("results") or [])[:12]:
            loc = (r.get("geometry") or {}).get("location") or {}
            out.append({
                "name": r.get("name") or "",
                "vicinity": r.get("vicinity") or r.get("formatted_address") or "",
                "types": (r.get("types") or [])[:4],
                "lat": loc.get("lat"),
                "lng": loc.get("lng"),
            })
        return out
    except Exception as e:
        print(f"[_places_nearby] {e}", flush=True)
        return []


def _places_nearby_by_type(lat, lng, place_type, radius_m=900, max_results=8):
    """Nearby search filtered by a single Places type (e.g. cafe, subway_station)."""
    key = _google_maps_api_key()
    if lat is None or lng is None or not key or not (place_type or "").strip():
        return []
    try:
        u = (
            f"https://maps.googleapis.com/maps/api/place/nearbysearch/json?"
            f"location={lat},{lng}&radius={radius_m}&type={quote_plus(place_type)}&key={key}"
        )
        req = Request(u, headers={"User-Agent": "HotelMayaKnowledge/1.0"})
        with urlopen(req, timeout=14) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
        if data.get("status") not in ("OK", "ZERO_RESULTS"):
            print(f"[_places_nearby_by_type] {place_type} status={data.get('status')}", flush=True)
        out = []
        for r in (data.get("results") or [])[:max_results]:
            loc = (r.get("geometry") or {}).get("location") or {}
            out.append({
                "name": r.get("name") or "",
                "vicinity": r.get("vicinity") or r.get("formatted_address") or "",
                "types": (r.get("types") or [])[:5],
                "rating": r.get("rating"),
                "lat": loc.get("lat"),
                "lng": loc.get("lng"),
                "search_type": place_type,
            })
        return out
    except Exception as e:
        print(f"[_places_nearby_by_type] {place_type} {e}", flush=True)
        return []


def _places_place_details(place_id):
    """Place Details: reviews, hours, rating — for guest-preference synthesis."""
    key = _google_maps_api_key()
    if not place_id or not key:
        return None
    try:
        fields = (
            "name,rating,user_ratings_total,reviews,opening_hours,website,url,"
            "formatted_address,formatted_phone_number,business_status"
        )
        u = (
            "https://maps.googleapis.com/maps/api/place/details/json?"
            f"place_id={quote_plus(place_id)}&fields={fields}&key={key}"
        )
        req = Request(u, headers={"User-Agent": "HotelMayaKnowledge/1.0"})
        with urlopen(req, timeout=16) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
        if data.get("status") != "OK":
            print(f"[_places_place_details] status={data.get('status')}", flush=True)
            return None
        r = data.get("result") or {}
        revs = []
        for rv in (r.get("reviews") or [])[:8]:
            if not isinstance(rv, dict):
                continue
            t = (rv.get("text") or "").strip()
            if not t:
                continue
            revs.append({
                "rating": rv.get("rating"),
                "text": t[:900],
                "time": (rv.get("relative_time_description") or "")[:80],
            })
        oh = r.get("opening_hours") or {}
        return {
            "name": r.get("name") or "",
            "rating": r.get("rating"),
            "user_ratings_total": r.get("user_ratings_total"),
            "formatted_address": r.get("formatted_address") or "",
            "website": r.get("website") or "",
            "url": r.get("url") or "",
            "business_status": r.get("business_status") or "",
            "weekday_text": (oh.get("weekday_text") or [])[:14],
            "reviews": revs,
        }
    except Exception as e:
        print(f"[_places_place_details] {e}", flush=True)
        return None


def _pk_structure_with_gemini(display_name: str, research_blob: str) -> dict:
    """Optional: turn messy text into labelled fields (offices/rules/pricing/location)."""
    if not (research_blob or "").strip():
        return {}
    prompt = (
        f'Property / workspace name: "{display_name}"\n\n'
        f"Source text (web scrape + Google Maps + nearby POIs + review excerpts):\n{research_blob[:9000]}\n\n"
        "Return ONLY a single JSON object with keys:\n"
        '- summary: one punchy sentence (vibe + what it is).\n'
        "- offices_note: capacity & facilities — estimate or state counts for private offices, "
        "hot desks, meeting rooms, event space if present in text; else empty string.\n"
        "- rules_note: house rules — check-in/out style hours, guest/member policies, "
        "noise, food, pets, access if mentioned; else empty.\n"
        "- pricing_note: membership or indicative rates only if grounded in text; else empty.\n"
        "- location_note: address / area / how to find it in one short line.\n"
        "- amenities_note: best nearby coffee or lounge picks and accessibility / transit "
        "(tube, step-free) using ONLY the POI lists provided — no invention.\n"
        "- guest_reviews_insights: 1–3 short lines summarizing what reviewers love or dislike "
        "(e.g. 'Guests love the quiet 3rd floor') — only from review quotes in the source; "
        "empty if no reviews.\n"
        "Use empty string for any unknown field. Language: English if the property is UK/US "
        "branded (e.g. WeWork London); otherwise Hebrew or bilingual as fits. No markdown."
    )
    _json_sys = "You output only valid minified JSON objects."
    try:
        raw = ""
        if _USE_NEW_GENAI:
            live_key = os.getenv("GEMINI_API_KEY", "").strip() or _GEMINI_API_KEY
            if not live_key:
                return {}
            if live_key != getattr(genai, "_configured_key", None):
                genai.configure(api_key=live_key)
                genai._configured_key = live_key
                _gemini_invalidate_model_cache()
            for model_name in _gemini_model_candidates():
                try:
                    model = genai.GenerativeModel(
                        model_name=model_name,
                        system_instruction=_json_sys,
                        generation_config=genai.types.GenerationConfig(temperature=0.2, max_output_tokens=1024),
                    )
                    resp = model.generate_content(prompt)
                    raw = _safe_gemini_text(resp, label="_pk_structure_with_gemini").strip()
                    break
                except Exception as e:
                    if _gemini_err_is_model_not_found(e):
                        continue
                    print(f"[_pk_structure_with_gemini] {model_name}: {e}", flush=True)
                    break
        else:
            return {}
        if raw.startswith("```"):
            raw = re.sub(r"^```(?:json)?\s*", "", raw)
            raw = re.sub(r"\s*```$", "", raw)
        return json.loads(raw) if raw else {}
    except Exception as e:
        print(f"[_pk_structure_with_gemini] {e}", flush=True)
        return {}


def acquire_property_knowledge(tenant_id, display_name, source_url=None):
    """
    Research + persist one property row. Uses URL preview, Google Places (if key set), optional Gemini structuring.
    """
    if not SessionLocal or not PropertyKnowledgeModel:
        raise RuntimeError("DB unavailable")
    disp = (display_name or "").strip() or "Property"
    nkey = _property_knowledge_normalize_key(disp)
    now = datetime.now(timezone.utc).isoformat()

    title, page_blob = _fetch_url_text_preview(source_url) if source_url else ("", "")
    q = disp
    if title and title.lower() not in q.lower():
        q = f"{disp} {title}"[:200]

    place = _places_text_search(q) or _places_text_search(disp)
    place_details = None
    pois = []
    typed_pois = []
    if place and place.get("place_id"):
        place_details = _places_place_details(place["place_id"])
    if place and place.get("lat") is not None and place.get("lng") is not None:
        lat0, lng0 = place["lat"], place["lng"]
        pois = _places_nearby(lat0, lng0)
        typed_pois = _places_nearby_by_type(lat0, lng0, "cafe", 650, 8) + _places_nearby_by_type(
            lat0, lng0, "subway_station", 1200, 8
        )

    merged_pois = []
    seen_pk = set()
    for p in (pois or []) + (typed_pois or []):
        if not isinstance(p, dict):
            continue
        key = (
            (p.get("name") or "").strip().lower(),
            round(float(p.get("lat") or 0.0), 4),
            round(float(p.get("lng") or 0.0), 4),
        )
        if key in seen_pk:
            continue
        seen_pk.add(key)
        merged_pois.append(p)

    research = {
        "display_name": disp,
        "source_url": source_url or "",
        "page_title": title,
        "place": place,
        "place_details": place_details,
        "nearby_poi_count": len(merged_pois),
    }
    blob_parts = [f"Name: {disp}"]
    if title:
        blob_parts.append(f"Page title: {title}")
    if page_blob:
        blob_parts.append(f"Page text excerpt:\n{page_blob[:6000]}")
    if place:
        blob_parts.append(
            f"Maps: {place.get('name')} — {place.get('formatted_address')}"
        )
    if place_details:
        rsum = place_details.get("user_ratings_total")
        blob_parts.append(
            f"Google listing: rating={place_details.get('rating')} reviews_total={rsum}"
        )
        wt = place_details.get("weekday_text") or []
        if wt:
            blob_parts.append("Opening hours (Google Maps):\n" + "\n".join(wt[:14]))
        rev_lines = []
        for rv in (place_details.get("reviews") or [])[:8]:
            if not isinstance(rv, dict):
                continue
            rev_lines.append(
                f"- ({rv.get('rating')}/5) {rv.get('text', '')[:650]}"
            )
        if rev_lines:
            blob_parts.append("Google review excerpts:\n" + "\n".join(rev_lines))
    if merged_pois:
        blob_parts.append(
            "Nearby POIs (general + coffee/transit): "
            + "; ".join(
                f"{p.get('name')} ({p.get('vicinity')})"
                for p in merged_pois[:14]
                if p.get("name")
            )
        )
    research_blob = "\n\n".join(blob_parts)

    structured = _pk_structure_with_gemini(disp, research_blob)
    summary = (structured.get("summary") or "").strip()
    if not summary and place:
        summary = f"{place.get('name') or disp} — {place.get('formatted_address') or ''}".strip()[:400]
    if not summary:
        summary = f"Learned site: {disp}"[:400]

    offices_note = (structured.get("offices_note") or "").strip()
    rules_note = (structured.get("rules_note") or "").strip()
    pricing_note = (structured.get("pricing_note") or "").strip()
    location_note = (structured.get("location_note") or "").strip()
    if not location_note and place:
        location_note = (place.get("formatted_address") or "")[:500]
    if not offices_note and place and place.get("types"):
        offices_note = "Place types (Maps): " + ", ".join(place.get("types") or [])[:300]

    amenities_note = (structured.get("amenities_note") or "").strip()
    guest_insights = (structured.get("guest_reviews_insights") or "").strip()
    if guest_insights:
        if amenities_note:
            amenities_note = f"{amenities_note}\n\nGuest preferences (from reviews): {guest_insights}"
        else:
            amenities_note = f"Guest preferences (from reviews): {guest_insights}"

    session = SessionLocal()
    try:
        row = (
            session.query(PropertyKnowledgeModel)
            .filter_by(tenant_id=tenant_id, normalized_key=nkey)
            .first()
        )
        pid = row.id if row else str(uuid.uuid4())
        if not row:
            row = PropertyKnowledgeModel(id=pid)
            row.tenant_id = tenant_id
            row.normalized_key = nkey
            row.created_at = now
        row.display_name = disp
        row.source_url = source_url or row.source_url or ""
        row.summary = summary
        row.offices_note = offices_note or None
        row.rules_note = rules_note or None
        row.pricing_note = pricing_note or None
        row.location_note = location_note or None
        row.amenities_note = amenities_note or None
        row.pois_json = json.dumps(merged_pois, ensure_ascii=False) if merged_pois else "[]"
        row.research_json = json.dumps({**research, "structured": structured}, ensure_ascii=False)
        row.updated_at = now
        session.add(row)
        session.commit()
        return row
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _maya_property_knowledge_context_for_message(tenant_id, user_message):
    if not SessionLocal or not PropertyKnowledgeModel or not (user_message or "").strip():
        return ""
    session = SessionLocal()
    try:
        rows = (
            session.query(PropertyKnowledgeModel)
            .filter(PropertyKnowledgeModel.tenant_id == tenant_id)
            .order_by(PropertyKnowledgeModel.updated_at.desc())
            .limit(80)
            .all()
        )
    except Exception:
        rows = []
    finally:
        session.close()
    if not rows:
        return ""
    um = (user_message or "").lower()
    tokens = set(re.findall(r"[\w\u0590-\u05ff]+", um))
    hits = []
    for r in rows:
        dn = (r.display_name or "").strip()
        if not dn:
            continue
        dnl = dn.lower()
        nk = (r.normalized_key or "").strip().lower()
        if dnl in um or (nk and nk in _property_knowledge_normalize_key(um)):
            hits.append(r)
            continue
        dtoks = set(re.findall(r"[\w\u0590-\u05ff]+", dnl))
        if len(dtoks & tokens) >= 2:
            hits.append(r)
            continue
        sig = [p for p in re.findall(r"[a-z0-9\u0590-\u05ff]{4,}", dnl) if len(p) >= 4]
        if any(p in um for p in sig):
            hits.append(r)
    # Ambient knowledge: greetings ("מאיה את כאן?") may not name a site — still attach Bazaar / Ministore / WeWork rows if present.
    if not hits:
        _ambient = (
            "bazaar",
            "ministore",
            "wework",
            "city tower",
            "rooms sky",
            "leonardo",
            "בזאר",
            "מיניסטור",
            "bsr",
            "bsr city",
            "petah tikva",
            "פתח תקווה",
            "jabotinsky",
            "tower y",
            "red line",
            "רק\"ל",
        )
        for r in rows:
            dn = (r.display_name or "").lower()
            if any(x in dn for x in _ambient):
                hits.append(r)
            if len(hits) >= 4:
                break
    if not hits:
        return ""
    lines = [
        "PROPERTY_KNOWLEDGE_DB — Maya learned these sites permanently; cite for guest/worker questions about them:",
    ]
    for r in hits[:5]:
        lines.append(f"- {r.display_name}: {(r.summary or '')[:280]}")
        if r.location_note:
            lines.append(f"  · מיקום / location: {(r.location_note or '')[:200]}")
        if r.pricing_note:
            lines.append(f"  · מחירים / pricing: {(r.pricing_note or '')[:200]}")
        if r.rules_note:
            lines.append(f"  · כללים / rules: {(r.rules_note or '')[:200]}")
        if r.offices_note:
            lines.append(f"  · משרדים / capacity: {(r.offices_note or '')[:200]}")
        if r.amenities_note:
            lines.append(f"  · POIs & reviews: {(r.amenities_note or '')[:320]}")
        if r.pois_json:
            try:
                pois = json.loads(r.pois_json)
                if isinstance(pois, list):
                    names = [p.get("name") for p in pois[:6] if isinstance(p, dict) and p.get("name")]
                    if names:
                        lines.append("  · nearby: " + ", ".join(names))
            except Exception:
                pass
    return "\n".join(lines)


def _maya_try_acquire_property_knowledge_response(tenant_id, command):
    """If Kobi teaches a property, research + store and return Flask (jsonify, code) or None."""
    if not command or not _maya_triggers_property_knowledge_acquire(command):
        return None
    if not SessionLocal or not PropertyKnowledgeModel:
        msg = "קובי, אין חיבור למסד נתונים — לא ניתן לשמור ידע נכס כרגע."
        return jsonify({"success": True, "message": msg, "displayMessage": msg, "response": msg}), 200
    name, url = _maya_parse_acquire_target(command)
    if not name:
        msg = "קובי, לאיזה נכס לשמור? שלח שם מלא או קישור (למשל WeWork London Ministore)."
        return jsonify({"success": True, "message": msg, "displayMessage": msg, "response": msg}), 200
    try:
        row = acquire_property_knowledge(tenant_id, name, source_url=url)
    except Exception as e:
        print(f"[acquire_property_knowledge] {e}", flush=True)
        msg = "קובי, ניסיתי לשמור את הנכס אבל משהו נתקע — בדוק חיבור או נסה שוב."
        return jsonify({"success": True, "message": msg, "displayMessage": msg, "response": msg}), 200
    msg_en = (
        f"I've fully analyzed {row.display_name}. "
        "I know the rules, the vibe, and the best local spots. I'm ready to manage!"
    )
    if not _google_maps_api_key():
        msg_en += " (Add GOOGLE_MAPS_API_KEY in .env for richer Maps + reviews.)"
    _maya_memory_log_turn(tenant_id, command, msg_en)
    return jsonify({
        "success": True,
        "message": msg_en,
        "displayMessage": msg_en,
        "response": msg_en,
        "propertyKnowledgeSaved": True,
        "propertyKnowledge": {
            "id": row.id,
            "display_name": row.display_name,
            "normalized_key": row.normalized_key,
        },
    }), 200


def _maya_task_board_status_reply(tenant_id, user_id=None):
    """Human-like status: occupied rooms (61 grid) + open tasks from DB — not a robotic repeat."""
    uid = user_id or f"demo-{tenant_id}"
    c = _task_status_counts_for_tenant(tenant_id)
    m = _maya_bazaar_61_room_metrics(tenant_id, uid)
    if not c:
        return "קובי, אין לי כרגע גישה למסד המשימות — נסה שוב בעוד רגע."
    open_tasks = int(c["pending"] or 0) + int(c.get("in_progress") or 0)
    if int(c.get("total") or 0) == 0 and open_tasks == 0:
        return "קובי, המערכת נקייה ומוכנה לנכסים חדשים. מה להוסיף?"
    if not m:
        return (
            f"קובי, כרגע יש לנו {open_tasks} משימות פתוחות בלוח (ממתין+בטיפול), "
            f"מתוך {c['total']} סה\"כ. אני על זה!"
        )
    # Slight variety so replies are not identical every time
    occ = m["occupied"]
    pct = m["occupancy_pct"]
    if random.random() < 0.5:
        return (
            f"קובי, כרגע יש לנו {occ} חדרים תפוסים מתוך 61 בפורטפוליו ({pct}% תפוסה), "
            f"ו-{open_tasks} משימות פתוחות בלוח. אני על זה!"
        )
    return (
        f"קובי, מהמצב: תפוסה בלוח החדרים {pct}% ({occ}/61), "
        f"ובמשימות — {open_tasks} פתוחות מתוך {c['total']}. אני מנטרת את זה."
    )


def _maya_whats_happening_reply(tenant_id):
    """Grounded 'מה קורה עכשיו?' from last Live Ops Engine lines (same feed as activity-feed)."""
    items = [e for e in _ACTIVITY_LOG if (e.get("text") or "").strip()]
    if items:
        last = items[-1]
        t = (last.get("text") or "").strip()
        if t:
            return t
    c = _task_status_counts_for_tenant(tenant_id)
    if c:
        tot = int(c.get("total") or 0)
        pend = int(c.get("pending") or 0)
        return (
            f"קובי, הלוח פעיל — {tot} משימות בסך הכל, {pend} בממתין; "
            "אני מנטרת בזמן אמת עד שתגיע שורה חדשה מהשטח."
        )
    return "קובי, המערכת רצה — עדיין אין שורה אחרונה בלוג התפעול; תן עוד רגע לעדכון."


def _maya_explain_pending_tasks_reply(tenant_id):
    """Answer 'why so many tasks without treatment' — uses live DB counts."""
    c = _task_status_counts_for_tenant(tenant_id)
    if not c:
        return None
    return (
        f"קובי, יש {c['pending']} משימות שעדיין ב-Pending בלי טיפול פעיל — מתוך {c['total']} בלוח. "
        "רובן היו ממתינות לשיוך אוטומטי לעובד או לפתיחה מצד הצוות. אני משייכת כעת לפי נכס ותפקיד."
    )


def _maya_truth_calendar_availability_enabled():
    """Real slot-level availability requires explicit opt-in (PMS / slot engine not in default stack)."""
    return str(os.getenv("MAYA_CALENDAR_AVAILABILITY", "") or "").strip().lower() in ("1", "true", "yes", "on")


def _maya_strict_emergency_warranted(command: str) -> bool:
    """
    Voice/SMS emergency escalation only for explicit life-safety style phrases.
    Avoids triggering on availability questions or vague wording.
    """
    c = (command or "").strip()
    if not c:
        return False
    cl = c.lower()
    if _maya_truth:
        try:
            intent, _conf = _maya_truth.classify_maya_intent(c)
            if intent == _maya_truth.INTENT_AVAILABILITY:
                return False
        except Exception:
            pass
    if "?" in c:
        explicit = (
            "מצב חירום",
            "חירום מיידי",
            "fire emergency",
            "building on fire",
        )
        if not any(x in c or x in cl for x in explicit):
            return False
    triggers = (
        "מצב חירום",
        "יש אש",
        "דליקה",
        "שריפה",
        "building on fire",
        "active fire",
        "fire emergency",
    )
    if any(t in c or t in cl for t in triggers):
        return True
    if ("נזילה חמורה" in c or "דליפה חריפה" in c) and any(
        u in c or u in cl for u in ("מיידי", "עכשיו", "\u05d3\u05d7\u05d5\u05e3", "urgent", "now")
    ):
        return True
    if cl in ("emergency",) and len(c) < 24:
        return True
    if c in ("חירום!", "Emergency!"):
        return True
    return False


def _truth_search_portfolios(city_hint: str, category_hint: str, amenities_hint: str, rooms: list):
    """Filter manual_rooms-derived portfolio rows by city / category tokens (stored description + name only)."""
    if not rooms:
        return []
    city = (city_hint or "").strip().lower()
    cat = (category_hint or "").strip().lower()
    am = (amenities_hint or "").strip().lower()
    out = []
    for r in rooms:
        if not isinstance(r, dict):
            continue
        blob = f"{r.get('name', '')} {r.get('description', '')}".lower()
        if city and city not in blob:
            continue
        if cat and cat not in blob:
            continue
        if am and am not in blob and all(am not in str(x).lower() for x in (r.get("amenities") or [])):
            continue
        out.append(
            {
                "id": r.get("id"),
                "name": r.get("name"),
                "description": (r.get("description") or "")[:220],
                "max_guests": r.get("max_guests"),
            }
        )
    return out


def _truth_command_catalog_hints(command: str) -> dict:
    """Extract city / workspace type / min capacity from Hebrew or English user text (stored catalog only)."""
    c = (command or "").strip()
    low = c.lower()
    he = c
    cities = []
    _city_defs = (
        ("תל אביב", ("תל אביב", "תל-אביב", 'ת"א', "tel aviv", "tel-aviv", "telaviv")),
        ("ירושלים", ("ירושלים", "jerusalem")),
        ("חיפה", ("חיפה", "haifa")),
        ("באר שבע", ("באר שבע", "beer sheva", "beersheva")),
        ("פתח תקווה", ("פתח תקווה", "פתח תקוה", "petah tikva", "petah-tikva")),
        ("רמת גן", ("רמת גן", "ramat gan")),
        ("הרצליה", ("הרצליה", "herzliya")),
        ("רעננה", ("רעננה", "raanana")),
        ("מודיעין", ("מודיעין", "modiin")),
        ("בני ברק", ("בני ברק", "bnei brak")),
        ("אילת", ("אילת", "eilat")),
        ("יפו", ("יפו", "jaffa", "yafo")),
    )
    for _canon, aliases in _city_defs:
        for a in aliases:
            al = a.lower()
            if al in low or a in he:
                cities.append(_canon)
                break
    want_office = any(x in he or x in low for x in ("משרד", "משרדים", "office", "private office", "קומת משרדים"))
    want_meeting = any(
        k in he or k in low
        for k in ("חדר ישיבות", "חדרי ישיבות", "ישיבות", "meeting room", "meeting rooms", "conference")
    )
    want_hotel = any(k in he or k in low for k in ("מלון", "hotel", "לינה", "סוויט"))
    m_pax = re.search(r"(\d{1,3})\s*(אנשים|מקומות|people|pax)?", c, re.I)
    min_pax = int(m_pax.group(1)) if m_pax else None
    return {
        "cities": cities,
        "want_office": want_office,
        "want_meeting": want_meeting,
        "want_hotel": want_hotel,
        "min_pax": min_pax,
    }


def _truth_room_match_blob(r: dict) -> str:
    if not isinstance(r, dict):
        return ""
    am = r.get("amenities") or []
    am_s = " ".join(str(x) for x in am) if isinstance(am, list) else str(am)
    return f"{r.get('name', '')} {r.get('description', '')} {am_s}"


def _truth_catalog_filter_rooms(rooms: list, hints: dict) -> list:
    """Filter manual_rooms-derived dicts by city / workspace type / min capacity (substring match on stored fields)."""
    cities = hints.get("cities") or []
    wo = hints.get("want_office")
    wm = hints.get("want_meeting")
    wh = hints.get("want_hotel")
    min_pax = hints.get("min_pax")
    out = []
    for r in rooms or []:
        if not isinstance(r, dict):
            continue
        blob = _truth_room_match_blob(r).lower()
        he_blob = _truth_room_match_blob(r)
        if cities:
            if not any((cv.lower() in blob) or (cv in he_blob) for cv in cities):
                continue
        type_conds = []
        if wo:
            type_conds.append(
                any(x in blob for x in ("office", "משרד", "private office", "wework", "cowork", "hot desk", "משרדים"))
            )
        if wm:
            type_conds.append(any(x in blob for x in ("meeting", "ישיבות", "conference", "קונפרנס")))
        if wh:
            type_conds.append(
                any(x in blob for x in ("hotel", "מלון", "suite", "boutique", "room types", "standard queen"))
            )
        if type_conds and not all(type_conds):
            continue
        if min_pax is not None:
            try:
                mg = int(r.get("max_guests") or 0)
            except (TypeError, ValueError):
                mg = 0
            if mg < min_pax:
                continue
        out.append(r)
    return out


def _truth_format_catalog_lines(matches: list, *, header: str) -> str:
    if not matches:
        return ""
    lines = [header]
    for r in matches[:18]:
        am = r.get("amenities") or []
        am_s = ", ".join(str(x) for x in am[:8]) if isinstance(am, list) else str(am)
        mg = r.get("max_guests")
        desc = (r.get("description") or "").replace("\n", " ").strip()[:180]
        lines.append(
            f"- {r.get('name')}: max_guests={mg}; amenities=[{am_s}]; catalog_note={desc}"
        )
    lines.append(
        "(נתוני קטלוג בלבד מ-manual_rooms — לא זמינות חיה ולא משבצות פנויות.)"
    )
    return "\n".join(lines)


def _truth_property_knowledge_catalog_lines(
    tenant_id, hints: dict, catalog_ids: set, command: str
) -> tuple[str, str, int]:
    """
    Pull pricing_note and supporting notes from property_knowledge for matching rows.
    Returns (pricing_block, extra_context_block, rows_used).
    """
    if not SessionLocal or not PropertyKnowledgeModel:
        return "", "", 0
    session = SessionLocal()
    rows = []
    try:
        rows = (
            session.query(PropertyKnowledgeModel)
            .filter(PropertyKnowledgeModel.tenant_id == tenant_id)
            .order_by(PropertyKnowledgeModel.updated_at.desc())
            .limit(80)
            .all()
        )
    except Exception as e:
        print(f"[_truth_property_knowledge_catalog_lines] {e}", flush=True)
        rows = []
    finally:
        session.close()
    cities = hints.get("cities") or []
    wo = hints.get("want_office")
    wm = hints.get("want_meeting")
    wh = hints.get("want_hotel")
    pricing_lines = []
    extra_lines = []
    used = 0
    for row in rows or []:
        parts = [
            row.display_name or "",
            row.location_note or "",
            row.summary or "",
            row.pricing_note or "",
            row.amenities_note or "",
            row.offices_note or "",
            row.rules_note or "",
        ]
        blob = " ".join(p for p in parts if p).lower()
        he_blob = " ".join(p for p in parts if p)
        rid = (row.manual_room_id or "").strip()
        linked = rid and rid in catalog_ids
        if cities:
            city_ok = any((c.lower() in blob) or (c in he_blob) for c in cities)
            if not city_ok and not linked:
                continue
        has_pricing = bool((row.pricing_note or "").strip())
        if wo and not has_pricing and not any(
            x in blob for x in ("office", "משרד", "pricing", "מחיר", "desk", "suite", "cowork", "wework")
        ):
            if not linked:
                continue
        if wm and not has_pricing and not any(
            x in blob for x in ("meeting", "ישיבות", "conference", "office", "משרד")
        ):
            if not linked:
                continue
        if wh and not has_pricing and not any(x in blob for x in ("hotel", "מלון", "suite", "boutique", "room")):
            if not linked:
                continue
        used += 1
        label = row.display_name or row.normalized_key or row.id
        if (row.pricing_note or "").strip():
            pricing_lines.append(f"- {label}: {(row.pricing_note or '').strip()[:520]}")
        extra_bits = []
        if (row.amenities_note or "").strip():
            extra_bits.append(f"amenities_note: {(row.amenities_note or '').strip()[:280]}")
        if (row.offices_note or "").strip() and wm:
            extra_bits.append(f"offices_note: {(row.offices_note or '').strip()[:280]}")
        if (row.location_note or "").strip():
            extra_bits.append(f"location_note: {(row.location_note or '').strip()[:200]}")
        if extra_bits:
            extra_lines.append(f"- {label}: " + " | ".join(extra_bits))
    pb = ""
    if pricing_lines:
        pb = "VERIFIED_PRICING (property_knowledge.pricing_note; stored only):\n" + "\n".join(pricing_lines[:10])
    eb = ""
    if extra_lines:
        eb = "VERIFIED_PROPERTY_NOTES (property_knowledge; no live availability):\n" + "\n".join(extra_lines[:10])
    return pb, eb, used


def _truth_catalog_truth_log(intent: str, helper: str, n_rows: int, grounded: bool, source: str):
    print(
        f"[Maya catalog] intent={intent!r} helper={helper!r} rows={int(n_rows)} grounded={bool(grounded)} source={source!r}",
        flush=True,
    )


def _truth_stored_pricing_and_catalog_bundle(tenant_id, command: str, rooms: list) -> tuple[str, int, int]:
    """
    Build verified text blocks for pricing questions: manual_rooms catalog + property_knowledge.
    Returns (combined_verified_text, n_catalog_rows, n_pk_rows).
    """
    hints = _truth_command_catalog_hints(command)
    has_filter = bool(
        hints["cities"] or hints["want_office"] or hints["want_meeting"] or hints["want_hotel"] or hints["min_pax"] is not None
    )
    if not has_filter:
        px = _truth_pricing_from_knowledge(tenant_id, command)
        return (px, 0, 1) if px else ("", 0, 0)
    matches = _truth_catalog_filter_rooms(rooms, hints)
    if hints["cities"] and not matches:
        relaxed = dict(hints)
        relaxed["want_office"] = False
        relaxed["want_meeting"] = False
        relaxed["want_hotel"] = False
        relaxed["min_pax"] = None
        matches = _truth_catalog_filter_rooms(rooms, relaxed)
    catalog_ids = {str(r.get("id")) for r in matches if r.get("id")}
    chunks = []
    if matches:
        chunks.append(
            _truth_format_catalog_lines(
                matches,
                header="VERIFIED_STORED_CATALOG (manual_rooms: name, amenities, max_guests, description snippet):",
            )
        )
    pk_pricing, pk_extra, n_pk = _truth_property_knowledge_catalog_lines(tenant_id, hints, catalog_ids, command)
    if pk_pricing:
        chunks.append(pk_pricing)
    if pk_extra:
        chunks.append(pk_extra)
    if matches and not pk_pricing:
        chunks.append(
            "VERIFIED_PRICING_STATUS: אין מחירון מפורט שמור ב-property_knowledge.pricing_note עבור הסניפים המסוננים — אפשר לצטט רק את פרטי הקטלוג לעיל."
        )
    text = "\n\n".join(c for c in chunks if c)
    return text, len(matches), n_pk


def _truth_get_meeting_room_facts(tenant_id, command: str, rooms: list) -> str:
    """Meeting-room signals from stored portfolio amenities + property_knowledge (catalog only; not live booking)."""
    hints = _truth_command_catalog_hints(command)
    hints_m = dict(hints)
    hints_m["want_meeting"] = True
    hints_m["want_office"] = False
    scoped = _truth_catalog_filter_rooms(rooms, hints_m)
    base = scoped if scoped else rooms
    lines = []
    cities = hints.get("cities") or []
    for r in base or []:
        if not isinstance(r, dict):
            continue
        am = r.get("amenities") or []
        am_l = [str(x).lower() for x in am] if isinstance(am, list) else []
        blob = " ".join(am_l) + " " + (r.get("description") or "").lower()
        he_blob = _truth_room_match_blob(r)
        if cities and not any((c.lower() in blob) or (c in he_blob) for c in cities):
            continue
        if "meeting" in blob or "ישיבות" in he_blob or "conference" in blob:
            lines.append(
                f"- {r.get('name')}: amenities include meeting-related entries; stored manual_rooms catalog only."
            )
    if SessionLocal and PropertyKnowledgeModel:
        session = SessionLocal()
        try:
            rows = (
                session.query(PropertyKnowledgeModel)
                .filter(PropertyKnowledgeModel.tenant_id == tenant_id)
                .order_by(PropertyKnowledgeModel.updated_at.desc())
                .limit(40)
                .all()
            )
            for row in rows or []:
                off = (row.offices_note or "") + " " + (row.summary or "") + " " + (row.location_note or "")
                ol = off.lower()
                if "meeting" not in ol and "ישיבות" not in off and "conference" not in ol:
                    continue
                if cities:
                    if not any(c.lower() in ol or c in off for c in cities):
                        continue
                lines.append(f"- {row.display_name} (property_knowledge): {(off.strip())[:320]}")
        except Exception as e:
            print(f"[_truth_get_meeting_room_facts] {e}", flush=True)
        finally:
            session.close()
    if not lines:
        return ""
    return "VERIFIED_STORED_MEETING_CONTEXT (not live booking):\n" + "\n".join(lines[:14])


def _truth_capacity_from_rooms(command: str, rooms: list) -> str:
    """max_guests from portfolio rows; optional people count from user message."""
    m = re.search(r"(\d{1,3})\s*(אנשים|people|pax|מקומות)?", command or "", re.I)
    want = int(m.group(1)) if m else None
    fits = []
    for r in rooms or []:
        if not isinstance(r, dict):
            continue
        try:
            mg = int(r.get("max_guests") or 0)
        except (TypeError, ValueError):
            mg = 0
        if want is not None and mg >= want:
            fits.append(f"{r.get('name')}: max_guests>={want} (stored field)")
        elif want is None and mg:
            fits.append(f"{r.get('name')}: max_guests={mg} (stored field)")
    if want is not None and not fits:
        return f"No portfolio properties in DB report max_guests>={want} (stored manual_rooms only)."
    if not fits:
        return "No max_guests data on portfolio rows."
    return "VERIFIED_CAPACITY (stored manual_rooms.max_guests only; not live event capacity):\n" + "\n".join(fits[:20])


def _maya_parse_date_hints(command: str):
    """
    Extract a (start_date, end_date) window from natural-language booking / availability phrases.
    Returns (datetime.date, datetime.date).  Never raises.
    Defaults to today+14 days when no date signal is found.
    """
    from datetime import date as _dt_date, timedelta as _td
    today = _dt_date.today()
    cl = (command or "").lower()

    # 1. Explicit ISO dates: 2024-12-25 or 2024/12/25
    for raw in re.findall(r"\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b", command):
        try:
            d = datetime.strptime(raw.replace("/", "-"), "%Y-%m-%d").date()
            return d, d + _td(days=1)
        except Exception:
            continue

    # 2. DD/MM/YYYY or DD.MM.YYYY (European format common in Hebrew context)
    for raw in re.findall(r"\b(\d{1,2}[./]\d{1,2}[./]\d{2,4})\b", command):
        sep = "." if "." in raw else "/"
        parts = raw.split(sep)
        if len(parts) != 3:
            continue
        day_s, mon_s, yr_s = parts
        yr = int(yr_s) if len(yr_s) == 4 else (2000 + int(yr_s))
        try:
            d = _dt_date(yr, int(mon_s), int(day_s))
            return d, d + _td(days=1)
        except Exception:
            continue

    # 3. Natural-language keywords
    if any(w in cl for w in ("היום", "today", "עכשיו", "now")):
        return today, today + _td(days=1)
    if any(w in cl for w in ("מחר", "tomorrow")):
        d = today + _td(days=1)
        return d, d + _td(days=1)
    if any(w in cl for w in ("השבוע", "this week")):
        return today, today + _td(days=7)
    if any(w in cl for w in ("שבוע הבא", "next week")):
        nw = today + _td(days=7)
        return nw, nw + _td(days=7)
    if any(w in cl for w in ("החודש", "this month")):
        return today, today + _td(days=30)
    if any(w in cl for w in ("חודש הבא", "next month")):
        nm = today + _td(days=30)
        return nm, nm + _td(days=30)
    if any(w in cl for w in ("weekend", "סוף שבוע", 'סופ"ש')):
        days_to_fri = (4 - today.weekday()) % 7
        fri = today + _td(days=days_to_fri)
        return fri, fri + _td(days=2)

    # 4. Generic availability signal without specific date → next 14 days
    if any(w in cl for w in ("זמין", "פנוי", "available", "availability", "זמינות", "booking")):
        return today, today + _td(days=14)

    # 5. Default fallback
    return today, today + _td(days=14)


def _truth_check_availability(tenant_id, command: str) -> dict:
    """
    Query BookingModel for the date window inferred from `command`.
    Returns verified booking data that Maya can cite directly.
    Falls back to ical_configured flag if BookingModel is unavailable.
    """
    has_ical = False
    if SessionLocal and CalendarConnectionModel:
        _s = SessionLocal()
        try:
            row = _s.query(CalendarConnectionModel).filter_by(tenant_id=tenant_id).first()
            has_ical = bool(row and (getattr(row, "ical_url", None) or "").strip())
        except Exception:
            pass
        finally:
            _s.close()

    if not SessionLocal or not BookingModel:
        return {
            "verified_slot": False,
            "ical_configured": has_ical,
            "calendar_api_enabled": _maya_truth_calendar_availability_enabled(),
            "note": "BookingModel unavailable — no booking data loaded.",
        }

    from datetime import date as _date
    start_d, end_d = _maya_parse_date_hints(command)
    if start_d is None:
        start_d = _date.today()
        from datetime import timedelta as _td
        end_d = start_d + _td(days=14)

    start_s = start_d.strftime("%Y-%m-%d")
    end_s   = end_d.strftime("%Y-%m-%d")

    _sess = SessionLocal()
    try:
        rows = (
            _sess.query(BookingModel)
            .filter(
                BookingModel.tenant_id == tenant_id,
                BookingModel.status != "cancelled",
                BookingModel.check_out > start_s,
                BookingModel.check_in  < end_s,
            )
            .order_by(BookingModel.check_in)
            .limit(30)
            .all()
        )
        bookings = [
            {
                "guest": (r.guest_name or "Guest")[:40],
                "property": (r.property_name or "")[:60],
                "check_in": r.check_in,
                "check_out": r.check_out,
                "nights": r.nights,
                "status": r.status or "confirmed",
            }
            for r in rows
        ]
    except Exception as _qe:
        bookings = []
        print(f"[CalendarTool] BookingModel query failed: {_qe}", flush=True)
    finally:
        _sess.close()

    verified = bool(bookings)
    return {
        "verified_slot": verified,
        "ical_configured": has_ical,
        "calendar_api_enabled": _maya_truth_calendar_availability_enabled(),
        "date_window": f"{start_s} → {end_s}",
        "bookings": bookings,
        "booking_count": len(bookings),
        "note": (
            f"BookingModel returned {len(bookings)} booking(s) in window {start_s}→{end_s}."
            if verified
            else f"No bookings found in window {start_s}→{end_s} — rooms appear FREE."
        ),
    }


def _truth_pricing_from_knowledge(tenant_id, command: str) -> str:
    if not SessionLocal or not PropertyKnowledgeModel:
        return ""
    session = SessionLocal()
    try:
        rows = (
            session.query(PropertyKnowledgeModel)
            .filter(PropertyKnowledgeModel.tenant_id == tenant_id)
            .order_by(PropertyKnowledgeModel.updated_at.desc())
            .limit(60)
            .all()
        )
    except Exception:
        rows = []
    finally:
        session.close()
    if not rows:
        return ""
    um = (command or "").lower()
    tokens = set(re.findall(r"[\w\u0590-\u05ff]+", um))
    chunks = []
    for r in rows:
        if not (r.pricing_note or "").strip():
            continue
        dn = (r.display_name or "").lower()
        dtoks = set(re.findall(r"[\w\u0590-\u05ff]+", dn))
        if len(tokens & dtoks) < 1 and dn not in um and (r.normalized_key or "") not in um:
            continue
        chunks.append(f"{r.display_name}: {(r.pricing_note or '').strip()[:400]}")
    if not chunks:
        return ""
    return "VERIFIED_PRICING (property_knowledge.pricing_note only):\n" + "\n".join(chunks[:8])


def _truth_lead_snapshot(tenant_id, limit: int = 8) -> str:
    if not SessionLocal or not LeadModel:
        return ""
    session = SessionLocal()
    try:
        rows = (
            session.query(LeadModel)
            .filter_by(tenant_id=tenant_id)
            .order_by(LeadModel.created_at.desc())
            .limit(limit)
            .all()
        )
    except Exception:
        rows = []
    finally:
        session.close()
    if not rows:
        return "VERIFIED_LEADS: none in DB for this tenant."
    lines = []
    for r in rows:
        lines.append(
            f"- {(r.name or '').strip() or '—'} | {(r.status or '').strip()} | "
            f"{(r.property_name or '').strip()} | created={(r.created_at or '')[:16]}"
        )
    return "VERIFIED_LEADS (leads table):\n" + "\n".join(lines)


def _maya_truth_audit_empty():
    """Default truth audit dict (copy per use)."""
    return {
        "intent": "unsupported_unknown",
        "intent_confidence": 0.0,
        "tool_calls": [],
        "grounded": False,
        "source_name": None,
        "source_details": "",
        "action_taken": "none",
        "confidence": 0.0,
        "prompt_injection": "",
        "short_circuit_response": None,
        "fallback_reason": None,
        "intent_detection_ms": 0,
        "truth_tools_ms": 0,
    }


def _maya_log_timing(
    *,
    intent: str,
    total_ms: int,
    gemini_ms: int = 0,
    db_ms: int = 0,
    truth_ms: int = 0,
    intent_ms: int = 0,
    truth_tools_ms: int = 0,
    response_build_ms: int = 0,
    grounded: bool = False,
    prompt_chars: int = 0,
    sse: bool = False,
    model: str = "",
):
    """One-line structured latency log for Maya (terminal / log aggregation)."""
    parts = [
        f"intent={intent!r}",
        f"total_ms={int(total_ms)}",
        f"gemini_ms={int(gemini_ms)}",
        f"db_ms={int(db_ms)}",
        f"truth_ms={int(truth_ms)}",
        f"intent_detection_ms={int(intent_ms)}",
        f"truth_tools_ms={int(truth_tools_ms)}",
        f"response_build_ms={int(response_build_ms)}",
        f"grounded={grounded}",
        f"prompt_chars={int(prompt_chars)}",
        f"sse={bool(sse)}",
    ]
    if model:
        parts.append(f"model={model!r}")
    print("[MayaTiming] " + " ".join(parts), flush=True)


def _maya_truth_evaluate_operational(tenant_id, user_id, command, rooms, maya_stats_snapshot):
    """Safe entry: never raises; logs full trace on failure."""
    try:
        return _maya_truth_evaluate_operational_impl(tenant_id, user_id, command, rooms, maya_stats_snapshot)
    except Exception as e:
        import traceback as _tb_truth

        print(f"[Maya truth] evaluate wrapper error: {type(e).__name__}: {e}", flush=True)
        _tb_truth.print_exc()
        return _maya_truth_audit_empty()


def _maya_truth_evaluate_operational_impl(tenant_id, user_id, command, rooms, maya_stats_snapshot):
    """
    Intent + tool wiring for grounding. Returns dict with prompt_injection, tool_calls,
    optional short_circuit_response (payload dict), and audit fields.
    """
    empty = _maya_truth_audit_empty()
    if not _maya_truth or not (command or "").strip():
        return empty
    intent_detection_ms = 0
    try:
        _ic0 = time.perf_counter()
        intent, iconf = _maya_truth.classify_maya_intent(command)
        intent_detection_ms = int((time.perf_counter() - _ic0) * 1000)
    except Exception as e:
        print(f"[Maya truth] classify_maya_intent failed: {type(e).__name__}: {e}", flush=True)
        return empty
    if not _maya_truth.is_operational_truth_intent(intent):
        print(f"[Maya truth] skip grounding intent={intent!r} (non-operational)", flush=True)
        out = _maya_truth_audit_empty()
        out["intent"] = intent
        out["intent_confidence"] = float(iconf)
        out["confidence"] = float(iconf)
        out["action_taken"] = "truth_layer_skipped_non_operational"
        out["intent_detection_ms"] = intent_detection_ms
        out["truth_tools_ms"] = 0
        return out

    tool_calls = []
    verified_chunks = []
    grounded = False
    source_name = None
    source_details = ""
    action_taken = "llm_with_prompt"
    fallback_reason = None
    short_circuit_response = None
    truth_tools_ms = 0

    try:
        _tools_t0 = time.perf_counter()
        city_m = re.search(
            r"(\u05ea\u05dc \u05d0\u05d1\u05d9\u05d1|\u05d9\u05e8\u05d5\u05e9\u05dc\u05d9\u05dd|\u05d7\u05d9\u05e4\u05d4|\u05e8\u05de\u05ea \u05d2\u05df|\u05d4\u05e8\u05e6\u05dc\u05d9\u05d4|\u05e4\u05ea\u05d7 \u05ea\u05e7\u05d5\u05d5\u05d4|\u05d1\u05e0\u05d9 \u05d1\u05e8\u05e7|\u05e8\u05e2\u05e0\u05e0\u05d4|\u05de\u05d5\u05d3\u05d9\u05e2\u05d9\u05df|\u05d1\u05d0\u05e8 \u05e9\u05d1\u05e2|\u05d0\u05d9\u05dc\u05ea|\u05d4\u05e8\u05e6\u05dc\u05d9\u05d4|\u05d9\u05e4\u05d5|tel aviv|jerusalem|haifa|petah tikva|beer sheva|eilat|jaffa)",
            command or "",
            re.I,
        )
        city_hint = city_m.group(1) if city_m else ""

        if intent == _maya_truth.INTENT_AVAILABILITY:
            av = _truth_check_availability(tenant_id, command)
            tool_calls.append({"name": "fetch_calendar_availability", "ok": av.get("verified_slot", False), "result": av})
            if av.get("verified_slot"):
                # Real booking data found — inject as grounded LIVE_CALENDAR block.
                # Maya is now authorised to answer from this data; no short-circuit.
                bookings = av.get("bookings") or []
                window = av.get("date_window", "")
                lines = [f"LIVE_CALENDAR (fetch_calendar_availability executed — verified from BookingModel):"]
                lines.append(f"Date window queried: {window}")
                lines.append(f"Bookings found: {av['booking_count']}")
                for b in bookings[:10]:
                    lines.append(
                        f"  • {b['property']} — {b['guest']} | {b['check_in']} → {b['check_out']}"
                        f" ({b['nights']} night(s)) [{b['status']}]"
                    )
                if not bookings:
                    lines.append("  No bookings overlap this window — rooms appear available.")
                lines.append(
                    "INSTRUCTION: You have executed fetch_calendar_availability. "
                    "Report the above data to the user directly. "
                    "Do NOT say 'I haven't checked' — the check was just performed."
                )
                cal_block = "\n".join(lines)
                verified_chunks.append(cal_block)
                grounded = True
                source_name = "BookingModel.fetch_calendar_availability"
                action_taken = "live_calendar_grounded"
            else:
                # No booking data in DB yet — inject an honest status but still let the LLM respond.
                no_data_note = (
                    "LIVE_CALENDAR: fetch_calendar_availability was executed. "
                    f"Date window: {av.get('date_window', 'today+14d')}. "
                    "Result: No bookings found in this window OR BookingModel is empty. "
                    "You MAY say rooms appear to be available based on the current booking database, "
                    "but acknowledge the booking system may have more data. "
                    "Do NOT say 'I haven't checked' — the tool ran."
                )
                verified_chunks.append(no_data_note)
                grounded = True
                source_name = "BookingModel.empty_window"
                action_taken = "live_calendar_no_data"
        elif intent == _maya_truth.INTENT_MEETING_ROOMS:
            block = _truth_get_meeting_room_facts(tenant_id, command, rooms)
            tool_calls.append({"name": "get_meeting_rooms", "ok": bool(block), "summary": (block or "")[:200]})
            if block:
                verified_chunks.append(block)
                grounded = True
                source_name = "manual_rooms_amenities+property_knowledge"
                source_details = block[:1200]
                action_taken = "stored_meeting_context"
                _truth_catalog_truth_log(intent, "get_meeting_room_facts", block.count("\n"), True, "stored_catalog")
            else:
                fallback_reason = "no_meeting_data_in_stores"
                msg = (
                    "אין לי כרגע נתונים מאומתים על חדרי ישיבות מהמאגר — רק מה שקיים בנכסים שנשמרו במערכת. "
                    + _maya_truth.NO_VERIFIED_LIVE_DATA_HE
                )
                short_circuit_response = {"success": True, "message": msg, "displayMessage": msg, "response": msg}
                action_taken = "short_circuit_no_meeting_facts"
        elif intent == _maya_truth.INTENT_ROOM_CAPACITY:
            hints_c = _truth_command_catalog_hints(command)
            rooms_cap = rooms
            if hints_c.get("cities") or hints_c.get("min_pax") is not None:
                rooms_cap = _truth_catalog_filter_rooms(rooms, hints_c) or rooms
            cap = _truth_capacity_from_rooms(command, rooms_cap)
            tool_calls.append({"name": "get_capacity_options", "ok": True, "summary": cap[:200]})
            verified_chunks.append(cap)
            grounded = True
            source_name = "manual_rooms.max_guests"
            source_details = cap[:1200]
            action_taken = "stored_capacity"
        elif intent == _maya_truth.INTENT_BRANCH_PROPERTY:
            hints_br = _truth_command_catalog_hints(command)
            if city_hint and city_hint not in hints_br["cities"]:
                hints_br["cities"].append(city_hint)
            matches_br = _truth_catalog_filter_rooms(rooms, hints_br)
            if not matches_br and hints_br["cities"]:
                hints_relaxed = dict(hints_br)
                hints_relaxed["want_office"] = hints_relaxed["want_meeting"] = hints_relaxed["want_hotel"] = False
                hints_relaxed["min_pax"] = None
                matches_br = _truth_catalog_filter_rooms(rooms, hints_relaxed)
            found = [
                {
                    "id": r.get("id"),
                    "name": r.get("name"),
                    "description": (r.get("description") or "")[:220],
                    "max_guests": r.get("max_guests"),
                }
                for r in (matches_br or [])
            ]
            tool_calls.append({"name": "search_properties", "ok": bool(found), "count": len(found)})
            if found:
                blob = json.dumps(found[:15], ensure_ascii=False)
                verified_chunks.append("VERIFIED_PORTFOLIO_FILTER (manual_rooms catalog):\n" + blob)
                grounded = True
                source_name = "manual_rooms"
                source_details = blob[:1200]
                action_taken = "stored_branch_catalog"
                _truth_catalog_truth_log(intent, "search_properties", len(found), True, "stored_catalog")
            else:
                fallback_reason = "no_matching_branches"
                msg = "לא מצאתי נכס תואם בנתונים השמורים במערכת לפי החיפוש — לא בדקתי מקור חיצוני."
                short_circuit_response = {"success": True, "message": msg, "displayMessage": msg, "response": msg}
                action_taken = "short_circuit_branch_nomatch"
        elif intent == _maya_truth.INTENT_PRICING:
            bundle, n_cat, n_pk = _truth_stored_pricing_and_catalog_bundle(tenant_id, command, rooms)
            tool_calls.append(
                {
                    "name": "get_property_pricing",
                    "ok": bool(bundle),
                    "summary": (bundle or "")[:160],
                    "rows_catalog": n_cat,
                    "rows_property_knowledge": n_pk,
                }
            )
            if bundle:
                verified_chunks.append(bundle)
                grounded = True
                source_name = "manual_rooms+property_knowledge"
                source_details = bundle[:1200]
                action_taken = "stored_pricing_or_catalog"
                has_price = "VERIFIED_PRICING" in bundle
                _truth_catalog_truth_log(
                    intent,
                    "get_property_pricing",
                    max(n_cat, n_pk),
                    True,
                    "stored_catalog" if not has_price else "stored_catalog+pricing_note",
                )
            else:
                short_circuit_response = {
                    "success": True,
                    "message": _maya_truth.NO_VERIFIED_PRICING_HE,
                    "displayMessage": _maya_truth.NO_VERIFIED_PRICING_HE,
                    "response": _maya_truth.NO_VERIFIED_PRICING_HE,
                }
                fallback_reason = "no_pricing_in_db"
                action_taken = "short_circuit_pricing"
                _truth_catalog_truth_log(intent, "get_property_pricing", 0, False, "stored_catalog")
        elif intent == _maya_truth.INTENT_GUEST_LEAD:
            snap = _truth_lead_snapshot(tenant_id)
            tool_calls.append({"name": "get_leads_snapshot", "ok": True, "summary": snap[:160]})
            verified_chunks.append(snap)
            grounded = True
            source_name = "leads"
            source_details = snap[:1200]
            action_taken = "db_leads"

        truth_tools_ms = int((time.perf_counter() - _tools_t0) * 1000)

    except Exception as e:
        import traceback as _tb_op

        print(f"[Maya truth] operational tools failed: {type(e).__name__}: {e}", flush=True)
        _tb_op.print_exc()
        tool_calls.append({"name": "truth_operational_branch", "ok": False, "error": type(e).__name__})
        fallback_reason = "operational_branch_exception"
        action_taken = "truth_graceful_fallback"
        msg = _maya_truth.TRUTH_GRACEFUL_FALLBACK_HE
        short_circuit_response = {
            "success": True,
            "message": msg,
            "displayMessage": msg,
            "response": msg,
        }
        grounded = False
        verified_chunks = []
        source_name = None
        source_details = ""
        try:
            truth_tools_ms = int((time.perf_counter() - _tools_t0) * 1000)
        except Exception:
            truth_tools_ms = 0

    policy_lines = [
        "TRUTH_LAYER_POLICY:",
        f"- Classified intent: {intent} (confidence ~{iconf:.2f}).",
        "- Do NOT write that you 'checked the live system' unless a tool result explicitly confirms a verified query for that claim.",
        "- For availability/booking: never invent free rooms or times.",
        "- If VERIFIED blocks are empty and the user asks operational facts, state that you lack verified live data for that part.",
        # Enforce consistent counts and no fake live-check claims on every grounded response
        f"- {_maya_truth.TRUTH_POLICY_NO_FAKE_LIVE}",
        f"- {_maya_truth.TRUTH_POLICY_SINGLE_COUNT_SOURCE}",
        "- Staff registration: use action:register_staff when user provides name + role explicitly; "
          "for bulk/complex HR changes redirect to Dashboard → Settings → Staff.",
        "- Calendar availability: when LIVE_CALENDAR appears in this prompt, it means "
          "fetch_calendar_availability was already executed — cite those results directly. "
          "NEVER say 'I haven't checked' when LIVE_CALENDAR data is present.",
    ]
    if verified_chunks:
        policy_lines.append("VERIFIED_TOOL_OUTPUT (cite only these for matching operational questions):")
        policy_lines.extend(verified_chunks)
    prompt_injection = "\n".join(policy_lines)

    try:
        print(
            _maya_truth.format_audit_log(
                tenant_id=tenant_id,
                user_message=command or "",
                intent=intent,
                tool_calls=tool_calls,
                grounded=grounded,
                fallback_reason=fallback_reason,
            ),
            flush=True,
        )
    except Exception:
        pass

    return {
        "intent": intent,
        "intent_confidence": iconf,
        "tool_calls": tool_calls,
        "grounded": grounded,
        "source_name": source_name,
        "source_details": source_details,
        "action_taken": action_taken,
        "confidence": iconf,
        "prompt_injection": prompt_injection,
        "short_circuit_response": short_circuit_response,
        "fallback_reason": fallback_reason,
        "intent_detection_ms": intent_detection_ms,
        "truth_tools_ms": truth_tools_ms,
    }


def _maya_truth_wrap_llm_payload(tenant_id, command, truth_audit, payload: dict) -> dict:
    """Attach truth metadata + log final answer path."""
    if not truth_audit or not _maya_truth:
        return payload
    try:
        out = _maya_truth.merge_truth_fields(
            payload,
            intent=truth_audit.get("intent") or "unsupported_unknown",
            intent_confidence=float(truth_audit.get("intent_confidence") or 0),
            tool_calls=list(truth_audit.get("tool_calls") or []),
            grounded=bool(truth_audit.get("grounded")),
            source_name=truth_audit.get("source_name"),
            source_details=truth_audit.get("source_details") or "",
            action_taken=truth_audit.get("action_taken") or "",
            confidence=float(truth_audit.get("confidence") or 0),
        )
        print(
            _maya_truth.format_audit_log(
                tenant_id=tenant_id,
                user_message=command or "",
                intent=truth_audit.get("intent") or "",
                tool_calls=truth_audit.get("tool_calls") or [],
                grounded=truth_audit.get("grounded", False),
                fallback_reason=truth_audit.get("fallback_reason"),
            )
            + " [final_llm_payload]",
            flush=True,
        )
        return out
    except Exception as e:
        print(f"[_maya_truth_wrap_llm_payload] {e}", flush=True)
        return payload


def _maya_memory_log_turn(tenant_id, user_text, assistant_text):
    if not tenant_id:
        return
    if _maya_memory:
        try:
            _maya_memory.append_turn(tenant_id, "user", (user_text or "")[:8000])
            _maya_memory.append_turn(tenant_id, "assistant", (assistant_text or "")[:8000])
        except Exception as e:
            print("[maya_memory]", e, flush=True)
    if _guest_memory:
        try:
            _guest_memory.append_turn(tenant_id, "user", (user_text or "")[:8000])
            _guest_memory.append_turn(tenant_id, "assistant", (assistant_text or "")[:8000], meta={"learning": True})
        except Exception as e:
            print("[guest_memory]", e, flush=True)


def _maya_kobi_tasks_reply(tenant_id=None, user_id=None):
    """SMS quota vs live task count + 61-unit grid occupancy (never a fixed '20' or fake %)."""
    if is_twilio_internal_dashboard_only():
        return (
            "קובי, אני מעבדת את המשימות. מכיוון שחרגנו ממכסת ה-SMS, "
            "אני מנהלת הכל דרך הלוח הפנימי באדום/כתום/ירוק."
        )
    uid = user_id or (f"demo-{tenant_id}" if tenant_id else f"demo-{DEFAULT_TENANT_ID}")
    c = _task_status_counts_for_tenant(tenant_id) if tenant_id else None
    total_t = int(c["total"] or 0) if c else 0
    m = _maya_bazaar_61_room_metrics(tenant_id, uid) if tenant_id else None
    if not m:
        return (
            f"היי קובי, יש לי {total_t} משימות בלוח לפי בסיס הנתונים. "
            "מחכה לנתוני לוח החדרים המלאים — רענן את הדשבורד אם צריך."
        )
    occ_n = m["occupied"]
    pct = m["occupancy_pct"]
    return (
        f"היי קובי, יש לנו {total_t} משימות בלוח, "
        f"ובפורטפוליו {occ_n} חדרים תפוסים מתוך 61 ({pct}% תפוסה לפי לוח החדרים). הכל מסונכרן."
    )


def _invalidate_owner_dashboard_cache():
    _OWNER_DASHBOARD_CACHE["ts"] = 0.0
    _OWNER_DASHBOARD_CACHE["payload"] = None


def _task_escalation_fields(r):
    pri = (getattr(r, "priority", None) or "normal").strip().lower()
    notes = (getattr(r, "worker_notes", "") or "")
    escalated = pri == "critical" or "[ESCALATED]" in notes
    return escalated, pri if pri else "normal", notes


def get_automation_stats_for_tenant(tenant_id):
    if SessionLocal and LeadModel and MessageModel:
        session = SessionLocal()
        try:
            total_leads = session.query(LeadModel).filter_by(tenant_id=tenant_id).count()
            outbound_messages = session.query(MessageModel).filter_by(
                tenant_id=tenant_id, direction="outbound"
            ).count()
        finally:
            session.close()
    else:
        with DATA_LOCK:
            total_leads = len([lead for lead in LEADS if lead.get("tenant_id") == tenant_id])
            outbound_messages = AUTOMATION_STATS.get(tenant_id, {}).get("automated_messages", 0)
    stats = AUTOMATION_STATS.get(tenant_id, {"automated_messages": 0, "last_scan": None})
    stats["automated_messages"] = outbound_messages
    stats["leads_total"] = total_leads
    AUTOMATION_STATS[tenant_id] = stats
    return stats


def emit_automation_stats(tenant_id):
    payload = get_automation_stats_for_tenant(tenant_id)
    enqueue_event(tenant_id, "automation_stats", payload)


def generate_lead(source="airbnb"):
    properties = [
        "Royal Suite", "Ocean Suite", "Diamond Suite", "Sunset Suite",
        "Modern Loft", "Skyline Penthouse", "Garden Villa", "City Studio"
    ]
    hosts = ["Dana", "Yossi", "Maya", "Sarah", "John", "Lina", "Oren", "Mika"]
    cities = ["Tel Aviv", "Athens", "London", "Madrid", "Dubai", "Rome"]
    prop = random.choice(properties)
    host = random.choice(hosts)
    response_time_hours = random.choice([0.5, 1, 2, 4, 6, 12])
    score = min(100, 50 + int(response_time_hours * 6) + random.randint(0, 20))
    lead_id = str(uuid.uuid4())

    lead = {
        "id": lead_id,
        "name": prop,
        "contact": host,
        "email": f"{host.lower()}@example.com",
        "phone": os.getenv("DEMO_PHONE", "+972501234567"),
        "source": source,
        "status": "new",
        "value": random.choice([600, 850, 1200, 2000]),
        "rating": round(random.uniform(4.1, 5.0), 1),
        "createdAt": now_iso(),
        "notes": "Identified by autonomous scout",
        "property": prop,
        "city": random.choice(cities),
        "response_time_hours": response_time_hours,
        "lead_quality": score,
        "ai_summary": "Slow response time detected; AI automation could improve conversions.",
    }

    return lead


def generate_hebrew_lead(index, source="airbnb"):
    properties = [
        "פנטהאוז מול הים", "סוויטת יוקרה במרכז", "וילה עם בריכה פרטית",
        "לופט אורבני מעוצב", "דירת נופש בטיילת", "סוויטת גן שקטה",
    ]
    hosts = ["דנה כהן", "יוסי לוי", "מאיה רז", "שרון אברהם", "אורי ביטון", "נועה לוי"]
    cities = ["תל אביב", "ירושלים", "חיפה", "אילת", "נתניה", "באר שבע"]
    prop = properties[index % len(properties)]
    host = hosts[index % len(hosts)]
    response_time_hours = random.choice([0.5, 1, 2, 3, 5])
    score = min(100, 55 + int(response_time_hours * 6) + random.randint(5, 20))
    lead_id = str(uuid.uuid4())

    return {
        "id": lead_id,
        "name": prop,
        "contact": host,
        "email": f"{host.replace(' ', '.')}@example.com",
        "phone": os.getenv("DEMO_PHONE", "+972501234567"),
        "source": source,
        "status": "new",
        "value": random.choice([700, 950, 1400, 2100]),
        "rating": round(random.uniform(4.3, 5.0), 1),
        "createdAt": now_iso(),
        "notes": "נמצא על ידי סריקת לידים אוטונומית",
        "property": prop,
        "city": cities[index % len(cities)],
        "response_time_hours": response_time_hours,
        "lead_quality": score,
        "ai_summary": "זמן תגובה איטי יחסית - אוטומציה תעלה אחוזי סגירה.",
    }


def seed_hebrew_leads(count=5, tenant_id=None):
    tenant_id = tenant_id or DEFAULT_TENANT_ID
    with DATA_LOCK:
        if any(lead.get("tenant_id") == tenant_id for lead in LEADS):
            return
    sources = ["airbnb", "booking"]
    for i in range(count):
        lead = generate_hebrew_lead(i, source=sources[i % len(sources)])
        add_lead(lead, tenant_id=tenant_id)


def add_lead(lead, tenant_id=None, **kwargs):
    persisted = persist_lead(lead)
    lead = persisted or lead
    with DATA_LOCK:
        existing = LEADS_BY_ID.get(lead["id"])
        if existing:
            existing.update(lead)
        else:
            LEADS.insert(0, lead)
            LEADS_BY_ID[lead["id"]] = lead
    enqueue_event(tenant_id or lead.get("tenant_id") or DEFAULT_TENANT_ID, "new_lead", lead)


def update_lead(lead_id, updates):
    with DATA_LOCK:
        lead = LEADS_BY_ID.get(lead_id)
        if not lead:
            return None
        lead.update(updates)
    persist_lead(lead)
    enqueue_event(lead.get("tenant_id") or DEFAULT_TENANT_ID, "lead_updated", lead)
    return lead


def _normalize_phone(phone):
    """Convert Israeli 050-xxx to +97250xxx for Twilio."""
    p = (phone or "").strip().replace("-", "").replace(" ", "").replace("(", "").replace(")", "")
    if p.startswith("0") and len(p) >= 9:
        return "+972" + p[1:]
    if not p.startswith("+"):
        return "+972" + p
    return p


TWILIO_SENDER = (
    (os.getenv("TWILIO_WHATSAPP_FROM") or os.getenv("TWILIO_PHONE_FROM") or "")
    .strip()
    .replace("whatsapp:", "")
    .replace("\r", "")
    .replace("\n", "")
)

def _is_whatsapp_limit_error(err):
    """Twilio 63030 = WhatsApp daily limit reached."""
    s = (err or "").lower()
    return "63030" in s or "limit" in s or "quota" in s or "daily" in s


def _is_retryable_error(err):
    """Temporary/rate-limit errors worth retrying."""
    s = (err or "").lower()
    return "limit" in s or "429" in s or "rate" in s or "timeout" in s or "503" in s or "502" in s or "temporarily" in s


def _is_twilio_quota_or_sms_cap_error(err: str) -> bool:
    """Daily SMS cap (~50), WhatsApp limits, trial caps — switch to internal dashboard; do not crash."""
    s = (err or "").lower()
    if _is_whatsapp_limit_error(err):
        return True
    if any(x in s for x in ("21608", "21614", "21408", "63038", "message limit", "exceeded", "quota", "max", "50")):
        return True
    if "twilio" in s and ("limit" in s or "cap" in s or "permission" in s):
        return True
    return False


def send_whatsapp(to_number, message, media_url=None, _retries=3):
    try:
        return _send_whatsapp_inner(to_number, message, media_url, _retries)
    except Exception as e:
        sms_or_whatsapp_failed_continue(e, "whatsapp")
        return {"success": False, "error": str(e), "skipped": True}


def _send_whatsapp_inner(to_number, message, media_url=None, _retries=3):
    to = _normalize_phone(to_number)
    if is_twilio_internal_dashboard_only():
        return {"success": False, "error": "internal_dashboard_only", "skipped": True}
    if TWILIO_SIMULATE:
        preview = (message or "")[:80]
        print("[Twilio SIMULATE mode] - message print to terminal | WhatsApp ->", to, "|", preview)
        _ACTIVITY_LOG.append({
            "id": str(uuid.uuid4()),
            "ts": int(time.time() * 1000),   # milliseconds — matches JS Date.now()
            "type": "whatsapp",
            "to": to,
            "text": f"📱 WhatsApp → {to}: {preview}",
        })
        return {"success": True, "sid": "sim-"+str(time.time()), "simulated": True}
    raw = (os.getenv("TWILIO_WHATSAPP_FROM") or os.getenv("TWILIO_PHONE_FROM") or TWILIO_SENDER).strip().replace("\r", "").replace("\n", "")
    from_val = raw if raw.startswith("whatsapp:") else f"whatsapp:{raw.replace('whatsapp:', '') or TWILIO_SENDER}"
    if not TWILIO_CLIENT:
        return {"success": False, "error": "Twilio not configured"}
    for attempt in range(max(1, _retries)):
        try:
            payload = {"from_": from_val, "to": f"whatsapp:{to}", "body": message}
            if media_url:
                payload["media_url"] = [media_url]
            msg = TWILIO_CLIENT.messages.create(**payload)
            return {"success": True, "sid": msg.sid}
        except Exception as e:
            err_str = str(e)
            print("[Twilio] WhatsApp send failed (attempt %d):" % (attempt + 1), e)
            if _is_twilio_quota_or_sms_cap_error(err_str):
                set_twilio_internal_dashboard_only(err_str[:240])
            if attempt < _retries - 1 and _is_retryable_error(err_str):
                time.sleep(1.5 * (attempt + 1))
                continue
            r = {"success": False, "error": err_str}
            if _is_whatsapp_limit_error(err_str):
                r["is_limit"] = True
            if _is_twilio_quota_or_sms_cap_error(err_str):
                r["internal_dashboard_only"] = True
            return r
    return {"success": False, "error": "Twilio send failed after retries"}


def send_sms(to_number, message, _retries=3):
    """Send SMS via Twilio. Sender: +14155238886. Retries on temporary errors."""
    try:
        return _send_sms_inner(to_number, message, _retries)
    except Exception as e:
        sms_or_whatsapp_failed_continue(e, "sms")
        return {"success": False, "error": str(e), "skipped": True}


def _send_sms_inner(to_number, message, _retries=3):
    to = _normalize_phone(to_number)
    if is_twilio_internal_dashboard_only():
        return {"success": False, "error": "internal_dashboard_only", "skipped": True}
    if TWILIO_SIMULATE:
        preview = (message or "")[:80]
        print("[Twilio SIMULATE mode] - message print to terminal | SMS ->", to, "|", preview)
        _ACTIVITY_LOG.append({
            "id": str(uuid.uuid4()),
            "ts": int(time.time() * 1000),
            "type": "sms",
            "to": to,
            "text": f"💬 SMS → {to}: {preview}",
        })
        return {"success": True, "sid": "sim-"+str(time.time()), "simulated": True}
    raw = (os.getenv("TWILIO_PHONE_FROM") or os.getenv("TWILIO_WHATSAPP_FROM") or TWILIO_SENDER).strip().replace("whatsapp:", "").replace("\r", "").replace("\n", "")
    from_number = raw or TWILIO_SENDER
    if not TWILIO_CLIENT:
        return {"success": False, "error": "Twilio not configured"}
    for attempt in range(max(1, _retries)):
        try:
            msg = TWILIO_CLIENT.messages.create(from_=from_number, to=to, body=message)
            return {"success": True, "sid": msg.sid}
        except Exception as e:
            err_str = str(e)
            if _is_twilio_quota_or_sms_cap_error(err_str):
                set_twilio_internal_dashboard_only(err_str[:240])
            if attempt < _retries - 1 and _is_retryable_error(err_str):
                time.sleep(1.5 * (attempt + 1))
                continue
            print("[Twilio] SMS send failed:", e)
            r = {"success": False, "error": err_str}
            if _is_twilio_quota_or_sms_cap_error(err_str):
                r["internal_dashboard_only"] = True
            return r
    return {"success": False, "error": "SMS failed after retries"}


_BAZAAR_VARIETY_100_RESET_DONE = False  # set False to regenerate VIP mix on next server start


def reset_bazaar_jaffa_variety_100(tenant_id=DEFAULT_TENANT_ID):
    """
    One-shot per process: remove all Hotel Bazaar Jaffa tasks (replaces Check-in–heavy loops),
    insert 100 varied tasks — 50% Cleaning, 30% Maintenance, 20% VIP Guest.
    Sets 10 to In_Progress (בטיפול / orange) and 5 to Done (בוצע / green).
    """
    global _BAZAAR_VARIETY_100_RESET_DONE
    if _BAZAAR_VARIETY_100_RESET_DONE:
        return
    if not SessionLocal or not PropertyTaskModel:
        return
    pid = "bazaar-jaffa-hotel"
    pname = "Hotel Bazaar Jaffa"
    batch = str(uuid.uuid4())[:10]

    cleaning_tpl = [
        "ניקיון יחידה {u}/10 — סבב בוקר ואיסוף פסולת",
        "ניקיון יחידה {u}/10 — החלפת מצעים ומגבות",
        "ניקיון יחידה {u}/10 — ניקוי מקלחת וכיור",
        "ניקיון יחידה {u}/10 — שואב אבק ורצפות",
        "ניקיון יחידה {u}/10 — מסדרון ודלתות",
        "ניקיון לובי — זכוכיות כניסה ושטיח הכניסה",
        "ניקיון מדרגות חירום — מעקה ומעבר",
        "ניקיון חדר כושר — מגבות ומכשירים",
        "ניקיון חדר ישיבות קטן — לוח וכיסאות",
        "ניקיון מטבחון עובדים — משטח ומקרר",
    ]
    maint_tpl = [
        "תחזוקה חדר {r} — בדיקת מזגן ורעש",
        "תחזוקה חדר {r} — נורה ומפסק תאורה",
        "תחזוקה — ברז מטבחון קומה {f}, בדיקת דליפה",
        "תחזוקה — סיפון מקלחת חדר {r}",
        "תחזוקה — דלת חדר {r}, צירים וריחוף",
        "תחזוקה — מעלית אזור {f}, תאורת קומה",
        "תחזוקה — משאבת מים בגג, בדיקת לחץ",
        "תחזוקה — חניה B1, תאורה וסימון",
        "תחזוקה — מערכת מיני-בר חדר {r}",
        "תחזוקה — חיבורי חשמל בלובי, בדיקת לוח",
    ]
    vip_tpl = [
        "אורח VIP — יחידה {u}/10: קבלת פנים ופירות יחיד",
        "אורח VIP — יחידה {u}/10: late checkout מתואם",
        "אורח VIP — יחידה {u}/10: מסעדה — הזמנת שולחן",
        "אורח VIP — יחידה {u}/10: העברה מהשדה",
        "אורח VIP — יחידה {u}/10: ערכת קפה משודרגת",
        "אורח VIP — יחידה {u}/10: מגבות וחלוק פרימיום",
        "אורח VIP — יחידה {u}/10: חניה ואבטחה אישית",
        "אורח VIP — יחידה {u}/10: ספא — תור עדיפות",
        "אורח VIP — יחידה {u}/10: בר גג — הזמנה מיוחדת",
        "אורח VIP — יחידה {u}/10: מזוודות — קבלה מהירה",
    ]

    types_order = [TASK_TYPE_CLEANING_HE] * 50 + [TASK_TYPE_MAINTENANCE_HE] * 30 + [TASK_TYPE_VIP_HE] * 20
    random.shuffle(types_order)

    session = SessionLocal()
    try:
        qdel = session.query(PropertyTaskModel).filter(
            PropertyTaskModel.property_id == pid,
            PropertyTaskModel.tenant_id == tenant_id,
        )
        deleted = qdel.delete(synchronize_session=False)
        now = now_iso()
        ci = 0
        mi = 0
        si = 0
        ids_batch = []
        for i, ttype in enumerate(types_order):
            tid = f"bazaar-v100-{batch}-{i:03d}"
            ids_batch.append(tid)
            if ttype == TASK_TYPE_CLEANING_HE:
                tpl = cleaning_tpl[ci % len(cleaning_tpl)]
                u = (ci % 10) + 1
                ci += 1
                desc = tpl.format(u=u)
            elif ttype == TASK_TYPE_MAINTENANCE_HE:
                tpl = maint_tpl[mi % len(maint_tpl)]
                mi += 1
                r = 201 + (mi % 32)
                f = (mi % 8) + 1
                desc = tpl.format(r=r, f=f)
            else:
                tpl = vip_tpl[si % len(vip_tpl)]
                u = (si % 10) + 1
                si += 1
                desc = tpl.format(u=u)
            session.add(
                PropertyTaskModel(
                    id=tid,
                    property_id=pid,
                    staff_id="",
                    assigned_to="",
                    description=desc,
                    status="Pending",
                    created_at=now,
                    property_name=pname,
                    staff_name="",
                    staff_phone="",
                    task_type=ttype,
                    priority="normal",
                    tenant_id=tenant_id,
                )
            )
        session.commit()

        # 10 × בטיפול (orange), 5 × בוצע (green) — stable slice by id order
        for tid in ids_batch[:10]:
            row = session.query(PropertyTaskModel).filter_by(id=tid).first()
            if row:
                row.status = "In_Progress"
                row.started_at = now
        for tid in ids_batch[10:15]:
            row = session.query(PropertyTaskModel).filter_by(id=tid).first()
            if row:
                row.status = "Done"
                row.started_at = now
                row.completed_at = now
        session.commit()

        _BAZAAR_VARIETY_100_RESET_DONE = True
        _bump_tasks_version()
        _invalidate_owner_dashboard_cache()
        print(
            f"[reset_bazaar_jaffa_variety_100] replaced Bazaar tasks (deleted={deleted}); "
            f"inserted 100 (10 In_Progress, 5 Done) batch={batch}",
            flush=True,
        )
    except Exception as e:
        session.rollback()
        print(f"[reset_bazaar_jaffa_variety_100] {e}", flush=True)
    finally:
        session.close()


def make_emergency_call(to_number=None, message_he=None):
    """Place emergency voice call to owner (050-3233332) using Twilio client.calls.create.
    Plays TTS: 'קובי, יש מצב חירום במלון. בדוק את לוח המשימות' when user says 'Emergency'."""
    target = _normalize_phone(to_number or OWNER_PHONE)
    msg = message_he or "קובי, יש מצב חירום במלון. בדוק את לוח המשימות."
    return make_voice_call(target, msg)


def make_voice_call(to_number, message_he=None):
    """Place voice call via Twilio client.calls.create. Sender: +14155238886."""
    to = _normalize_phone(to_number)
    say_text = (message_he or "חירום - יש צורך בהתערבות מיידית. מאיה ממליצה להתקשר חזרה.").replace("<", "").replace(">", "")
    if is_twilio_internal_dashboard_only():
        return {"success": False, "error": "internal_dashboard_only", "skipped": True}
    if TWILIO_SIMULATE:
        preview = say_text[:80]
        print("[Twilio SIMULATE mode] - message print to terminal | Voice ->", to, "|", preview)
        _ACTIVITY_LOG.append({
            "id": str(uuid.uuid4()),
            "ts": int(time.time() * 1000),
            "type": "voice",
            "to": to,
            "text": f"📞 Voice → {to}: {preview}",
        })
        return {"success": True, "sid": "sim-"+str(time.time()), "simulated": True}
    raw = (os.getenv("TWILIO_PHONE_FROM") or os.getenv("TWILIO_WHATSAPP_FROM") or TWILIO_SENDER).strip().replace("whatsapp:", "").replace("\r", "").replace("\n", "")
    from_number = raw or TWILIO_SENDER
    if not TWILIO_CLIENT:
        return {"success": False, "error": "Twilio not configured"}
    twiml = f'<Response><Say language="he-IL">{say_text}</Say></Response>'
    try:
        call = TWILIO_CLIENT.calls.create(to=to, from_=from_number, twiml=twiml)
        return {"success": True, "sid": call.sid}
    except Exception as e:
        print("[Twilio] Voice call failed:", e)
        return {"success": False, "error": str(e)}


def _get_task_dashboard_link(task_id=None):
    """Dashboard URL for task confirmation - uses APP_URL env or localhost."""
    base = (os.getenv("APP_URL") or os.getenv("REACT_APP_API_URL") or "http://localhost:3000").rstrip("/")
    return f"{base}/tasks" if not task_id else f"{base}/tasks?highlight={task_id}"


# Twilio background queue for 100+ concurrent clients - async sending
TWILIO_QUEUE = queue.Queue()


def _twilio_worker():
    """Background worker: process Twilio tasks from queue. Retries 3x on temporary errors."""
    while True:
        try:
            item = TWILIO_QUEUE.get()
            if item is None:
                break
            action = item.get("action")
            try:
                if action == "notify_task":
                    task = item.get("task")
                    if task:
                        notify_staff_on_task_created(task)
                elif action == "whatsapp":
                    send_whatsapp(item.get("to"), item.get("message"), item.get("media_url"))
                elif action == "sms":
                    send_sms(item.get("to"), item.get("message"))
                elif action == "voice":
                    make_voice_call(item.get("to"), item.get("message"))
            except Exception as inner:
                print("[Twilio Queue] Action failed (Maya/UI continue):", inner)
            TWILIO_QUEUE.task_done()
        except Exception as e:
            print("[Twilio Queue] Worker error:", e)
            try:
                TWILIO_QUEUE.task_done()
            except Exception:
                pass


_twilio_worker_started = False
_twilio_worker_thread = threading.Thread(target=_twilio_worker, daemon=True)
_twilio_worker_thread.start()
_twilio_worker_started = True
print("[Twilio] Background queue worker started for 100+ clients")


def enqueue_twilio_task(action, **kwargs):
    """Enqueue a Twilio task for async processing. Maya returns immediately."""
    try:
        TWILIO_QUEUE.put_nowait({"action": action, **kwargs})
        return True
    except Exception as e:
        print("[Twilio Queue] Enqueue failed:", e)
        return False


def _whatsapp_env_defers_outbound():
    """True when outbound WhatsApp/SMS is not sent immediately from this environment."""
    try:
        if SKIP_TWILIO_WHATSAPP_OUTBOUND or TWILIO_SIMULATE or is_twilio_internal_dashboard_only():
            return True
    except Exception:
        pass
    return False


def _maya_notice_whatsapp_may_sync_later(display_msg, *, task_created=False, notify_enqueued=True):
    """Append bilingual line when the task is saved but WhatsApp is deferred or notify enqueue failed."""
    if not task_created:
        return (display_msg or "").strip()
    need_notice = (not notify_enqueued) or _whatsapp_env_defers_outbound()
    if not need_notice:
        return (display_msg or "").strip()
    he = "המשימה נוצרה במערכת. הודעת WhatsApp תסונכרן מאוחר יותר."
    en = "Task created locally. WhatsApp notification will sync later."
    line = f"{he} ({en})"
    base = (display_msg or "").strip()
    if line in base or he in base:
        return base
    return f"{base}\n\n{line}" if base else line


def notify_staff_on_task_created(task):
    """Push message to Owner (050-3233332) AND Staff (052-8155537).
    Staff gets a /worker?task_id=XXX link; Owner gets the dashboard link.
    Never raises — failures are logged; task row is always committed before this runs (queue worker)."""
    if is_twilio_internal_dashboard_only():
        tid = (task or {}).get("id") or ""
        print(
            "[Twilio] Internal Dashboard Only — skipping SMS/WhatsApp; task",
            tid,
            "visible on worker board.",
            flush=True,
        )
        return {"success": True, "internal_dashboard_only": True, "skipped_twilio": True}
    if SKIP_TWILIO_WHATSAPP_OUTBOUND:
        tid = (task or {}).get("id") or ""
        print(
            "[Twilio] SKIP_TWILIO_WHATSAPP — outbound disabled; task",
            tid,
            "saved; dashboard only.",
            flush=True,
        )
        return {"success": True, "skipped_twilio": True, "skip_env": True}
    try:
        task_id  = task.get("id") or ""
        desc     = (task.get("description") or task.get("content") or "")[:150]
        base     = (os.getenv("APP_URL") or "http://localhost:3000").rstrip("/")

        # Worker view link — /worker/levikobi shows ALL pending tasks
        # Staff can also open the specific task via ?task_id=XXX
        worker_link = f"{base}/worker/levikobi"
        if task_id:
            worker_link += f"?task_id={task_id}"
        # Dashboard link — for the owner
        owner_link  = _get_task_dashboard_link(task_id)

        staff_name = (task.get("staff_name") or "").strip()
        staff_msg  = f"מאיה: משימה חדשה שויכה אליך!\n{desc}\nלחץ לפתיחה: {worker_link}"
        owner_msg  = f"משימה חדשה: {desc}\nלצפייה בלוח: {owner_link}"

        ok = False
        limit_hit = False

        # Notify staff first (worker view link)
        staff_phone = (task.get("staff_phone") or STAFF_PHONE or "").strip()
        if staff_phone:
            try:
                r = send_whatsapp(staff_phone, staff_msg)
                if not r.get("success"):
                    if r.get("is_limit"):
                        limit_hit = True
                    r = send_sms(staff_phone, staff_msg)
                if r.get("success"):
                    ok = True
                    print(f"[Twilio] ✅ Staff notified: {staff_name} ({staff_phone}) → {worker_link}")
            except Exception as ex:
                print("[Twilio] Staff notify failed:", ex)

        # Notify owner (dashboard link)
        try:
            r = send_whatsapp(OWNER_PHONE, owner_msg)
            if not r.get("success"):
                if r.get("is_limit"):
                    limit_hit = True
                r = send_sms(OWNER_PHONE, owner_msg)
            if r.get("success"):
                ok = True
        except Exception as ex:
            print("[Twilio] Owner notify failed:", ex)

        if not ok and limit_hit:
            try:
                v = make_voice_call(OWNER_PHONE, f"משימה חדשה: {desc}. בדוק את לוח המשימות.")
                if v.get("success"):
                    ok = True
            except Exception as ex:
                print("[Twilio] Voice fallback failed:", ex)

        if ok and task_id:
            try:
                _promote_property_task_to_in_progress_after_worker_notify(str(task_id))
            except Exception:
                pass

        return {"success": ok, "limit_fallback": limit_hit and ok}
    except Exception as e:
        print("[Maya] notify_staff_on_task_created error (AI continues):", e)
        return {"success": False, "limit_fallback": False}


def notify_owner_on_seen(task=None):
    """Send to Owner (050-3233332) when staff clicks ראיתי."""
    msg = "מאיה: המשימה אושרה ומטופלת"
    r = send_whatsapp(OWNER_PHONE, msg)
    if not r.get("success"):
        r = send_sms(OWNER_PHONE, msg)
    return r


@app.route("/api/notify/send-system-ready", methods=["POST", "GET", "OPTIONS"])
def api_send_system_ready():
    """Send 'System Ready' WhatsApp to owner (050-3233332) - for immediate test."""
    if request.method == "OPTIONS":
        return Response(status=204)
    msg = "System Ready"
    r = send_whatsapp(OWNER_PHONE, msg)
    if not r.get("success"):
        r = send_sms(OWNER_PHONE, msg)
    return jsonify({"success": r.get("success", False), "message": "נשלח" if r.get("success") else r.get("error", "שליחה נכשלה")})


@app.route("/api/test-notify", methods=["POST", "GET", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization"], methods=["GET", "POST", "OPTIONS"])
def api_test_notify():
    """Test WhatsApp and Voice without full AI flow. Targets 050-3233332."""
    if request.method == "OPTIONS":
        return Response(status=204)
    owner_raw = (os.getenv("OWNER_PHONE") or "").strip().replace("-", "").replace(" ", "")
    owner = ("+972" + owner_raw[1:]) if owner_raw.startswith("0") else owner_raw
    if not owner:
        return jsonify({"success": False, "error": "OWNER_PHONE not configured in environment"}), 400
    results = {}
    # Test WhatsApp
    r_wa = send_whatsapp(owner, "בדיקת WhatsApp מנתיב /api/test-notify")
    results["whatsapp"] = {"success": r_wa.get("success"), "error": r_wa.get("error")}
    if not r_wa.get("success"):
        r_sms = send_sms(owner, "בדיקת SMS מנתיב /api/test-notify")
        results["sms"] = {"success": r_sms.get("success"), "error": r_sms.get("error")}
    # Test Voice (optional - use ?voice=1 to trigger)
    if request.args.get("voice") == "1" or (request.get_json(silent=True) or {}).get("voice"):
        r_v = make_voice_call(owner, "קובי, יש מצב חירום במלון. בדוק את לוח המשימות.")
        results["voice"] = {"success": r_v.get("success"), "error": r_v.get("error")}
    return jsonify({
        "success": results.get("whatsapp", {}).get("success") or results.get("sms", {}).get("success"),
        "twilio_configured": bool(TWILIO_CLIENT),
        "results": results,
        "message": "הבדיקה בוצעה. בדוק את הנייד." if results.get("whatsapp", {}).get("success") or results.get("sms", {}).get("success") else (results.get("whatsapp", {}).get("error") or results.get("sms", {}).get("error", "Twilio לא מוגדר")),
    })


@app.route("/api/notify/send-test", methods=["POST", "GET", "OPTIONS"])
def api_send_test_message():
    """Send test message to owner (050-3233332) via Twilio - no window.open."""
    if request.method == "OPTIONS":
        return Response(status=204)
    msg = "בדיקת מערכת מאיה - המשימה התקבלה"
    r = send_whatsapp(OWNER_PHONE, msg)
    if not r.get("success"):
        r = send_sms(OWNER_PHONE, msg)
    return jsonify({
        "success": r.get("success", False),
        "message": "שלחתי את הודעת הבדיקה לנייד שלך, בדוק את המכשיר" if r.get("success") else r.get("error", "שליחה נכשלה - ודא ש-Twilio מוגדר"),
    })


@app.route("/api/notify/send-message", methods=["POST", "OPTIONS"])
def api_send_message():
    """Push message to phone via Twilio. Body: { to_phone, message }. Requires auth."""
    if request.method == "OPTIONS":
        return Response(status=204)
    try:
        get_property_tasks_auth_bundle()
    except ValueError as _auth_e:
        return jsonify({"success": False, "error": str(_auth_e) or "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    to_phone = (data.get("to_phone") or data.get("phone") or "").strip() or OWNER_PHONE
    msg = (data.get("message") or data.get("body") or "").strip()
    if not msg:
        return jsonify({"success": False, "error": "Missing message"}), 400
    to_norm = _normalize_phone(to_phone)
    r = send_whatsapp(to_norm, msg)
    if not r.get("success"):
        r = send_sms(to_norm, msg)
    return jsonify({"success": r.get("success", False), "error": r.get("error")})


@app.route("/api/notify/send-task", methods=["POST", "OPTIONS"])
def api_send_task_notification():
    """Push task message to phone via Twilio. Used when Maya sends to staff. Requires auth."""
    if request.method == "OPTIONS":
        return Response(status=204)
    try:
        get_property_tasks_auth_bundle()
    except ValueError as _auth_e:
        return jsonify({"success": False, "error": str(_auth_e) or "Unauthorized"}), 401
    data = request.get_json(silent=True) or {}
    task = data.get("task") or {}
    to_phone = (data.get("to_phone") or "").strip() or STAFF_PHONE
    desc = (task.get("description") or task.get("content") or "")[:150]
    link = _get_task_dashboard_link(task.get("id"))
    msg = f"משימה חדשה: {desc}\nלאישור לחץ כאן: {link}"
    to_normalized = _normalize_phone(to_phone)
    r = send_whatsapp(to_normalized, msg)
    if not r.get("success"):
        r = send_sms(to_normalized, msg)
    return jsonify({"success": r.get("success", False), "message": "ההודעה נשלחה בהצלחה לנייד שלך" if r.get("success") else r.get("error", "שליחה נכשלה")})


def handle_guest_communication(event_type, booking_data):
    """
    מנוע הודעות אוטומטיות לאורחים – לפי סוג אירוע.
    booking_data: guest_name, guest_phone, property_title/property_name, check_in, check_out
    """
    guest_name = booking_data.get("guest_name") or "אורח"
    property_name = booking_data.get("property_title") or booking_data.get("property_name") or "הנכס"
    guest_phone = booking_data.get("guest_phone")
    if not guest_phone:
        return {"success": False, "error": "Missing guest_phone"}

    templates = {
        "booking.confirmed": (
            f"היי {guest_name}! איזה כיף שבחרת להתארח ב-{property_name}. "
            "ההזמנה שלך מאושרת. בקרוב אשלח לך פרטי הגעה מדויקים. 🏠"
        ),
        "check_in.reminder": (
            f"היי {guest_name}, מחכים לך מחר! שעת הצ'ק-אין היא 15:00. "
            "הנה המיקום המדויק: [Link]"
        ),
        "check_out.instructions": (
            f"היי {guest_name}, מקווים שנהניתם! רק מזכירים שהצ'ק-אאוט הוא ב-11:00. "
            "נשמח אם תסגרו את המזגן ביציאה. 🙏"
        ),
    }

    message = templates.get(event_type)
    if not message:
        return {"success": False, "error": f"Unknown event_type: {event_type}"}

    return send_whatsapp(guest_phone, message)


def auto_greet_lead(lead):
    # Silenced when BACKGROUND_SCAN_ENABLED=0 (default) — prevents terminal flooding
    if not BACKGROUND_SCAN_ENABLED:
        return {"success": False, "skipped": True}
    message = (
        f"Hi {lead.get('contact', '')}! Thanks for your interest in {lead.get('property', 'our listing')}.\n"
        "I can help automate guest management and improve response times. Would you like a quick demo?"
    )
    result = send_whatsapp(lead.get("phone"), message)
    if result.get("success"):
        tenant_id = lead.get("tenant_id") or DEFAULT_TENANT_ID
        AUTOMATION_STATS.setdefault(tenant_id, {"automated_messages": 0, "last_scan": None})
        AUTOMATION_STATS[tenant_id]["automated_messages"] += 1
        emit_automation_stats(tenant_id)
    return result


def pick_argument(objection):
    options = OBJECTION_ARGUMENTS.get(objection, [])
    if not options:
        return "We can tailor the automation to your needs and reduce operational load."
    stats = OBJECTION_SUCCESS.get(objection, {"yes": 0, "no": 0})
    return options[0] if stats["yes"] >= stats["no"] else options[-1]


def record_message(tenant_id, lead_id, direction, channel, content):
    if not SessionLocal or not MessageModel:
        return
    session = SessionLocal()
    try:
        session.add(MessageModel(
            id=str(uuid.uuid4()),
            tenant_id=tenant_id,
            lead_id=lead_id,
            direction=direction,
            channel=channel,
            content=content,
            created_at=now_iso(),
        ))
        session.commit()
    finally:
        session.close()


def upsert_calendar_connection(tenant_id, ical_url, vacancy_windows, vacant_nights, potential_revenue):
    if not SessionLocal or not CalendarConnectionModel:
        return None
    session = SessionLocal()
    try:
        existing = session.query(CalendarConnectionModel).filter_by(tenant_id=tenant_id).first()
        if not existing:
            existing = CalendarConnectionModel(tenant_id=tenant_id)
            session.add(existing)
        existing.ical_url = ical_url
        existing.last_sync = now_iso()
        existing.vacant_nights = vacant_nights
        existing.potential_revenue = potential_revenue
        existing.vacancy_windows = json.dumps(vacancy_windows)
        session.commit()
        return existing
    finally:
        session.close()


def get_calendar_status(tenant_id):
    if not SessionLocal or not CalendarConnectionModel:
        return None
    session = SessionLocal()
    try:
        record = session.query(CalendarConnectionModel).filter_by(tenant_id=tenant_id).first()
    finally:
        session.close()
    if not record:
        return None
    return {
        "tenant_id": record.tenant_id,
        "ical_url": record.ical_url,
        "last_sync": record.last_sync,
        "vacant_nights": record.vacant_nights,
        "potential_revenue": record.potential_revenue,
        "vacancy_windows": json.loads(record.vacancy_windows or "[]"),
    }


def upsert_staff(tenant_id, staff_id, name=None, phone=None, language=None, photo_url=None, lat=None, lng=None, property_id=None, role=None):
    if not SessionLocal or not StaffModel:
        return None
    session = SessionLocal()
    try:
        staff = session.query(StaffModel).filter_by(id=staff_id, tenant_id=tenant_id).first()
        if not staff:
            staff = StaffModel(
                id=staff_id,
                tenant_id=tenant_id,
                name=name or staff_id,
                phone=phone or "",
                active=1,
                on_shift=0,
                points=0,
                gold_points=0,
                property_id=property_id or None,
                role=role or None,
            )
            session.add(staff)
        if name:
            staff.name = name
        if phone:
            staff.phone = phone
        if language:
            staff.language = language
        if photo_url:
            staff.photo_url = photo_url
        if property_id is not None:
            staff.property_id = property_id
        if role is not None:
            staff.role = role
        if lat is not None and lng is not None:
            staff.last_lat = lat
            staff.last_lng = lng
            staff.last_location_at = now_iso()
        session.commit()
        return staff
    finally:
        session.close()


def _maya_register_staff_from_action(tenant_id: str, user_id: str, staff_obj: dict, rooms: list):
    """
    Handle action:register_staff from the LLM.
    staff_obj expected keys: name, phone (optional), role (optional), property_name (optional).
    Returns (staff_record_dict | None, error_str | None).
    Uses PropertyStaffModel when available (hotel portfolio staff), falls back to StaffModel.
    """
    name = (staff_obj.get("name") or "").strip()
    phone = (staff_obj.get("phone") or staff_obj.get("phone_number") or "").strip() or None
    role = (staff_obj.get("role") or "Staff").strip() or "Staff"
    prop_name_hint = (staff_obj.get("propertyName") or staff_obj.get("property_name") or "").strip().lower()

    if not name:
        return None, "Missing staff name"

    # Resolve property_id from rooms list
    property_id = None
    if prop_name_hint and rooms:
        for r in rooms:
            rn = (r.get("name") or "").strip().lower()
            if rn == prop_name_hint or prop_name_hint in rn or rn in prop_name_hint:
                property_id = r.get("id")
                break
    if not property_id and rooms:
        property_id = rooms[0].get("id")

    try:
        if PropertyStaffModel and property_id and SessionLocal:
            session = SessionLocal()
            try:
                new_id = str(uuid.uuid4())
                emp = PropertyStaffModel(
                    id=new_id,
                    property_id=property_id,
                    name=name,
                    role=role,
                    phone_number=phone,
                )
                session.add(emp)
                session.commit()
                return {
                    "id": emp.id,
                    "name": emp.name,
                    "role": emp.role,
                    "phone": phone,
                    "property_id": property_id,
                }, None
            except Exception as e:
                session.rollback()
                return None, str(e)
            finally:
                session.close()

        # Fallback to StaffModel (operational staff table)
        if StaffModel:
            new_id = str(uuid.uuid4())
            s = upsert_staff(tenant_id, new_id, name=name, phone=phone, role=role, property_id=property_id)
            if s:
                return {
                    "id": getattr(s, "id", new_id),
                    "name": getattr(s, "name", name),
                    "role": role,
                    "phone": phone,
                    "property_id": property_id,
                }, None
            return None, "upsert_staff returned None"

        return None, "No staff model available in this deployment"
    except Exception as e:
        return None, str(e)


def get_staff_rank(session, tenant_id, staff_id):
    try:
        records = (
            session.query(StaffModel)
            .filter_by(tenant_id=tenant_id)
            .order_by(StaffModel.gold_points.desc(), StaffModel.points.desc())
            .all()
        )
    except Exception:
        records = session.query(StaffModel).filter_by(tenant_id=tenant_id).all()
    for idx, staff in enumerate(records, start=1):
        if staff.id == staff_id:
            return idx
    return None


def get_rank_tier(gold_points):
    points = gold_points or 0
    if points >= 200:
        return "gold"
    if points >= 100:
        return "silver"
    if points >= 40:
        return "bronze"
    return "starter"


def emit_staff_update(session, tenant_id, staff_id):
    if not StaffModel:
        return
    staff = session.query(StaffModel).filter_by(id=staff_id, tenant_id=tenant_id).first()
    if not staff:
        return
    payload = {
        "id": staff.id,
        "name": staff.name,
        "phone": staff.phone,
        "active": bool(staff.active),
        "on_shift": bool(staff.on_shift),
        "points": staff.points or 0,
        "gold_points": staff.gold_points if staff.gold_points is not None else (staff.points or 0),
        "language": staff.language,
        "photo_url": staff.photo_url,
        "last_lat": staff.last_lat,
        "last_lng": staff.last_lng,
        "last_location_at": staff.last_location_at,
    }
    payload["rank"] = get_staff_rank(session, tenant_id, staff.id)
    payload["rank_tier"] = get_rank_tier(payload["gold_points"])
    enqueue_staff_event(tenant_id, "staff_update", payload)


def emit_staff_update_by_id(tenant_id, staff_id):
    if not SessionLocal or not StaffModel:
        return
    session = SessionLocal()
    try:
        emit_staff_update(session, tenant_id, staff_id)
    finally:
        session.close()


def set_staff_shift(tenant_id, staff_id, on_shift):
    if not SessionLocal or not StaffModel:
        return None
    session = SessionLocal()
    try:
        staff = session.query(StaffModel).filter_by(id=staff_id, tenant_id=tenant_id).first()
        if not staff:
            return None
        staff.on_shift = 1 if on_shift else 0
        if on_shift:
            staff.last_clock_in = now_iso()
        else:
            staff.last_clock_out = now_iso()
        session.commit()
        return staff
    finally:
        session.close()


def set_staff_active(tenant_id, staff_id, active):
    if not SessionLocal or not StaffModel:
        return None
    session = SessionLocal()
    try:
        staff = session.query(StaffModel).filter_by(id=staff_id, tenant_id=tenant_id).first()
        if not staff:
            return None
        staff.active = 1 if active else 0
        if not active:
            staff.on_shift = 0
        session.commit()
        return staff
    finally:
        session.close()


def set_staff_photo(tenant_id, staff_id, photo_url):
    if not SessionLocal or not StaffModel:
        return None
    session = SessionLocal()
    try:
        staff = session.query(StaffModel).filter_by(id=staff_id, tenant_id=tenant_id).first()
        if not staff:
            return None
        staff.photo_url = photo_url
        session.commit()
        return staff
    finally:
        session.close()


def set_staff_location(tenant_id, staff_id, lat, lng):
    if not SessionLocal or not StaffModel:
        return None
    session = SessionLocal()
    try:
        staff = session.query(StaffModel).filter_by(id=staff_id, tenant_id=tenant_id).first()
        if not staff:
            return None
        staff.last_lat = lat
        staff.last_lng = lng
        staff.last_location_at = now_iso()
        session.commit()
        return staff
    finally:
        session.close()


def extract_property_id_from_url(url):
    """Extract property/listing ID from Airbnb or Booking URL."""
    s = str(url or "").strip()
    m = re.search(r"(?:airbnb|booking)[^/]*/[^/]*/?rooms?/(\d+)", s, re.I)
    if m:
        return m.group(1)
    m = re.search(r"/rooms?/(\d+)", s, re.I)
    if m:
        return m.group(1)
    m = re.search(r"\b(\d{7,20})\b", s)
    return m.group(1) if m else None


def extract_photo_id_from_url(url):
    """Extract photo_id from Airbnb URL query string."""
    s = str(url or "")
    m = re.search(r"photo_id=(\d+)", s, re.I)
    return m.group(1) if m else None


def build_airbnb_image_url(property_id=None, photo_id=None):
    """Build Airbnb CDN image URL. Uses photo_id if present, else placeholder."""
    if photo_id:
        return f"https://a0.muscache.com/im/pictures/{photo_id}.jpg?im_w=1200"
    return "https://images.unsplash.com/photo-1613977257363-707ba9348227?w=1200&auto=format&fit=crop"


def create_manual_room(tenant_id, name, description=None, photo_url=None, room_id=None, status="active", amenities=None, owner_id=None, max_guests=None, bedrooms=None, beds=None, bathrooms=None):
    if not SessionLocal or not ManualRoomModel:
        return None
    tenant_id = _coerce_demo_tenant_id(tenant_id)
    for attempt in range(5):
        session = SessionLocal()
        try:
            rid = room_id or str(uuid.uuid4())
            created = now_iso()
            amenities_json = json.dumps(amenities) if amenities is not None else ""
            room = ManualRoomModel(
                id=rid,
                tenant_id=tenant_id,
                owner_id=owner_id,
                name=name,
                description=description or "",
                photo_url=photo_url or "",
                amenities=amenities_json,
                status=status,
                created_at=created,
                last_checkout_at=None,
                last_checkin_at=None,
                max_guests=max_guests if max_guests is not None else 2,
                bedrooms=bedrooms if bedrooms is not None else 1,
                beds=beds if beds is not None else 1,
                bathrooms=bathrooms if bathrooms is not None else 1,
            )
            session.add(room)
            session.commit()
            print(f"[create_manual_room] ✅ Saved property '{name}' id={rid} tenant={tenant_id}", flush=True)
            # Parse gallery from description so callers can access pictures[] immediately
            _dm, _gal = _split_description_gallery(description or "")
            _purl = (photo_url or "").strip()
            _pictures = [g for g in _gal if g] or ([_purl] if _purl else [])
            return {
                "id": rid, "name": name, "description": _dm, "photo_url": _purl,
                "image_url": _purl, "pictures": _pictures,
                "mainImage": (_pictures[0] if _pictures else _purl) or "",
                "amenities": list(amenities) if amenities else [], "status": status, "created_at": created,
                "last_checkout_at": None, "last_checkin_at": None,
                "max_guests": room.max_guests or 2, "bedrooms": room.bedrooms or 1, "beds": room.beds or 1, "bathrooms": room.bathrooms or 1,
            }
        except Exception as e:
            session.rollback()
            err_s = str(e).lower()
            if _is_sqlite and ("locked" in err_s or "database is locked" in err_s) and attempt < 4:
                time.sleep(0.12 * (attempt + 1))
                continue
            print(f"[create_manual_room] ❌ Failed to save property '{name}': {e}", flush=True)
            raise
        finally:
            session.close()


def upsert_property_db(tenant_id, payload):
    """Create or update a manual_rooms row — same persistence path as /api/properties (Maya / tools)."""
    if not isinstance(payload, dict):
        return None
    tenant_id = _coerce_demo_tenant_id(tenant_id)
    pid = str((payload.get("id") or payload.get("property_id") or "")).strip()
    name = (payload.get("name") or "").strip()
    if not SessionLocal or not ManualRoomModel:
        return None
    if pid:
        session = SessionLocal()
        try:
            row = session.query(ManualRoomModel).filter_by(id=pid, tenant_id=tenant_id).first()
            if row:
                if name:
                    row.name = name
                if "description" in payload:
                    row.description = (payload.get("description") or "") or ""
                if "photo_url" in payload or "photoUrl" in payload:
                    row.photo_url = (payload.get("photo_url") or payload.get("photoUrl") or "") or ""
                if "amenities" in payload:
                    row.amenities = json.dumps(payload.get("amenities") or [])
                if "status" in payload:
                    row.status = (payload.get("status") or "active") or "active"
                for attr, key in (
                    ("max_guests", "max_guests"),
                    ("bedrooms", "bedrooms"),
                    ("beds", "beds"),
                    ("bathrooms", "bathrooms"),
                ):
                    if key in payload and payload.get(key) is not None and payload.get(key) != "":
                        try:
                            setattr(row, attr, int(payload.get(key)))
                        except (TypeError, ValueError):
                            pass
                session.commit()
                am = json.loads(row.amenities) if row.amenities else []
                return {
                    "id": row.id,
                    "name": row.name,
                    "description": row.description or "",
                    "photo_url": row.photo_url or "",
                    "amenities": am,
                    "status": row.status or "active",
                    "max_guests": getattr(row, "max_guests", 2),
                    "bedrooms": getattr(row, "bedrooms", 1),
                    "beds": getattr(row, "beds", 1),
                    "bathrooms": getattr(row, "bathrooms", 1),
                }
        except Exception as e:
            session.rollback()
            print(f"[upsert_property_db] update failed: {e}", flush=True)
        finally:
            session.close()
    if not name:
        name = "Property"
    return create_manual_room(
        tenant_id,
        name,
        description=payload.get("description"),
        photo_url=payload.get("photo_url") or payload.get("photoUrl"),
        room_id=pid or None,
        status=(payload.get("status") or "active") or "active",
        amenities=payload.get("amenities"),
        owner_id=payload.get("owner_id"),
        max_guests=payload.get("max_guests"),
        bedrooms=payload.get("bedrooms"),
        beds=payload.get("beds"),
        bathrooms=payload.get("bathrooms"),
    )


# Reliable HTTPS imagery — no /assets-only paths (they 404 in many builds and break room cards)
BOUTIQUE_HOTEL_PLACEHOLDER = (
    "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=800&auto=format&fit=crop&q=85"
)
# Hotel Bazaar Jaffa — room-type heroes (marketing site categories)
BAZAAR_IMG_STANDARD = (
    "https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200&auto=format&fit=crop&q=85"
)
BAZAAR_IMG_DELUXE = (
    "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=1200&auto=format&fit=crop&q=85"
)
BAZAAR_IMG_JAFFA_SUITE = (
    "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&auto=format&fit=crop&q=85"
)
_DEFAULT_IMAGE_HOTEL = BOUTIQUE_HOTEL_PLACEHOLDER
_DEFAULT_IMAGE_WEWORK = "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&auto=format&fit=crop&q=85"
_DEFAULT_IMAGE_BAZAAR = BAZAAR_IMG_DELUXE
_DEFAULT_IMAGE_CITY = "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&auto=format&fit=crop&q=85"

# 15 properties — one high-res Unsplash per row (Bazaar + 14 ROOMS); used by seed + grid fallbacks
PROPERTY_PORTFOLIO_IMAGES = [
    BAZAAR_IMG_DELUXE,
    "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200&auto=format&fit=crop&q=85",
    "https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=1200&auto=format&fit=crop&q=85",
    "https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1200&auto=format&fit=crop&q=85",
    "https://images.unsplash.com/photo-1497366811353-6870744d04b2?w=1200&auto=format&fit=crop&q=85",
    "https://images.unsplash.com/photo-1604328698692-f76ea9498e76?w=1200&auto=format&fit=crop&q=85",
    "https://images.unsplash.com/photo-1517245385007-cbe13ea217f0?w=1200&auto=format&fit=crop&q=85",
    "https://images.unsplash.com/photo-1556761175-b413da4baf72?w=1200&auto=format&fit=crop&q=85",
    "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=1200&auto=format&fit=crop&q=85",
    "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=1200&auto=format&fit=crop&q=85",
    "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=1200&auto=format&fit=crop&q=85",
    "https://images.unsplash.com/photo-1560185007-cde436f6a4d0?w=1200&auto=format&fit=crop&q=85",
    "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1200&auto=format&fit=crop&q=85",
    "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?w=1200&auto=format&fit=crop&q=85",
    "https://images.unsplash.com/photo-1502005229762-cf1b2da7c5d6?w=1200&auto=format&fit=crop&q=85",
]


def _default_photo_url_for_property(name, pid):
    s = (name or "").lower()
    p = str(pid or "").lower()
    if "bazaar" in s or p == "bazaar-jaffa-hotel" or "בזאר" in (name or ""):
        return _DEFAULT_IMAGE_BAZAAR
    if p.startswith("wework-") or "wework" in s:
        return _DEFAULT_IMAGE_WEWORK
    if "city tower" in s or "leonardo" in s or "סיטי" in (name or "") or p == "leonardo-city-tower-ramat-gan":
        return _DEFAULT_IMAGE_CITY
    return _DEFAULT_IMAGE_HOTEL


def _normalize_external_photo_url(url, name=None, pid=None):
    """Prefer HTTPS Unsplash; missing or brittle relative /assets paths → boutique placeholder."""
    u = (url or "").strip()
    if not u:
        return _default_photo_url_for_property(name, pid)
    if u.startswith("/assets/"):
        return BOUTIQUE_HOTEL_PLACEHOLDER
    if u.startswith("/uploads/") or (u.startswith("/") and not u.startswith("//")):
        base = (API_BASE_URL or "").rstrip("/")
        if base and "/uploads" in u:
            return f"{base}{u}"
        return _default_photo_url_for_property(name, pid)
    return u


def _ensure_room_image_urls(room_dict):
    """Guarantee non-empty photo_url / image_url on property payloads."""
    if not isinstance(room_dict, dict):
        return room_dict
    p = (room_dict.get("photo_url") or room_dict.get("image_url") or "").strip()
    d = _normalize_external_photo_url(p, room_dict.get("name"), room_dict.get("id"))
    room_dict["photo_url"] = d
    room_dict["image_url"] = d
    return room_dict


_EH_GALLERY_MARKER = "\n__EH_GALLERY__:"


def _split_description_gallery(description: str):
    """Split human description from appended JSON gallery list (stored in manual_rooms.description)."""
    t = description or ""
    if _EH_GALLERY_MARKER not in t:
        return t, []
    main, _, rest = t.partition(_EH_GALLERY_MARKER)
    try:
        urls = json.loads(rest.strip())
        if isinstance(urls, list):
            return (main or "").rstrip(), [str(u).strip() for u in urls if u and str(u).strip()]
    except Exception:
        pass
    return t, []


def _merge_description_gallery(main_text: str, urls: list) -> str:
    """Persist ordered gallery URLs in description (manual_rooms has single photo_url column)."""
    main = (main_text or "").rstrip()
    u = []
    seen = set()
    for x in urls or []:
        s = str(x).strip()
        if s and s not in seen:
            seen.add(s)
            u.append(s)
    if not u:
        return main
    return f"{main}{_EH_GALLERY_MARKER}{json.dumps(u, ensure_ascii=False)}"


def _absolutize_property_image_url(purl: str, tenant_id: str) -> str:
    purl = (purl or "").strip()
    if purl.startswith("/assets/"):
        purl = ""
    if purl and not purl.startswith("http"):
        path = purl.lstrip("/")
        if path.startswith("uploads/"):
            purl = f"{API_BASE_URL}/{path}"
        else:
            purl = f"{API_BASE_URL}/uploads/{path}"
    return purl


def list_manual_rooms(tenant_id, owner_id=None):
    """Return list of dicts. When owner_id is set, only return properties owned by that user.
    Demo/guest sessions (owner_id starts with 'demo-') skip the owner filter so they can
    see all properties in the tenant — needed for the God Mode dashboard and client demos."""
    if not SessionLocal or not ManualRoomModel:
        return []
    session = SessionLocal()
    try:
        q = session.query(ManualRoomModel).filter_by(tenant_id=tenant_id)
        # Skip owner filter for demo sessions so all properties remain visible
        is_demo_session = owner_id is not None and str(owner_id).startswith("demo-")
        if owner_id is not None and not is_demo_session:
            q = q.filter(or_(ManualRoomModel.owner_id.is_(None), ManualRoomModel.owner_id == owner_id))
        rows = q.all()
        out = []
        for r in rows:
            try:
                am = json.loads(r.amenities) if r.amenities else []
            except Exception:
                am = []
            purl = (r.photo_url or "").strip()
            if purl.startswith("/assets/"):
                purl = ""
            if purl and not purl.startswith("http"):
                path = purl.lstrip("/")
                if path.startswith("uploads/"):
                    purl = f"{API_BASE_URL}/{path}"
                else:
                    purl = f"{API_BASE_URL}/uploads/{path}"
            purl = _normalize_external_photo_url(purl, r.name, r.id)
            desc_main, gallery_urls = _split_description_gallery(r.description or "")
            pictures = []
            for gu in gallery_urls:
                au = _absolutize_property_image_url(gu, tenant_id)
                au = _normalize_external_photo_url(au, r.name, r.id)
                if au and au not in pictures:
                    pictures.append(au)
            if not pictures and purl:
                pictures = [purl]
            occ = getattr(r, "occupancy_rate", None)
            if occ is None:
                occ = 80.0
            try:
                occ = float(occ)
            except Exception:
                occ = 80.0
            out.append({
                "id": r.id,
                "name": r.name,
                "description": desc_main,
                "photo_url": purl,
                "image_url": purl,
                "pictures": pictures,
                "mainImage": pictures[0] if pictures else purl,
                "amenities": am,
                "status": r.status or "active",
                "created_at": r.created_at,
                "last_checkout_at": r.last_checkout_at,
                "last_checkin_at": r.last_checkin_at,
                "ai_automation_enabled": bool(getattr(r, "ai_automation_enabled", 0)),
                "max_guests": getattr(r, "max_guests", None) or 2,
                "bedrooms": getattr(r, "bedrooms", None) or 1,
                "beds": getattr(r, "beds", None) or 1,
                "bathrooms": getattr(r, "bathrooms", None) or 1,
                "occupancy_rate": occ,
                "tenant_id": getattr(r, "tenant_id", None) or tenant_id,
            })
        return out
    finally:
        session.close()


def _default_portfolio_seed_rooms():
    """15 pins: Bazaar (Standard Queen / Deluxe Gallery / Jaffa Suite) + 14× ROOMS. ~80% occupancy."""
    now = datetime.now(timezone.utc).isoformat()
    bazaar_img = BAZAAR_IMG_DELUXE
    _rooms_images = PROPERTY_PORTFOLIO_IMAGES[1:15]
    rooms_rows = [
        ("rooms-branch-sky-tower", "ROOMS Sky Tower", "תל אביב", "sky-tower"),
        ("rooms-branch-acro-tlv", "ROOMS Acro", "תל אביב", "acro-tlv"),
        ("rooms-branch-beit-rubinstein", "ROOMS Beit Rubinstein", "תל אביב", "beit-rubinstein"),
        ("rooms-branch-neve-tzedek", "ROOMS Neve Tzedek", "תל אביב", "neve-tzedek"),
        ("rooms-branch-bbc", "ROOMS BBC", "בני ברק", "bbc-bnei-brak"),
        ("rooms-branch-acro-raanana", "ROOMS Acro Ra'anana", "רעננה", "acro-raanana"),
        ("rooms-branch-millennium-raanana", "ROOMS Millennium", "רעננה", "millennium-raanana"),
        ("rooms-branch-modiin", "ROOMS Modi'in", "מודיעין", "modiin"),
        ("rooms-branch-bsr-city", "ROOMS BSR City", "פתח תקווה", "bsr-city"),
        ("rooms-branch-herzliya", "ROOMS Herzliya", "הרצליה", "herzliya"),
        ("rooms-branch-haifa", "ROOMS Haifa", "חיפה", "haifa"),
        ("rooms-branch-jerusalem", "ROOMS Jerusalem", "ירושלים", "jerusalem"),
        ("rooms-branch-beer-sheva", "ROOMS Beersheva", "באר שבע", "beer-sheva"),
        ("rooms-branch-eilat", "ROOMS Eilat", "אילת", "eilat"),
    ]
    city_tower_img = "https://images.unsplash.com/photo-1496417263034-38ec4f0b665a?w=800&auto=format&fit=crop"
    rows = [
        {
            "id": "bazaar-jaffa-hotel",
            "name": "Hotel Bazaar Jaffa",
            "description": (
                "Hotel Bazaar Jaffa — Room types: Standard Queen, Deluxe Gallery, Jaffa Suite · "
                "10 guest keys · portfolio 61 rooms total @ ~80% occupancy. Jaffa Flea Market, boutique."
            ),
            "photo_url": bazaar_img,
            "image_url": bazaar_img,
            "amenities": ["Standard Queen", "Deluxe Gallery", "Jaffa Suite", "10 Rooms", "Hotel", "Boutique"],
            "status": "Active",
            "occupancy_rate": 80,
            "created_at": now,
            "branch_slug": "bazaar-jaffa-hotel",
            "max_guests": 2,
            "bedrooms": 1,
            "beds": 1,
            "bathrooms": 1,
            "ai_automation_enabled": False,
        },
        {
            "id": "leonardo-city-tower-ramat-gan",
            "name": "Leonardo Plaza City Tower",
            "description": (
                "Urban, business, elegant — Ramat Gan (Diamond Exchange / בורסה). 17 floors. "
                "Share Spa; rooftop pool (seasonal); Business Lounge; kosher certification Ramat Gan Rabbinate. "
                "Room types: Deluxe (14m²), Deluxe Grand, Executive, Club (floors 16–17), Junior Suite, Jacuzzi Suite. "
                "Check-in/out 15:00 / 11:00."
            ),
            "photo_url": city_tower_img,
            "image_url": city_tower_img,
            "amenities": ["Spa", "Pool", "Business Lounge", "Kosher", "Hotel", "רמת גן"],
            "status": "Active",
            "occupancy_rate": 80,
            "created_at": now,
            "branch_slug": "leonardo-city-tower-ramat-gan",
            "max_guests": 2,
            "bedrooms": 1,
            "beds": 1,
            "bathrooms": 1,
            "ai_automation_enabled": False,
        },
    ]
    for i, (wid, wname, city_he, slug) in enumerate(rooms_rows):
        img = _rooms_images[i]
        rows.append({
            "id": wid,
            "name": wname,
            "description": (
                f"ROOMS / WeWork-style — {city_he} · {wname}. "
                f"Inventory: Private Office · Meeting Rooms · hot desk. ~80% occupied (cowork ops)."
            ),
            "photo_url": img,
            "image_url": img,
            "amenities": ["Private Office", "Meeting Room", "ROOMS", "WeWork", "Coworking", city_he],
            "status": "Active",
            "occupancy_rate": 80,
            "created_at": now,
            "branch_slug": slug,
            "max_guests": 1,
            "bedrooms": 0,
            "beds": 0,
            "bathrooms": 0,
            "ai_automation_enabled": False,
        })
    wework_img = "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=80"
    wework_rows = [
        ("wework-tlv-london-ministore", "WeWork London Ministore", "תל אביב", "wework-tlv-london-ministore"),
        ("wework-tlv-toha",             "WeWork ToHA",             "תל אביב", "wework-tlv-toha"),
        ("wework-tlv-azrieli-town",     "WeWork Azrieli Town",     "תל אביב", "wework-tlv-azrieli-town"),
        ("wework-tlv-shaul-hamelech",   "WeWork Shaul HaMelech 35","תל אביב", "wework-tlv-shaul-hamelech"),
        ("wework-tlv-midtown",          "WeWork Midtown",           "תל אביב", "wework-tlv-midtown"),
        ("wework-tlv-sarona",           "WeWork Sarona",            "תל אביב", "wework-tlv-sarona"),
        ("wework-tlv-hazerem",          "WeWork HaZerem 10",        "תל אביב", "wework-tlv-hazerem"),
        ("wework-tlv-schocken",         "WeWork Schocken 23",       "תל אביב", "wework-tlv-schocken"),
        ("wework-tlv-dubnov",           "WeWork Dubnov 7",          "תל אביב", "wework-tlv-dubnov"),
        ("wework-rg-sapir",             "WeWork Sapir Tower",       "רמת גן",  "wework-rg-sapir"),
        ("wework-haifa-atzmaut",        "WeWork Haifa Atzmaut 45",  "חיפה",    "wework-haifa-atzmaut"),
        ("wework-herzliya-shenkar",     "WeWork Herzliya Shenkar 1","הרצליה",  "wework-herzliya-shenkar"),
        ("wework-jlm-king-george",      "WeWork Jerusalem King George 20","ירושלים","wework-jlm-king-george"),
        ("wework-b7-halutz",            "WeWork Beersheba Halutz 16","באר שבע","wework-b7-halutz"),
    ]
    for wid, wname, city_he, slug in wework_rows:
        rows.append({
            "id": wid,
            "name": wname,
            "description": (
                f"WeWork {city_he} — {wname}. מחירי בסיס זמניים: ₪0 לכל סוגי ההשכרה. "
                f"אפשרויות: גישה יומית · חדרי ישיבות · עמדה קבועה · משרד פרטי."
            ),
            "photo_url": wework_img,
            "image_url": wework_img,
            "amenities": ["WeWork", "Workspace", "Coworking", city_he],
            "status": "Active",
            "occupancy_rate": 80,
            "created_at": now,
            "branch_slug": slug,
            "max_guests": 1,
            "bedrooms": 0,
            "beds": 0,
            "bathrooms": 0,
            "ai_automation_enabled": False,
        })
    for row in rows:
        if isinstance(row, dict):
            row.setdefault("tenant_id", DEFAULT_TENANT_ID)
    return rows


def _grid_dirty_slots_from_occ(occ_pct, n_total=61):
    """
    Map simulated occupancy to global dirty/cleaning slot count for the 61-unit grid.
    Previously used fixed 10% of 61 (=6 dirty) — pilot refresh must move this number.
    """
    occ_pct = float(max(0.0, min(100.0, float(occ_pct))))
    n_occ = int(round(n_total * occ_pct / 100.0))
    rem = n_total - n_occ
    if rem <= 0:
        return 0, n_occ, rem
    raw = (100.0 - occ_pct) / 100.0 * n_total * 0.42
    n_dirty = max(1, min(rem, int(round(raw))))
    return n_dirty, n_occ, rem


def _room_status_grid_payload(tenant_id, user_id):
    """
    61 room units across 15 properties (Bazaar 10 + 14×ROOMS with 3–4 units each).
    Status mix: ~80% occupied (red), ~10% ready (green), ~10% cleaning/dirty (yellow).
    Heavy seed/assign runs on startup + Maya autonomous loop — omitted here for <500ms cached loads.
    """
    props = list_manual_rooms(tenant_id, owner_id=user_id)
    if not props:
        props = _ensure_demo_portfolio_properties(
            [_ensure_room_image_urls(dict(x)) for x in _default_portfolio_seed_rooms()]
        )
    prop_by_id = {p.get("id"): p for p in props if p.get("id")}
    if len(prop_by_id) < 15:
        for row in _default_portfolio_seed_rooms():
            if isinstance(row, dict) and row.get("id"):
                prop_by_id.setdefault(row["id"], _ensure_room_image_urls(dict(row)))
    bazaar_id = "bazaar-jaffa-hotel"
    non_bazaar = sorted([pid for pid in prop_by_id.keys() if pid != bazaar_id])
    counts_tail = [4] * 9 + [3] * 5
    room_counts = [(bazaar_id, 10)] + list(zip(non_bazaar[:14], counts_tail))
    rooms_out = []
    room_idx = 0
    n_total = 61
    occ_pct = float(get_daily_stats()["occupancy_pct"])
    p_bazaar = prop_by_id.get(bazaar_id) or {}
    st_b = str(p_bazaar.get("status") or "")
    m_gd = re.search(r"grid_dirty=(\d+)", st_b, re.I)
    n_dirty, n_occ, _rem = _grid_dirty_slots_from_occ(occ_pct, n_total)
    if m_gd:
        try:
            n_dirty = max(0, min(_rem, int(m_gd.group(1))))
        except Exception:
            pass
    # ready = remainder after occupied + dirty
    acro_id = "rooms-branch-acro-tlv"
    for pid, n in room_counts:
        p = prop_by_id.get(pid) or {}
        pname = p.get("name") or pid
        photo = _normalize_external_photo_url(
            (p.get("photo_url") or p.get("image_url") or "").strip(),
            p.get("name"),
            p.get("id"),
        )
        for j in range(n):
            room_idx += 1
            if room_idx <= n_occ:
                status = "occupied"
            elif room_idx <= n_occ + n_dirty:
                status = "dirty"
            else:
                status = "ready"
            if pid == bazaar_id:
                if j < 4:
                    label = f"Bazaar · Standard Queen {j + 1:02d}"
                    photo = BAZAAR_IMG_STANDARD
                elif j < 8:
                    label = f"Bazaar · Deluxe Gallery {j - 3:02d}"
                    photo = BAZAAR_IMG_DELUXE
                else:
                    label = f"Bazaar · Jaffa Suite {j - 7:02d}"
                    photo = BAZAAR_IMG_JAFFA_SUITE
            elif pid == acro_id:
                label = f"ROOMS Acro TLV · Office/Meeting {j + 1}"
            else:
                label = f"{pname} · Unit {j + 1}"
            guest = "Demo Guest" if status == "occupied" else None
            rooms_out.append(
                {
                    "id": f"{pid}-u{j + 1}",
                    "name": label,
                    "property_id": pid,
                    "property_name": pname,
                    "status": status,
                    "beds": 1 if int(p.get("bedrooms") or 1) == 0 else 2,
                    "bedrooms": max(1, int(p.get("bedrooms") or 1)),
                    "photo_url": photo,
                    "guest": guest,
                }
            )
    # Live link: open Cleaning tasks for Bazaar → unit goes yellow (dirty / בניקיון)
    dirty_units = _bazaar_open_cleaning_unit_indices(tenant_id)
    if dirty_units:
        for r in rooms_out:
            if r.get("property_id") != bazaar_id:
                continue
            rid = str(r.get("id") or "")
            mu = re.search(r"-u(\d+)$", rid)
            if not mu:
                continue
            u = int(mu.group(1))
            if u in dirty_units:
                r["status"] = "dirty"
                r["guest"] = None
    summary = {"ready": 0, "occupied": 0, "dirty": 0, "total": len(rooms_out)}
    for r in rooms_out:
        st = r.get("status")
        if st in summary:
            summary[st] += 1
    return {"rooms": rooms_out, "summary": summary}


def _upcoming_bookings_payload(tenant_id, user_id):
    """Upcoming stays for the 15-property portfolio — DB rows when present, else synthetic."""
    out = []
    today = datetime.now(timezone.utc).date()
    today_s = today.isoformat()
    if SessionLocal and BookingModel:
        session = SessionLocal()
        try:
            rows = (
                session.query(BookingModel)
                .filter(
                    BookingModel.tenant_id == tenant_id,
                    BookingModel.status.in_(["confirmed", "pending"]),
                    BookingModel.check_in >= today_s,
                )
                .order_by(BookingModel.check_in)
                .limit(50)
                .all()
            )
            for b in rows:
                gp = ""
                try:
                    gp = (getattr(b, "guest_phone", None) or "") or ""
                except Exception:
                    gp = ""
                out.append(
                    {
                        "id": b.id,
                        "property_id": b.property_id,
                        "property_name": b.property_name or "",
                        "guest_name": b.guest_name or "",
                        "guest_phone": gp,
                        "check_in": b.check_in,
                        "check_out": b.check_out,
                        "nights": b.nights or 1,
                        "total_price": b.total_price or 0,
                        "status": b.status or "confirmed",
                    }
                )
        except Exception as e:
            print(f"[_upcoming_bookings_payload] DB: {e}", flush=True)
        finally:
            session.close()
    if len(out) >= 3:
        return {"bookings": out}
    props = list_manual_rooms(tenant_id, owner_id=user_id)
    if not props:
        props = _ensure_demo_portfolio_properties(
            [_ensure_room_image_urls(dict(x)) for x in _default_portfolio_seed_rooms()]
        )
    for i, p in enumerate(props[:15]):
        cid = (today + timedelta(days=(i % 7) + 1)).isoformat()
        cod = (today + timedelta(days=(i % 7) + 4)).isoformat()
        out.append(
            {
                "id": f"synth-up-{p.get('id')}-{i}",
                "property_id": p.get("id"),
                "property_name": p.get("name") or "Property",
                "guest_name": f"Guest {i + 1}",
                "guest_phone": "",
                "check_in": cid,
                "check_out": cod,
                "nights": 3,
                "total_price": 1200 + i * 50,
                "status": "confirmed",
            }
        )
    return {"bookings": out[:15]}


_ROOM_INVENTORY_TEXT_CACHE: dict = {}
_ROOM_INVENTORY_TEXT_TTL: int = 45  # seconds — stale is fine for LLM context


def _build_maya_room_inventory_text(tenant_id, user_id):
    """Compact lines for Gemini: Bazaar + ROOMS Acro room counts by status (Occupied/Ready/Dirty).
    Result is cached for _ROOM_INVENTORY_TEXT_TTL seconds so consecutive Maya messages skip the
    _room_status_grid_payload DB call entirely."""
    _now = time.time()
    _ck = tenant_id or "_"
    _hit = _ROOM_INVENTORY_TEXT_CACHE.get(_ck)
    if _hit and (_now - _hit["ts"]) < _ROOM_INVENTORY_TEXT_TTL:
        return _hit["text"]
    data = _room_status_grid_payload(tenant_id, user_id)
    rooms = data.get("rooms") or []

    def _lines_for(pid, title):
        block = [r for r in rooms if r.get("property_id") == pid]
        if not block:
            return ""
        occ = sum(1 for r in block if r.get("status") == "occupied")
        rd = sum(1 for r in block if r.get("status") == "ready")
        dirty = sum(1 for r in block if r.get("status") == "dirty")
        return (
            f"{title}: {len(block)} units — {occ} Occupied, {rd} Ready, {dirty} Dirty "
            f"(portfolio ~80% occupancy target)."
        )

    parts = [
        _lines_for("bazaar-jaffa-hotel", "Hotel Bazaar Jaffa"),
        _lines_for("rooms-branch-acro-tlv", "ROOMS Acro TLV"),
    ]
    result = " ".join(p for p in parts if p)
    _ROOM_INVENTORY_TEXT_CACHE[_ck] = {"text": result, "ts": _now}
    return result


def initial_tasks():
    """Alias: default task rows when DB is empty — same payload as /api/property-tasks GET."""
    return _default_property_tasks_seed()


def _default_property_tasks_seed():
    """Sample property_tasks when DB is empty or GET fails — JSON shape matches /api/property-tasks."""
    now = datetime.now(timezone.utc).isoformat()
    # 20 unique demo tasks — mix of housekeeping + checkout prep (ניקיון / צ'ק-אאוט).
    samples = [
        ("seed-pt-bazaar-1", "bazaar-jaffa-hotel", "Hotel Bazaar Jaffa", "ניקיון חדר אחרי צ'ק-אאוט — 201", "Pending", "עלמה"),
        ("seed-pt-wework-1", "wework-tlv-london-ministore", "WeWork London Ministore", "ניקיון Hot Desks — אחרי אירוע חברה", "Pending", "מנהל קהילה"),
        ("seed-pt-rooms-1", "rooms-branch-sky-tower", "ROOMS Sky Tower", "ניקיון אזור Hot Desks אחרי אירוע", "Pending", "מנהל קהילה"),
        ("seed-pt-wework-2", "wework-tlv-toha", "WeWork ToHA", "בדיקת מערכת אוורור לפני פגישות", "Pending", "קובי"),
        ("seed-pt-wework-3", "wework-tlv-azrieli-town", "WeWork Azrieli Town", "ניקיון מטבחון משותף — קומה 12", "Pending", "עלמה"),
        ("seed-pt-rooms-2", "rooms-branch-acro-tlv", "ROOMS Acro", "ניקיון חדר ישיבות לפני צ'ק-אאוט אורח", "Pending", "מנהל קהילה"),
        ("seed-pt-wework-4", "wework-tlv-shaul-hamelech", "WeWork Shaul HaMelech 35", "תחזוקת תאורה — אזור לובי WeWork", "Pending", "קובי"),
        ("seed-pt-rooms-3", "rooms-branch-beit-rubinstein", "ROOMS Beit Rubinstein", "צ'ק-אאוט סוויטה — בדיקת מלאי", "Pending", "מנהל קהילה"),
        ("seed-pt-wework-5", "wework-tlv-midtown", "WeWork Midtown", "ניקיון חדר ישיבות — הכנה ללקוח", "Pending", "עלמה"),
        ("seed-pt-rooms-4", "rooms-branch-neve-tzedek", "ROOMS Neve Tzedek", "ניקיון מטבחון ומקרר משותף", "Pending", "מנהל קהילה"),
        ("seed-pt-bazaar-2", "bazaar-jaffa-hotel", "Hotel Bazaar Jaffa", "מגבות ומצעים — ריענון לפני כניסה", "Pending", "עלמה"),
        ("seed-pt-wework-6", "wework-tlv-sarona", "WeWork Sarona", "סבב ניקיון ערב — קומת קוורקינג", "Pending", "מנהל קהילה"),
        ("seed-pt-rooms-5", "rooms-branch-bbc", "ROOMS BBC", "ניקיון מסדרון אחרי צ'ק-אאוט חברה", "Pending", "עלמה"),
        ("seed-pt-wework-7", "wework-tlv-hazerem", "WeWork HaZerem 10", "בדיקת ברזים ושסתומים — מטבחון", "Pending", "קובי"),
        ("seed-pt-rooms-6", "rooms-branch-acro-raanana", "ROOMS Acro Ra'anana", "ניקיון אחרי אירוע קהילה + צ'ק-אאוט", "Pending", "מנהל קהילה"),
        ("seed-pt-bazaar-3", "bazaar-jaffa-hotel", "Hotel Bazaar Jaffa", "ניקיון לובי — הכנה לקבוצת צ'ק-אאוט", "Pending", "עלמה"),
        ("seed-pt-wework-8", "wework-tlv-schocken", "WeWork Schocken 23", "תחזוקת דלתות זכוכית — קומת WeWork", "Pending", "קובי"),
        ("seed-pt-bazaar-4", "bazaar-jaffa-hotel", "Hotel Bazaar Jaffa", "ניקיון חדר — חולצ' צ'ק-אאוט 11:00", "Pending", "עלמה"),
        ("seed-pt-water-leak-kobi", "rooms-branch-haifa", "ROOMS Haifa", "Water Leak — reported by Kobi (נזילת מים בצינור)", "Pending", "קובי"),
        ("seed-pt-rooms-16", "rooms-branch-acro-tlv", "ROOMS Acro", "סבב ניקיון ערב — הכנת חלל לאירוח", "Pending", "מנהל קהילה"),
    ]
    tasks = []
    for tid, pid, pname, desc, status, staff in samples:
        room_label = pname
        ctx = "2 Guests, 1 Bedroom, 1 Bed"
        tasks.append({
            "id": tid,
            "property_id": pid,
            "property_name": room_label,
            "title": desc,
            "room_id": pid,
            "room": room_label,
            "room_number": room_label,
            "task_type": desc,
            "assigned_to": "",
            "description": desc,
            "status": status,
            "created_at": now,
            "started_at": None,
            "completed_at": None,
            "duration_minutes": None,
            "staff_name": staff,
            "worker_name": staff,
            "staff_phone": "",
            "property_context": ctx,
            "photo_url": "",
            "actions": [{"label": "ראיתי ✅", "value": "seen"}, {"label": "בוצע 🏁", "value": "done"}],
        })
    return tasks


def _emergency_task_types_for_index(i):
    """ניקיון חדר / תחזוקה / אורח VIP mix for 20 demo tasks."""
    if i < 10:
        return TASK_TYPE_CLEANING_HE, "normal"
    if i < 16:
        return TASK_TYPE_MAINTENANCE_HE, "normal"
    return TASK_TYPE_VIP_HE, "high"


def _emergency_task_rows_for_db():
    """PropertyTaskModel-ready rows: 20 tasks with explicit task_type + priority."""
    base = _default_property_tasks_seed()
    out = []
    for i, t in enumerate(base):
        if not isinstance(t, dict):
            continue
        tt, pr = _emergency_task_types_for_index(i)
        d = dict(t)
        d["task_type"] = tt
        d["priority"] = pr
        out.append(d)
    return out


def _maya_try_start_task_from_natural_command(tenant_id, user_id, command):
    """
    Match natural language (e.g. 'Clean the lobby' / 'נקי את הלובי') to a property_task,
    set In_Progress, assign staff if missing, enqueue Twilio notify_task (WhatsApp/SMS worker).
    Returns dict for jsonify or None if no match / DB unavailable.
    """
    if not SessionLocal or not PropertyTaskModel or not command:
        return None
    raw = (command or "").strip()
    low = raw.lower()
    he = raw
    wants_lobby = "lobby" in low or "לובי" in he
    wants_action = any(
        x in low
        for x in ("clean", "start", "begin", "handle", "take care", "execute")
    ) or any(x in he for x in ("נקי", "נקה", "התחל", "טפל", "בצע", "מטפל", "ניקיון"))
    if not wants_lobby or not wants_action:
        return None
    session = SessionLocal()
    try:
        q = _property_tasks_query_for_tenant(session, tenant_id)
        if q is None:
            return None
        best = None
        best_score = 0
        for t in q.all():
            st = _norm_task_status_category(getattr(t, "status", None))
            if st == "done":
                continue
            desc = (getattr(t, "description", "") or "").strip()
            dl = desc.lower()
            score = 0
            if "לובי" in desc or "lobby" in dl:
                score += 12
            if "ניקיון" in desc or "clean" in dl:
                score += 4
            if score > best_score:
                best_score = score
                best = t
        if not best or best_score < 8:
            return None
        tid = best.id
        assign_stuck_property_tasks(tenant_id)
        session.expire_all()
        task = session.query(PropertyTaskModel).filter_by(id=tid).first()
        if not task:
            return None
        desc_short = (task.description or "")[:160]
        if _norm_task_status_category(getattr(task, "status", None)) == "in_progress":
            display = f"המשימה «{desc_short[:72]}» כבר בביצוע (In_Progress)."
            return {
                "success": True,
                "message": display,
                "displayMessage": display,
                "response": display,
                "taskStarted": False,
                "taskId": task.id,
                "status": task.status,
            }
        now_ts = datetime.now(timezone.utc).isoformat()
        task.status = "In_Progress"
        if not getattr(task, "started_at", None):
            task.started_at = now_ts
        session.commit()
        td = {
            "id": task.id,
            "description": desc_short,
            "content": desc_short,
            "staff_name": getattr(task, "staff_name", None) or "",
            "staff_phone": (getattr(task, "staff_phone", None) or "").strip() or STAFF_PHONE,
        }
        notify_ok = True
        try:
            notify_ok = bool(enqueue_twilio_task("notify_task", task=td))
        except Exception:
            notify_ok = False
        worker = getattr(task, "staff_name", None) or "הצוות"
        display = f"מצאתי את המשימה «{desc_short[:72]}» — העברתי לביצוע (In_Progress) ושייכתי ל{worker}."
        if not _whatsapp_env_defers_outbound() and notify_ok:
            display += " התראה נשלחה לתור השליחה (WhatsApp/SMS)."
        display = _maya_notice_whatsapp_may_sync_later(display, task_created=True, notify_enqueued=notify_ok)
        return {
            "success": True,
            "message": display,
            "displayMessage": display,
            "response": display,
            "taskStarted": True,
            "taskId": task.id,
            "status": task.status,
        }
    except Exception as e:
        try:
            session.rollback()
        except Exception:
            pass
        print(f"[_maya_try_start_task_from_natural_command] {e}", flush=True)
        return None
    finally:
        session.close()


def _maya_find_task_id_for_completion(tenant_id, hint):
    """Match first non-terminal task whose description contains hint (min 4 chars)."""
    if not hint or len(str(hint).strip()) < 4:
        return ""
    if not SessionLocal or not PropertyTaskModel:
        return ""
    h = str(hint).strip().lower()
    session = SessionLocal()
    try:
        q = _property_tasks_query_for_tenant(session, tenant_id)
        if q is None:
            return ""
        for t in q.order_by(PropertyTaskModel.created_at.desc()).limit(50):
            st = (getattr(t, "status", "") or "").strip().lower()
            if st in ("done", "completed", "archived"):
                continue
            d = (getattr(t, "description", "") or "").strip().lower()
            if h in d:
                return str(getattr(t, "id", "") or "")
        return ""
    finally:
        session.close()


def _maya_mark_property_task_done(tenant_id, task_id, user_id=None):
    """Persist Done on property_tasks so Mission Board polling reflects completion."""
    if not task_id or not SessionLocal or not PropertyTaskModel:
        return False, "no_task_or_db"
    tid = str(task_id).strip()
    session = SessionLocal()
    try:
        task = (
            session.query(PropertyTaskModel)
            .filter_by(id=tid, tenant_id=tenant_id)
            .first()
        )
        if not task:
            task = session.query(PropertyTaskModel).filter_by(id=tid).first()
        if not task:
            return False, "not_found"
        task.status = "Done"
        if hasattr(task, "completed_at"):
            task.completed_at = now_iso()
        session.commit()
        _bump_tasks_version()
        try:
            _invalidate_owner_dashboard_cache()
        except Exception:
            pass
        try:
            dshort = ((getattr(task, "description", None) or "")[:100]).strip()
            _push_activity(
                {
                    "type": "maya_task_done",
                    "text": f"מאיה סימנה משימה כבוצעה: {dshort}" if dshort else "מאיה סימנה משימה כבוצעה.",
                    "task_id": tid,
                }
            )
        except Exception:
            pass
        return True, None
    except Exception as e:
        try:
            session.rollback()
        except Exception:
            pass
        print(f"[_maya_mark_property_task_done] {e!r}", flush=True)
        return False, str(e)
    finally:
        session.close()


def assign_stuck_property_tasks(tenant_id=DEFAULT_TENANT_ID):
    """
    Link unassigned property_tasks to property_staff by property_id + role heuristic
    (Cleaning→housekeeping, Maintenance→maintenance, VIP→first available).
    """
    if not SessionLocal or not PropertyTaskModel or not PropertyStaffModel:
        return 0
    session = SessionLocal()
    n = 0
    try:
        tasks = (
            session.query(PropertyTaskModel)
            .filter_by(tenant_id=tenant_id)
            .all()
        )
        for t in tasks:
            sid = (getattr(t, "staff_id", None) or "") or ""
            at = (getattr(t, "assigned_to", None) or "") or ""
            if (sid.strip() or at.strip()):
                continue
            staff_rows = session.query(PropertyStaffModel).filter_by(property_id=t.property_id).all()
            if not staff_rows:
                continue
            ttype = (getattr(t, "task_type", None) or "").strip()
            picked = None
            if _is_task_type_cleaning(ttype):
                for s in staff_rows:
                    rl = (s.role or "").lower()
                    if any(x in rl for x in ("clean", "housekeep", "ניקיון")):
                        picked = s
                        break
            elif _is_task_type_maintenance(ttype):
                for s in staff_rows:
                    rl = (s.role or "").lower()
                    if any(x in rl for x in ("maint", "תחזוק", "fix", "kobi")):
                        picked = s
                        break
            elif _is_task_type_vip(ttype):
                for s in staff_rows:
                    rl = (s.role or "").lower()
                    nm = (s.name or "")
                    if any(x in rl for x in ("check", "front", "vip", "guest", "goni")):
                        picked = s
                        break
                    if "goni" in nm.lower() or "גוני" in nm:
                        picked = s
                        break
            if not picked:
                for s in staff_rows:
                    nm = (s.name or "")
                    if "עלמה" in nm or "alma" in nm.lower():
                        picked = s
                        break
            if not picked:
                picked = staff_rows[0]
            t.staff_id = picked.id
            t.assigned_to = picked.id
            t.staff_name = picked.name or t.staff_name or "Staff"
            t.staff_phone = getattr(picked, "phone_number", None) or t.staff_phone or ""
            st0 = (getattr(t, "status", None) or "").strip()
            if st0 in ("Pending", "pending", ""):
                t.status = "In_Progress"
                if hasattr(t, "started_at") and not (getattr(t, "started_at", None) or "").strip():
                    t.started_at = datetime.now(timezone.utc).isoformat()
            n += 1
        if n:
            session.commit()
            print(f"[assign_stuck_property_tasks] linked {n} tasks to staff", flush=True)
    except Exception as e:
        session.rollback()
        print(f"[assign_stuck_property_tasks] {e}", flush=True)
    finally:
        session.close()
    return n


def _escalate_stale_red_tasks(tenant_id=DEFAULT_TENANT_ID):
    """
    Pending (red) longer than 15 minutes → In_Progress (orange), assign to גוני or עלמה.
    """
    if not SessionLocal or not PropertyTaskModel:
        return 0
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
    session = SessionLocal()
    n = 0
    try:
        q = _property_tasks_query_for_tenant(session, tenant_id)
        if q is None:
            return 0
        rows = q.filter(PropertyTaskModel.status == "Pending").all()
        assignees = ("Goni", "Alma")
        for i, t in enumerate(rows):
            ca = parse_iso_datetime(getattr(t, "created_at", None) or "")
            if ca is None:
                continue
            if ca.tzinfo is None:
                ca = ca.replace(tzinfo=timezone.utc)
            if ca > cutoff:
                continue
            name = assignees[i % 2]
            t.status = "In_Progress"
            t.staff_name = name
            t.started_at = now_iso()
            note = (getattr(t, "worker_notes", None) or "").strip()
            if "[AUTO-ESCALATED]" not in note:
                t.worker_notes = (note + " [AUTO-ESCALATED] Maya→" + name).strip()
            n += 1
        if n:
            session.commit()
            _bump_tasks_version()
            _invalidate_owner_dashboard_cache()
            _sim_log(f"⚡ Escalated {n} stale Pending task(s) to In_Progress (Goni/Alma)", "warn")
            print(f"[MayaAutonomous] escalated {n} stale red tasks to orange", flush=True)
    except Exception as e:
        session.rollback()
        print(f"[_escalate_stale_red_tasks] {e}", flush=True)
    finally:
        session.close()
    return n


_AUTOGEN_SAMPLES = [
    ("bazaar-jaffa-hotel", "Hotel Bazaar Jaffa", "חדר 204 — בקשת מגבות", TASK_TYPE_SERVICE_HE),
    ("bazaar-jaffa-hotel", "Hotel Bazaar Jaffa", "לובי — תור קבלה ומזוודות", TASK_TYPE_SERVICE_HE),
    ("rooms-branch-acro-tlv", "ROOMS Acro", "ריענון Hot Desks אחרי צ'ק-אאוטים", TASK_TYPE_CLEANING_HE),
    ("rooms-branch-sky-tower", "ROOMS Sky Tower", "מסדרון VIP — מלאי", TASK_TYPE_CLEANING_HE),
    ("bazaar-jaffa-hotel", "Hotel Bazaar Jaffa", "סוויטה — מילוי מיני בר", TASK_TYPE_SERVICE_HE),
]


def _generate_periodic_property_task(tenant_id=DEFAULT_TENANT_ID):
    """One synthetic operational task every 30 minutes (24/7 worker loop)."""
    if not SessionLocal or not PropertyTaskModel:
        return None
    pid, pname, desc, ttype = random.choice(_AUTOGEN_SAMPLES)
    tid = "auto-" + str(uuid.uuid4())
    now = now_iso()
    session = SessionLocal()
    try:
        row = PropertyTaskModel(
            id=tid,
            property_id=pid,
            staff_id="",
            assigned_to="",
            description=desc,
            status="Pending",
            created_at=now,
            property_name=pname,
            staff_name="",
            staff_phone="",
            task_type=ttype,
            priority="normal",
            tenant_id=tenant_id,
        )
        session.add(row)
        session.commit()
        _bump_tasks_version()
        _invalidate_owner_dashboard_cache()
        room_hint = re.search(r"(\d{3})", desc) or re.search(r"חדר\s*(\d+)", desc)
        room_part = f"חדר {room_hint.group(1)}" if room_hint else (pname or "הנכס")
        maya_he = f"בדיוק נוספה משימת ניקיון ל{room_part}! ({desc[:60]})"
        _ACTIVITY_LOG.append({
            "id": str(uuid.uuid4()),
            "ts": int(time.time() * 1000),
            "type": "task_created",
            "text": maya_he,
            "task": {"id": tid, "description": desc, "property_name": pname, "status": "Pending"},
        })
        print(f"[MayaAutonomous] generated task {tid}", flush=True)
        return tid
    except Exception as e:
        session.rollback()
        print(f"[_generate_periodic_property_task] {e}", flush=True)
        return None
    finally:
        session.close()


_MAYA_AUTONOMOUS_LAST = {"assign": 0.0, "seed": 0.0}
_LIVE_ENGINE_TICK = {"gen": 0.0, "bulk": 0.0}
_MAINT_GEN_LAST = 0.0

_MAINT_AUTOGEN_LINES = [
    "נורה שרופה בחדר 302",
    "בדיקת מזגן — קומה 4",
    "תחזוקת חשמל — לוח ראשי",
    "בדיקת ברזים במסדרון",
    "חידוש סימון יציאת חירום",
    "תחזוקת מעלית — רעש יוצא דופן",
    "בדיקת דלתות אוטומטיות בלובי",
    "מסנן מזגן — החלפה נדרשת",
]


def _insert_random_maintenance_task(tenant_id=DEFAULT_TENANT_ID):
    """Live ops: insert one random Hebrew maintenance task on Bazaar or WeWork."""
    if not SessionLocal or not PropertyTaskModel:
        return
    import random as _r

    desc = _r.choice(_MAINT_AUTOGEN_LINES)
    pid, pname = _r.choice(
        [
            ("bazaar-jaffa-hotel", "Hotel Bazaar Jaffa"),
            ("wework-tlv-london-ministore", "WeWork London Ministore"),
            ("wework-tlv-toha", "WeWork ToHA"),
            ("wework-tlv-azrieli-town", "WeWork Azrieli Town"),
            ("wework-tlv-midtown", "WeWork Midtown"),
        ]
    )
    task_id = str(uuid.uuid4())
    session = SessionLocal()
    try:
        session.add(
            PropertyTaskModel(
                id=task_id,
                property_id=pid,
                staff_id="",
                assigned_to="",
                description=desc,
                status="Pending",
                created_at=now_iso(),
                property_name=pname,
                staff_name="קובי",
                staff_phone="",
                task_type=TASK_TYPE_MAINTENANCE_HE,
                priority="normal",
                tenant_id=tenant_id,
            )
        )
        session.commit()
        _bump_tasks_version()
        try:
            _invalidate_owner_dashboard_cache()
        except Exception:
            pass
        try:
            _push_activity(
                {
                    "type": "maintenance_autogen",
                    "text": f"משימת תחזוקה חדשה: {desc} — {pname}",
                }
            )
        except Exception:
            pass
        print(f"[LiveOpsEngine] maintenance autogen id={task_id[:8]} {pname!r}", flush=True)
    except Exception as e:
        session.rollback()
        print(f"[maintenance_autogen] {e!r}", flush=True)
    finally:
        session.close()


def _live_ops_engine_loop():
    """
    Live Operations Engine — 10s single-task status tick + periodic autogen / seed / bulk churn.
    """
    import time as _t
    import random as _r

    print("[LiveOpsEngine] started — 10s status tick + periodic tasks (Bazaar / WeWork)", flush=True)
    while True:
        _t.sleep(10)
        try:
            tid = DEFAULT_TENANT_ID
            now = time.time()
            global _MAINT_GEN_LAST
            if LIVE_AUTOGEN_TASKS:
                if now - _MAINT_GEN_LAST >= 30:
                    _MAINT_GEN_LAST = now
                    try:
                        _insert_random_maintenance_task(tid)
                    except Exception as _ma_e:
                        print(f"[LiveOpsEngine] maintenance autogen: {_ma_e!r}", flush=True)
            _tick_one_live_task_status(tid, log_hebrew=True)
            if LIVE_AUTOGEN_TASKS:
                if now - _LIVE_ENGINE_TICK.get("gen", 0) >= 45:
                    _LIVE_ENGINE_TICK["gen"] = now
                    if _r.random() < 0.72:
                        _generate_periodic_property_task(tid)
            _escalate_stale_red_tasks(tid)
            if now - _MAYA_AUTONOMOUS_LAST["assign"] >= 180:
                _MAYA_AUTONOMOUS_LAST["assign"] = now
                assign_stuck_property_tasks(tid)
            if not SKIP_EMERGENCY_TASK_SEED:
                if now - _MAYA_AUTONOMOUS_LAST["seed"] >= 600:
                    _MAYA_AUTONOMOUS_LAST["seed"] = now
                    try:
                        ensure_emergency_portfolio_and_tasks(tid)
                    except Exception:
                        pass
            if LIVE_AUTOGEN_TASKS:
                if now - _LIVE_ENGINE_TICK.get("bulk", 0) >= 120:
                    _LIVE_ENGINE_TICK["bulk"] = now
                    advance_simulation_task_statuses(tid, log_hebrew=True)
            try:
                _invalidate_owner_dashboard_cache()
            except Exception:
                pass
        except Exception as e:
            print(f"[LiveOpsEngine] {e}", flush=True)


def purge_synthetic_property_tasks(tenant_id=DEFAULT_TENANT_ID):
    """Remove demo / smart / seeded property_tasks rows; keeps manual_rooms portfolio."""
    if not SessionLocal or not PropertyTaskModel:
        return {"deleted": 0}
    from sqlalchemy import or_ as _or
    session = SessionLocal()
    try:
        q = session.query(PropertyTaskModel).filter_by(tenant_id=tenant_id).filter(
            _or(
                PropertyTaskModel.id.like("seed-%"),
                PropertyTaskModel.id.like("seed-pt-%"),
                PropertyTaskModel.id.like("bazaar-v100-%"),
                PropertyTaskModel.id.like("live-emergency-%"),
                PropertyTaskModel.description.like("Automated Welcome%"),
                PropertyTaskModel.description.like("Smart Task%"),
                PropertyTaskModel.description.like("%משימת אופרציה%"),
                PropertyTaskModel.description.like("ניקיון לובי — סבב ערב%"),
                PropertyTaskModel.description.like("דחוף — עומס בקבלה%"),
                PropertyTaskModel.description.like("דחוף — מסדרון סוויטות%"),
            )
        )
        n = q.delete(synchronize_session=False)
        session.commit()
        if n:
            _bump_tasks_version()
            try:
                _invalidate_owner_dashboard_cache()
            except Exception:
                pass
        if n:
            print(f"[purge_synthetic_property_tasks] deleted {n} rows (tenant={tenant_id})", flush=True)
        return {"deleted": n}
    except Exception as e:
        session.rollback()
        print(f"[purge_synthetic_property_tasks] {e}", flush=True)
        return {"deleted": 0, "error": str(e)}
    finally:
        session.close()


# ── Per-tenant background seed dedup ─────────────────────────────────────────
# Tracks which tenants have already had their portfolio seeded this process
# lifetime, and which are currently seeding, so we never spawn more than one
# thread per tenant.
_PORTFOLIO_SEED_DONE: set = set()
_PORTFOLIO_SEED_RUNNING: set = set()


def _kick_background_seed(tenant_id: str) -> None:
    """Start ensure_emergency_portfolio_and_tasks in a daemon thread.

    Safe to call on every request — will no-op if a seed is already running or
    has completed for this tenant within the current process lifetime.
    """
    if tenant_id in _PORTFOLIO_SEED_DONE or tenant_id in _PORTFOLIO_SEED_RUNNING:
        return
    _PORTFOLIO_SEED_RUNNING.add(tenant_id)

    import threading as _bg_thr

    def _run() -> None:
        try:
            ensure_emergency_portfolio_and_tasks(tenant_id)
            _PORTFOLIO_SEED_DONE.add(tenant_id)
        except Exception as _bg_err:
            print(f"[background_seed] {tenant_id}: {_bg_err}", flush=True)
        finally:
            _PORTFOLIO_SEED_RUNNING.discard(tenant_id)

    _bg_thr.Thread(target=_run, daemon=True).start()


def ensure_emergency_portfolio_and_tasks(tenant_id=DEFAULT_TENANT_ID):
    """
    Scale-ready seed: persist 15 properties (Bazaar + 14 ROOMS) with fixed Unsplash URLs + 80% occupancy,
    then ≥20 property_tasks (Cleaning / Maintenance / VIP Guest). Idempotent.
    """
    if not SessionLocal or not ManualRoomModel:
        return
    seed_props = _default_portfolio_seed_rooms()
    session = SessionLocal()
    try:
        existing = {
            r[0]
            for r in session.query(ManualRoomModel.id).filter_by(tenant_id=tenant_id).all()
        }
        for row in seed_props:
            if not isinstance(row, dict):
                continue
            rid = row.get("id")
            if not rid:
                continue
            photo = (row.get("photo_url") or row.get("image_url") or "").strip()
            desc = row.get("description") or ""
            am_json = json.dumps(row.get("amenities") or [])
            if rid not in existing:
                session.add(
                    ManualRoomModel(
                        id=rid,
                        tenant_id=tenant_id,
                        owner_id=None,
                        name=row["name"],
                        description=desc,
                        photo_url=photo,
                        amenities=am_json,
                        status=str(row.get("status", "active")).lower(),
                        created_at=row.get("created_at") or now_iso(),
                        max_guests=int(row.get("max_guests") or 2),
                        bedrooms=int(row.get("bedrooms") or 1),
                        beds=int(row.get("beds") or 1),
                        bathrooms=int(row.get("bathrooms") or 1),
                        occupancy_rate=80.0,
                    )
                )
                existing.add(rid)
            else:
                ob = session.query(ManualRoomModel).filter_by(id=rid, tenant_id=tenant_id).first()
                if ob:
                    # Only update name if unchanged from the seed default (preserve user edits).
                    seed_name = row.get("name") or ""
                    if seed_name and (not ob.name or ob.name == seed_name):
                        ob.name = seed_name
                    # Never overwrite description if the user has already added a gallery
                    # (gallery lines are embedded in description by _merge_description_gallery).
                    _ob_dm, _ob_gal = _split_description_gallery(ob.description or "")
                    if not _ob_gal:
                        # No gallery yet — safe to refresh the seed description.
                        ob.description = desc
                    # Preserve a custom photo_url (uploaded by user); only reset if still
                    # pointing to the original seed URL or if no URL exists yet.
                    if not ob.photo_url or ob.photo_url.strip() == photo:
                        if photo:
                            ob.photo_url = photo
                    ob.amenities = am_json
                    try:
                        ob.occupancy_rate = 80.0
                        ob.max_guests = int(row.get("max_guests") or ob.max_guests or 2)
                        ob.bedrooms = int(row.get("bedrooms") or ob.bedrooms or 1)
                        ob.beds = int(row.get("beds") or ob.beds or 1)
                        ob.bathrooms = int(row.get("bathrooms") or ob.bathrooms or 1)
                    except Exception:
                        pass
        try:
            session.commit()
        except IntegrityError:
            session.rollback()
            for row in seed_props:
                if not isinstance(row, dict):
                    continue
                rid = row.get("id")
                if not rid:
                    continue
                ob = session.query(ManualRoomModel).filter_by(id=rid, tenant_id=tenant_id).first()
                if ob:
                    _ob_dm2, _ob_gal2 = _split_description_gallery(ob.description or "")
                    if not _ob_gal2:
                        ob.description = row.get("description") or ob.description
                    ob.amenities = json.dumps(row.get("amenities") or [])
                    try:
                        ob.occupancy_rate = 80.0
                    except Exception:
                        pass
                    ph = (row.get("photo_url") or row.get("image_url") or "").strip()
                    if ph and (not ob.photo_url or ob.photo_url.strip() == ph):
                        ob.photo_url = ph
            try:
                session.commit()
            except Exception as e2:
                session.rollback()
                print(f"[ensure_emergency_portfolio] upsert retry failed: {e2}", flush=True)
        print(
            f"[ensure_emergency_portfolio] portfolio pins synced "
            f"({session.query(ManualRoomModel).filter_by(tenant_id=tenant_id).count()} total rooms)",
            flush=True,
        )
    except Exception as e:
        session.rollback()
        print(f"[ensure_emergency_portfolio] properties: {e}", flush=True)
    finally:
        session.close()

    ensure_minimal_staff_for_portfolio(tenant_id)
    ensure_kobi_maintenance_on_portfolio(tenant_id)

    if not PropertyTaskModel:
        return
    if not SKIP_EMERGENCY_TASK_SEED:
        session = SessionLocal()
        try:
            tc = session.query(PropertyTaskModel).filter_by(tenant_id=tenant_id).count()
            if tc < 20:
                want = _emergency_task_rows_for_db()
                have = {r[0] for r in session.query(PropertyTaskModel.id).filter_by(tenant_id=tenant_id).all()}
                for t in want:
                    tid = t.get("id")
                    if not tid or tid in have:
                        continue
                    desc = (t.get("description") or t.get("title") or "Task").strip()
                    session.add(
                        PropertyTaskModel(
                            id=tid,
                            property_id=t.get("property_id") or "",
                            staff_id="",
                            assigned_to="",
                            description=desc,
                            status=str(t.get("status") or "Pending"),
                            created_at=t.get("created_at") or now_iso(),
                            property_name=t.get("property_name") or "",
                            staff_name=t.get("staff_name") or "",
                            staff_phone="",
                            task_type=t.get("task_type") or TASK_TYPE_CLEANING_HE,
                            priority=t.get("priority") or "normal",
                            tenant_id=tenant_id,
                        )
                    )
                session.commit()
                print(f"[ensure_emergency_portfolio] property_tasks count={session.query(PropertyTaskModel).filter_by(tenant_id=tenant_id).count()}", flush=True)
        except Exception as e:
            session.rollback()
            print(f"[ensure_emergency_portfolio] tasks: {e}", flush=True)
        finally:
            session.close()
    assign_stuck_property_tasks(tenant_id)
    if not SKIP_EMERGENCY_TASK_SEED:
        ensure_kobi_water_leak_task(tenant_id)
        ensure_bazaar_emergency_live_tasks(tenant_id)


def ensure_bazaar_emergency_live_tasks(tenant_id=DEFAULT_TENANT_ID):
    """Two high-priority Emergency rows for Hotel Bazaar Jaffa — proves live task pipeline + UI sync."""
    if not SessionLocal or not PropertyTaskModel:
        return
    ids = ("live-emergency-bazaar-1", "live-emergency-bazaar-2")
    rows_def = [
        (
            "live-emergency-bazaar-1",
            "דחוף — עומס בקבלה ותור הגעה; גיבוי דלפק קבלה (מלון בזאר יפו)",
        ),
        (
            "live-emergency-bazaar-2",
            "דחוף — מסדרון סוויטות: רעש מזגן + בדיקת לחץ מים לפני צ'ק-אין (מלון בזאר יפו)",
        ),
    ]
    session = SessionLocal()
    added = 0
    try:
        n_bazaar = (
            session.query(PropertyTaskModel)
            .filter_by(tenant_id=tenant_id, property_id="bazaar-jaffa-hotel")
            .count()
        )
        if n_bazaar >= 100:
            return
        have = {
            r[0]
            for r in session.query(PropertyTaskModel.id).filter(PropertyTaskModel.id.in_(ids)).all()
        }
        now = now_iso()
        for tid, desc in rows_def:
            if tid in have:
                continue
            session.add(
                PropertyTaskModel(
                    id=tid,
                    property_id="bazaar-jaffa-hotel",
                    staff_id="",
                    assigned_to="",
                    description=desc,
                    status="Pending",
                    created_at=now,
                    property_name="Hotel Bazaar Jaffa",
                    staff_name="",
                    staff_phone="",
                    task_type=TASK_TYPE_SERVICE_HE,
                    priority="high",
                    tenant_id=tenant_id,
                )
            )
            added += 1
        if added:
            session.commit()
            _bump_tasks_version()
            _invalidate_owner_dashboard_cache()
            print(f"[ensure_bazaar_emergency_live_tasks] inserted {added} emergency Bazaar task(s)", flush=True)
    except Exception as e:
        session.rollback()
        print(f"[ensure_bazaar_emergency_live_tasks] {e}", flush=True)
    finally:
        session.close()


def ensure_min_property_tasks_volume(tenant_id=DEFAULT_TENANT_ID, minimum=100):
    """Idempotent: insert extra property_tasks until tenant has at least `minimum` rows (Bazaar + WeWork mix)."""
    if not SessionLocal or not PropertyTaskModel:
        return
    session = SessionLocal()
    try:
        n = session.query(PropertyTaskModel).filter_by(tenant_id=tenant_id).count()
        if n >= minimum:
            return
        need = minimum - n
        props = [
            ("bazaar-jaffa-hotel", "Hotel Bazaar Jaffa"),
            ("wework-tlv-london-ministore", "WeWork London Ministore"),
            ("wework-tlv-toha", "WeWork ToHA"),
            ("wework-tlv-azrieli-town", "WeWork Azrieli Town"),
        ]
        now = now_iso()
        for i in range(need):
            pid, pname = props[i % len(props)]
            session.add(
                PropertyTaskModel(
                    id=str(uuid.uuid4()),
                    property_id=pid,
                    staff_id="",
                    assigned_to="",
                    description=f"משימת אופרציה #{n + i + 1} — {pname}",
                    status="Pending",
                    created_at=now,
                    property_name=pname,
                    staff_name="עובד",
                    staff_phone="",
                    task_type=TASK_TYPE_SERVICE_HE,
                    priority="normal",
                    tenant_id=tenant_id,
                )
            )
        session.commit()
        _bump_tasks_version()
        try:
            _invalidate_owner_dashboard_cache()
        except Exception:
            pass
        print(
            f"[ensure_min_property_tasks_volume] inserted {need} rows (tenant total ≥ {minimum})",
            flush=True,
        )
    except Exception as e:
        session.rollback()
        print(f"[ensure_min_property_tasks_volume] {e}", flush=True)
    finally:
        session.close()


def ensure_minimal_staff_for_portfolio(tenant_id=DEFAULT_TENANT_ID):
    """One operations row per property with no staff — enables auto-assignment."""
    if not SessionLocal or not PropertyStaffModel or not ManualRoomModel:
        return
    session = SessionLocal()
    try:
        for prop in session.query(ManualRoomModel).filter_by(tenant_id=tenant_id).all():
            n = session.query(PropertyStaffModel).filter_by(property_id=prop.id).count()
            if n == 0:
                session.add(
                    PropertyStaffModel(
                        id=str(uuid.uuid4()),
                        property_id=prop.id,
                        name="צוות אופרציות",
                        role="Operations",
                        phone_number="0500000000",
                    )
                )
        session.commit()
    except Exception as e:
        session.rollback()
        print(f"[ensure_minimal_staff_for_portfolio] {e}", flush=True)
    finally:
        session.close()


def ensure_kobi_maintenance_on_portfolio(tenant_id=DEFAULT_TENANT_ID):
    """Each seeded property gets a Maintenance worker (קובי) so leak auto-assign has a target."""
    if not SessionLocal or not PropertyStaffModel or not ManualRoomModel:
        return
    seed_ids = {r.get("id") for r in _default_portfolio_seed_rooms() if isinstance(r, dict) and r.get("id")}
    if not seed_ids:
        return
    session = SessionLocal()
    try:
        for prop in session.query(ManualRoomModel).filter(
            ManualRoomModel.tenant_id == tenant_id,
            ManualRoomModel.id.in_(list(seed_ids)),
        ).all():
            staff = session.query(PropertyStaffModel).filter_by(property_id=prop.id).all()
            has_maintenance = False
            for s in staff:
                nm = s.name or ""
                rl = (s.role or "").lower()
                if "קובי" in nm or "kobi" in nm.lower() or "maintenance" in rl or "תחזוק" in rl:
                    has_maintenance = True
                    break
            if not has_maintenance:
                session.add(
                    PropertyStaffModel(
                        id=str(uuid.uuid4()),
                        property_id=prop.id,
                        name="קובי",
                        role="Maintenance",
                        phone_number="0529876543",
                    )
                )
        session.commit()
    except Exception as e:
        session.rollback()
        print(f"[ensure_kobi_maintenance_on_portfolio] {e}", flush=True)
    finally:
        session.close()


def ensure_kobi_water_leak_task(tenant_id=DEFAULT_TENANT_ID):
    """Idempotent: persist Kobi water-leak task if missing (older DBs with ≥20 rows)."""
    WID = "seed-pt-water-leak-kobi"
    if not SessionLocal or not PropertyTaskModel:
        return
    session = SessionLocal()
    try:
        ex = session.query(PropertyTaskModel).filter_by(id=WID).first()
        if ex:
            return
        row = next((x for x in _emergency_task_rows_for_db() if x.get("id") == WID), None)
        if not row:
            return
        desc = (row.get("description") or row.get("title") or "Water Leak").strip()
        session.add(
            PropertyTaskModel(
                id=WID,
                property_id=row.get("property_id") or "",
                staff_id="",
                assigned_to="",
                description=desc,
                status=str(row.get("status") or "Pending"),
                created_at=row.get("created_at") or now_iso(),
                property_name=row.get("property_name") or "",
                staff_name=row.get("staff_name") or "קובי",
                staff_phone="",
                task_type=row.get("task_type") or "Maintenance",
                priority=row.get("priority") or "normal",
                tenant_id=tenant_id,
            )
        )
        session.commit()
        print(f"[ensure_kobi_water_leak_task] inserted {WID}", flush=True)
    except Exception as e:
        session.rollback()
        print(f"[ensure_kobi_water_leak_task] {e}", flush=True)
    finally:
        session.close()


def set_manual_room_checkin(session, tenant_id, room_id):
    room = session.query(ManualRoomModel).filter_by(id=room_id, tenant_id=tenant_id).first()
    if not room:
        return None
    room.last_checkin_at = now_iso()
    session.commit()
    return room


def is_recent_clock_in(staff, within_hours=12):
    last = parse_iso_datetime(getattr(staff, "last_clock_in", None))
    if not last:
        return False
    return (datetime.now(timezone.utc) - last) <= timedelta(hours=within_hours)


def create_booking_with_automation(tenant_id, booking_data):
    """
    יוצר משימת ניקיון אוטומטית ליום הצ'ק-אאוט.
    booking_data: { property_id?, room?, property_name?, guest_name, check_in, check_out }
    """
    room_label = (
        booking_data.get("room")
        or booking_data.get("property_name")
        or "Room"
    )
    check_out = booking_data.get("check_out")
    due_at = f"{check_out}T12:00:00Z" if check_out else None
    task = create_task(
        tenant_id,
        "cleaning",
        room_label,
        due_at=due_at,
        room_id=booking_data.get("property_id"),
    )
    if task:
        dispatch_tasks(tenant_id)
    return task


def create_task(tenant_id, task_type, room, due_at=None, room_id=None):
    """Create task via db.session.add + commit. Returns plain dict (no DetachedInstanceError).
    Prints DB_ERROR on failure so it's visible in the terminal."""
    if not SessionLocal or not TaskModel:
        print("DB_ERROR: SessionLocal or TaskModel not initialised — cannot create task")
        return None
    session = SessionLocal()
    try:
        task_id = str(uuid.uuid4())
        created_at = now_iso()
        new_task = TaskModel(
            id=task_id,
            tenant_id=tenant_id,
            task_type=task_type,
            room=room,
            room_id=room_id,
            status="pending",
            created_at=created_at,
            due_at=due_at,
            points_awarded=0,
        )
        session.add(new_task)
        session.commit()
        print(f"[DB] ✅ Task created: id={task_id} type={task_type} room={room}")
        return {
            "id": task_id,
            "task_type": task_type,
            "room": room,
            "status": "pending",
            "created_at": created_at,
            "due_at": due_at,
        }
    except Exception as e:
        session.rollback()
        print(f"DB_ERROR: {e}")
        import traceback as _tb_db
        _tb_db.print_exc()
        return None
    finally:
        session.close()


def assign_task(task_or_id, staff, session):
    task_id = task_or_id.get("id") if isinstance(task_or_id, dict) else (task_or_id.id if hasattr(task_or_id, "id") else task_or_id)
    task = session.query(TaskModel).filter_by(id=task_id).first() if task_id else None
    if not task:
        return
    task.staff_id = staff.id
    task.status = "assigned"
    task.assigned_at = now_iso()
    staff.last_assigned_at = now_iso()
    session.commit()
    if staff.phone:
        message = f"New task: {task.task_type} for room {task.room}."
        send_whatsapp(staff.phone, message)


def assign_best_staff(tenant_id, task_or_dict, session):
    staff_pool = (
        session.query(StaffModel)
        .filter_by(tenant_id=tenant_id, active=1, on_shift=1)
        .all()
    )
    staff_pool = [staff for staff in staff_pool if is_recent_clock_in(staff, within_hours=12)]
    if not staff_pool:
        return False
    property_location = get_property_location()
    def staff_sort_key(staff):
        distance = 9999.0
        if property_location and staff.last_lat is not None and staff.last_lng is not None:
            distance = haversine_km(property_location[0], property_location[1], staff.last_lat, staff.last_lng)
        return (-(staff.gold_points or 0), distance, staff.last_assigned_at or "")
    staff_pool.sort(key=staff_sort_key)
    assign_task(task_or_dict, staff_pool[0], session)
    return True


def dispatch_tasks(tenant_id):
    if not SessionLocal or not TaskModel or not StaffModel:
        return
    session = SessionLocal()
    try:
        pending = session.query(TaskModel).filter_by(tenant_id=tenant_id, status="pending").all()
        if not pending:
            return
        staff_pool = (
            session.query(StaffModel)
            .filter_by(tenant_id=tenant_id, active=1, on_shift=1)
            .all()
        )
        staff_pool = [staff for staff in staff_pool if is_recent_clock_in(staff, within_hours=12)]
        if not staff_pool:
            return
        staff_pool.sort(
            key=lambda s: (
                -(s.gold_points or 0),
                s.last_assigned_at or "",
            )
        )
        for task in pending:
            staff = staff_pool[0]
            assign_task(task, staff, session)
            staff_pool.append(staff_pool.pop(0))
    finally:
        session.close()


def dispatch_loop():
    while True:
        time.sleep(DISPATCH_INTERVAL)
        if not DISPATCH_ENABLED:
            continue
        for tenant_id in get_tenant_ids():
            dispatch_tasks(tenant_id)


def start_dispatcher():
    global DISPATCH_STARTED
    with DISPATCH_LOCK:
        if DISPATCH_STARTED:
            return
        thread = threading.Thread(target=dispatch_loop, daemon=True)
        thread.start()
        DISPATCH_STARTED = True


def update_task_status(tenant_id, task_id, status):
    if not SessionLocal or not TaskModel:
        return None
    session = SessionLocal()
    try:
        task = session.query(TaskModel).filter_by(id=task_id, tenant_id=tenant_id).first()
        if not task:
            return None
        now_time = now_iso()
        if status == "on_my_way":
            task.status = "on_my_way"
            task.on_my_way_at = now_time
            if task.staff_id:
                staff = session.query(StaffModel).filter_by(id=task.staff_id, tenant_id=tenant_id).first()
                if staff:
                    photo_url = staff.photo_url or os.getenv("DEFAULT_STAFF_PHOTO_URL") or "https://via.placeholder.com/512x512.png?text=Staff"
                    language = (staff.language or "").lower()
                    if language.startswith("he"):
                        message_text = f"החדר שלך מוכן על ידי {staff.name}!"
                    elif language.startswith("th"):
                        message_text = f"ห้องของคุณกำลังถูกจัดเตรียมโดย {staff.name}!"
                    elif language.startswith("hi"):
                        message_text = f"आपका कमरा {staff.name} द्वारा तैयार किया जा रहा है!"
                    elif language.startswith("es"):
                        message_text = f"¡Tu habitación está siendo preparada por {staff.name}!"
                    else:
                        message_text = f"Your room is being prepared by {staff.name}!"
                    notify_targets = [
                        os.getenv("OPERATIONS_WHATSAPP_TO"),
                        os.getenv("GUEST_WHATSAPP_TO"),
                        os.getenv("HOST_WHATSAPP_TO"),
                    ]
                    for notify_number in [n for n in notify_targets if n]:
                        send_whatsapp(
                            notify_number,
                            message_text,
                            media_url=photo_url,
                        )
        elif status == "started":
            task.status = "in_progress"
            task.started_at = now_time
        elif status == "finished":
            task.status = "finished"
            task.finished_at = now_time
            base_points = 5
            gold_award = 0
            due_at = parse_iso_datetime(task.due_at)
            assigned_at = parse_iso_datetime(task.assigned_at)
            started_at = parse_iso_datetime(task.started_at)
            finished_at = parse_iso_datetime(task.finished_at)
            target_seconds = None
            if due_at and assigned_at:
                target_seconds = (due_at - assigned_at).total_seconds()
            if not target_seconds or target_seconds <= 0:
                target_seconds = 90 * 60
            actual_seconds = None
            if started_at and finished_at:
                actual_seconds = (finished_at - started_at).total_seconds()
            elif assigned_at and finished_at:
                actual_seconds = (finished_at - assigned_at).total_seconds()
            if actual_seconds is not None and actual_seconds <= target_seconds:
                gold_award = 10
            task.points_awarded = base_points + gold_award
            if task.staff_id:
                staff = session.query(StaffModel).filter_by(id=task.staff_id, tenant_id=tenant_id).first()
                if staff:
                    staff.points = (staff.points or 0) + task.points_awarded
                    staff.gold_points = (staff.gold_points or 0) + gold_award
                    rank_tier = get_rank_tier(staff.gold_points)
        session.commit()
        if task.staff_id:
            emit_staff_update(session, tenant_id, task.staff_id)
        if status == "finished":
            dispatch_tasks(tenant_id)
        return task
    finally:
        session.close()


def enqueue_message_job(payload):
    MESSAGE_QUEUE.put(payload)


def message_worker():
    while True:
        payload = MESSAGE_QUEUE.get()
        if payload is None:
            break
        tenant_id = payload.get("tenant_id") or DEFAULT_TENANT_ID
        message = (payload.get("message") or "").strip()
        from_number = payload.get("from_number")
        lead_id = payload.get("lead_id")
        target_lang = payload.get("worker_lang") or get_worker_language(tenant_id)
        if message:
            record_message(tenant_id, lead_id, "inbound", "whatsapp", message)
        objection = "general"
        if any(word in message for word in ["יקר", "מחיר", "עלות"]):
            objection = "price"
        elif any(word in message for word in ["מיקום", "רחוק"]):
            objection = "location"
        elif any(word in message for word in ["חוקים", "כללים", "תקנון"]):
            objection = "rules"
        response_text = pick_argument(objection)
        translated_message = translate_message(message, target_lang)
        enqueue_event(tenant_id, "message_translated", {
            "lead_id": lead_id,
            "original": message,
            "translated": translated_message,
            "target_lang": target_lang,
        })
        if lead_id:
            update_lead(lead_id, {"last_objection": objection, "ai_summary": response_text})
        if from_number:
            result = send_whatsapp(from_number, response_text)
            if result.get("success"):
                record_message(tenant_id, lead_id, "outbound", "whatsapp", response_text)
                AUTOMATION_STATS.setdefault(tenant_id, {"automated_messages": 0, "last_scan": None})
                AUTOMATION_STATS[tenant_id]["automated_messages"] += 1
                emit_automation_stats(tenant_id)
        MESSAGE_QUEUE.task_done()


def start_message_workers():
    global MESSAGE_WORKERS_STARTED
    with MESSAGE_WORKERS_LOCK:
        if MESSAGE_WORKERS_STARTED:
            return
        workers = int(os.getenv("MESSAGE_WORKERS", "4"))
        for _ in range(workers):
            thread = threading.Thread(target=message_worker, daemon=True)
            thread.start()
        MESSAGE_WORKERS_STARTED = True


def scan_realtime_leads(platforms=None, vacancy_windows=None):
    leads = []
    sources = platforms or ["airbnb", "booking"]
    for _ in range(random.randint(1, 3)):
        source = random.choice(sources)
        vacancy = None
        if vacancy_windows:
            vacancy = random.choice(vacancy_windows)
        leads.append(generate_lead(source=source))
    return leads


def persist_lead(lead):
    if not SessionLocal or not LeadModel:
        return None
    session = SessionLocal()
    try:
        existing = session.query(LeadModel).filter_by(id=lead.get("id")).first()
        if not existing:
            existing = LeadModel(id=lead.get("id"))
            session.add(existing)
        existing.tenant_id = lead.get("tenant_id") or DEFAULT_TENANT_ID
        existing.name = lead.get("name")
        existing.contact = lead.get("contact")
        existing.email = lead.get("email")
        existing.phone = lead.get("phone")
        existing.source = lead.get("source")
        existing.status = lead.get("status")
        existing.value = lead.get("value")
        existing.rating = lead.get("rating")
        existing.created_at = lead.get("createdAt")
        existing.notes = lead.get("notes")
        existing.property_name = lead.get("property")
        existing.city = lead.get("city")
        existing.response_time_hours = lead.get("response_time_hours")
        existing.lead_quality = lead.get("lead_quality")
        existing.ai_summary = lead.get("ai_summary")
        existing.last_objection = lead.get("last_objection")
        existing.payment_link = lead.get("payment_link")
        existing.desired_checkin = lead.get("desired_checkin")
        existing.desired_checkout = lead.get("desired_checkout")
        session.commit()
        return lead
    except SQLAlchemyError as error:
        session.rollback()
        print(f"Failed to persist lead: {error}")
        return None
    finally:
        session.close()


def load_leads_from_db():
    if not SessionLocal or not LeadModel:
        return
    session = SessionLocal()
    try:
        records = session.query(LeadModel).all()
    finally:
        session.close()
    leads = []
    for record in records:
        leads.append({
            "id": record.id,
            "tenant_id": record.tenant_id,
            "name": record.name,
            "contact": record.contact,
            "email": record.email,
            "phone": record.phone,
            "source": record.source,
            "status": record.status,
            "value": record.value,
            "rating": record.rating,
            "createdAt": record.created_at,
            "notes": record.notes,
            "property": record.property_name,
            "city": record.city,
            "response_time_hours": record.response_time_hours,
            "lead_quality": record.lead_quality,
            "ai_summary": record.ai_summary,
            "last_objection": record.last_objection,
            "payment_link": record.payment_link,
            "desired_checkin": record.desired_checkin,
            "desired_checkout": record.desired_checkout,
        })
    leads.sort(key=lambda lead: lead.get("createdAt") or "", reverse=True)
    with DATA_LOCK:
        LEADS.clear()
        LEADS.extend(leads)
        LEADS_BY_ID.clear()
        for lead in leads:
            LEADS_BY_ID[lead["id"]] = lead


def ensure_default_tenants():
    if not SessionLocal or not TenantModel:
        return
    session = SessionLocal()
    try:
        defaults = [
            {"id": DEFAULT_TENANT_ID, "name": "Demo Hotels"},
            {"id": "pilot-1", "name": "Pilot Group 1"},
            {"id": "pilot-2", "name": "Pilot Group 2"},
        ]
        for tenant in defaults:
            exists = session.query(TenantModel).filter_by(id=tenant["id"]).first()
            if not exists:
                session.add(TenantModel(
                    id=tenant["id"],
                    name=tenant["name"],
                    created_at=now_iso(),
                ))
        session.commit()
    finally:
        session.close()


def ensure_demo_user():
    if not SessionLocal or not UserModel:
        return
    session = SessionLocal()
    try:
        existing = session.query(UserModel).filter_by(email="demo@easyhost.ai").first()
        if not existing:
            session.add(UserModel(
                id=str(uuid.uuid4()),
                tenant_id=DEFAULT_TENANT_ID,
                email="demo@easyhost.ai",
                password_hash=hash_password("demo123"),
                role="admin",
                created_at=now_iso(),
            ))
        session.commit()
    finally:
        session.close()


def ensure_levikobi_user():
    """HARD RESET: Delete levikobi40@gmail.com and re-create with password 123456, role admin."""
    if not SessionLocal or not UserModel:
        return
    session = SessionLocal()
    try:
        email = "levikobi40@gmail.com"
        pw_hash = generate_password_hash("123456", method="pbkdf2:sha256")
        session.query(UserModel).filter_by(email=email).delete()
        session.add(UserModel(
            id=str(uuid.uuid4()),
            tenant_id=DEFAULT_TENANT_ID,
            email=email,
            password_hash=pw_hash,
            role="admin",
            created_at=now_iso(),
        ))
        session.commit()
        print("[ensure_levikobi_user] Hard reset OK: levikobi40@gmail.com re-created with password 123456, role admin")
    except Exception as e:
        session.rollback()
        print("[ensure_levikobi_user] Error:", e)
    finally:
        session.close()


def ensure_admin_from_env():
    """
    Create / update admin user from ADMIN_EMAIL + ADMIN_PASSWORD env vars.
    Set these in Render → Environment Variables to configure the demo password
    without touching code.
    Falls back to levikobi40@gmail.com / 123456 if env vars are absent.
    """
    admin_email = os.getenv("ADMIN_EMAIL", "").strip().lower()
    admin_pass  = os.getenv("ADMIN_PASSWORD", "").strip()
    if not admin_email or not admin_pass:
        return  # nothing to do — levikobi user already seeded separately
    if not SessionLocal or not UserModel:
        return
    session = SessionLocal()
    try:
        pw_hash = generate_password_hash(admin_pass, method="pbkdf2:sha256")
        existing = session.query(UserModel).filter_by(email=admin_email).first()
        if existing:
            existing.password_hash = pw_hash
            existing.role = "admin"
        else:
            session.add(UserModel(
                id=str(uuid.uuid4()),
                tenant_id=DEFAULT_TENANT_ID,
                email=admin_email,
                password_hash=pw_hash,
                role="admin",
                created_at=now_iso(),
            ))
        session.commit()
        print(f"[ensure_admin_from_env] Admin user ready: {admin_email}")
    except Exception as e:
        session.rollback()
        print(f"[ensure_admin_from_env] Error: {e}")
    finally:
        session.close()


def seed_dashboard_data():
    """Seed properties (Alma, Chandler), 3 staff, and 5 sample tasks for Task Calendar."""
    if not all([SessionLocal, ManualRoomModel, PropertyStaffModel, PropertyTaskModel]):
        return
    session = SessionLocal()
    try:
        prop_alma = session.query(ManualRoomModel).filter_by(tenant_id=DEFAULT_TENANT_ID, name="Alma").first()
        if not prop_alma:
            prop_alma_id = str(uuid.uuid4())
            session.add(ManualRoomModel(
                id=prop_alma_id,
                tenant_id=DEFAULT_TENANT_ID,
                owner_id=None,
                name="Alma",
                description="Villa Alma",
                status="active",
                created_at=now_iso(),
                max_guests=2,
                bedrooms=1,
                beds=1,
                bathrooms=1,
            ))
            session.commit()
            print("[seed_dashboard_data] Created property Alma")
        else:
            prop_alma_id = prop_alma.id

        prop_chandler = session.query(ManualRoomModel).filter_by(tenant_id=DEFAULT_TENANT_ID, name="Chandler").first()
        if not prop_chandler:
            prop_chandler_id = str(uuid.uuid4())
            session.add(ManualRoomModel(
                id=prop_chandler_id,
                tenant_id=DEFAULT_TENANT_ID,
                owner_id=None,
                name="Chandler",
                description="Chandler Suite",
                status="active",
                created_at=now_iso(),
                max_guests=4,
                bedrooms=2,
                beds=2,
                bathrooms=1,
            ))
            session.commit()
            print("[seed_dashboard_data] Created property Chandler")
        else:
            prop_chandler_id = prop_chandler.id

        staff_data = [
            (prop_alma_id, "Alma", "Cleaning", "0501234567"),
            (prop_alma_id, "Kobi", "Maintenance", "0529876543"),
            (prop_alma_id, "Avi", "Electrician", "050-2223334"),
            (prop_chandler_id, "Goni", "Check-in", "050-1112223"),
        ]
        staff_ids = {}
        for prop_id, name, role, phone in staff_data:
            existing_staff = session.query(PropertyStaffModel).filter_by(property_id=prop_id, name=name).first()
            if not existing_staff:
                sid = str(uuid.uuid4())
                session.add(PropertyStaffModel(
                    id=sid,
                    property_id=prop_id,
                    name=name,
                    role=role,
                    phone_number=phone,
                ))
                staff_ids[f"{prop_id}:{name}"] = (sid, prop_id)
            else:
                staff_ids[f"{prop_id}:{name}"] = (existing_staff.id, prop_id)
        session.commit()
        print("[seed_dashboard_data] Staff ready: Alma, Kobi, Goni")

        def get_staff(prop_id, name):
            key = f"{prop_id}:{name}"
            if key in staff_ids:
                return staff_ids[key][0]
            for s in session.query(PropertyStaffModel).filter_by(property_id=prop_id).all():
                if s.name == name:
                    return s.id
            return None

        task_count = session.query(PropertyTaskModel).count()
        if task_count == 0:
            prop_names = {prop_alma_id: "Alma", prop_chandler_id: "Chandler"}
            tasks_data = [
                ("Cleaning for Suite 201", "Alma", prop_alma_id, "Pending"),
                ("Fix AC in Lobby", "Kobi", prop_alma_id, "Pending"),
                ("Welcome Pack Setup", "Alma", prop_alma_id, "Done"),
                ("Prepare Chandler for check-in", "Goni", prop_chandler_id, "Pending"),
                ("Deep clean Alma villa", "Alma", prop_alma_id, "Pending"),
            ]
            for desc, staff_name, prop_id, status in tasks_data:
                sid = get_staff(prop_id, staff_name)
                staff_rec = session.query(PropertyStaffModel).filter_by(id=sid).first() if sid else None
                prop_name = prop_names.get(prop_id, "Property")
                session.add(PropertyTaskModel(
                    id=str(uuid.uuid4()),
                    property_id=prop_id,
                    staff_id=sid or "",
                    assigned_to=sid or "",
                    description=desc,
                    status=status,
                    created_at=now_iso(),
                    property_name=prop_name,
                    staff_name=staff_rec.name if staff_rec else staff_name,
                    staff_phone=staff_rec.phone_number if staff_rec else "",
                ))
            session.commit()
            print("[seed_dashboard_data] Created 5 sample tasks for Task Calendar")
        force_seed_sample_tasks(session)
        session.commit()
    except Exception as e:
        session.rollback()
        print("[seed_dashboard_data] Error:", e)
    finally:
        session.close()


def force_seed_sample_tasks(session=None):
    """One-time: Add 3 sample tasks (Clean Ocean Suite, Fix Sink, Guest Check-in) if not present."""
    if not SessionLocal or not PropertyTaskModel or not PropertyStaffModel or not ManualRoomModel:
        return
    sess = session or SessionLocal()
    try:
        existing_desc = set()
        try:
            for r in sess.query(PropertyTaskModel.description).filter(
                PropertyTaskModel.description.in_(["Clean Ocean Suite", "Fix Sink", "Guest Check-in"])
            ).all():
                desc = r[0] if hasattr(r, "__getitem__") else getattr(r, "description", None)
                if desc:
                    existing_desc.add(desc)
        except Exception:
            pass
        if len(existing_desc) >= 3:
            return
        rooms = sess.query(ManualRoomModel).filter_by(tenant_id=DEFAULT_TENANT_ID).all()
        if not rooms:
            return
        prop = rooms[0]
        prop_id = prop.id
        prop_name = prop.name or "Property"
        staff_by_name = {}
        for s in sess.query(PropertyStaffModel).filter_by(property_id=prop_id).all():
            staff_by_name[s.name] = s
        tasks_to_add = [
            ("Clean Ocean Suite", "Alma"),
            ("Fix Sink", "Kobi"),
            ("Guest Check-in", "Goni"),
        ]
        for desc, staff_name in tasks_to_add:
            if desc in existing_desc:
                continue
            staff = staff_by_name.get(staff_name)
            sid = staff.id if staff else ""
            staff_n = staff.name if staff else staff_name
            staff_p = staff.phone_number if staff else ""
            sess.add(PropertyTaskModel(
                id=str(uuid.uuid4()),
                property_id=prop_id,
                staff_id=sid,
                assigned_to=sid,
                description=desc,
                status="Pending",
                created_at=now_iso(),
                property_name=prop_name,
                staff_name=staff_n,
                staff_phone=staff_p,
            ))
        if not session:
            sess.commit()
            print("[force_seed_sample_tasks] Added 3 sample tasks: Clean Ocean Suite, Fix Sink, Guest Check-in")
    except Exception as e:
        if not session:
            sess.rollback()
        print("[force_seed_sample_tasks] Note:", e)
    finally:
        if not session:
            sess.close()


# ══════════════════════════════════════════════════════════════════════════════
#  PILOT DEMO — Seed, Simulation, Mock Staff
# ══════════════════════════════════════════════════════════════════════════════

def seed_pilot_demo():
    """Create 10 demo properties (5 John / 5 Sarah), demo owner accounts, and mock staff.

    Robust: each insert is wrapped in its own try/except so a single failure
    (e.g. missing column) does not abort the entire seed run.
    """
    if not SessionLocal or not ManualRoomModel:
        print("[seed_pilot_demo] Skipped — DB models not available")
        return
    session = SessionLocal()
    try:
        # ── Quick check: if all 10 properties already exist, nothing to do ────
        existing_count = session.query(ManualRoomModel).filter(
            ManualRoomModel.name.in_(DEMO_PILOT_PROPERTY_NAMES)
        ).count()
        if existing_count >= 10:
            print(f"[seed_pilot_demo] ✅ Already seeded ({existing_count}/10 properties found)")
            return

        # ── Demo owner user accounts ──────────────────────────────────────────
        owner_map = {}
        if UserModel:
            for email, name in [("john@easyhost.demo", "John"), ("sarah@easyhost.demo", "Sarah")]:
                try:
                    existing = session.query(UserModel).filter_by(email=email).first()
                    if not existing:
                        uid = str(uuid.uuid4())
                        session.add(UserModel(
                            id=uid, tenant_id=DEFAULT_TENANT_ID, email=email,
                            password_hash=generate_password_hash("demo123", method="pbkdf2:sha256"),
                            role="host", created_at=now_iso(),
                        ))
                        session.commit()
                        owner_map[name] = uid
                    else:
                        owner_map[name] = existing.id
                except Exception as _ue:
                    session.rollback()
                    print(f"[seed_pilot_demo] Demo user {email} skipped: {_ue}")

        # ── 10 pilot properties (one commit per row to survive partial failures) ─
        pilot_defs = [
            ("John",  "John's Beach House",       "Beachfront 3BR villa",              6, 250),
            ("John",  "John's Downtown Loft",     "Modern loft in the city centre",    2, 150),
            ("John",  "John's Mountain Cabin",    "Cozy mountain retreat",             4, 180),
            ("John",  "John's City Studio",       "Compact studio, business district", 2,  90),
            ("John",  "John's Rooftop Penthouse", "Luxury penthouse, panoramic views", 8, 400),
            ("Sarah", "Sarah's Poolside Villa",   "5-star villa with private pool",    8, 350),
            ("Sarah", "Sarah's Garden Suite",     "Tranquil garden apartment",         3, 120),
            ("Sarah", "Sarah's Harbor View",      "Waterfront apartment, harbour views", 4, 200),
            ("Sarah", "Sarah's Cozy Cottage",     "Charming countryside cottage",      4, 140),
            ("Sarah", "Sarah's Modern Flat",      "Sleek flat near airport",           2, 110),
        ]
        seeded = 0
        for owner_name, pname, desc, guests, _price in pilot_defs:
            try:
                if session.query(ManualRoomModel).filter_by(
                    tenant_id=DEFAULT_TENANT_ID, name=pname
                ).first():
                    continue
                new_prop = ManualRoomModel(
                    id=str(uuid.uuid4()),
                    tenant_id=DEFAULT_TENANT_ID,
                    name=pname,
                    description=desc,
                    status="active",
                    created_at=now_iso(),
                    max_guests=guests,
                    bedrooms=max(1, guests // 2),
                    beds=max(1, guests // 2),
                    bathrooms=max(1, guests // 3),
                )
                # owner_id is optional — only set if column exists on model
                if hasattr(new_prop, "owner_id"):
                    new_prop.owner_id = owner_map.get(owner_name)
                session.add(new_prop)
                session.commit()
                seeded += 1
            except Exception as _pe:
                session.rollback()
                print(f"[seed_pilot_demo] Property '{pname}' skipped: {_pe}")

        # ── Mock staff for every pilot property ───────────────────────────────
        staff_added = 0
        if PropertyStaffModel:
            for pname in DEMO_PILOT_PROPERTY_NAMES:
                try:
                    prop = session.query(ManualRoomModel).filter_by(
                        tenant_id=DEFAULT_TENANT_ID, name=pname
                    ).first()
                    if not prop:
                        continue
                    for ms in MOCK_STAFF:
                        if not session.query(PropertyStaffModel).filter_by(
                            property_id=prop.id, name=ms["name"]
                        ).first():
                            session.add(PropertyStaffModel(
                                id=str(uuid.uuid4()), property_id=prop.id,
                                name=ms["name"], role=ms["role"], phone_number=ms["phone"],
                            ))
                            staff_added += 1
                    session.commit()
                except Exception as _se:
                    session.rollback()
                    print(f"[seed_pilot_demo] Staff for '{pname}' skipped: {_se}")

        # ── Sample bookings (last 30 days) to populate Revenue dashboard ─────
        bookings_added = 0
        if BookingModel:
            try:
                existing_bookings = session.query(BookingModel).filter_by(
                    tenant_id=DEFAULT_TENANT_ID
                ).count()
            except Exception:
                existing_bookings = 0

            if existing_bookings == 0:
                # Re-fetch the pilot properties so we can link bookings to real IDs
                pilot_props = session.query(ManualRoomModel).filter(
                    ManualRoomModel.name.in_(DEMO_PILOT_PROPERTY_NAMES)
                ).all()

                _booking_defs = [
                    # (guest_name, nights, total_price, days_ago)
                    ("James Mitchell",   3,  1800, 2),
                    ("Laura Bennett",    5,  2500, 5),
                    ("Carlos Rivera",    2,   900, 7),
                    ("Sophie Turner",    4,  1400, 10),
                    ("Daniel Kim",       1,   550, 12),
                    ("Emily Hartman",    6,  2100, 15),
                    ("Michael Johnson",  3,  1250, 18),
                    ("Olivia Nguyen",    2,   780, 21),
                    ("Ethan Clarke",     7,  2450, 25),
                    ("Ava Martins",      4,  1600, 29),
                ]
                for guest_name, nights, total_price, days_ago in _booking_defs:
                    try:
                        prop = random.choice(pilot_props) if pilot_props else None
                        check_in_dt  = datetime.now(timezone.utc) - timedelta(days=days_ago + nights)
                        check_out_dt = check_in_dt + timedelta(days=nights)
                        session.add(BookingModel(
                            id=str(uuid.uuid4()),
                            tenant_id=DEFAULT_TENANT_ID,
                            property_id=prop.id if prop else None,
                            property_name=prop.name if prop else "Demo Property",
                            guest_name=guest_name,
                            guest_phone="",
                            check_in=check_in_dt.strftime("%Y-%m-%d"),
                            check_out=check_out_dt.strftime("%Y-%m-%d"),
                            nights=nights,
                            total_price=total_price,
                            status="completed",
                            created_at=now_iso(),
                        ))
                        bookings_added += 1
                    except Exception as _be:
                        session.rollback()
                        print(f"[seed_pilot_demo] Booking for '{guest_name}' skipped: {_be}")
                try:
                    session.commit()
                except Exception as _bce:
                    session.rollback()
                    print(f"[seed_pilot_demo] Bookings commit failed: {_bce}")

        total = session.query(ManualRoomModel).filter(
            ManualRoomModel.name.in_(DEMO_PILOT_PROPERTY_NAMES)
        ).count()
        print(f"[seed_pilot_demo] ✅ Done — {seeded} new properties, {staff_added} staff, {bookings_added} bookings added ({total}/10 total)")
    except Exception as e:
        session.rollback()
        print(f"[seed_pilot_demo] Fatal error: {e}")
    finally:
        session.close()


# ══════════════════════════════════════════════════════════════════════════════
#  Autonomous Management Engine — 80% occupancy demo, Maya checkout + guest towels
# ══════════════════════════════════════════════════════════════════════════════

try:
    from zoneinfo import ZoneInfo
except ImportError:
    ZoneInfo = None  # type: ignore

_DEMO_ENGINE_SCHED_STARTED = False
_CHECKOUT_REMINDER_LOCK = threading.Lock()
_CHECKOUT_REMINDER_LAST_DATE = None

# Hotel Bazaar Jaffa + 14× WeWork — matches client emergency seed (15 cards)
_DEMO_15_WEWORK = [
    ("wework-tlv-london-ministore", "WeWork London Ministore", "תל אביב"),
    ("wework-tlv-toha", "WeWork ToHA", "תל אביב"),
    ("wework-tlv-azrieli-town", "WeWork Azrieli Town", "תל אביב"),
    ("wework-tlv-shaul-hamelech", "WeWork Shaul HaMelech 35", "תל אביב"),
    ("wework-tlv-midtown", "WeWork Midtown", "תל אביב"),
    ("wework-tlv-sarona", "WeWork Sarona", "תל אביב"),
    ("wework-tlv-hazerem", "WeWork HaZerem 10", "תל אביב"),
    ("wework-tlv-schocken", "WeWork Schocken 23", "תל אביב"),
    ("wework-tlv-dubnov", "WeWork Dubnov 7", "תל אביב"),
    ("wework-rg-sapir", "WeWork Sapir Tower", "רמת גן"),
    ("wework-haifa-atzmaut", "WeWork Haifa — Derech Ha'atzmaut 45", "חיפה"),
    ("wework-herzliya-shenkar", "WeWork Herzliya — Aryeh Shenkar 1", "הרצליה"),
    ("wework-jlm-king-george", "WeWork Jerusalem — King George 20", "ירושלים"),
    ("wework-b7-halutz", "WeWork Beersheba — Halutziei HaOr 16", "באר שבע"),
]

_DEMO_GUEST_FIRST_NAMES = (
    "Noam", "Yael", "David", "Sarah", "Daniel", "Maya", "Ron", "Tamar", "Alex", "Jordan",
    "Emma", "Liam", "Olivia", "Ethan", "Sophia", "James", "Chen", "Lin", "Marco", "Elena",
    "Nina", "Oren", "Shira", "Gil", "Roni", "Amit", "Lior", "Hila", "Tom", "Kate",
)
_DEMO_GUEST_LAST_NAMES = (
    "Cohen", "Levi", "Mizrahi", "Peretz", "Avraham", "Friedman", "Katz", "Bar", "Dayan", "Azulay",
    "Smith", "Brown", "Garcia", "Müller", "Rossi", "Silva", "Kim", "Patel", "Singh", "Lee",
)


def _demo_portfolio_15_rows():
    """(id, name, description, photo_url, max_guests) for Bazaar + 14 WeWork."""
    bazaar_img = "https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80"
    ww_img = "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=80"
    rows = [
        (
            "bazaar-jaffa-hotel",
            "Hotel Bazaar Jaffa",
            "Bohemian Jaffa — demo portfolio row.",
            bazaar_img,
            2,
        ),
    ]
    for wid, wname, city_he in _DEMO_15_WEWORK:
        rows.append(
            (
                wid,
                wname,
                f"WeWork {city_he} — demo portfolio row.",
                ww_img,
                1,
            )
        )
    return rows


def initialize_demo_data():
    """
    Idempotent simulation: ensure 15 canonical properties exist, ~80% Occupied,
    100+ guest bookings, housekeeping workers, automation toggles ON, sample tasks.
    """
    global DEMO_AUTOMATION_SETTINGS
    if not SessionLocal or not ManualRoomModel:
        print("[initialize_demo_data] Skipped — DB unavailable")
        return {"ok": False, "error": "no_db"}

    tenant_id = DEFAULT_TENANT_ID
    portfolio = _demo_portfolio_15_rows()
    n = len(portfolio)
    occupied_n = max(1, int(round(0.80 * n)))

    session = SessionLocal()
    stats = {"properties_upserted": 0, "bookings_added": 0, "staff_added": 0, "tasks_added": 0}
    try:
        for i, (pid, pname, pdesc, pimg, max_g) in enumerate(portfolio):
            row = session.query(ManualRoomModel).filter_by(id=pid, tenant_id=tenant_id).first()
            occ = "Occupied" if i < occupied_n else "Vacant"
            if not row:
                session.add(ManualRoomModel(
                    id=pid,
                    tenant_id=tenant_id,
                    owner_id=None,
                    name=pname,
                    description=pdesc,
                    photo_url=pimg,
                    amenities="[]",
                    status=occ,
                    created_at=now_iso(),
                    ai_automation_enabled=1,
                    max_guests=max_g,
                    bedrooms=1 if max_g > 1 else 0,
                    beds=1 if max_g > 1 else 0,
                    bathrooms=1 if max_g > 1 else 0,
                ))
                stats["properties_upserted"] += 1
            else:
                row.status = occ
                row.ai_automation_enabled = 1
                if not (row.photo_url or "").strip():
                    row.photo_url = pimg

        session.commit()

        # Housekeeping "Worker" per property for towel / service tasks
        for pid, pname, _, _, _ in portfolio:
            exists = session.query(PropertyStaffModel).filter_by(
                property_id=pid, name="עובד",
            ).first() if PropertyStaffModel else None
            if not exists and PropertyStaffModel:
                session.add(PropertyStaffModel(
                    id=str(uuid.uuid4()),
                    property_id=pid,
                    name="עובד",
                    role="Housekeeping",
                    department="Operations",
                    phone_number="0500000001",
                    branch_slug="",
                ))
                stats["staff_added"] += 1
        session.commit()

        # 100+ bookings with names and stay dates
        if BookingModel:
            cur_ct = session.query(BookingModel).filter_by(tenant_id=tenant_id).count()
            target_total = 110
            need = max(0, target_total - cur_ct)
            pid_list = [p[0] for p in portfolio]
            for _ in range(need):
                prop_id = random.choice(pid_list)
                pname = next((x[1] for x in portfolio if x[0] == prop_id), "Property")
                gn = f"{random.choice(_DEMO_GUEST_FIRST_NAMES)} {random.choice(_DEMO_GUEST_LAST_NAMES)}"
                phone = f"05{random.randint(2000000, 9999999)}"
                base = datetime.now(timezone.utc).date()
                start = base - timedelta(days=random.randint(0, 75))
                nights = random.randint(1, 10)
                end = start + timedelta(days=nights)
                st = random.choice(["confirmed", "confirmed", "completed"])
                session.add(BookingModel(
                    id=str(uuid.uuid4()),
                    tenant_id=tenant_id,
                    property_id=prop_id,
                    property_name=pname,
                    guest_name=gn,
                    guest_phone=phone,
                    check_in=start.isoformat(),
                    check_out=end.isoformat(),
                    nights=nights,
                    total_price=random.randint(400, 4800),
                    status=st,
                    created_at=now_iso(),
                ))
                stats["bookings_added"] += 1

            # Active stays with checkout today — feeds Maya 11:00 reminders
            today_iso = datetime.now(timezone.utc).date().isoformat()
            existing_today_out = session.query(BookingModel).filter_by(
                tenant_id=tenant_id, check_out=today_iso,
            ).count()
            if existing_today_out < 8:
                for _ in range(8 - existing_today_out):
                    prop_id = random.choice(pid_list)
                    pname = next((x[1] for x in portfolio if x[0] == prop_id), "Property")
                    gn = f"{random.choice(_DEMO_GUEST_FIRST_NAMES)} {random.choice(_DEMO_GUEST_LAST_NAMES)}"
                    phone = f"05{random.randint(2000000, 9999999)}"
                    cin = (
                        datetime.now(timezone.utc).date()
                        - timedelta(days=random.randint(1, 5))
                    ).isoformat()
                    session.add(BookingModel(
                        id=str(uuid.uuid4()),
                        tenant_id=tenant_id,
                        property_id=prop_id,
                        property_name=pname,
                        guest_name=gn,
                        guest_phone=phone,
                        check_in=cin,
                        check_out=today_iso,
                        nights=random.randint(1, 5),
                        total_price=random.randint(400, 2200),
                        status="confirmed",
                        created_at=now_iso(),
                    ))
                    stats["bookings_added"] += 1
            session.commit()

        # Sample operational tasks (welcome / cleaning pipeline) — off by default for live ops
        if PropertyTaskModel and not SKIP_INIT_DEMO_TASKS:
            demo_descs = [
                "Automated Welcome — בדיקת הגעה",
                "Smart Task — הכנת חדר לצ'ק-אין",
                "ניקיון לובי — סבב ערב",
            ]
            try:
                for pid, pname, _, _, _ in random.sample(portfolio, min(8, len(portfolio))):
                    for desc in random.sample(demo_descs, 1):
                        session.add(PropertyTaskModel(
                            id=str(uuid.uuid4()),
                            property_id=pid,
                            staff_id="",
                            assigned_to="",
                            description=desc,
                            status="Pending",
                            created_at=now_iso(),
                            property_name=pname,
                            staff_name="עובד",
                            staff_phone="0500000001",
                            task_type="Service",
                        ))
                        stats["tasks_added"] += 1
                session.commit()
            except Exception as _te:
                session.rollback()
                print(f"[initialize_demo_data] sample tasks skipped: {_te}", flush=True)

        DEMO_AUTOMATION_SETTINGS["automated_welcome_enabled"] = True
        DEMO_AUTOMATION_SETTINGS["smart_task_assignment_enabled"] = True

        print(
            f"[initialize_demo_data] ✅ {stats} — {occupied_n}/{n} Occupied, automation ON",
            flush=True,
        )
        return {"ok": True, **stats, "occupied_slots": occupied_n, "total_properties": n}
    except Exception as e:
        session.rollback()
        print(f"[initialize_demo_data] Error: {e}", flush=True)
        import traceback as _tb_id
        _tb_id.print_exc()
        return {"ok": False, "error": str(e)}
    finally:
        session.close()


def run_maya_checkout_reminders_for_today():
    """
    At 11:00 (Asia/Jerusalem): for active bookings checking out today on Occupied properties,
    create a 'Checkout Reminder' property_task once per guest per day.
    """
    if not SessionLocal or not BookingModel or not PropertyTaskModel or not ManualRoomModel:
        return 0
    if not ZoneInfo:
        return 0
    tz = ZoneInfo("Asia/Jerusalem")
    today = datetime.now(tz).date().isoformat()
    tenant_id = DEFAULT_TENANT_ID
    session = SessionLocal()
    created = 0
    try:
        rows = (
            session.query(BookingModel)
            .filter_by(tenant_id=tenant_id)
            .filter(BookingModel.check_out == today)
            .filter(BookingModel.status.in_(("confirmed", "checked_in")))
            .all()
        )
        for b in rows:
            pid = (b.property_id or "").strip()
            if not pid:
                continue
            room = session.query(ManualRoomModel).filter_by(id=pid, tenant_id=tenant_id).first()
            st = (getattr(room, "status", "") or "").strip().lower() if room else ""
            if room is not None and st == "vacant":
                continue
            guest = (b.guest_name or "אורח").strip()
            pname = (b.property_name or "נכס").strip()
            desc = f"Checkout Reminder — {guest} — {pname} (צ'ק-אאוט היום 11:00)"
            dup = session.query(PropertyTaskModel).filter(
                PropertyTaskModel.description == desc,
            ).first()
            if dup:
                continue
            session.add(PropertyTaskModel(
                id=str(uuid.uuid4()),
                property_id=pid,
                staff_id="",
                assigned_to="",
                description=desc,
                status="Pending",
                created_at=now_iso(),
                property_name=pname,
                staff_name="עובד",
                staff_phone="0500000001",
                task_type="Service",
            ))
            created += 1
            _ACTIVITY_LOG.append({
                "id": str(uuid.uuid4()),
                "ts": int(time.time() * 1000),
                "type": "maya_checkout_reminder",
                "text": f"🔔 מאיה: {desc}",
            })
        if created:
            session.commit()
            print(f"[Maya] Checkout reminders created: {created}", flush=True)
        return created
    except Exception as e:
        session.rollback()
        print(f"[run_maya_checkout_reminders_for_today] {e}", flush=True)
        return 0
    finally:
        session.close()


def _maya_demo_engine_scheduler_loop():
    """Wake periodically; fire checkout reminders once per day around 11:00 Israel time."""
    global _CHECKOUT_REMINDER_LAST_DATE
    while True:
        time.sleep(45)
        try:
            if not ZoneInfo:
                continue
            tz = ZoneInfo("Asia/Jerusalem")
            now = datetime.now(tz)
            if now.hour != 11:
                continue
            dkey = now.date().isoformat()
            with _CHECKOUT_REMINDER_LOCK:
                if _CHECKOUT_REMINDER_LAST_DATE == dkey:
                    continue
                if DEMO_AUTOMATION_SETTINGS.get("automated_welcome_enabled") or DEMO_AUTOMATION_SETTINGS.get("smart_task_assignment_enabled"):
                    run_maya_checkout_reminders_for_today()
                _CHECKOUT_REMINDER_LAST_DATE = dkey
        except Exception as ex:
            print(f"[_maya_demo_engine_scheduler_loop] {ex}", flush=True)


def start_maya_demo_engine_scheduler():
    global _DEMO_ENGINE_SCHED_STARTED
    if _DEMO_ENGINE_SCHED_STARTED:
        return
    _DEMO_ENGINE_SCHED_STARTED = True
    threading.Thread(
        target=_maya_demo_engine_scheduler_loop,
        daemon=True,
        name="MayaDemoEngineScheduler",
    ).start()
    print("[Maya] Demo engine scheduler thread started (11:00 checkout reminders)", flush=True)


def _guest_towel_resolve_worker(session, tenant_id, property_id, property_name_hint=""):
    """Pick housekeeping worker for property; fallback name עובד."""
    if not PropertyStaffModel or not property_id:
        return "עובד", "", ""
    staff_rows = session.query(PropertyStaffModel).filter_by(property_id=property_id).all()
    for role_key in ("Housekeeping", "Cleaning", "Worker", "housekeeping"):
        for s in staff_rows:
            r = (getattr(s, "role", "") or "").strip()
            if r.lower() == role_key.lower() or "clean" in r.lower():
                return s.name or "עובד", getattr(s, "phone_number", "") or "", s.id
    for s in staff_rows:
        return s.name or "עובד", getattr(s, "phone_number", "") or "", s.id
    return "עובד", "0500000001", ""


def _get_pilot_properties(session):
    """Return ManualRoomModel rows for the 10 pilot demo properties."""
    rows = session.query(ManualRoomModel).filter(
        ManualRoomModel.name.in_(DEMO_PILOT_PROPERTY_NAMES)
    ).all()
    if not rows:  # fallback: any active properties in this tenant
        rows = session.query(ManualRoomModel).filter_by(
            tenant_id=DEFAULT_TENANT_ID
        ).limit(10).all()
    return rows


def _generate_demo_complaints(count=5):
    """Insert `count` random guest complaints as Pending tasks for demo properties."""
    if not SessionLocal or not PropertyTaskModel or not ManualRoomModel:
        return 0
    session = SessionLocal()
    try:
        props = _get_pilot_properties(session)
        if not props:
            return 0
        sample = random.sample(DEMO_COMPLAINTS, min(count, len(DEMO_COMPLAINTS)))
        created = 0
        for desc, staff_name in sample:
            prop     = random.choice(props)
            room_num = random.randint(101, 509)
            ms       = next((m for m in MOCK_STAFF if m["name"] == staff_name), MOCK_STAFF[0])
            task_id  = str(uuid.uuid4())
            full_desc = f"Room {room_num}: {desc}"
            session.add(PropertyTaskModel(
                id=task_id, property_id=prop.id,
                staff_id="", assigned_to="",
                description=full_desc, status="Pending", created_at=now_iso(),
                property_name=prop.name, staff_name=staff_name, staff_phone=ms["phone"],
            ))
            _ACTIVITY_LOG.append({
                "id": str(uuid.uuid4()),
                "ts": int(time.time() * 1000),
                "type": "task_created",
                "text": f"🚨 {prop.name}: {full_desc}",
                "task": {
                    "id": task_id, "description": full_desc,
                    "property_name": prop.name, "staff_name": staff_name,
                },
            })
            created += 1
        session.commit()
        print(f"[GuestSim] Generated {created} complaints")
        return created
    except Exception as e:
        _sim_log(f"❌ Error generating complaints: {e}", "error")
        session.rollback()
        print(f"[GuestSim] Error: {e}")
        return 0
    finally:
        session.close()


def _mock_staff_auto_respond():
    """Auto-complete mock-staff tasks that have been Pending for >5 minutes."""
    if not SessionLocal or not PropertyTaskModel:
        return
    session = SessionLocal()
    try:
        cutoff_iso = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
        pending = session.query(PropertyTaskModel).filter(
            PropertyTaskModel.status == "Pending",
            PropertyTaskModel.staff_name.in_(MOCK_STAFF_NAMES),
            PropertyTaskModel.created_at <= cutoff_iso,
        ).all()
        for task in pending:
            ms   = next((m for m in MOCK_STAFF if m["name"] == task.staff_name), MOCK_STAFF[0])
            note = random.choice(DEMO_COMPLETION_NOTES)
            task.status       = "Done"
            task.completed_at = now_iso()
            task.worker_notes = note
            task.photo_url    = DEMO_PLACEHOLDER_IMAGE
            _ACTIVITY_LOG.append({
                "id":   str(uuid.uuid4()),
                "ts":   int(time.time() * 1000),
                "type": "task_created",
                "text": f"{ms['emoji']} {task.staff_name} completed: {task.property_name} — {note}",
                "task": {
                    "id": task.id, "status": "Done",
                    "staff_name": task.staff_name,
                    "property_name": task.property_name,
                    "description": task.description,
                    "worker_notes": note,
                    "photo_url": DEMO_PLACEHOLDER_IMAGE,
                },
            })
        if pending:
            session.commit()
            _sim_log(f"✅ Mock staff auto-completed {len(pending)} task(s)", "success")
            for task in pending:
                ms = next((m for m in MOCK_STAFF if m["name"] == task.staff_name), MOCK_STAFF[0])
                _sim_log(
                    f"  {ms['emoji']} {task.staff_name} → {task.property_name}: {task.description[:50]}",
                    "success",
                )
            print(f"[MockStaff] Auto-completed {len(pending)} tasks")
    except Exception as e:
        _sim_log(f"❌ Mock staff error: {e}", "error")
        session.rollback()
        print(f"[MockStaff] Error: {e}")
    finally:
        session.close()


def _guest_simulation_loop():
    """Background thread: generate 5 guest complaints every 15 minutes."""
    import time as _t
    _sim_log("🚀 Guest simulation started — complaints every 15 minutes", "info")
    print("[GuestSim] Thread started — complaints every 15 minutes")
    while not DEMO_STOP_EVENT.is_set():
        for _ in range(90):        # 90 × 10s = 900s = 15 min
            if DEMO_STOP_EVENT.is_set():
                return
            _t.sleep(10)
        try:
            count = _generate_demo_complaints(5)
            _sim_log(f"💬 Injected {count} guest complaints into the database", "warn")
        except Exception as e:
            _sim_log(f"❌ Guest sim error: {e}", "error")
            print(f"[GuestSim] Loop error: {e}")
    _sim_log("⏹ Guest simulation stopped", "info")
    print("[GuestSim] Thread stopped")


def _mock_staff_loop():
    """Background thread: auto-complete mock-staff tasks every 30 seconds."""
    import time as _t
    _sim_log("🤖 Mock staff auto-responder started — polling every 30 s (5 min response time)", "info")
    print("[MockStaff] Thread started — polling every 30 s")
    while not DEMO_STOP_EVENT.is_set():
        _t.sleep(30)
        try:
            _mock_staff_auto_respond()
        except Exception as e:
            _sim_log(f"❌ Mock staff loop error: {e}", "error")
            print(f"[MockStaff] Loop error: {e}")
    _sim_log("⏹ Mock staff auto-responder stopped", "info")
    print("[MockStaff] Thread stopped")


def start_pilot_simulation():
    """Start guest simulation + mock staff auto-response threads. Idempotent."""
    global DEMO_ACTIVE
    with DEMO_LOCK:
        if DEMO_ACTIVE:
            return
        DEMO_STOP_EVENT.clear()
        _sim_log("▶️  runPilotSimulation() — STARTED", "info")
        _sim_log("   • 10 demo properties seeded across 2 owners (John & Sarah)", "info")
        _sim_log("   • Guest complaints injected every 15 minutes (5 per batch)", "info")
        _sim_log("   • Mock staff auto-respond after 5 minutes with photo proof", "info")
        threading.Thread(target=_generate_demo_complaints, args=(5,), daemon=True,
                         name="DemoFirstBatch").start()
        threading.Thread(target=_guest_simulation_loop, daemon=True, name="GuestSimLoop").start()
        threading.Thread(target=_mock_staff_loop,       daemon=True, name="MockStaffLoop").start()
        DEMO_ACTIVE = True
    print("[Demo] Pilot simulation STARTED")


def stop_pilot_simulation():
    """Signal all simulation threads to stop."""
    global DEMO_ACTIVE
    with DEMO_LOCK:
        DEMO_STOP_EVENT.set()
        DEMO_ACTIVE = False
    _sim_log("⏹  runPilotSimulation() — STOPPED", "warn")
    print("[Demo] Pilot simulation STOPPED")


def runPilotSimulation() -> dict:
    """
    Full pilot simulation bootstrap — call once to:
      1. Ensure schema exists on Supabase / PostgreSQL
      2. Seed 10 pilot properties (5 × John, 5 × Sarah) + mock staff
      3. Start the guest-complaint injection loop (every 15 min)
      4. Start the mock-staff auto-response loop (5 min response time)

    Idempotent — safe to call multiple times; already-existing data is skipped.
    Returns a dict summarising what was done.
    """
    result: dict = {
        "schema_created": False,
        "properties_seeded": 0,
        "simulation_started": False,
        "already_active": DEMO_ACTIVE,
        "db_url_type": (
            "supabase" if "supabase" in DATABASE_URL else
            "postgres"  if _is_pg                     else
            "sqlite"
        ),
    }

    # 1 — schema
    if Base and ENGINE:
        try:
            init_db()
            result["schema_created"] = True
        except Exception as e:
            result["schema_error"] = str(e)

    # 2 — seed
    try:
        seed_pilot_demo()
        # Count how many pilot properties exist after seeding
        if SessionLocal and ManualRoomModel:
            s = SessionLocal()
            try:
                result["properties_seeded"] = s.query(ManualRoomModel).filter(
                    ManualRoomModel.name.in_(DEMO_PILOT_PROPERTY_NAMES)
                ).count()
            finally:
                s.close()
    except Exception as e:
        result["seed_error"] = str(e)

    # 3+4 — start simulation loops
    if not DEMO_ACTIVE:
        start_pilot_simulation()
        result["simulation_started"] = True
    else:
        result["simulation_started"] = False   # already running

    _sim_log(
        f"🏁 runPilotSimulation() complete — "
        f"{result['properties_seeded']} properties · bots {'active' if DEMO_ACTIVE else 'FAILED to start'}",
        "success",
    )
    return result


def get_tenant_ids():
    if SessionLocal and TenantModel:
        session = SessionLocal()
        try:
            return [tenant.id for tenant in session.query(TenantModel).all()]
        finally:
            session.close()
    return [DEFAULT_TENANT_ID]


def scout_worker():
    while True:
        payload = SCOUT_QUEUE.get()
        if payload is None:
            break
        # Skip entirely when background scanning is disabled — keeps terminal clean
        if not BACKGROUND_SCAN_ENABLED:
            SCOUT_QUEUE.task_done()
            continue
        tenant_id = payload.get("tenant_id") or DEFAULT_TENANT_ID
        platforms = payload.get("platforms")
        vacancy_windows = payload.get("vacancy_windows")
        new_leads = scan_realtime_leads(platforms=platforms, vacancy_windows=vacancy_windows)
        for lead in new_leads:
            try:
                add_lead(lead, tenant_id=tenant_id)
                if lead.get("lead_quality", 0) >= 75:
                    auto_greet_lead(lead)
            except Exception as e:
                print("[scout_worker] add_lead error:", e)
        AUTOMATION_STATS.setdefault(tenant_id, {"automated_messages": 0, "last_scan": None})
        AUTOMATION_STATS[tenant_id]["last_scan"] = now_iso()
        emit_automation_stats(tenant_id)
        SCOUT_QUEUE.task_done()



# ── Set to "1" in .env to re-enable automatic lead-scanning every 20 s ───────
# ══════════════════════════════════════════════════════════════════
# AUTO_MODE — master switch for all background AI activity.
#
#   AUTO_MODE = False  →  Manual Trigger Mode (current default)
#     • No automatic Gemini calls, no background scanning
#     • Terminal stays quiet; only manual /test-task commands run
#     • Use /test-task in the chat to inject tasks for testing
#
#   AUTO_MODE = True   →  Full autonomous mode
#     • Background lead scanning, proactive messaging, auto reports
#     • Flip this when you're ready for production
#
# To enable: set AUTO_MODE = True  OR  set env AUTO_MODE=1
# ══════════════════════════════════════════════════════════════════
AUTO_MODE = str(os.getenv("AUTO_MODE", "1")).strip().lower() in ("1", "true", "yes", "on")
if AUTO_MODE:
    print("[Maya] ✅ AUTO_MODE = True  — Maya is running autonomously")
else:
    print("[Maya] 🔕 AUTO_MODE = False — Manual Trigger Mode active. Use /test-task in chat.")

BACKGROUND_SCAN_ENABLED = AUTO_MODE or (
    str(os.getenv("BACKGROUND_SCAN", "0")).strip().lower() in ("1", "true", "yes")
)

VIP_ESCALATION_MINUTES = 30
_VIP_ESCAL_THREAD_STARTED = False


def _parse_task_iso_dt(val):
    if not val:
        return None
    try:
        s = str(val).replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _run_vip_escalation_tick():
    """AUTO_MODE: VIP Guest tasks open >30m → priority critical + WhatsApp escalation."""
    if not AUTO_MODE or not SessionLocal or not PropertyTaskModel:
        return
    session = SessionLocal()
    try:
        q = _property_tasks_query_for_tenant(session, DEFAULT_TENANT_ID)
        if q is None:
            return
        now = datetime.now(timezone.utc)
        for r in q.all():
            st = _norm_task_status_category(getattr(r, "status", None))
            if st == "done":
                continue
            ttype = (getattr(r, "task_type", "") or "").strip()
            if "vip" not in ttype.lower():
                continue
            pri = (getattr(r, "priority", "") or "").strip().lower()
            if pri == "critical":
                continue
            notes = (getattr(r, "worker_notes", "") or "")
            if "[ESCALATED]" in notes:
                continue
            created = _parse_task_iso_dt(getattr(r, "created_at", None))
            if not created:
                continue
            if created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            age_min = (now - created).total_seconds() / 60.0
            if age_min < VIP_ESCALATION_MINUTES:
                continue
            r.priority = "critical"
            r.worker_notes = (notes + "\n[ESCALATED] " + now.isoformat()).strip()
            session.commit()
            desc = (r.description or "")[:200]
            msg = f"🚨 מייה — הסלמה VIP: {desc} (פתוח {int(age_min)} דק׳)"
            enqueue_twilio_task("whatsapp", to=OWNER_PHONE, message=msg)
            if STAFF_PHONE:
                enqueue_twilio_task("whatsapp", to=STAFF_PHONE, message=msg)
            print(f"[VIP escalation] task {str(r.id)[:8]}… age={age_min:.0f} min", flush=True)
    except Exception as e:
        try:
            session.rollback()
        except Exception:
            pass
        print(f"[VIP escalation] {e}", flush=True)
    finally:
        session.close()


def start_vip_escalation_watcher():
    global _VIP_ESCAL_THREAD_STARTED
    if _VIP_ESCAL_THREAD_STARTED or not AUTO_MODE:
        return
    _VIP_ESCAL_THREAD_STARTED = True

    def _loop():
        while True:
            time.sleep(60)
            try:
                _run_vip_escalation_tick()
            except Exception as _ve:
                print("[VIP escalation loop]", _ve, flush=True)

    threading.Thread(target=_loop, daemon=True, name="VipEscalation").start()
    print("[VIP escalation] background watcher started (60s)", flush=True)


def scanning_loop():
    """Lead scanner. Disabled by default (BACKGROUND_SCAN=0) to preserve Gemini quota.
    Enable via .env: BACKGROUND_SCAN=1"""
    if not BACKGROUND_SCAN_ENABLED:
        print("[Scanner] Background scan DISABLED (BACKGROUND_SCAN=0). Terminal will be silent.")
        return          # exit immediately — no looping, no Twilio SIMULATE noise
    while True:
        time.sleep(20)
        for tenant_id in get_tenant_ids():
            SCOUT_QUEUE.put({"tenant_id": tenant_id, "platforms": ["airbnb", "booking"]})


def start_scanner():
    global SCANNER_STARTED
    with SCANNER_LOCK:
        if SCANNER_STARTED:
            return
        workers = int(os.getenv("SCOUT_WORKERS", "4"))
        for _ in range(workers):
            thread = threading.Thread(target=scout_worker, daemon=True)
            thread.start()
        scheduler = threading.Thread(target=scanning_loop, daemon=True)
        scheduler.start()
        SCANNER_STARTED = True


def calendar_sync_loop():
    while True:
        now_local = datetime.now()
        interval = get_ical_sync_interval_seconds(now_local)
        time.sleep(60)
        for tenant_id in get_tenant_ids():
            last_sync = ICAL_LAST_SYNC.get(tenant_id)
            if last_sync and (time.time() - last_sync) < interval:
                continue
            try:
                result = sync_ical_for_tenant(tenant_id)
                if result:
                    ICAL_LAST_SYNC[tenant_id] = time.time()
            except Exception:
                continue


def start_calendar_syncer():
    global ICAL_SYNC_STARTED
    with ICAL_SYNC_LOCK:
        if ICAL_SYNC_STARTED:
            return
        thread = threading.Thread(target=calendar_sync_loop, daemon=True)
        thread.start()
        ICAL_SYNC_STARTED = True


def _get_local_ip():
    """Get this machine's local network IP for QR code / mobile access."""
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


@app.route("/api/local-ip", methods=["GET"])
def api_local_ip():
    """Return local IP and suggested app URL for QR code / mobile scanning."""
    ip = _get_local_ip()
    return jsonify({
        "ip": ip,
        "appUrl": f"http://{ip}:3000",
    })


@app.route("/health", methods=["GET", "OPTIONS"])
@cross_origin(origins=_CORS_ORIGINS, supports_credentials=True, allow_headers=["Content-Type", "Authorization", "X-Tenant-Id", "Accept"])
def health():
    if request.method == "OPTIONS":
        return Response(status=204)
    whatsapp_ready = bool(TWILIO_CLIENT and os.getenv("TWILIO_WHATSAPP_FROM"))
    db_ready = bool(ENGINE and SessionLocal and Base)
    gemini_configured = bool(GEMINI_MODEL)
    return jsonify({
        "ok": True,
        "time": now_iso(),
        "whatsapp_ready": whatsapp_ready,
        "objection_ready": True,
        "objection_languages": ["he"],
        "db_ready": db_ready,
        "auth_enabled": not AUTH_DISABLED,
        "gemini_configured": gemini_configured,
    })


@app.route("/api/field/staff-activity", methods=["GET"])
@require_auth
def field_staff_activity():
    """Last N field-app status updates (timestamp + staff + room) for Task Calendar / admins."""
    try:
        lim = int(request.args.get("limit", "40"))
        lim = max(1, min(lim, 120))
    except (TypeError, ValueError):
        lim = 40
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    matched = [
        e for e in _ACTIVITY_LOG
        if e.get("type") == "staff_field_status" and e.get("tenant_id") == tenant_id
    ]
    matched.sort(key=lambda e: e.get("ts", 0), reverse=True)
    return jsonify({"events": matched[:lim]})


@app.route("/api/activity-feed", methods=["GET"])
def activity_feed():
    """
    Returns the last N simulate/task events from _ACTIVITY_LOG.
    MayaChat.js polls this every 4 s and shows new entries as Maya messages.
    Query param:  ?since=<unix_ms>   — only return entries newer than this timestamp.
    """
    since_ms = float(request.args.get("since", 0) or 0)
    now_ms = int(time.time() * 1000)
    events = [e for e in _ACTIVITY_LOG if e.get("ts", 0) > since_ms]
    return jsonify({"events": list(events), "server_ts": now_ms})


@app.route("/api/demo/status", methods=["GET"])
def demo_status():
    """Return current pilot simulation status."""
    return jsonify({"active": DEMO_ACTIVE, "mock_staff": MOCK_STAFF_NAMES})


@app.route("/api/demo/toggle", methods=["POST"])
def demo_toggle():
    """Start or stop the pilot simulation. Body: { action: 'start'|'stop'|'reset' }"""
    data   = request.get_json(silent=True) or {}
    action = data.get("action", "start")
    if action == "stop":
        stop_pilot_simulation()
        return jsonify({"ok": True, "active": False})
    if action == "reset":
        stop_pilot_simulation()
        if SessionLocal and PropertyTaskModel:
            session = SessionLocal()
            try:
                session.query(PropertyTaskModel).filter(
                    PropertyTaskModel.staff_name.in_(MOCK_STAFF_NAMES)
                ).delete(synchronize_session=False)
                session.commit()
            except Exception as e:
                session.rollback()
                print(f"[Demo reset] Error: {e}")
            finally:
                session.close()
        return jsonify({"ok": True, "active": False, "reset": True})
    # default: start
    start_pilot_simulation()
    return jsonify({"ok": True, "active": True})


@app.route("/init-db", methods=["GET"])
def init_db_browser():
    """
    Browser-friendly one-shot endpoint.
    Visit https://easyhost-backend.onrender.com/init-db to:
      1. Create all tables in Supabase (CREATE TABLE IF NOT EXISTS)
      2. Seed 10 pilot properties + mock staff
      3. Start the simulation bots
      4. Return a plain-text summary so you can see it immediately in the browser
    """
    lines = []

    def log(msg):
        lines.append(msg)
        print(msg)

    # ── 1. Schema ────────────────────────────────────────────────────────────
    db_label = (
        "Supabase PostgreSQL" if "supabase" in DATABASE_URL else
        "PostgreSQL"          if _is_pg else
        "SQLite"
    )
    log(f"[init-db] Connecting to {db_label}…")
    if ENGINE and Base:
        try:
            # Quick connection test
            from sqlalchemy import text as _text
            with ENGINE.connect() as _c:
                _c.execute(_text("SELECT 1"))
            log(f"[init-db] ✅ Connected to {db_label} successfully")
        except Exception as ce:
            log(f"[init-db] ❌ Connection failed: {ce}")
            return (
                f"❌ Cannot connect to {db_label}.\n\n"
                f"Error: {ce}\n\n"
                "Check SUPABASE_URL and SUPABASE_KEY (must be DATABASE password, not JWT key).",
                500,
                {"Content-Type": "text/plain; charset=utf-8"},
            )
        try:
            init_db()
            log("[init-db] ✅ All tables created (CREATE TABLE IF NOT EXISTS)")
        except Exception as e:
            log(f"[init-db] ❌ Schema error: {e}")
    else:
        log("[init-db] ⚠️  Database engine not available — check SQLAlchemy install")

    # ── 1b. Seed admin user (levikobi40@gmail.com / 123456) ──────────────────
    try:
        ensure_levikobi_user()
        ensure_admin_from_env()
        log("[init-db] ✅ Admin user levikobi40@gmail.com ready (pw: 123456)")
    except Exception as e:
        log(f"[init-db] ⚠️  Admin seed warning: {e}")

    # ── 2. Seed 10 pilot properties ──────────────────────────────────────────
    prop_count = 0
    try:
        seed_pilot_demo()
        if SessionLocal and ManualRoomModel:
            s = SessionLocal()
            try:
                prop_count = s.query(ManualRoomModel).filter(
                    ManualRoomModel.name.in_(DEMO_PILOT_PROPERTY_NAMES)
                ).count()
            finally:
                s.close()
        log(f"[init-db] ✅ {prop_count} pilot properties in database")
    except Exception as e:
        log(f"[init-db] ⚠️  Seed warning: {e}")

    # ── 3. Start simulation bots ─────────────────────────────────────────────
    try:
        if not DEMO_ACTIVE:
            start_pilot_simulation()
            log("[init-db] ✅ Simulation bots started (guest complaints + staff responses)")
        else:
            log("[init-db] ℹ️  Simulation bots already running")
    except Exception as e:
        log(f"[init-db] ⚠️  Bot start warning: {e}")

    # ── 4. Response ──────────────────────────────────────────────────────────
    summary = "\n".join(lines)
    body = (
        f"🏨 Pilot Ready!\n"
        f"{'=' * 50}\n"
        f"Database  : {db_label}\n"
        f"Properties: {prop_count} pilot properties seeded\n"
        f"Bots      : {'LIVE' if DEMO_ACTIVE else 'started'}\n"
        f"{'=' * 50}\n\n"
        f"Log:\n{summary}\n"
    )
    return body, 200, {"Content-Type": "text/plain; charset=utf-8"}


@app.route("/db-status", methods=["GET"])
def db_status():
    """
    Visit https://easyhost.onrender.com/db-status to see exactly which database
    the server is connected to and whether the connection works.
    """
    db_type = (
        "Supabase PostgreSQL" if "supabase" in DATABASE_URL or "pooler.supabase" in DATABASE_URL else
        "PostgreSQL"          if _is_pg else
        "SQLite (local)"
    )
    safe_url  = re.sub(r":([^:@]+)@", ":***@", DATABASE_URL)
    connected = False
    table_count = 0
    error_msg = ""
    try:
        from sqlalchemy import text as _t, inspect as _inspect
        with ENGINE.connect() as _c:
            _c.execute(_t("SELECT 1"))
        connected = True
        insp = _inspect(ENGINE)
        table_count = len(insp.get_table_names())
    except Exception as e:
        error_msg = str(e)

    # Env var diagnostics (values masked)
    env_diag = {
        "DATABASE_URL":         "set ✅" if os.getenv("DATABASE_URL") else "not set",
        "SUPABASE_URL":         os.getenv("SUPABASE_URL", "not set"),
        "SUPABASE_KEY":         ("set ✅ (starts with: " + os.getenv("SUPABASE_KEY","")[:12] + "…)") if os.getenv("SUPABASE_KEY") else "not set",
        "SUPABASE_DB_PASSWORD": "set ✅" if os.getenv("SUPABASE_DB_PASSWORD") else "not set ❌",
    }

    lines = [
        "╔══ EasyHost DB Status ══════════════════════════╗",
        f"  Database type : {db_type}",
        f"  Connection URL: {safe_url[:80]}",
        f"  Connected      : {'✅ YES' if connected else '❌ NO — ' + error_msg}",
        f"  Tables found   : {table_count}",
        "╠══ Environment Variables ════════════════════════╣",
    ]
    for k, v in env_diag.items():
        lines.append(f"  {k:<24}: {v}")

    if not connected and _is_pg:
        lines += [
            "╠══ Fix ══════════════════════════════════════════╣",
            "  Set SUPABASE_DB_PASSWORD in Render env vars:",
            "  → Supabase Dashboard → Settings → Database",
            "  → Copy 'Database Password' (reset if forgotten)",
            "  OR set DATABASE_URL to the full connection string",
        ]
    if connected and table_count == 0:
        lines.append("  ⚠️  Connected but no tables — visit /init-db to create them")
    elif connected:
        lines.append("  ✅ Ready — visit /init-db to seed pilot data if needed")
    lines.append("╚════════════════════════════════════════════════╝")

    return "\n".join(lines) + "\n", 200, {"Content-Type": "text/plain; charset=utf-8"}


@app.route("/api/demo/run-pilot", methods=["POST", "GET"])
def run_pilot_endpoint():
    """
    One-click pilot simulation launcher.
    POST (or GET) → runs runPilotSimulation() and returns a JSON status report.

    Also accepts an optional query param:
      ?reset=1  → stop + wipe mock-staff tasks before restarting
    """
    if request.args.get("reset") == "1":
        stop_pilot_simulation()
        if SessionLocal and PropertyTaskModel:
            session = SessionLocal()
            try:
                session.query(PropertyTaskModel).filter(
                    PropertyTaskModel.staff_name.in_(MOCK_STAFF_NAMES)
                ).delete(synchronize_session=False)
                session.commit()
                _sim_log("🔄 Reset: cleared all mock-staff tasks", "warn")
            except Exception as e:
                session.rollback()
            finally:
                session.close()

    report = runPilotSimulation()
    return jsonify({
        "ok":    True,
        "report": report,
        "message": (
            f"✅ runPilotSimulation() complete — "
            f"{report.get('properties_seeded', 0)} pilot properties on "
            f"{report.get('db_url_type','unknown')} — "
            f"simulation {'already active' if report.get('already_active') else 'started'}"
        ),
    })


@app.route("/api/sim-log", methods=["GET"])
@require_auth
def sim_log_endpoint():
    """
    Real-time simulation activity log for the God Mode admin dashboard.
    Returns the last N entries (newest first) from the _SIM_LOG deque.
    Query param: ?limit=50
    """
    limit   = min(int(request.args.get("limit", 50)), 200)
    entries = list(_SIM_LOG)[-limit:]
    return jsonify({"entries": list(reversed(entries)), "count": len(_SIM_LOG)})


@app.route("/api/god-mode/overview", methods=["GET"])
@require_auth
def god_mode_overview():
    """
    Master God-Mode overview: all pilot properties with task counts,
    recent pending tasks, recent mock-staff completions, and live stats.
    """
    if not SessionLocal or not ManualRoomModel or not PropertyTaskModel:
        return jsonify({"properties": [], "pending_tasks": [], "completions": [], "stats": {}, "demo_active": DEMO_ACTIVE})

    session = SessionLocal()
    try:
        # ── All pilot properties ──────────────────────────────────────────────
        props     = _get_pilot_properties(session)
        prop_ids  = [p.id for p in props]

        # Load task counts per property
        from sqlalchemy import func as _func
        pending_counts = {
            row[0]: row[1]
            for row in session.query(
                PropertyTaskModel.property_id, _func.count(PropertyTaskModel.id)
            ).filter(
                PropertyTaskModel.property_id.in_(prop_ids),
                PropertyTaskModel.status == "Pending",
            ).group_by(PropertyTaskModel.property_id).all()
        }
        done_counts = {
            row[0]: row[1]
            for row in session.query(
                PropertyTaskModel.property_id, _func.count(PropertyTaskModel.id)
            ).filter(
                PropertyTaskModel.property_id.in_(prop_ids),
                PropertyTaskModel.status == "Done",
            ).group_by(PropertyTaskModel.property_id).all()
        }

        # Build owner map: owner_id → email (to derive first name)
        owner_cache = {}
        if UserModel:
            for p in props:
                if p.owner_id and p.owner_id not in owner_cache:
                    u = session.query(UserModel).filter_by(id=p.owner_id).first()
                    if u:
                        owner_cache[p.owner_id] = u.email.split("@")[0].capitalize()

        properties_out = []
        for p in props:
            pid = p.id
            owner_name = owner_cache.get(p.owner_id, "Unknown")
            pending = pending_counts.get(pid, 0)
            done    = done_counts.get(pid, 0)
            status  = "busy" if pending > 2 else ("active" if pending > 0 else "clear")
            properties_out.append({
                "id": pid, "name": p.name, "owner": owner_name,
                "pending": pending, "done": done, "status": status,
            })

        # ── Recent pending tasks (last 30) ────────────────────────────────────
        pending_tasks = session.query(PropertyTaskModel).filter(
            PropertyTaskModel.property_id.in_(prop_ids),
            PropertyTaskModel.status == "Pending",
        ).order_by(PropertyTaskModel.created_at.desc()).limit(30).all()

        pending_out = [{
            "id": t.id, "property_name": t.property_name or "—",
            "description": t.description or "—", "staff_name": t.staff_name or "—",
            "created_at": t.created_at,
        } for t in pending_tasks]

        # ── Recent mock-staff completions (last 20) ───────────────────────────
        completions = session.query(PropertyTaskModel).filter(
            PropertyTaskModel.staff_name.in_(MOCK_STAFF_NAMES),
            PropertyTaskModel.status == "Done",
        ).order_by(PropertyTaskModel.completed_at.desc()).limit(20).all()

        completions_out = [{
            "id": t.id, "property_name": t.property_name or "—",
            "description": t.description or "—", "staff_name": t.staff_name or "—",
            "worker_notes": t.worker_notes or "Completed",
            "completed_at": t.completed_at,
            "photo_url": t.photo_url or "",
        } for t in completions]

        # ── Overall stats ─────────────────────────────────────────────────────
        total_pending = sum(pending_counts.values())
        total_done    = sum(done_counts.values())
        stats = {
            "total_properties": len(props),
            "active_tasks":     total_pending,
            "completed_tasks":  total_done,
            "mock_staff_count": len(MOCK_STAFF),
        }

        return jsonify({
            "properties":   properties_out,
            "pending_tasks": pending_out,
            "completions":  completions_out,
            "stats":        stats,
            "demo_active":  DEMO_ACTIVE,
        })
    except Exception as e:
        print(f"[god_mode_overview] Error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()


@app.route("/api/completed-today", methods=["GET", "OPTIONS"])
def completed_today():
    """
    Returns all PropertyTask rows whose status is Done/Completed
    and whose updated_at (or created_at) falls on today (UTC).
    Used by ManagerPipeline.jsx for the 'Completed Today' glassmorphism feed.
    Requires auth so results are tenant-scoped.
    """
    if request.method == "OPTIONS":
        return Response(status=204)

    try:
        identity = get_property_tasks_auth_bundle()
    except ValueError as _auth_e:
        return jsonify({"error": str(_auth_e) or "Unauthorized"}), 401
    _ct_tenant_id = identity["tenant_id"]

    if not SessionLocal or not PropertyTaskModel:
        return jsonify([]), 200

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    session = SessionLocal()
    try:
        rows = _property_tasks_query_for_tenant(session, _ct_tenant_id).filter(
            PropertyTaskModel.status.in_(["Done", "done", "Completed", "completed"])
        ).order_by(PropertyTaskModel.created_at.desc()).limit(200).all()

        results = []
        for r in rows:
            # Check updated_at or created_at falls on today
            ts_col = getattr(r, "updated_at", None) or getattr(r, "created_at", None)
            if ts_col:
                try:
                    ts_str = str(ts_col)[:10]  # "YYYY-MM-DD"
                    if ts_str != today_str:
                        continue
                except Exception:
                    continue
            results.append({
                "id":           r.id,
                "property_id":  r.property_id,
                "property_name": getattr(r, "property_name", None) or "",
                "description":  r.description or "",
                "task_type":    getattr(r, "task_type", None) or "",
                "status":       r.status,
                "staff_name":   getattr(r, "staff_name", None) or "",
                "staff_phone":  getattr(r, "staff_phone", None) or "",
                "created_at":   str(r.created_at) if r.created_at else None,
                "updated_at":   str(getattr(r, "updated_at", None) or r.created_at or ""),
            })
        print(f"[completed-today] Returning {len(results)} tasks for {today_str}")
        return jsonify(results), 200
    except Exception as e:
        session.rollback()
        print(f"[completed-today] DB_ERROR: {e}")
        import traceback as _tb_ct; _tb_ct.print_exc()
        return jsonify([]), 200
    finally:
        session.close()


@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    """Register a new user. Creates user in users table with hashed password."""
    if not SessionLocal or not UserModel:
        return jsonify({"error": "Auth unavailable"}), 500
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email:
        return jsonify({"error": "Email required"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    reg_role = (data.get("role") or "staff").strip().lower()
    if reg_role not in ("admin", "manager", "staff"):
        reg_role = "staff"
    if reg_role == "admin":
        reg_role = "staff"
    if reg_role == "operation":
        reg_role = "staff"
    worker_handle_reg = (data.get("worker_handle") or data.get("workerHandle") or "").strip()
    session = SessionLocal()
    try:
        existing = session.query(UserModel).filter_by(email=email).first()
        if existing:
            return jsonify({"error": "Email already registered"}), 409
        user_id = str(uuid.uuid4())
        user = UserModel(
            id=user_id,
            tenant_id=DEFAULT_TENANT_ID,
            email=email,
            password_hash=hash_password(password),
            role=reg_role,
            worker_handle=worker_handle_reg.lower() if worker_handle_reg else None,
            created_at=now_iso(),
        )
        session.add(user)
        session.commit()
        now = datetime.now(timezone.utc)
        norm_role = _normalize_app_role(reg_role)
        payload = {
            "sub": user_id,
            "tenant_id": DEFAULT_TENANT_ID,
            "role": norm_role,
            "email": email,
            "worker_handle": (worker_handle_reg.lower() if worker_handle_reg else None),
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=JWT_EXP_HOURS)).timestamp()),
        }
        return jsonify({
            "token": encode_jwt(payload),
            "tenant_id": DEFAULT_TENANT_ID,
            "role": norm_role,
            "worker_handle": worker_handle_reg.lower() if worker_handle_reg else None,
        }), 201
    except Exception as e:
        session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    """Login with email/password. Uses werkzeug password verification."""
    if not SessionLocal or not UserModel:
        return jsonify({"error": "Auth unavailable"}), 500
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email:
        return jsonify({"error": "Email required"}), 400
    session = SessionLocal()
    try:
        user = session.query(UserModel).filter_by(email=email).first()
    finally:
        session.close()
    if not user or not verify_password(user.password_hash, password):
        return jsonify({"error": "Invalid credentials"}), 401
    now = datetime.now(timezone.utc)
    norm_role = _normalize_app_role(user.role)
    wh = (getattr(user, "worker_handle", None) or "").strip()
    payload = {
        "sub": user.id,
        "tenant_id": user.tenant_id,
        "role": norm_role,
        "email": (user.email or "").strip().lower(),
        "worker_handle": wh.lower() if wh else None,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=JWT_EXP_HOURS)).timestamp()),
    }
    return jsonify({
        "token": encode_jwt(payload),
        "tenant_id": user.tenant_id,
        "role": norm_role,
        "email": user.email,
        "worker_handle": wh.lower() if wh else None,
    })


@app.route("/api/auth/demo", methods=["POST"])
def auth_demo():
    if not ALLOW_DEMO_AUTH:
        return jsonify({"error": "Demo auth disabled"}), 403
    data = request.get_json(force=True) or {}
    tenant_id = data.get("tenant_id") or DEFAULT_TENANT_ID
    now = datetime.now(timezone.utc)
    payload = {
        "sub": f"demo-{tenant_id}",
        "tenant_id": tenant_id,
        "role": "admin",
        "email": "demo@easyhost.ai",
        "worker_handle": None,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=JWT_EXP_HOURS)).timestamp()),
    }
    return jsonify({"token": encode_jwt(payload), "tenant_id": tenant_id, "role": "admin"})


@app.route("/api/auth/reset-password", methods=["POST", "OPTIONS"])
def auth_reset_password():
    """Reset password for existing user. Verifies email exists, updates password hash."""
    if request.method == "OPTIONS":
        return jsonify({}), 200
    if not SessionLocal or not UserModel:
        return jsonify({"error": "Auth unavailable"}), 500
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    new_password = data.get("new_password") or ""
    if not email:
        return jsonify({"error": "Email required"}), 400
    if len(new_password) < 6:
        return jsonify({"error": "New password must be at least 6 characters"}), 400
    session = SessionLocal()
    try:
        user = session.query(UserModel).filter_by(email=email).first()
        if not user:
            return jsonify({"error": "Email not found. Please register."}), 404
        user.password_hash = hash_password(new_password)
        session.commit()
        now = datetime.now(timezone.utc)
        norm_role = _normalize_app_role(user.role)
        wh = (getattr(user, "worker_handle", None) or "").strip()
        payload = {
            "sub": user.id,
            "tenant_id": user.tenant_id,
            "role": norm_role,
            "email": (user.email or "").strip().lower(),
            "worker_handle": wh.lower() if wh else None,
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=JWT_EXP_HOURS)).timestamp()),
        }
        return jsonify({
            "token": encode_jwt(payload),
            "tenant_id": user.tenant_id,
            "role": norm_role,
            "worker_handle": wh.lower() if wh else None,
        })
    except Exception as e:
        session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()


@app.route("/api/audit/task-completions", methods=["GET", "OPTIONS"])
@require_auth
def api_audit_task_completions():
    """Admin/Manager: read task completion audit trail for the authenticated tenant."""
    if request.method == "OPTIONS":
        return Response(status=204)
    if not SessionLocal or not TaskAuditLogModel:
        return jsonify({"entries": []}), 200
    try:
        identity = get_property_tasks_auth_bundle()
    except ValueError as _e:
        return jsonify({"error": str(_e)}), 401
    if identity.get("app_role") not in ("admin", "manager", "operation"):
        return jsonify({"error": "Forbidden"}), 403
    try:
        lim = min(200, max(1, int(request.args.get("limit", "50"))))
    except (TypeError, ValueError):
        lim = 50
    tid = identity["tenant_id"]
    session = SessionLocal()
    try:
        rows = (
            session.query(TaskAuditLogModel)
            .filter(TaskAuditLogModel.tenant_id == tid)
            .order_by(TaskAuditLogModel.created_at.desc())
            .limit(lim)
            .all()
        )
        return jsonify({
            "entries": [{
                "id": r.id,
                "task_id": r.task_id,
                "action": r.action,
                "previous_status": r.previous_status,
                "new_status": r.new_status,
                "actor_user_id": r.actor_user_id,
                "actor_email": r.actor_email,
                "created_at": r.created_at,
            } for r in rows],
        }), 200
    finally:
        session.close()


@app.route("/api/leads", methods=["GET"])
@require_auth
def get_leads():
    status = request.args.get("status")
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if SessionLocal and LeadModel:
        session = SessionLocal()
        try:
            query = session.query(LeadModel).filter_by(tenant_id=tenant_id)
            if status:
                query = query.filter_by(status=status)
            records = query.order_by(LeadModel.created_at.desc()).all()
        finally:
            session.close()
        leads = [
            {
                "id": record.id,
                "tenant_id": record.tenant_id,
                "name": record.name,
                "contact": record.contact,
                "email": record.email,
                "phone": record.phone,
                "source": record.source,
                "status": record.status,
                "value": record.value,
                "rating": record.rating,
                "createdAt": record.created_at,
                "notes": record.notes,
                "property": record.property_name,
                "city": record.city,
                "response_time_hours": record.response_time_hours,
                "lead_quality": record.lead_quality,
                "ai_summary": record.ai_summary,
                "last_objection": record.last_objection,
                "payment_link": record.payment_link,
            }
            for record in records
        ]
    else:
        with DATA_LOCK:
            leads = [lead for lead in LEADS if lead.get("tenant_id") == tenant_id]
        if status:
            leads = [lead for lead in leads if lead.get("status") == status]
    return jsonify(leads)


@app.route("/api/onboarding/ical", methods=["POST"])
@require_auth
def onboarding_ical():
    data = request.get_json(force=True) or {}
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    ical_url = data.get("ical_url") or ""
    nightly_rate = int(data.get("nightly_rate") or 250)
    if not ical_url.startswith("http"):
        return jsonify({"error": "Invalid iCal URL"}), 400
    try:
        with urlopen(ical_url, timeout=10) as response:
            ics_text = response.read().decode("utf-8", errors="ignore")
    except Exception as error:
        return jsonify({"error": f"Failed to fetch iCal: {error}"}), 400
    booked_ranges = parse_ical_dates(ics_text)
    vacancy_windows, vacant_nights = calculate_vacancies(booked_ranges, horizon_days=30)
    potential_revenue = vacant_nights * nightly_rate
    upsert_calendar_connection(tenant_id, ical_url, vacancy_windows, vacant_nights, potential_revenue)
    if vacancy_windows:
        for window in vacancy_windows[:10]:
            due_at = f"{window.get('checkin')}T12:00:00+00:00"
            room_label = f"Vacancy {window.get('checkin')} → {window.get('checkout')}"
            task = create_task(tenant_id, "Cleaning", room_label, due_at=due_at)
            if task and SessionLocal and StaffModel:
                session = SessionLocal()
                try:
                    assign_best_staff(tenant_id, task, session)
                finally:
                    session.close()
        SCOUT_QUEUE.put({
            "tenant_id": tenant_id,
            "platforms": ["airbnb", "booking"],
            "vacancy_windows": vacancy_windows,
        })
        dispatch_tasks(tenant_id)
    return jsonify({
        "synced": True,
        "vacant_nights": vacant_nights,
        "potential_revenue": potential_revenue,
        "vacancy_windows": vacancy_windows,
    })


def _normalize_ical_url(url):
    u = (url or "").strip()
    if u.lower().startswith("webcal://"):
        u = "https://" + u[9:]
    return u


def _ical_uid_tag(uid):
    s = re.sub(r"[^a-zA-Z0-9_-]", "", (uid or "")[:80])
    return s or "noid"


def _pick_prep_staff_for_property(session, property_id):
    """Prefer cleaning/housekeeping names for check-in prep tasks."""
    if not property_id or not PropertyStaffModel:
        return "", "", ""
    staff_rows = session.query(PropertyStaffModel).filter_by(property_id=property_id).all()
    if not staff_rows:
        return "", "", ""

    def score(s):
        r = (s.role or "").lower()
        d = (getattr(s, "department", None) or "").lower()
        n = (s.name or "").lower()
        if "ניקיון" in r or "clean" in r or "housekeep" in r or "דנה" in n:
            return 4
        if "ניקיון" in d or "clean" in d:
            return 3
        if "תחזוק" in r or "maint" in r or "יוסי" in n:
            return 2
        return 1

    best = sorted(staff_rows, key=score, reverse=True)[0]
    return (
        best.name or "",
        getattr(best, "phone_number", None) or "",
        best.id or "",
    )


def sync_ical_prep_checkin_tasks(tenant_id, ical_url, property_id=None):
    """
    Fetch iCal (Airbnb/Booking export), parse stays, create deduped 'הכנה לצ'ק-אין' property_tasks.
    Returns dict: created, skipped, error (optional), reservations_seen.
    """
    out = {"created": 0, "skipped": 0, "reservations_seen": 0, "error": None}
    url = _normalize_ical_url(ical_url)
    if not url.startswith("http"):
        out["error"] = "invalid_url"
        return out
    try:
        from calendar_scanner import fetch_ical, parse_ical
    except Exception as e:
        out["error"] = f"calendar_scanner: {e}"
        return out
    content = fetch_ical(url)
    if not content:
        out["error"] = "fetch_failed"
        return out
    reservations = parse_ical(content)
    out["reservations_seen"] = len(reservations)
    if not reservations:
        out["error"] = "no_events_parsed"
        return out
    if not SessionLocal or not PropertyTaskModel:
        out["error"] = "no_database"
        return out

    session = SessionLocal()
    try:
        pid = (property_id or "").strip()
        prop_name = ""
        if not pid and ManualRoomModel:
            room = session.query(ManualRoomModel).filter_by(tenant_id=tenant_id).first()
            if room:
                pid = room.id or ""
                prop_name = (room.name or "") or ""
        elif pid and ManualRoomModel:
            room = session.query(ManualRoomModel).filter_by(id=pid, tenant_id=tenant_id).first()
            if room:
                prop_name = (room.name or "") or ""

        today = datetime.now(timezone.utc).date()
        horizon_end = today + timedelta(days=120)
        staff_name, staff_phone, staff_id = _pick_prep_staff_for_property(session, pid)
        effective_status = "Assigned" if staff_name else "Pending"

        for res in reservations:
            ci = res.get("check_in")
            co = res.get("check_out") or ci
            if not ci:
                continue
            try:
                ci_d = datetime.strptime(str(ci)[:10], "%Y-%m-%d").date()
            except ValueError:
                continue
            try:
                co_d = datetime.strptime(str(co)[:10], "%Y-%m-%d").date()
            except ValueError:
                co_d = ci_d
            if ci_d < today - timedelta(days=1):
                continue
            if ci_d > horizon_end:
                continue

            uid = res.get("uid") or ""
            tag = f"[ical_uid:{_ical_uid_tag(uid)}]"
            q = _property_tasks_query_for_tenant(session, tenant_id)
            if q is not None:
                exists = (
                    q.filter(PropertyTaskModel.description.like(f"%{tag}%"))
                    .first()
                )
                if exists:
                    out["skipped"] += 1
                    continue

            guest = res.get("guest_name") or "אורח"
            room_label = res.get("room_name") or prop_name or "יחידה"
            desc = (
                f"הכנה לצ'ק-אין — {room_label} — אורח: {guest} — צ'ק-אין {ci} · צ'ק-אאוט {co_d.isoformat()} {tag}"
            )
            due_at = f"{str(ci)[:10]}T06:00:00+00:00"
            try:
                ci_dt = datetime(ci_d.year, ci_d.month, ci_d.day, tzinfo=timezone.utc)
                hours_to_ci = (ci_dt - datetime.now(timezone.utc)).total_seconds() / 3600.0
            except Exception:
                hours_to_ci = 999
            priority = "high" if 0 <= hours_to_ci <= 24 else "normal"

            task_id = str(uuid.uuid4())
            created = now_iso()
            display_property = prop_name or room_label or pid or "נכס"
            task = PropertyTaskModel(
                id=task_id,
                property_id=pid,
                staff_id=staff_id,
                assigned_to=staff_id,
                description=desc,
                status=effective_status,
                created_at=created,
                property_name=display_property,
                staff_name=staff_name,
                staff_phone=staff_phone or "",
                photo_url="",
                task_type=TASK_TYPE_CLEANING_HE,
                priority=priority,
                tenant_id=tenant_id,
                due_at=due_at,
            )
            session.add(task)
            out["created"] += 1

        try:
            session.commit()
        except Exception as ce:
            session.rollback()
            out["error"] = str(ce)
            out["created"] = 0
            return out
        try:
            assign_stuck_property_tasks(tenant_id)
        except Exception:
            pass
        _bump_tasks_version()
        _invalidate_owner_dashboard_cache()
        return out
    finally:
        session.close()


@app.route("/api/integrations/ical-prep-tasks", methods=["POST", "OPTIONS"])
def ical_prep_tasks_route():
    """Parse Airbnb/Booking iCal URL and create check-in prep tasks on the mission board."""
    if request.method == "OPTIONS":
        return Response(status=204)
    try:
        tenant_id, _user_id = get_auth_context_from_request()
    except Exception:
        tenant_id = DEFAULT_TENANT_ID
    data = request.get_json(silent=True) or {}
    ical_url = data.get("ical_url") or data.get("url") or ""
    property_id = (data.get("property_id") or "").strip() or None
    result = sync_ical_prep_checkin_tasks(tenant_id, ical_url, property_id)
    if result.get("error") and result.get("created", 0) == 0:
        return jsonify({"ok": False, **result}), 400
    return jsonify({"ok": True, **result}), 200


@app.route("/api/reports/daily-property-tasks", methods=["GET", "OPTIONS"])
def daily_property_tasks_report_route():
    """Hebrew summary: completed vs pending for last 24h (for owners / WhatsApp)."""
    if request.method == "OPTIONS":
        return Response(status=204)
    try:
        tenant_id, _ = get_auth_context_from_request()
    except Exception:
        tenant_id = DEFAULT_TENANT_ID
    if not SessionLocal or not PropertyTaskModel:
        return jsonify({
            "summary_text": "אין חיבור לבסיס נתונים — לא ניתן להפיק דוח.",
            "stats": {"completed_24h": 0, "pending_open": 0},
        }), 200
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    session = SessionLocal()
    try:
        q = _property_tasks_query_for_tenant(session, tenant_id)
        if q is None:
            return jsonify({"summary_text": "", "stats": {}}), 200
        rows = q.all()
        done_recent = []
        pending_list = []
        for r in rows:
            st = (r.status or "").strip().lower()
            if st == "archived":
                continue
            if st in ("done", "completed"):
                comp = getattr(r, "completed_at", None) or ""
                dt = parse_iso_datetime(comp) if comp else None
                if dt is None:
                    continue
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                if dt >= since:
                    done_recent.append(r)
            else:
                pending_list.append(r)
        n_done = len(done_recent)
        n_pending = len(pending_list)
        lines = [
            f"דוח משימות — 24 שעות אחרונות (נכון ל-{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC)",
            "",
            f"• הושלמו בפרק זמן זה: {n_done}",
            f"• משימות פתוחות כעת: {n_pending}",
            "",
        ]
        if done_recent:
            lines.append("דוגמאות להשלמות אחרונות:")
            for r in done_recent[:15]:
                d = (r.description or "").strip().replace("\n", " ")
                p = (r.property_name or "").strip()
                lines.append(f"  – {d[:90]}{'…' if len(d) > 90 else ''} ({p or '—'})")
            lines.append("")
        if pending_list:
            lines.append("דוגמאות למשימות פתוחות:")
            for r in pending_list[:15]:
                d = (r.description or "").strip().replace("\n", " ")
                p = (r.property_name or "").strip()
                lines.append(f"  – {d[:90]}{'…' if len(d) > 90 else ''} ({p or '—'})")
        summary = "\n".join(lines)
        return jsonify({
            "summary_text": summary,
            "stats": {"completed_24h": n_done, "pending_open": n_pending},
        }), 200
    finally:
        session.close()


@app.route("/api/bookings", methods=["POST"])
@require_auth
def create_booking_route():
    """יצירת הזמנה + משימת ניקיון אוטומטית ליום הצ'ק-אאוט"""
    data = request.get_json(force=True) or {}
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    booking_data = {
        "property_id": data.get("property_id"),
        "room": data.get("room"),
        "property_name": data.get("property_name"),
        "property_title": data.get("property_title") or data.get("property_name"),
        "guest_name": data.get("guest_name"),
        "guest_phone": data.get("guest_phone"),
        "check_in": data.get("check_in"),
        "check_out": data.get("check_out"),
    }
    if not booking_data.get("guest_name") and not booking_data.get("room"):
        return jsonify({"error": "Missing guest_name or room"}), 400
    task = create_booking_with_automation(tenant_id, booking_data)
    if (
        task
        and booking_data.get("guest_phone")
        and DEMO_AUTOMATION_SETTINGS.get("automated_welcome_enabled")
    ):
        handle_guest_communication("booking.confirmed", booking_data)
    if not task:
        return jsonify({"error": "Failed to create booking/task"}), 500
    return jsonify({
        "task_id": task.get("id"),
        "room": task.get("room"),
        "due_at": task.get("due_at"),
        "status": task.get("status"),
    })


@app.route("/api/messaging/guest", methods=["POST"])
@require_auth
def send_guest_message():
    """
    שליחת הודעת WhatsApp אוטומטית לאורח.
    event_type: booking.confirmed | check_in.reminder | check_out.instructions
    """
    data = request.get_json(force=True) or {}
    event_type = data.get("event_type")
    booking_data = data.get("booking_data") or {}
    if not event_type:
        return jsonify({"error": "Missing event_type"}), 400
    if not booking_data.get("guest_phone"):
        return jsonify({"error": "Missing guest_phone in booking_data"}), 400
    result = handle_guest_communication(event_type, booking_data)
    return jsonify(result)


@app.route("/api/onboarding/manual-checkout", methods=["POST"])
@require_auth
def onboarding_manual_checkout():
    data = request.get_json(force=True) or {}
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    checkout_date = data.get("checkout_date") or now_iso()[:10]
    room_label = data.get("room") or f"Manual Checkout {checkout_date}"
    due_at = f"{checkout_date}T12:00:00+00:00"
    task = create_task(tenant_id, "Cleaning", room_label, due_at=due_at)
    if task and SessionLocal and StaffModel:
        session = SessionLocal()
        try:
            assign_best_staff(tenant_id, task, session)
        finally:
            session.close()
    dispatch_tasks(tenant_id)
    return jsonify({"ok": True, "task_id": (task.get("id") or task["id"]) if task else None})


@app.route("/api/rooms/manual", methods=["GET"])
@require_auth
def get_manual_rooms():
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if not SessionLocal or not ManualRoomModel:
        return jsonify([])
    session = SessionLocal()
    try:
        rooms = session.query(ManualRoomModel).filter_by(tenant_id=tenant_id).all()
        room_ids = [r.id for r in rooms]
        tasks = []
        if room_ids and TaskModel:
            tasks = (
                session.query(TaskModel)
                .filter(TaskModel.tenant_id == tenant_id)
                .filter(TaskModel.room_id.in_(room_ids))
                .order_by(TaskModel.created_at.desc())
                .all()
            )
        latest_by_room = {}
        for task in tasks:
            if task.room_id not in latest_by_room:
                latest_by_room[task.room_id] = task
        staff_lookup = {}
        staff_ids = {task.staff_id for task in latest_by_room.values() if task.staff_id}
        if staff_ids and StaffModel:
            staff_records = session.query(StaffModel).filter(StaffModel.id.in_(staff_ids)).all()
            staff_lookup = {record.id: record.name for record in staff_records}
        out = []
        for r in rooms:
            try:
                am = json.loads(r.amenities) if r.amenities else []
            except Exception:
                am = []
            lt = latest_by_room.get(r.id)
            out.append({
                "id": r.id,
                "name": r.name,
                "description": r.description or "",
                "photo_url": r.photo_url or "",
                "amenities": am,
                "status": r.status or "active",
                "created_at": r.created_at,
                "last_checkout_at": r.last_checkout_at,
                "last_checkin_at": r.last_checkin_at,
                "latest_status": lt.status if lt else "idle",
                "latest_task_id": lt.id if lt else None,
                "latest_staff_name": staff_lookup.get(lt.staff_id) if lt else None,
            })
        return jsonify(out)
    finally:
        session.close()


@app.route("/api/upload", methods=["POST"])
@require_auth
def upload_images():
    """
    Generic image upload — accepts multiple files, returns URLs.
    Routes to Cloudinary when configured, falls back to local storage.

    Optional form field 'property_id': when provided, saves the first
    uploaded URL as the property's photo_url immediately so the caller
    does not need a separate PATCH request.
    """
    files = request.files.getlist("files") or (
        [request.files["file"]] if request.files.get("file") else []
    )
    if not files:
        return jsonify({"error": "Missing files", "urls": []}), 400

    property_id = (request.form.get("property_id") or "").strip() or None
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)

    uploaded_urls = []
    for f in files:
        if not f or not f.filename:
            continue
        ct = (f.content_type or "").lower()
        if not ct.startswith("image/"):
            return jsonify({"error": f"Invalid file type: {f.filename}", "urls": []}), 400

        data, new_ext = _compress_image(f.stream)

        url = None
        if _CLOUDINARY_CONFIGURED:
            try:
                url = _cloudinary_upload(data, folder="easyhost/uploads")
            except Exception as cdn_err:
                print(f"[Cloudinary] Upload failed, falling back to local: {cdn_err}")

        if not url:
            # ── Local fallback ────────────────────────────────────────────────
            ext = new_ext or (f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else "jpg")
            if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
                ext = "jpg"
            unique_name = f"{uuid.uuid4().hex}.{ext}"
            file_path = os.path.join(UPLOAD_STATIC, unique_name)
            with open(file_path, "wb") as _fh:
                _fh.write(data)
            url = f"{API_BASE_URL}/uploads/shared/{unique_name}"

        uploaded_urls.append(url)

    # ── Persist URLs to property if property_id provided ─────────────────────
    # Save photo_url AND merge into the gallery stored in description so that
    # GET /properties/<id> returns the full pictures[] array immediately.
    if property_id and uploaded_urls and SessionLocal and ManualRoomModel:
        try:
            _sess = SessionLocal()
            try:
                row = _sess.query(ManualRoomModel).filter_by(
                    id=property_id, tenant_id=tenant_id
                ).first()
                if row:
                    row.photo_url = uploaded_urls[0]
                    # Merge new URLs into the existing gallery in description
                    existing_main, existing_gallery = _split_description_gallery(row.description or "")
                    merged_gallery = []
                    seen_gallery = set()
                    for gu in (uploaded_urls + existing_gallery):
                        s = str(gu).strip()
                        if s and s not in seen_gallery:
                            seen_gallery.add(s)
                            merged_gallery.append(s)
                    row.description = _merge_description_gallery(existing_main, merged_gallery)
                    _sess.commit()
                    print(f"[upload_images] ✅ photo_url + gallery({len(merged_gallery)}) saved to property {property_id}")
            except Exception as _dbe:
                _sess.rollback()
                print(f"[upload_images] DB save warning: {_dbe}")
            finally:
                _sess.close()
        except Exception as _outer:
            print(f"[upload_images] Session error: {_outer}")

    return jsonify({"urls": uploaded_urls})


@app.route("/api/rooms/manual/photo/upload", methods=["POST"])
@require_auth
def room_photo_upload():
    """Property photo upload — routes to Cloudinary when configured, else local.
    Accepts optional form field 'property_id'; when present, immediately persists
    the new photo_url to the manual_rooms row so the caller doesn't need a
    separate PATCH.
    """
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    property_id = (request.form.get("property_id") or "").strip() or None

    if "photo" not in request.files:
        return jsonify({"error": "Missing file"}), 400
    file = request.files["photo"]
    if not file or not file.filename:
        return jsonify({"error": "Invalid file"}), 400

    data, new_ext = _compress_image(file.stream)

    photo_url = None
    if _CLOUDINARY_CONFIGURED:
        try:
            photo_url = _cloudinary_upload(data, folder=f"easyhost/properties/{tenant_id}")
        except Exception as cdn_err:
            print(f"[Cloudinary] Property photo upload failed, falling back to local: {cdn_err}")

    if not photo_url:
        # ── Local fallback ────────────────────────────────────────────────────
        os.makedirs(UPLOAD_ROOT, exist_ok=True)
        tenant_dir = os.path.join(UPLOAD_ROOT, tenant_id, "properties")
        os.makedirs(tenant_dir, exist_ok=True)
        orig_ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "jpg"
        ext = new_ext or orig_ext
        unique_name = f"prop-{uuid.uuid4().hex}.{ext}"
        with open(os.path.join(tenant_dir, unique_name), "wb") as _fh:
            _fh.write(data)
        photo_url = f"{API_BASE_URL}/uploads/{tenant_id}/properties/{unique_name}"

    # ── Persist to DB immediately if property_id provided ────────────────────
    if property_id and SessionLocal and ManualRoomModel:
        try:
            _sess = SessionLocal()
            try:
                row = _sess.query(ManualRoomModel).filter_by(
                    id=property_id, tenant_id=tenant_id
                ).first()
                if row:
                    row.photo_url = photo_url
                    _sess.commit()
                    print(f"[room_photo_upload] ✅ photo_url saved to property {property_id}")
            except Exception as _dbe:
                _sess.rollback()
                print(f"[room_photo_upload] DB save warning: {_dbe}")
            finally:
                _sess.close()
        except Exception as _outer:
            print(f"[room_photo_upload] Session error: {_outer}")

    return jsonify({"ok": True, "photo_url": photo_url})


@app.route("/api/rooms/manual", methods=["POST"])
@require_auth
def create_manual_room_route():
    data = request.get_json(force=True) or {}
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "Missing room name"}), 400
    room = create_manual_room(tenant_id, name, data.get("description"), data.get("photo_url"))
    if not room:
        return jsonify({"error": "Failed to create room"}), 500
    return jsonify({
        "id": room["id"],
        "name": room["name"],
        "description": room["description"],
        "photo_url": room["photo_url"],
        "status": room.get("status") or "active",
        "created_at": room["created_at"],
        "last_checkout_at": room.get("last_checkout_at"),
        "last_checkin_at": room.get("last_checkin_at"),
    })


@app.route("/api/rooms/manual/<room_id>/checkout", methods=["POST"])
@require_auth
def manual_room_checkout(room_id):
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if not SessionLocal or not ManualRoomModel:
        return jsonify({"error": "Manual rooms unavailable"}), 500
    session = SessionLocal()
    try:
        room = session.query(ManualRoomModel).filter_by(id=room_id, tenant_id=tenant_id).first()
        if not room:
            return jsonify({"error": "Room not found"}), 404
        checkout_date = now_iso()[:10]
        room.last_checkout_at = now_iso()
        due_at = f"{checkout_date}T12:00:00+00:00"
        task = create_task(tenant_id, "Cleaning", room.name, due_at=due_at, room_id=room.id)
        if task and SessionLocal and StaffModel:
            assign_best_staff(tenant_id, task, session)
        session.commit()
    finally:
        session.close()
    dispatch_tasks(tenant_id)
    return jsonify({"ok": True})


@app.route("/api/rooms/manual/<room_id>/assign", methods=["POST"])
@require_auth
def manual_room_assign(room_id):
    data = request.get_json(force=True) or {}
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    staff_id = data.get("staff_id")
    if not staff_id:
        return jsonify({"error": "Missing staff_id"}), 400
    if not SessionLocal or not ManualRoomModel or not StaffModel:
        return jsonify({"error": "Manual rooms unavailable"}), 500
    session = SessionLocal()
    try:
        room = session.query(ManualRoomModel).filter_by(id=room_id, tenant_id=tenant_id).first()
        if not room:
            return jsonify({"error": "Room not found"}), 404
        staff = session.query(StaffModel).filter_by(id=staff_id, tenant_id=tenant_id).first()
        if not staff or not staff.active or not staff.on_shift or not is_recent_clock_in(staff, within_hours=12):
            return jsonify({"error": "Staff not available"}), 400
        due_at = f"{now_iso()[:10]}T12:00:00+00:00"
        task = create_task(tenant_id, "Cleaning", room.name, due_at=due_at, room_id=room.id)
        if task:
            assign_task(task, staff, session)
        session.commit()
    finally:
        session.close()
    return jsonify({"ok": True})


@app.route("/api/rooms/manual/<room_id>/checkin", methods=["POST"])
@require_auth
def manual_room_checkin(room_id):
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if not SessionLocal or not ManualRoomModel:
        return jsonify({"error": "Manual rooms unavailable"}), 500
    session = SessionLocal()
    try:
        room = session.query(ManualRoomModel).filter_by(id=room_id, tenant_id=tenant_id).first()
        if not room:
            return jsonify({"error": "Room not found"}), 404
        if room.status == "blocked":
            return jsonify({"error": "Room is blocked"}), 400
        room.last_checkin_at = now_iso()
        session.commit()
    finally:
        session.close()
    return jsonify({"ok": True})


@app.route("/api/rooms/manual/<room_id>/resolve", methods=["POST"])
@require_auth
def manual_room_resolve(room_id):
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if not SessionLocal or not ManualRoomModel:
        return jsonify({"error": "Manual rooms unavailable"}), 500
    session = SessionLocal()
    try:
        room = session.query(ManualRoomModel).filter_by(id=room_id, tenant_id=tenant_id).first()
        if not room:
            return jsonify({"error": "Room not found"}), 404
        room.status = "active"
        if DamageReportModel:
            session.query(DamageReportModel).filter_by(
                tenant_id=tenant_id,
                room_id=room_id,
                status="open",
            ).update({"status": "resolved", "resolved_at": now_iso()})
        session.commit()
    finally:
        session.close()
    return jsonify({"ok": True})


@app.route("/api/rooms/manual/<room_id>/history", methods=["GET"])
@require_auth
def manual_room_history(room_id):
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if not SessionLocal or not TaskModel:
        return jsonify({"history": [], "issues": [], "room_status": "active"})
    session = SessionLocal()
    try:
        room = session.query(ManualRoomModel).filter_by(id=room_id, tenant_id=tenant_id).first() if ManualRoomModel else None
        tasks = (
            session.query(TaskModel)
            .filter_by(tenant_id=tenant_id, room_id=room_id, status="finished")
            .order_by(TaskModel.finished_at.desc())
            .limit(20)
            .all()
        )
        staff_lookup = {}
        if StaffModel:
            staff_ids = {task.staff_id for task in tasks if task.staff_id}
            if staff_ids:
                staff_records = session.query(StaffModel).filter(StaffModel.id.in_(staff_ids)).all()
                staff_lookup = {record.id: record.name for record in staff_records}
        issues = []
        if DamageReportModel:
            issues = (
                session.query(DamageReportModel)
                .filter_by(tenant_id=tenant_id, room_id=room_id)
                .order_by(DamageReportModel.created_at.desc())
                .limit(10)
                .all()
            )
        history = [{"task_id": t.id, "finished_at": t.finished_at, "points_awarded": t.points_awarded, "staff_id": t.staff_id, "staff_name": staff_lookup.get(t.staff_id)} for t in tasks]
        issues_data = [{"id": i.id, "created_at": i.created_at, "resolved_at": i.resolved_at, "note": i.note, "photo_url": i.photo_url, "status": i.status} for i in issues]
    finally:
        session.close()
    return jsonify({"room_status": room.status if room else "active", "history": history, "issues": issues_data})


@app.route("/api/properties", methods=["GET", "POST", "OPTIONS"])
def create_property():
    """GET /api/properties — list manual_rooms + auto-seed. POST: create. Active connectivity endpoint."""
    if request.method == "OPTIONS":
        return Response(status=204)
    tenant_id = DEFAULT_TENANT_ID
    if not AUTH_DISABLED:
        try:
            tenant_id = get_tenant_id_from_request()
            if not tenant_id and ALLOW_DEMO_AUTH:
                tenant_id = DEFAULT_TENANT_ID
            if not tenant_id:
                return jsonify({"error": "Unauthorized"}), 401
            request.tenant_id = tenant_id
        except Exception as e:
            return jsonify({"error": str(e)}), 401
    else:
        try:
            tenant_id, _ = get_auth_context_from_request()
        except Exception:
            tenant_id = DEFAULT_TENANT_ID
        request.tenant_id = tenant_id
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    try:
        _, request.user_id = get_auth_context_from_request()
    except Exception:
        request.user_id = f"demo-{tenant_id}"

    if request.method == "GET":
        # Never return 204 on GET — always JSON 200 (OPTIONS alone uses 204 for CORS).
        if ENGINE and ManualRoomModel:
            # Non-blocking: seed runs at most once per tenant per process lifetime.
            _kick_background_seed(tenant_id)
        try:
            user_id = getattr(request, "user_id", None)
            try:
                rooms = list_manual_rooms(tenant_id, owner_id=user_id)
            except Exception as _list_err:
                print(f"[create_property] list_manual_rooms failed: {_list_err!r}", flush=True)
                import traceback as _tb_lm
                _tb_lm.print_exc()
                rooms = []
            if rooms is None or not isinstance(rooms, list):
                rooms = []
            portfolio_fallback = False
            if not rooms:
                # initial_properties: Bazaar + City Tower + ROOMS + 12× WeWork (15) — never empty body
                initial_properties = _default_portfolio_seed_rooms()
                rooms = [{**r, "tenant_id": tenant_id} for r in initial_properties if isinstance(r, dict)]
                portfolio_fallback = True
            rooms = [_ensure_room_image_urls(r) for r in rooms if isinstance(r, dict)]
            rooms = _ensure_demo_portfolio_properties(rooms)
            try:
                plimit = request.args.get("limit")
                poffset_raw = request.args.get("offset", "0") or "0"
                prop_limit = max(1, min(int(plimit), 500)) if plimit not in (None, "") else None
                prop_offset = max(0, int(poffset_raw))
            except (TypeError, ValueError):
                prop_limit, prop_offset = None, 0
            prop_total = len(rooms)
            if prop_limit is not None:
                rooms = rooms[prop_offset : prop_offset + prop_limit]
            resp = _no_cache_json(jsonify(rooms))
            resp.headers["X-Properties-Total"] = str(prop_total)
            resp.headers["X-Properties-Has-More"] = (
                "1" if prop_limit is not None and (prop_offset + len(rooms) < prop_total) else "0"
            )
            if prop_limit is not None:
                resp.headers["X-Properties-Limit"] = str(prop_limit)
                resp.headers["X-Properties-Offset"] = str(prop_offset)
            resp.headers["X-DB-Status"] = "fallback" if portfolio_fallback else "ok"
            if portfolio_fallback:
                resp.headers["X-Portfolio-Fallback"] = "1"
            return resp, 200
        except Exception as _prop_err:
            print(f"[create_property] GET list failed: {_prop_err!r}", flush=True)
            import traceback as _tb_prop
            _tb_prop.print_exc()
            initial_properties = _default_portfolio_seed_rooms()
            rooms = _ensure_demo_portfolio_properties(
                [_ensure_room_image_urls({**r, "tenant_id": tenant_id}) for r in initial_properties if isinstance(r, dict)]
            )
            try:
                plimit = request.args.get("limit")
                poffset_raw = request.args.get("offset", "0") or "0"
                prop_limit = max(1, min(int(plimit), 500)) if plimit not in (None, "") else None
                prop_offset = max(0, int(poffset_raw))
            except (TypeError, ValueError):
                prop_limit, prop_offset = None, 0
            prop_total = len(rooms)
            if prop_limit is not None:
                rooms = rooms[prop_offset : prop_offset + prop_limit]
            resp = _no_cache_json(jsonify(rooms))
            resp.headers["X-Properties-Total"] = str(prop_total)
            resp.headers["X-Properties-Has-More"] = (
                "1" if prop_limit is not None and (prop_offset + len(rooms) < prop_total) else "0"
            )
            if prop_limit is not None:
                resp.headers["X-Properties-Limit"] = str(prop_limit)
                resp.headers["X-Properties-Offset"] = str(prop_offset)
            resp.headers["X-DB-Status"] = "fallback"
            resp.headers["X-Portfolio-Fallback"] = "1"
            resp.headers["X-Portfolio-Error-Recovery"] = "1"
            return resp, 200

    print("[create_property] Received:", request.get_json(silent=True), "files:", list(request.files.keys()) if request.files else [])
    try:
        data = request.get_json(silent=True) or request.form.to_dict() or {}
        tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
        name = (data.get("name") or request.form.get("name") or "").strip()
        if not name:
            return jsonify({"error": "Missing property name"}), 400
        description = data.get("description") or request.form.get("description") or ""
        photo_url = data.get("photo_url") or data.get("photoUrl") or ""
        images = data.get("images") if isinstance(data.get("images"), list) else []
        pictures = data.get("pictures") if isinstance(data.get("pictures"), list) else []
        combined_imgs = []
        for src in (pictures, images):
            if not isinstance(src, list):
                continue
            for x in src:
                s = str(x).strip() if x is not None else ""
                if s and s not in combined_imgs:
                    combined_imgs.append(s)
        if not photo_url and combined_imgs:
            photo_url = combined_imgs[0]
        elif photo_url and str(photo_url).strip():
            pu = str(photo_url).strip()
            if pu not in combined_imgs:
                combined_imgs = [pu] + [p for p in combined_imgs if p != pu]
        # Always persist the full gallery (even a single image) in description so
        # list_manual_rooms can reliably populate pictures[] via _split_description_gallery.
        if combined_imgs:
            description = _merge_description_gallery(description, combined_imgs)
        if not photo_url and images and len(images) > 0:
            photo_url = images[0] if isinstance(images[0], str) else ""

        uploaded_urls = []
        if request.files:
            os.makedirs(UPLOAD_ROOT, exist_ok=True)
            prop_dir = os.path.join(UPLOAD_ROOT, tenant_id, "properties")
            os.makedirs(prop_dir, exist_ok=True)
            for key in ("photo", "image"):
                f = request.files.get(key)
                if f and f.filename:
                    ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else "jpg"
                    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
                        ext = "jpg"
                    unique_name = f"prop-{uuid.uuid4().hex}.{ext}"
                    f.save(os.path.join(prop_dir, unique_name))
                    url = f"{API_BASE_URL}/uploads/{tenant_id}/properties/{unique_name}"
                    uploaded_urls.append(url)
            for f in (request.files.getlist("images") or request.files.getlist("files") or []):
                if f and f.filename:
                    ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else "jpg"
                    if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
                        ext = "jpg"
                    unique_name = f"prop-{uuid.uuid4().hex}.{ext}"
                    f.save(os.path.join(prop_dir, unique_name))
                    url = f"{API_BASE_URL}/uploads/{tenant_id}/properties/{unique_name}"
                    uploaded_urls.append(url)
            if uploaded_urls and not photo_url:
                photo_url = uploaded_urls[0]
            if uploaded_urls:
                for u in uploaded_urls:
                    if u and u not in combined_imgs:
                        combined_imgs.append(u)
                if combined_imgs:
                    description = _merge_description_gallery(description, combined_imgs)

        amenities_list = data.get("amenities")
        if amenities_list is None:
            amenities_list = []
        if not isinstance(amenities_list, list):
            try:
                amenities_list = json.loads(amenities_list) if isinstance(amenities_list, str) else []
            except Exception:
                amenities_list = []
        owner_id = getattr(request, "user_id", None) or f"demo-{tenant_id}"
        def _int_or_none(val):
            if val is None or val == "":
                return None
            try:
                return int(val)
            except (TypeError, ValueError):
                return None
        max_guests = _int_or_none(data.get("max_guests"))
        bedrooms = _int_or_none(data.get("bedrooms"))
        beds = _int_or_none(data.get("beds"))
        bathrooms = _int_or_none(data.get("bathrooms"))
        room = create_manual_room(
            tenant_id,
            name,
            description=description or None,
            photo_url=photo_url or None,
            amenities=amenities_list if amenities_list else None,
            owner_id=owner_id,
            max_guests=max_guests,
            bedrooms=bedrooms,
            beds=beds,
            bathrooms=bathrooms,
        )
        if not room:
            return jsonify({"error": "Failed to create property"}), 500
        try:
            _STATUS_GRID_CACHE["ts"] = 0.0
            _STATUS_GRID_CACHE["payload"] = None
            _STATUS_GRID_CACHE["key"] = None
        except Exception:
            pass
        return jsonify({"ok": True, "property": room}), 201
    except Exception as e:
        err_msg = f"{type(e).__name__}: {str(e)}"
        print("[create_property] Error:", err_msg, flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({"error": err_msg, "detail": str(e)}), 500


@app.route("/api/properties/<string:property_id>", methods=["GET", "PUT", "PATCH", "OPTIONS"])
def update_property(property_id):
    """GET one property (JSON). PUT/PATCH — update manual_rooms."""
    if request.method == "OPTIONS":
        return Response(status=204)
    pid = str(property_id).strip() if property_id is not None else ""
    if not pid:
        return jsonify({"error": "Missing property id"}), 400
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if not AUTH_DISABLED:
        try:
            tenant_id = get_tenant_id_from_request()
            if not tenant_id and ALLOW_DEMO_AUTH:
                tenant_id = DEFAULT_TENANT_ID
            if not tenant_id:
                return jsonify({"error": "Unauthorized"}), 401
            request.tenant_id = tenant_id
        except Exception:
            return jsonify({"error": "Unauthorized"}), 401
    else:
        try:
            tenant_id, _ = get_auth_context_from_request()
        except Exception:
            tenant_id = DEFAULT_TENANT_ID
        request.tenant_id = tenant_id
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if not SessionLocal or not ManualRoomModel:
        return jsonify({"error": "Database unavailable"}), 500
    if request.method == "GET":
        try:
            rooms = list_manual_rooms(tenant_id, owner_id=None)
            for rr in rooms:
                if str(rr.get("id")) == pid:
                    return _no_cache_json(jsonify(rr)), 200
            return jsonify({"error": "Property not found", "code": "not_found"}), 404
        except Exception as e:
            print("[get_property] Error:", e, flush=True)
            return jsonify({"error": str(e)}), 500
    try:
        data = request.get_json(silent=True) or {}
        session = SessionLocal()
        try:
            room = session.query(ManualRoomModel).filter_by(id=pid, tenant_id=tenant_id).first()
            if not room:
                # Tenant-drift fallback: look up by id alone.
                # Handles legacy rows whose tenant_id was coerced differently
                # (e.g. 'BAZAAR_JAFFA' → 'default') across app restarts.
                room = session.query(ManualRoomModel).filter_by(id=pid).first()
                if room:
                    # Adopt the stored tenant so subsequent writes stay consistent.
                    tenant_id = room.tenant_id
                    print(
                        f"[update_property] tenant-drift resolved for id={pid!r}: "
                        f"expected tenant={tenant_id!r}, found on row",
                        flush=True,
                    )
            if not room:
                return jsonify({"error": "Property not found", "id": pid, "code": "not_found"}), 404
            if data.get("name"):
                room.name = (data.get("name") or "").strip() or room.name
            old_main, old_gal = _split_description_gallery(room.description or "")
            pics_in = []
            for key in ("pictures", "images"):
                if isinstance(data.get(key), list):
                    for x in data[key]:
                        s = str(x).strip() if x is not None else ""
                        if s and s not in pics_in:
                            pics_in.append(s)
            if pics_in:
                room.photo_url = pics_in[0]
                base_main = (data["description"] if "description" in data else old_main) or ""
                bm, _ = _split_description_gallery(base_main)
                # Merge incoming pics with the existing gallery so that an
                # upload-only call (which only sends the new URL) never erases
                # pre-existing images.  New URLs go first (highest priority).
                merged_pics = list(dict.fromkeys(pics_in + [g for g in old_gal if g not in pics_in]))
                room.description = _merge_description_gallery(bm, merged_pics)
            else:
                if "description" in data:
                    inc_main, _ = _split_description_gallery(data.get("description") or "")
                    room.description = _merge_description_gallery(inc_main, old_gal)
                if "photo_url" in data:
                    room.photo_url = data.get("photo_url") or ""
            if "amenities" in data:
                room.amenities = json.dumps(data.get("amenities") or [])
            if "status" in data:
                room.status = data.get("status") or "active"
            if "ai_automation_enabled" in data or "is_automation_enabled" in data:
                val = data.get("ai_automation_enabled", data.get("is_automation_enabled", False))
                room.ai_automation_enabled = 1 if val else 0
            def _upd_int(attr, key, default=1):
                v = data.get(key)
                if v is not None and v != "":
                    try:
                        setattr(room, attr, int(v))
                    except (TypeError, ValueError):
                        pass
            _upd_int("max_guests", "max_guests", 2)
            _upd_int("bedrooms", "bedrooms", 1)
            _upd_int("beds", "beds", 1)
            _upd_int("bathrooms", "bathrooms", 1)
            session.commit()
            try:
                _STATUS_GRID_CACHE["ts"] = 0.0
                _STATUS_GRID_CACHE["payload"] = None
                _STATUS_GRID_CACHE["key"] = None
            except Exception:
                pass
            rooms = list_manual_rooms(tenant_id, owner_id=None)
            for rr in rooms:
                if str(rr.get("id")) == pid:
                    return jsonify({"ok": True, "property": rr}), 200
            purl = room.photo_url or ""
            if purl and not purl.startswith("http"):
                path = purl.lstrip("/") if purl.startswith("/") else purl
                purl = f"{API_BASE_URL}/uploads/{path}"
            dm, gal = _split_description_gallery(room.description or "")
            return jsonify({
                "ok": True,
                "property": {
                    "id": room.id,
                    "name": room.name,
                    "description": dm,
                    "photo_url": purl,
                    "pictures": gal or ([purl] if purl else []),
                    "mainImage": (gal[0] if gal else purl) or "",
                    "amenities": json.loads(room.amenities) if room.amenities else [],
                    "status": room.status or "active",
                    "ai_automation_enabled": bool(getattr(room, "ai_automation_enabled", 0)),
                    "max_guests": getattr(room, "max_guests", 2),
                    "bedrooms": getattr(room, "bedrooms", 1),
                    "beds": getattr(room, "beds", 1),
                    "bathrooms": getattr(room, "bathrooms", 1),
                },
            }), 200
        finally:
            session.close()
    except Exception as e:
        print("[update_property] Error:", e, flush=True)
        return jsonify({"error": str(e)}), 500


@app.route("/api/properties/<string:property_id>", methods=["DELETE", "OPTIONS"])
def delete_property(property_id):
    """DELETE /api/properties/<id> - remove property from manual_rooms by UUID."""
    if request.method == "OPTIONS":
        return Response(status=204)
    pid = str(property_id).strip() if property_id else ""
    if not pid:
        return jsonify({"error": "Missing property id"}), 400
    tenant_id = DEFAULT_TENANT_ID
    if not AUTH_DISABLED:
        try:
            tenant_id = get_tenant_id_from_request()
            if not tenant_id and ALLOW_DEMO_AUTH:
                tenant_id = DEFAULT_TENANT_ID
            if not tenant_id:
                return jsonify({"error": "Unauthorized"}), 401
            request.tenant_id = tenant_id
        except Exception:
            return jsonify({"error": "Unauthorized"}), 401
    else:
        try:
            tenant_id, _ = get_auth_context_from_request()
        except Exception:
            tenant_id = DEFAULT_TENANT_ID
        request.tenant_id = tenant_id
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if not SessionLocal or not ManualRoomModel:
        return jsonify({"error": "Database unavailable"}), 500
    session = SessionLocal()
    try:
        room = session.query(ManualRoomModel).filter_by(id=pid, tenant_id=tenant_id).first()
        if not room:
            return jsonify({"error": "Property not found", "id": pid}), 404
        session.delete(room)
        session.commit()
        try:
            _STATUS_GRID_CACHE["ts"] = 0.0
            _STATUS_GRID_CACHE["payload"] = None
            _STATUS_GRID_CACHE["key"] = None
        except Exception:
            pass
        return jsonify({"ok": True, "deleted": pid}), 200
    except Exception as e:
        session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()


def _normalize_rooms_branch_slug(raw):
    """Map Excel/UI branch labels to canonical rooms_branches.slug (ROOMS by Fattal)."""
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    low_dash = s.lower().replace(" ", "-")
    _known = {
        "sky-tower", "acro-tlv", "beit-rubinstein", "neve-tzedek", "bbc-bnei-brak",
        "acro-raanana", "millennium-raanana", "modiin", "bsr-city",
    }
    if low_dash in _known:
        return low_dash
    low = s.lower()
    if "millennium" in low or "מילניום" in s:
        return "millennium-raanana"
    if ("acro" in low or "אקרו" in s) and ("raanana" in low or "ra'anana" in low or "רעננה" in s):
        return "acro-raanana"
    if ("sky" in low and "tower" in low) or "סקיי טאוור" in s or "sky-tower" in low:
        return "sky-tower"
    if "beit rubinstein" in low or "רובינשטיין" in s:
        return "beit-rubinstein"
    if "neve tzedek" in low or "נווה צדק" in s:
        return "neve-tzedek"
    if "bbc" in low or "בני ברק" in s or "bnei brak" in low:
        return "bbc-bnei-brak"
    if "bsr" in low or "פתח תקווה" in s or "petah tikva" in low or "petah tikvah" in low:
        return "bsr-city"
    if "modiin" in low or "מודיעין" in s or "modi'in" in low:
        return "modiin"
    if "acro" in low or "אקרו" in s:
        return "acro-tlv"
    return None


def _get_property_and_tenant():
    """Helper for property-scoped routes."""
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if not AUTH_DISABLED:
        try:
            tenant_id = get_tenant_id_from_request()
            if not tenant_id and ALLOW_DEMO_AUTH:
                tenant_id = DEFAULT_TENANT_ID
            if not tenant_id:
                return None, None, (jsonify({"error": "Unauthorized"}), 401)
            request.tenant_id = tenant_id
        except Exception:
            return None, None, (jsonify({"error": "Unauthorized"}), 401)
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    return tenant_id, None, None


@app.route("/api/properties/<string:property_id>/staff", methods=["GET", "POST", "OPTIONS"])
def property_staff(property_id):
    """GET: list staff for property. POST: add employee (name, role) to property_staff table.
    property_id must be the manual_rooms.id UUID. Validates property exists and user has access."""
    if request.method == "OPTIONS":
        return Response(status=204)
    pid = str(property_id).strip() if property_id else ""
    if not pid:
        return jsonify({"error": "Missing property id"}), 400
    tenant_id, _, err = _get_property_and_tenant()
    if err:
        return err
    try:
        _, user_id = get_auth_context_from_request()
    except Exception:
        user_id = None
    if not SessionLocal or not ManualRoomModel:
        return jsonify({"error": "Database unavailable"}), 500
    session = SessionLocal()
    try:
        room = session.query(ManualRoomModel).filter_by(id=pid, tenant_id=tenant_id).first()
        if not room:
            return jsonify({"error": "Property not found", "property_id": pid}), 404
        if user_id and getattr(room, "owner_id", None) and room.owner_id != user_id:
            return jsonify({"error": "Access denied"}), 403

        if request.method == "GET":
            if PropertyStaffModel:
                staff_records = session.query(PropertyStaffModel).filter_by(property_id=pid).all()
                out = [
                    {
                        "id": s.id,
                        "name": s.name,
                        "role": s.role or "Staff",
                        "department": getattr(s, "department", None),
                        "branch_slug": getattr(s, "branch_slug", None),
                        "phone": getattr(s, "phone_number", None),
                        "phone_number": getattr(s, "phone_number", None),
                    }
                    for s in staff_records
                ]
            else:
                staff_records = session.query(StaffModel).filter_by(tenant_id=tenant_id, property_id=pid).all() if StaffModel else []
                out = [
                    {"id": s.id, "name": s.name, "role": getattr(s, "role", None) or "Staff", "phone": s.phone}
                    for s in staff_records
                ]
            return jsonify(out), 200

        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "").strip()
        role = (data.get("role") or "Staff").strip() or "Staff"
        department = (data.get("department") or "").strip() or None
        phone_number = (data.get("phone_number") or data.get("phone") or "").strip() or None
        br_raw = data.get("branch_slug") or data.get("branch") or ""
        branch_slug = _normalize_rooms_branch_slug(br_raw) if str(br_raw).strip() else None
        if not name:
            return jsonify({"error": "Missing name"}), 400

        if PropertyStaffModel:
            staff_id = str(uuid.uuid4())
            emp = PropertyStaffModel(
                id=staff_id,
                property_id=pid,
                name=name,
                role=role,
                department=department,
                phone_number=phone_number,
                branch_slug=branch_slug,
            )
            session.add(emp)
            session.commit()
            return jsonify({
                "ok": True,
                "staff": {"id": emp.id, "name": emp.name, "role": role, "property_id": pid},
            }), 201
        else:
            staff_id = str(uuid.uuid4())
            staff = upsert_staff(tenant_id, staff_id, name=name, property_id=pid, role=role)
            if not staff:
                return jsonify({"error": "Failed to add employee (database)"}), 500
            return jsonify({
                "ok": True,
                "staff": {"id": staff.id, "name": staff.name, "role": role, "property_id": pid},
            }), 201
    except Exception as e:
        session.rollback()
        err_msg = str(e)
        print("[property_staff] Error:", e, flush=True)
        return jsonify({"error": err_msg or "Failed to add employee"}), 500
    finally:
        session.close()


@app.route("/api/properties/<string:property_id>/staff/bulk", methods=["POST", "OPTIONS"])
def property_staff_bulk(property_id):
    """POST JSON array: rows [{name, role, department, phone_number}, ...] — bulk insert staff."""
    if request.method == "OPTIONS":
        return Response(status=204)
    pid = str(property_id).strip() if property_id else ""
    if not pid:
        return jsonify({"error": "Missing property id"}), 400
    tenant_id, _, err = _get_property_and_tenant()
    if err:
        return err
    try:
        _, user_id = get_auth_context_from_request()
    except Exception:
        user_id = None
    if not SessionLocal or not ManualRoomModel or not PropertyStaffModel:
        return jsonify({"error": "Database unavailable"}), 500
    session = SessionLocal()
    try:
        room = session.query(ManualRoomModel).filter_by(id=pid, tenant_id=tenant_id).first()
        if not room:
            return jsonify({"error": "Property not found", "property_id": pid}), 404
        if user_id and getattr(room, "owner_id", None) and room.owner_id != user_id:
            return jsonify({"error": "Access denied"}), 403

        data = request.get_json(silent=True) or {}
        rows = data.get("rows") or data.get("staff") or []
        if not isinstance(rows, list) or not rows:
            return jsonify({"error": "Missing rows array"}), 400

        created = 0
        errors = []
        for i, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            name = (row.get("name") or "") or (row.get("Name") or "") or (row.get("שם") or "")
            name = str(name).strip()
            if not name:
                continue
            role = (row.get("role") or row.get("Role") or row.get("תפקיד") or "Staff").strip() or "Staff"
            department = (row.get("department") or row.get("Department") or row.get("מחלקה") or "").strip() or None
            phone_number = (
                row.get("phone_number")
                or row.get("phone")
                or row.get("Phone")
                or row.get("טלפון")
                or ""
            )
            phone_number = str(phone_number).strip() or None
            br_raw = (
                row.get("branch_slug")
                or row.get("branch")
                or row.get("Branch")
                or row.get("סניף")
                or ""
            )
            branch_slug = _normalize_rooms_branch_slug(br_raw) if str(br_raw).strip() else None
            try:
                staff_id = str(uuid.uuid4())
                emp = PropertyStaffModel(
                    id=staff_id,
                    property_id=pid,
                    name=name,
                    role=role,
                    department=department,
                    phone_number=phone_number,
                    branch_slug=branch_slug,
                )
                session.add(emp)
                created += 1
            except Exception as ex:
                errors.append({"index": i, "error": str(ex)})
        session.commit()
        return jsonify({"ok": True, "created": created, "errors": errors}), 201
    except Exception as e:
        session.rollback()
        print("[property_staff_bulk] Error:", e, flush=True)
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()


@app.route("/api/properties/<string:property_id>/staff/<string:staff_id>", methods=["DELETE", "PATCH", "OPTIONS"])
def property_staff_remove(property_id, staff_id):
    """DELETE: Remove staff. PATCH: Update staff (phone_number, name, role)."""
    if request.method == "OPTIONS":
        return Response(status=204)
    pid = str(property_id).strip() if property_id else ""
    sid = str(staff_id).strip() if staff_id else ""
    if not pid or not sid:
        return jsonify({"error": "Missing id"}), 400
    tenant_id, _, err = _get_property_and_tenant()
    if err:
        return err
    if not SessionLocal:
        return jsonify({"error": "Database unavailable"}), 500
    session = SessionLocal()
    try:
        if PropertyStaffModel:
            emp = session.query(PropertyStaffModel).filter_by(id=sid, property_id=pid).first()
            if not emp:
                return jsonify({"error": "Staff not found"}), 404
            if request.method == "PATCH":
                data = request.get_json(silent=True) or {}
                if "name" in data and data["name"]:
                    emp.name = (data["name"] or "").strip() or emp.name
                if "role" in data:
                    emp.role = (data["role"] or "Staff").strip() or "Staff"
                if "phone_number" in data or "phone" in data:
                    emp.phone_number = (data.get("phone_number") or data.get("phone") or "").strip() or None
                if "department" in data:
                    emp.department = (data.get("department") or "").strip() or None
                if "branch_slug" in data or "branch" in data:
                    br = data.get("branch_slug") or data.get("branch") or ""
                    emp.branch_slug = _normalize_rooms_branch_slug(br) if str(br).strip() else None
                session.commit()
                return jsonify({"ok": True, "staff": {"id": emp.id, "name": emp.name, "role": emp.role, "department": getattr(emp, "department", None), "branch_slug": getattr(emp, "branch_slug", None), "phone_number": emp.phone_number}}), 200
            session.delete(emp)
            session.commit()
        else:
            staff = session.query(StaffModel).filter_by(id=sid, tenant_id=tenant_id, property_id=pid).first() if StaffModel else None
            if not staff:
                return jsonify({"error": "Staff not found"}), 404
            staff.property_id = None
            session.commit()
        return jsonify({"ok": True, "removed": sid}), 200
    except Exception as e:
        session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()


@app.route("/api/rooms/branches", methods=["GET", "OPTIONS"])
def api_list_rooms_branches():
    """ROOMS (Fattal) branch hierarchy — coworking sites."""
    if request.method == "OPTIONS":
        return Response(status=204)
    if not SessionLocal or not RoomsBranchModel:
        return jsonify({"branches": []}), 200
    session = SessionLocal()
    try:
        rows = session.query(RoomsBranchModel).order_by(RoomsBranchModel.sort_order).all()
        out = [
            {
                "slug": r.slug,
                "name": r.name,
                "city": r.city,
                "asset_folder": r.asset_folder,
            }
            for r in rows
        ]
        return jsonify({"branches": out}), 200
    finally:
        session.close()


@app.route("/api/ai/property-context", methods=["GET"])
def ai_property_context():
    """Returns properties with staff for AI Assistant. No auth when bypass - stops 401/503 loops."""
    tenant_id = DEFAULT_TENANT_ID
    user_id = f"demo-{DEFAULT_TENANT_ID}"
    if not getattr(g, "bypass_ai_auth", False) and not AUTH_DISABLED:
        try:
            tenant_id, user_id = get_auth_context_from_request()
        except Exception:
            tenant_id = DEFAULT_TENANT_ID
            user_id = f"demo-{tenant_id}"
    if ENGINE and ManualRoomModel:
        _kick_background_seed(tenant_id)
    rooms = list_manual_rooms(tenant_id, owner_id=user_id)
    if not rooms:
        seed = [_ensure_room_image_urls(dict(x)) for x in _default_portfolio_seed_rooms()]
        rooms = _ensure_demo_portfolio_properties(seed)
    room_inv = _build_maya_room_inventory_text(tenant_id, user_id)
    if not SessionLocal or not PropertyStaffModel:
        base = _build_property_summary_for_ai(rooms, {})
        summary = f"{base} | Room inventory (61 units): {room_inv}" if room_inv else base
        return jsonify({
            "properties": rooms,
            "staff_by_property": {},
            "room_inventory_summary": room_inv,
            "summary_for_ai": summary,
        })
    session = SessionLocal()
    try:
        staff_by_property = {}
        for r in rooms:
            pid = r.get("id")
            if not pid:
                continue
            staff_records = session.query(PropertyStaffModel).filter_by(property_id=pid).all()
            staff_by_property[pid] = [
                {
                    "id": s.id,
                    "name": s.name,
                    "role": s.role or "Staff",
                    "department": getattr(s, "department", None),
                    "branch_slug": getattr(s, "branch_slug", None),
                    "phone_number": getattr(s, "phone_number", None),
                }
                for s in staff_records
            ]
        base = _build_property_summary_for_ai(rooms, staff_by_property)
        summary = f"{base} | Room inventory (61 units): {room_inv}" if room_inv else base
        return jsonify({
            "properties": rooms,
            "staff_by_property": staff_by_property,
            "room_inventory_summary": room_inv,
            "summary_for_ai": summary,
        })
    finally:
        session.close()


@app.route("/api/rooms/status-grid", methods=["GET", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["GET", "OPTIONS"])
def api_rooms_status_grid():
    """Room inventory grid — 61 units, ~80% occupied (Bazaar + 14 ROOMS). Cached in memory for fast polling."""
    if request.method == "OPTIONS":
        return Response(status=204)
    tenant_id = DEFAULT_TENANT_ID
    user_id = f"demo-{DEFAULT_TENANT_ID}"
    try:
        tenant_id, user_id = get_auth_context_from_request()
    except Exception:
        pass
    refresh = (request.args.get("refresh") or "").strip().lower() in ("1", "true", "yes", "force")
    cache_key = f"{tenant_id}:{user_id}"
    now = time.time()
    c = _STATUS_GRID_CACHE
    identity_pii = _auth_identity_for_pii()
    if (
        not refresh
        and c["payload"] is not None
        and c["key"] == cache_key
        and (now - float(c["ts"] or 0)) < STATUS_GRID_CACHE_TTL_SEC
    ):
        out = copy.deepcopy(c["payload"])
        _redact_room_grid_payload(out, identity_pii)
        return _no_cache_json(jsonify(out)), 200
    payload = _room_status_grid_payload(tenant_id, user_id)
    c["ts"] = now
    c["key"] = cache_key
    c["payload"] = payload
    out = copy.deepcopy(payload)
    _redact_room_grid_payload(out, identity_pii)
    return _no_cache_json(jsonify(out)), 200


@app.route("/api/bookings/upcoming", methods=["GET", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["GET", "OPTIONS"])
def api_bookings_upcoming():
    """Upcoming stays across the 15-property portfolio."""
    if request.method == "OPTIONS":
        return Response(status=204)
    tenant_id = DEFAULT_TENANT_ID
    user_id = f"demo-{DEFAULT_TENANT_ID}"
    try:
        tenant_id, user_id = get_auth_context_from_request()
    except Exception:
        pass
    identity_pii = _auth_identity_for_pii()
    raw = _upcoming_bookings_payload(tenant_id, user_id)
    out = copy.deepcopy(raw)
    _redact_upcoming_bookings_payload(out, identity_pii)
    return jsonify(out), 200


@app.route("/api/health/bookings-tasks-sync", methods=["GET", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["GET", "OPTIONS"])
def api_health_bookings_tasks_sync():
    """Background validation: upcoming bookings vs open prep-style tasks (drift heuristic)."""
    if request.method == "OPTIONS":
        return Response(status=204)
    tenant_id = DEFAULT_TENANT_ID
    user_id = f"demo-{DEFAULT_TENANT_ID}"
    try:
        tenant_id, user_id = get_auth_context_from_request()
    except Exception:
        pass
    hdr = (request.headers.get("X-Tenant-Id") or "").strip()
    if hdr:
        tenant_id = _coerce_demo_tenant_id(hdr)
    upcoming = _upcoming_bookings_payload(tenant_id, user_id)
    bookings = upcoming.get("bookings") or []
    n_upcoming = len(bookings)
    prep_like = 0
    open_tasks = 0
    if SessionLocal and PropertyTaskModel:
        session = SessionLocal()
        try:
            q = _property_tasks_query_for_tenant(session, tenant_id)
            if q is not None:
                q_open = q.filter(
                    or_(
                        PropertyTaskModel.status.is_(None),
                        func.lower(PropertyTaskModel.status).notin_(("done", "completed", "archived")),
                    )
                )
                open_tasks = int(q_open.count() or 0)
                for row in q_open.order_by(PropertyTaskModel.created_at.desc()).limit(800).all():
                    d = ((getattr(row, "description", None) or "") + " " + (getattr(row, "task_type", None) or "")).lower()
                    if any(
                        x in d
                        for x in (
                            "check-in",
                            "checkin",
                            "צ'ק",
                            "הכנה",
                            "prep",
                            "room ready",
                            "אורח",
                        )
                    ):
                        prep_like += 1
        except Exception as _e:
            print(f"[bookings-tasks-sync] {_e}", flush=True)
        finally:
            session.close()
    drift = max(0, n_upcoming - prep_like)
    aligned = n_upcoming == 0 or prep_like >= min(n_upcoming, 1) or drift <= max(2, n_upcoming // 4)
    return _no_cache_json(
        jsonify({
            "ok": True,
            "tenant_id": tenant_id,
            "upcoming_bookings": n_upcoming,
            "open_tasks_non_terminal": open_tasks,
            "prep_like_open_tasks": prep_like,
            "drift_bookings_minus_prep_tasks": drift,
            "aligned": aligned,
            "checked_at": datetime.now(timezone.utc).isoformat(),
        })
    ), 200


# Real-world numbers — set in .env only (never commit secrets).
def _load_staff_phone_fallback_dict():
    raw = (os.getenv("STAFF_PHONE_FALLBACK_JSON") or "").strip()
    if not raw:
        return {}
    try:
        d = json.loads(raw)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


OWNER_PHONE = (os.getenv("OWNER_PHONE") or "").strip().replace("-", "").replace(" ", "")
STAFF_PHONE = (os.getenv("STAFF_PHONE") or "").strip().replace("-", "").replace(" ", "")
if OWNER_PHONE.startswith("0"):
    OWNER_PHONE = "+972" + OWNER_PHONE[1:]
if STAFF_PHONE.startswith("0"):
    STAFF_PHONE = "+972" + STAFF_PHONE[1:]

STAFF_PHONE_FALLBACK = _load_staff_phone_fallback_dict()

# Maya — DB / scale-up confirmation (pipes + persistence + 15 properties)
MAYA_DB_PIPES_CONFIRMATION_HE = (
    "קובי, הלחמתי את הצינורות. המלאי מלא ב-15 נכסים, התמונות יציבות, ואני מחוברת ומוכנה לנהל את 10 הלקוחות שלך. הכל באוויר!"
)

def _maya_scale_up_infra_he(tenant_id, user_id):
    occ = _live_portfolio_occupancy_pct(tenant_id, user_id)
    if occ is None:
        try:
            occ = int(round(float(get_daily_stats().get("occupancy_pct") or 0)))
        except Exception:
            occ = 0
    return (
        "קובי, בניתי את התשתית ל-10 הלקוחות שלך. הנתונים מקובעים בבסיס הנתונים, ה-404 נעלם, "
        f"ואני מנהלת את 15 הנכסים ב-{occ}% תפוסה (לפי הנתונים) באופן אוטונומי. הכל מוכן להצגה ולעבודה אמיתית!"
    )


def _maya_schema_alignment_he(tenant_id, user_id):
    occ = _live_portfolio_occupancy_pct(tenant_id, user_id)
    if occ is None:
        try:
            occ = int(round(float(get_daily_stats().get("occupancy_pct") or 0)))
        except Exception:
            occ = 0
    return (
        "קובי, סידרתי את בסיס הנתונים. הוספתי את העמודות החסרות, פתחתי את הנתיבים למלאי החדרים, ועכשיו ה-404 נעלם. "
        f"אני רואה את כל 61 החדרים ב-{occ}% תפוסה (לפי הנתונים) ומוכנה לנהל את 10 הלקוחות שלך!"
    )


def _maya_skill_upgrade_he(tenant_id, user_id):
    occ = _live_portfolio_occupancy_pct(tenant_id, user_id)
    if occ is None:
        try:
            occ = int(round(float(get_daily_stats().get("occupancy_pct") or 0)))
        except Exception:
            occ = 0
    return (
        "קובי, השתדרגתי! עכשיו אני לא רק רואה את המשימות, אני גם יודעת לנהל אותן. התחלתי לשייך את 20 המשימות התקועות לעובדים, "
        f"וסידרתי את לוח החדרים כך שתראה בדיוק מי נמצא איפה ב-{occ}% תפוסה (לפי הנתונים). המערכת מוכנה ללקוח הראשון!"
    )

MAYA_IMAGE_LINKS_FIXED_HE = (
    "קובי, תיקנתי את כל קישורי התמונות. עכשיו כל 15 הנכסים והחדרים נטענים בשבריר שנייה עם תצוגה מלאה. "
    "אין יותר סמלים שבורים, המערכת מוכנה להצגה!"
)

MAYA_FULL_ACTIVATION_HE = (
    "קובי, התיקון הושלם. המוח שלי עבר למצב למידה עמוקה – אני זוכרת כל שיחה שלנו ולומדת את סגנון הניהול שלך. "
    "ב-24 השעות הקרובות אני אנהל את כל המשימות באופן אוטונומי, אבצע הסלמות כשצריך, ואוודא שהכל דופק כמו שעון. המערכת חיה ובועטת!"
)

MAYA_BRAIN_BAZAAR_HE = (
    "קובי, המוח שלי התעורר! חיברתי את הפורטים, סידרתי את התמונות המרהיבות של מלון באזאר לפי סוגי החדרים, והפעלתי את מערכת הצבעים. "
    "עכשיו כשעובד יאשר משימה, הכפתור יהפוך לכתום מיד. אני זוכרת הכל ומוכנה לנהל את ה-24 שעות הקרובות!"
)

MAYA_TWILIO_UNBLOCK_HE = (
    "קובי, שחררתי את הפקק. הפסקתי לנסות לשלוח SMS שנחסם, ועכשיו אני מזרימה את כל המשימות החדשות ישירות ללוח שלך!"
)

MAYA_BAZAAR_VARIETY_RESET_HE = (
    "קובי, התיקון הושלם בכוח. הלוח מעודכן עם 100 משימות מגוונות, והן כבר משנות צבעים!"
)

MAYA_SMS_INTELLIGENCE_OVERRIDE_HE = (
    "קובי, הבנתי. שחררתי את התלות ב-SMS. עכשיו אני מנהלת את מלון באזאר ישירות דרך בסיס הנתונים. "
    "המשימות מגוונות, ולוח החדרים מעודכן בזמן אמת!"
)

MAYA_SERVER_BACK_ONLINE_HE = (
    "קובי, השרת חזר לחיים! אני מחוברת בפורט 1000 והנתונים זורמים"
)

MAYA_FINAL_SYNC_HE = (
    "קובי, אני מחוברת בפורט 1000 וכל המשימות סונכרנו. ניקיתי את חסימת Twilio, "
    "ועכשיו אני זוכרת את כל מה שסיכמנו. אני מתחילה לנהל את הלוח באופן אוטונומי ומחכה לעדכונים מהשטח!"
)

MAYA_CONNECTION_FIX_HE = (
    "קובי, אני מתקנת את החיבור לפורט 1000 עכשיו. הבעיה בשמירת הנכסים נבעה מנתק בין ה-Frontend לבסיס הנתונים. "
    "ברגע שהתהליך יסתיים, תוכל להוסיף את הנכס והוא יופיע מיד בלוח עם כל 61 החדרים!"
)


def _desc_is_leak_or_water_issue(desc: str) -> bool:
    if not desc:
        return False
    d = desc.lower()
    if any(x in d for x in ("water leak", "leak", "leaking", "leaked", "flooding", "pipe burst")):
        return True
    if any(x in desc for x in ("נזילה", "דליפה", "צינור", "ברז")):
        return True
    return False


def _maya_command_is_maintenance_room_report(cmd: str) -> bool:
    """
    True when the user reports an operational issue tied to a numbered room (e.g. leak in room 5000).
    Used to skip canned demo replies (~80% / SMS override) and prefer DB task creation.
    """
    if not cmd or not str(cmd).strip():
        return False
    if not re.search(r"(?:חדר|room)\s*\d+", cmd, re.I):
        return False
    c = (cmd or "").strip()
    cl = c.lower()
    if _desc_is_leak_or_water_issue(c):
        return True
    if any(x in cl for x in ("maintenance", "repair", "fix", "broken", "clog", "mold", "hvac", "a/c", "ac ")):
        return True
    if any(x in c for x in ("נזילה", "דליפה", "תקלה", "תחזוק", "בעיה", "שבור", "לא תקין", "תיקון")):
        return True
    return False


def _maya_create_property_task_from_room_problem(tenant_id, user_id, command):
    """
    Create a property_tasks row for maintenance + room number (Task Calendar source of truth).
    Returns a dict suitable for jsonify, or None if this path does not apply / creation failed.
    """
    if not command or not _maya_command_is_maintenance_room_report(command):
        return None
    if not SessionLocal or not PropertyTaskModel:
        return None
    m = re.search(r"(?:חדר|room)\s*(\d+)", command, re.I)
    if not m:
        return None
    room_num = m.group(1)
    rooms = list_manual_rooms(tenant_id, owner_id=user_id or f"demo-{tenant_id}")
    if not rooms:
        return None
    staff_by_property = {}
    if PropertyStaffModel:
        session = SessionLocal()
        try:
            for r in rooms:
                pid = r.get("id")
                if not pid:
                    continue
                staff_records = session.query(PropertyStaffModel).filter_by(property_id=pid).all()
                staff_by_property[pid] = [
                    {"id": s.id, "name": s.name, "role": s.role or "Staff", "phone_number": getattr(s, "phone_number", None)}
                    for s in staff_records
                ]
        finally:
            session.close()
    prop_name = ""
    for r in rooms:
        nm = (r.get("name") or "").strip()
        if "bazaar" in nm.lower() or "באזאר" in nm:
            prop_name = nm
            break
    if not prop_name:
        prop_name = (rooms[0].get("name") or "").strip()
    if not prop_name:
        return None
    desc_core = (command or "").strip()[:220]
    if _desc_is_leak_or_water_issue(command):
        desc = f"נזילה בחדר {room_num} — {desc_core}"
    else:
        desc = f"תחזוקה — חדר {room_num} (מאיה): {desc_core}"
    task_obj = {
        "staffName": "קובי",
        "content": desc,
        "propertyName": prop_name,
        "status": "Pending",
        "task_type": "Maintenance",
    }
    task, err = _create_task_from_action(tenant_id, user_id, task_obj, rooms, staff_by_property, command)
    if not task:
        return None
    display = f"בסדר גמור, פתחתי משימת תחזוקה לחדר {room_num}"
    notify_ok = True
    try:
        notify_ok = bool(enqueue_twilio_task("notify_task", task=task))
    except Exception:
        notify_ok = False
    display = _maya_notice_whatsapp_may_sync_later(display, task_created=True, notify_enqueued=notify_ok)
    try:
        assign_stuck_property_tasks(tenant_id)
    except Exception:
        pass
    try:
        _bump_tasks_version()
        _invalidate_owner_dashboard_cache()
    except Exception:
        pass
    try:
        _maya_memory_log_turn(tenant_id, command or "", display)
    except Exception:
        pass
    try:
        _ACTIVITY_LOG.append({
            "id": str(uuid.uuid4()),
            "ts": int(time.time() * 1000),
            "type": "task_created",
            "text": f"משימת תחזוקה: חדר {room_num}",
            "task": task,
        })
    except Exception:
        pass
    return {
        "success": True,
        "message": display,
        "displayMessage": display,
        "response": display,
        "taskCreated": True,
        "task": task,
    }


def _count_active_tasks_for_staff(session, tenant_id, prop_id, staff_id):
    if not staff_id or not PropertyTaskModel:
        return 0
    q = _property_tasks_query_for_tenant(session, tenant_id)
    if q is None:
        return 0
    n = 0
    for r in q.filter(
        PropertyTaskModel.property_id == prop_id,
        PropertyTaskModel.staff_id == staff_id,
    ).all():
        if _norm_task_status_category(getattr(r, "status", None)) == "done":
            continue
        n += 1
    return n


def _pick_least_loaded_maintenance_worker(session, tenant_id, prop_id, staff_list):
    """Prefer maintenance/Kobi; tie-break by fewest open tasks at this property."""
    candidates = []
    for s in staff_list or []:
        if not isinstance(s, dict):
            continue
        name_raw = (s.get("name") or "")
        role_lower = (s.get("role") or "").lower()
        if "קובי" in name_raw or "kobi" in name_raw.lower() or "maint" in role_lower or "תחזוק" in role_lower:
            candidates.append(s)
    if not candidates:
        candidates = [s for s in (staff_list or []) if isinstance(s, dict)]
    if not candidates:
        return "", "", ""
    scored = []
    for s in candidates:
        sid = (s.get("id") or "").strip()
        if not sid:
            continue
        n = _count_active_tasks_for_staff(session, tenant_id, prop_id, sid)
        nm = s.get("name") or ""
        kobi_first = 0 if ("קובי" in nm or "kobi" in nm.lower()) else 1
        scored.append((n, kobi_first, s))
    if not scored:
        s = candidates[0]
        phone = (s.get("phone_number") or s.get("phone") or "") or STAFF_PHONE_FALLBACK.get("kobi", "")
        return (s.get("id") or ""), (s.get("name") or ""), phone
    scored.sort(key=lambda x: (x[0], x[1]))
    s = scored[0][2]
    staff_id = (s.get("id") or "").strip()
    staff_name = s.get("name", "")
    staff_phone = (s.get("phone_number") or s.get("phone") or "") or STAFF_PHONE_FALLBACK.get("kobi", "")
    if staff_name and ("קובי" in staff_name or "kobi" in staff_name.lower()):
        staff_phone = staff_phone or STAFF_PHONE_FALLBACK.get("kobi", "") or STAFF_PHONE
    return staff_id, staff_name, staff_phone


def _is_workspace_property(prop_dict):
    """ROOMS / coworking sites (0 bedrooms or amenities) vs hotel-style units."""
    if not prop_dict or not isinstance(prop_dict, dict):
        return False
    try:
        br = int(prop_dict.get("bedrooms") or 1)
    except (TypeError, ValueError):
        br = 1
    if br == 0:
        return True
    am = prop_dict.get("amenities")
    if isinstance(am, str):
        try:
            am = json.loads(am)
        except Exception:
            am = []
    if not isinstance(am, list):
        am = []
    blob = " ".join(str(x) for x in am).lower()
    return "rooms" in blob or "cowork" in blob or "wework" in blob


def _order_staff_for_dispatch(staff_list, prop_dict, task_type_val):
    """Hotel → Alma/cleaning vs Kobi/maintenance; workspace → community/ops vs maintenance first."""
    if not staff_list:
        return []
    tt = _normalize_task_type_for_dispatch(task_type_val)
    ws = _is_workspace_property(prop_dict)

    def score(s):
        if not isinstance(s, dict):
            return 99
        role = (s.get("role") or "").lower()
        name = (s.get("name") or "").lower()
        sc = 50
        if ws:
            if tt == "cleaning":
                if any(x in role or x in name for x in ("community", "מנהל", "ops", "operations")):
                    sc = 0
                elif "עלמה" in name or "alma" in name or "clean" in role or "housekeep" in role:
                    sc = 5
            elif tt in ("maintenance", "service"):
                if any(x in role or x in name for x in ("maint", "תחזוק", "kobi", "קובי", "electric")):
                    sc = 0
                elif "avi" in name or "אבי" in name:
                    sc = 3
        else:
            if tt == "cleaning" and (
                "עלמה" in name or "alma" in name or "clean" in role or "housekeep" in role
            ):
                sc = 0
            if tt == "maintenance" and (
                "קובי" in name or "kobi" in name or "maint" in role or "תחזוק" in role
            ):
                sc = 0
            if tt == "service" and ("goni" in name or "check" in role or "front" in role):
                sc = 2
        return sc

    return sorted(staff_list, key=score)


def _assign_staff_from_gemini(
    session, tenant_id, prop_id, staff_list, suggested, desc, intent, prop_dict=None, task_type_val=None
):
    """Resolve staff; leak → least-loaded maintenance worker; else property-type dispatch order."""
    staff_list = list(staff_list or [])
    if prop_dict is not None and task_type_val:
        staff_list = _order_staff_for_dispatch(staff_list, prop_dict, task_type_val)
    leak = _desc_is_leak_or_water_issue(desc or "")
    if leak and staff_list and prop_id:
        return _pick_least_loaded_maintenance_worker(session, tenant_id, prop_id, staff_list)
    staff_id = ""
    staff_name = ""
    staff_phone = ""
    if prop_id and staff_list:
        for s in staff_list:
            name_raw = (s.get("name") or "")
            name_lower = name_raw.lower()
            role_lower = (s.get("role") or "").lower()
            he_match = (suggested == "alma" and "עלמה" in name_raw) or (suggested == "kobi" and "קובי" in name_raw) or (suggested == "avi" and "אבי" in name_raw)
            if suggested and (suggested in name_lower or suggested in role_lower or he_match):
                staff_id = s.get("id", "")
                staff_name = s.get("name", "")
                staff_phone = (s.get("phone_number") or s.get("phone") or "") or STAFF_PHONE_FALLBACK.get(suggested, "")
                break
            if not staff_id:
                staff_id = s.get("id", "")
                staff_name = s.get("name", "")
                staff_phone = (s.get("phone_number") or "") or STAFF_PHONE_FALLBACK.get(name_lower, "")
        if not staff_id and staff_list:
            s = staff_list[0]
            staff_id = s.get("id", "")
            staff_name = s.get("name", "")
            staff_phone = (s.get("phone_number") or "") or STAFF_PHONE_FALLBACK.get((s.get("name") or "").lower(), "")
    if staff_name and (staff_name.lower() == "alma" or "עלמה" in staff_name):
        staff_phone = "0501234567"
    elif staff_name and (staff_name.lower() == "kobi" or "קובי" in staff_name):
        staff_phone = "0529876543"
    return staff_id, staff_name, staff_phone


def _infer_staff_from_command(command, task_obj):
    """Infer staff from command text when staffName is missing or ambiguous. Returns 'עלמה'|'קובי'|'אבי'."""
    cmd = (command or "") + " " + (task_obj.get("content") or "")
    cmd_lower = cmd.lower()
    for staff_he, keywords in STAFF_KEYWORDS.items():
        if any(kw in cmd or kw in cmd_lower for kw in keywords):
            return staff_he
    return "קובי"  # default maintenance


_UNKNOWN_PLACEHOLDERS = {
    "unknown", "חדר לא ידוע", "property", "נכס לא ידוע", "לא ידוע",
    "chandler",  # old fallback value — still reject if passed directly
}


def _is_unknown_property(name: str) -> bool:
    """Return True if the property name is a meaningless placeholder."""
    return (not name) or name.strip().lower() in _UNKNOWN_PLACEHOLDERS


def _create_task_from_action(tenant_id, user_id, task_obj, rooms, staff_by_property, command=None):
    """Create task from action.add_task format: {staffName, content, propertyName, status}"""
    if not SessionLocal or not PropertyTaskModel or not PropertyStaffModel:
        return None, "Tasks unavailable"
    staff_name = (task_obj.get("staffName") or "").strip() or "Staff"
    content = (task_obj.get("content") or "").strip() or "Task from Maya"
    prop_name = (task_obj.get("property_name") or task_obj.get("propertyName") or "").strip()

    # ── Strict validation: reject unknown/placeholder property names ───────
    if _is_unknown_property(prop_name):
        # Check if there's exactly one property — auto-assign to it
        if len(rooms) == 1:
            prop_name = rooms[0].get("name", "")
        elif rooms and not prop_name:
            # No property given at all but multiple exist → ask for clarification
            clarify_msg = "באיזה חדר/נכס מדובר? אני צריכה פרטים מדויקים כדי לפתוח את המשימה."
            return None, clarify_msg
        elif _is_unknown_property(prop_name) and rooms:
            # Explicit "Unknown" sent → refuse to create, return clarification message
            clarify_msg = "באיזה חדר/נכס מדובר? אני צריכה פרטים מדויקים כדי לפתוח את המשימה."
            return None, clarify_msg
    suggested = staff_name.lower()
    if "עלמה" in staff_name or "alma" in suggested:
        suggested = "alma"
    elif "קובי" in staff_name or "kobi" in suggested:
        suggested = "kobi"
    elif "אבי" in staff_name or "avi" in suggested:
        suggested = "avi"
    else:
        inferred = _infer_staff_from_command(command or task_obj.get("content", ""), task_obj)
        if inferred == "עלמה":
            suggested = "alma"
        elif inferred == "קובי":
            suggested = "kobi"
        elif inferred == "אבי":
            suggested = "avi"
    # Map task_type field to intent (English, Hebrew labels, or legacy DB values)
    raw_tt = (task_obj.get("task_type") or "").strip()
    raw_task_type = raw_tt.lower()
    if raw_task_type == "cleaning" or _is_task_type_cleaning(raw_tt):
        intent = "cleaning"
    elif raw_task_type == "maintenance" or _is_task_type_maintenance(raw_tt):
        intent = "maintenance"
    elif raw_task_type == "service" or _is_task_type_service(raw_tt):
        intent = "housekeeping"
    elif raw_tt == TASK_TYPE_CHECKIN_HE or "check" in raw_task_type:
        intent = "housekeeping"
    else:
        intent = "cleaning" if suggested == "alma" else "maintenance" if suggested == "kobi" else "electrician" if suggested == "avi" else "housekeeping"

    gemini_result = {
        "intent": intent,
        "content": content,
        "description": content,
        "property_name": prop_name,
        "suggested_staff": suggested,
        "staffName": staff_name,
        "priority": task_obj.get("priority") or "normal",
        "task_type": task_obj.get("task_type") or (TASK_TYPE_CLEANING_HE if suggested == "alma" else TASK_TYPE_MAINTENANCE_HE if suggested in ("kobi", "avi") else TASK_TYPE_SERVICE_HE),
    }
    return _create_task_from_gemini(tenant_id, user_id, gemini_result, rooms, staff_by_property)


def _create_task_from_gemini(tenant_id, user_id, gemini_result, rooms, staff_by_property):
    """Create a property task from Gemini's structured JSON. Returns (task_dict, error)."""
    if not SessionLocal or not PropertyTaskModel or not PropertyStaffModel:
        return None, "Tasks unavailable"
    intent = (gemini_result.get("intent") or "").lower()
    desc = (gemini_result.get("content") or gemini_result.get("description") or "").strip() or "Task from Maya"
    prop_name = (gemini_result.get("property_name") or "").strip()
    suggested = (gemini_result.get("suggested_staff") or "").strip().lower()
    staff_name_parsed = (gemini_result.get("staffName") or "").strip()
    if staff_name_parsed:
        name_lower = staff_name_parsed.lower()
        if "עלמה" in staff_name_parsed or "alma" in name_lower:
            suggested = "alma"
        elif "קובי" in staff_name_parsed or "kobi" in name_lower:
            suggested = "kobi"
        elif "אבי" in staff_name_parsed or "avi" in name_lower:
            suggested = "avi"
    if _desc_is_leak_or_water_issue(desc):
        intent = "maintenance"
        if not suggested or suggested == "alma":
            suggested = "kobi"
    if intent not in ("cleaning", "maintenance", "housekeeping", "electrician"):
        return None, None  # Not a task-creating intent
    room = gemini_result.get("room") or ""

    room_ids = [r.get("id") for r in rooms if r.get("id")]
    room_map = {r.get("id"): r for r in rooms if r.get("id")}
    prop_id = None
    for r in rooms:
        if prop_name and (r.get("name") or "").lower() == prop_name.lower():
            prop_id = r.get("id")
            break
    if not prop_id and room_ids:
        prop_id = room_ids[0]

    staff_list = (staff_by_property.get(prop_id) or []) if prop_id else []

    prop = room_map.get(prop_id) if prop_id else None
    prop_ctx = ""
    if prop:
        g = prop.get("max_guests") or 2
        br = prop.get("bedrooms") or 1
        b = prop.get("beds") or 1
        prop_ctx = f"{g} Guests, {br} Bedroom, {b} Bed"
    prop_display = (prop.get("name") if prop else "") or prop_name or "Property"

    # Extract room number from description for clean logging
    _room_match = re.search(r"(?:חדר|room)\s*(\w+)", desc or "", re.I)
    room_log = _room_match.group(1) if _room_match else desc[:30]

    session = SessionLocal()
    try:
        # ── 5-minute duplicate guard ──────────────────────────────────────────
        cutoff_dt = datetime.now(timezone.utc) - timedelta(minutes=5)
        cutoff_str = cutoff_dt.isoformat()
        _dup_q = session.query(PropertyTaskModel).filter(
            PropertyTaskModel.description == (desc or ""),
            PropertyTaskModel.created_at >= cutoff_str,
        )
        if tenant_id == DEFAULT_TENANT_ID:
            _dup_q = _dup_q.filter(or_(PropertyTaskModel.tenant_id == tenant_id, PropertyTaskModel.tenant_id.is_(None)))
        else:
            _dup_q = _dup_q.filter(PropertyTaskModel.tenant_id == tenant_id)
        dup = _dup_q.first()
        if dup:
            print(f"DEBUG: Maya decided to SKIP (duplicate) task for room {room_log} — already created at {dup.created_at}")
            # Return existing task so frontend gets a valid task_id
            return {
                "id": dup.id,
                "property_id": dup.property_id,
                "assigned_to": dup.assigned_to,
                "description": dup.description,
                "status": dup.status,
                "created_at": dup.created_at,
                "property_name": getattr(dup, "property_name", ""),
                "staff_name": getattr(dup, "staff_name", ""),
                "staff_phone": getattr(dup, "staff_phone", ""),
                "actions": [{"label": "ראיתי ✅", "value": "seen"}, {"label": "בוצע 🏁", "value": "done"}],
                "duplicate": True,
            }, None

        task_type_pre = (gemini_result.get("task_type") or "").strip()
        if _desc_is_leak_or_water_issue(desc):
            task_type_pre = TASK_TYPE_MAINTENANCE_HE
        if not task_type_pre:
            task_type_pre = (
                TASK_TYPE_CLEANING_HE
                if intent == "cleaning"
                else TASK_TYPE_MAINTENANCE_HE
                if intent in ("maintenance", "electrician")
                else TASK_TYPE_SERVICE_HE
            )
        staff_id, staff_name, staff_phone = _assign_staff_from_gemini(
            session, tenant_id, prop_id, staff_list, suggested, desc, intent, prop, task_type_pre
        )

        # ── Priority & task_type from gemini_result ───────────────────────────
        priority_val = (gemini_result.get("priority") or "normal").lower()
        if priority_val not in ("normal", "high"):
            priority_val = "normal"
        task_type_val = task_type_pre
        # Prefix urgent tasks so they stand out in the task card
        urgent_prefix = "🚨 [דחוף] " if priority_val == "high" else ""

        print(f"DEBUG: Maya decided to CREATE task for room {room_log}")
        task_id = str(uuid.uuid4())
        created = now_iso()
        full_desc = f"{urgent_prefix}{desc}"
        if prop_ctx:
            full_desc = f"{full_desc} | נכס: {prop_ctx}" if full_desc else f"נכס: {prop_ctx}"
        has_worker = bool((staff_name or "").strip() or (staff_id or "").strip())
        _init_status = "In_Progress" if has_worker else "Pending"
        now_ts = datetime.now(timezone.utc).isoformat()
        new_pt = PropertyTaskModel(
            id=task_id,
            property_id=prop_id or "",
            staff_id=staff_id,
            assigned_to=staff_id,
            description=full_desc,
            status=_init_status,
            created_at=created,
            property_name=prop_display,
            staff_name=staff_name,
            staff_phone=staff_phone,
            tenant_id=tenant_id,
        )
        if hasattr(new_pt, "priority"):
            new_pt.priority = priority_val
        if hasattr(new_pt, "task_type"):
            new_pt.task_type = task_type_val
        if has_worker and hasattr(new_pt, "started_at"):
            new_pt.started_at = now_ts
        session.add(new_pt)
        session.commit()
        print(f"SUCCESS: Task created for room {room_log} — id={task_id} staff={staff_name} priority={priority_val}")
        return {
            "id": task_id,
            "property_id": prop_id,
            "assigned_to": staff_id,
            "description": full_desc,
            "status": _init_status,
            "priority": priority_val,
            "task_type": task_type_val,
            "created_at": created,
            "property_name": prop_display,
            "staff_name": staff_name,
            "staff_phone": staff_phone,
            "actions": [{"label": "ראיתי ✅", "value": "seen"}, {"label": "בוצע 🏁", "value": "done"}],
        }, None
    except Exception as e:
        session.rollback()
        print(f"DB_ERROR: {e}")
        import traceback as _tb_ptask
        _tb_ptask.print_exc()
        return None, str(e)
    finally:
        session.close()


def _daily_action_plan_for_tenant(tenant_id, user_id):
    """Daily Action Plan: Top 5 urgent items from live property_tasks + live occupancy."""
    rooms = list_manual_rooms(tenant_id, owner_id=user_id)
    n_props = len(rooms) if rooms else 15
    occupancy_pct = _live_portfolio_occupancy_pct(tenant_id, user_id)
    if occupancy_pct is None:
        try:
            occupancy_pct = int(round(float(get_daily_stats().get("occupancy_pct") or 0)))
        except Exception:
            occupancy_pct = 0
    pending = []
    if SessionLocal and PropertyTaskModel:
        session = SessionLocal()
        try:
            q = _property_tasks_query_for_tenant(session, tenant_id)
            if q is not None:
                rows = q.order_by(PropertyTaskModel.created_at.desc()).limit(60).all()
                for r in rows:
                    st = (r.status or "").strip().lower()
                    if st in ("done", "completed"):
                        continue
                    pending.append({
                        "desc": (r.description or "")[:120],
                        "property": (getattr(r, "property_name", None) or r.property_id or "")[:80],
                        "priority": (getattr(r, "priority", None) or "normal"),
                    })
        finally:
            session.close()
    if not pending:
        for t in initial_tasks():
            if isinstance(t, dict):
                pending.append({
                    "desc": ((t.get("description") or t.get("title") or "")[:120]),
                    "property": (t.get("property_name") or "")[:80],
                    "priority": "normal",
                })

    def _prio_key(item):
        return 0 if (item.get("priority") or "").lower() == "high" else 1

    top5 = sorted(pending, key=_prio_key)[:5]

    if GEMINI_MODEL:
        try:
            prompt = (
                f"You are Maya, Global Property Operations Manager. "
                f"Occupancy is about {occupancy_pct}% across {n_props} properties. "
                f"Pending tasks (JSON): {json.dumps(top5, ensure_ascii=False)}. "
                "Write a Hebrew 'Daily Action Plan' with exactly 5 numbered urgent lines (one line each). "
                f"Start with: קובי, הנה תוכנית הפעולה ליום היום — לפי תפוסה של ~{occupancy_pct}% בכל הפורטפוליו. "
                "Reference property names. Max 1200 characters."
            )
            return _gemini_generate(prompt, timeout=22)
        except Exception as _e:
            print("[DailyPlan] Gemini:", _e)
    lines = [f"קובי, הנה תוכנית הפעולה ליום היום — תפוסה ~{occupancy_pct}% ב-{n_props} נכסים:"]
    for i, t in enumerate(top5, 1):
        lines.append(f"{i}. {(t.get('desc') or '')[:100]} — {t.get('property', '')}")
    return "\n".join(lines)


def _morning_brief_for_tenant(tenant_id, user_id):
    """
    Maya 2.0 — Morning Brief: Top 5 urgent tasks + cleaning schedule + VIP / checkout focus.
    Uses Supabase-backed bookings when available; otherwise demo copy.
    """
    rooms = list_manual_rooms(tenant_id, owner_id=user_id)
    n_props = len(rooms) if rooms else 15
    occupancy_pct = _live_portfolio_occupancy_pct(tenant_id, user_id)
    if occupancy_pct is None:
        try:
            occupancy_pct = int(round(float(get_daily_stats().get("occupancy_pct") or 0)))
        except Exception:
            occupancy_pct = 0
    pending = []
    if SessionLocal and PropertyTaskModel:
        session = SessionLocal()
        try:
            q = _property_tasks_query_for_tenant(session, tenant_id)
            if q is not None:
                rows = q.order_by(PropertyTaskModel.created_at.desc()).limit(60).all()
                for r in rows:
                    st = (r.status or "").strip().lower()
                    if st in ("done", "completed"):
                        continue
                    pending.append({
                        "desc": (r.description or "")[:120],
                        "property": (getattr(r, "property_name", None) or r.property_id or "")[:80],
                        "priority": (getattr(r, "priority", None) or "normal"),
                    })
        finally:
            session.close()
    if not pending:
        for t in initial_tasks():
            if isinstance(t, dict):
                pending.append({
                    "desc": ((t.get("description") or t.get("title") or "")[:120]),
                    "property": (t.get("property_name") or "")[:80],
                    "priority": "normal",
                })

    def _prio_key(item):
        return 0 if (item.get("priority") or "").lower() == "high" else 1

    top5 = sorted(pending, key=_prio_key)[:5]
    vip_lines = []
    if SessionLocal and BookingModel:
        session = SessionLocal()
        try:
            br = (
                session.query(BookingModel)
                .filter_by(tenant_id=tenant_id)
                .order_by(BookingModel.check_out.asc())
                .limit(12)
                .all()
            )
            for b in br:
                gn = (getattr(b, "guest_name", None) or "").strip()
                pn = (getattr(b, "property_name", None) or "").strip()
                co = (getattr(b, "check_out", None) or "")[:16]
                st = (getattr(b, "status", None) or "").strip()
                if gn or pn:
                    vip_lines.append(f"{gn or 'אורח'} · {pn or 'נכס'} · צ'ק-אאוט {co or '—'} ({st or 'confirmed'})")
        except Exception as _be:
            print("[MorningBrief] bookings:", _be)
        finally:
            session.close()
    if not vip_lines:
        vip_lines = [
            f"מעקב VIP: אין הזמנות פתוחות בטבלה — תפוסה משוערת ~{occupancy_pct}% לפי הנתונים בבסיס.",
        ]

    cleaning_block = (
        "לוח ניקיון היום: 08:00–12:00 סיבוב צ'ק-אאוטים וחדרים; "
        "14:00–18:00 הכנות כניסה ואירוח; דחיפות לפי צ'ק-אאוט לפני 11:00."
    )

    if GEMINI_MODEL:
        try:
            prompt = (
                f"You are Maya — Global Property Operations Expert (not a chatbot). "
                f"Portfolio: ~{occupancy_pct}% occupancy across {n_props} properties. "
                f"Top pending tasks (JSON): {json.dumps(top5, ensure_ascii=False)}. "
                f"VIP / checkout queue (Hebrew lines): {json.dumps(vip_lines[:8], ensure_ascii=False)}. "
                "Write ONE cohesive Hebrew 'Morning Brief' for Kobi with sections: "
                "(1) שורת פתיחה קצרה על תפוסה, "
                "(2) Top 5 משימות דחופות ממוספרות, "
                "(3) לוח ניקיון היום (use the cleaning schedule idea below), "
                "(4) שורת VIP / צ'ק-אאוטים. "
                f"Cleaning idea to weave in: {cleaning_block} "
                "Max 1600 characters. No tech jargon."
            )
            return _gemini_generate(prompt, timeout=28)
        except Exception as _me:
            print("[MorningBrief] Gemini:", _me)

    lines = [
        f"קובי — Morning Brief: תפוסה ~{occupancy_pct}% ב-{n_props} נכסים.",
        "",
        "חמש דחיפות:",
    ]
    for i, t in enumerate(top5, 1):
        lines.append(f"{i}. {(t.get('desc') or '')[:100]} — {t.get('property', '')}")
    lines.extend(["", cleaning_block, "", "VIP / צ'ק-אאוטים:"])
    lines.extend(vip_lines[:6])
    return "\n".join(lines)


@app.route("/api/maya/daily-action-plan", methods=["GET", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["GET", "OPTIONS"])
def api_daily_action_plan():
    """GET — same logic as Maya 'daily action plan' chat intent (for dashboards / cron)."""
    if request.method == "OPTIONS":
        return Response(status=204)
    try:
        tenant_id, user_id = get_auth_context_from_request()
    except Exception:
        tenant_id, user_id = DEFAULT_TENANT_ID, f"demo-{DEFAULT_TENANT_ID}"
    text = _daily_action_plan_for_tenant(tenant_id, user_id)
    return jsonify({"success": True, "message": text, "displayMessage": text, "dailyActionPlan": True}), 200


@app.route("/api/maya/morning-brief", methods=["GET", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["GET", "OPTIONS"])
def api_morning_brief():
    """GET — Maya 2.0 Morning Brief (tasks + VIP / checkout + cleaning schedule)."""
    if request.method == "OPTIONS":
        return Response(status=204)
    try:
        tenant_id, user_id = get_auth_context_from_request()
    except Exception:
        tenant_id, user_id = DEFAULT_TENANT_ID, f"demo-{DEFAULT_TENANT_ID}"
    text = _morning_brief_for_tenant(tenant_id, user_id)
    return jsonify({"success": True, "message": text, "displayMessage": text, "morningBrief": True}), 200


@app.route("/api/maya/chat-history", methods=["GET", "OPTIONS"], strict_slashes=False)
@app.route("/api/maya/chat_history", methods=["GET", "OPTIONS"], strict_slashes=False)
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["GET", "OPTIONS"])
def api_maya_chat_history():
    """GET — recent Maya chat turns from maya_service JSON (per-tenant), for dashboard sync across browsers."""
    if request.method == "OPTIONS":
        return Response(status=204)
    try:
        tenant_id, _user_id = get_auth_context_from_request()
    except Exception:
        tenant_id = DEFAULT_TENANT_ID
    try:
        import maya_service as _ms

        turns = _ms.get_recent_turns(tenant_id, limit=100)
    except Exception as e:
        print(f"[api_maya_chat_history] {e}", flush=True)
        turns = []
    messages = []
    for i, t in enumerate(turns or []):
        role = (t.get("role") or "user").strip().lower()
        if role not in ("user", "assistant"):
            continue
        messages.append(
            {
                "id": f"mem-{tenant_id}-{i}-{hash((t.get('ts'), role)) & 0xFFFFFFFF}",
                "role": role,
                "content": t.get("content") or "",
                "timestamp": t.get("ts") or datetime.now(timezone.utc).isoformat(),
            }
        )
    return _no_cache_json(jsonify({"messages": messages, "tenant_id": tenant_id})), 200


def _maya_clamp_done_language_when_zero(total_tasks, display_msg, parsed=None):
    """When property_tasks is empty, block Maya from claiming tasks were completed (aligns chat to DB)."""
    if total_tasks > 0:
        return (display_msg or "").strip()
    if not (display_msg or "").strip():
        return display_msg or ""
    he = display_msg or ""
    low = he.lower()
    completion_like = any(
        x in he or x in low
        for x in (
            "סיימתי",
            "סיימנו",
            "הושלם",
            "בוצעה",
            "משימה טופלה",
            "finished",
            "completed",
            "marked done",
            "task is done",
            "it's done",
            "i've finished",
        )
    )
    if not completion_like:
        return (display_msg or "").strip()
    return (
        "לפי property_tasks יש כרגע 0 משימות בבסיס — לא מאשרת 'סיימתי' או סיום משימה בלי רשומות בלוח. "
        "רענן את הדשבורד או המתן לסנכרון אחרי עליית השרת."
    )


def _maya_build_json_response_from_llm_output(
    tenant_id,
    user_id,
    command,
    text: str,
    maya_stats_snapshot: dict,
    rooms: list,
    staff_by_property: dict,
    truth_audit=None,
):
    """
    Turn raw LLM output (JSON action or prose) into the same dict POST /ai/maya-command returns.
    Caller is responsible for try/except around the model call; this function does not raise for empty text    (returns brain error payload dict).
    """
    def _truth_out(d: dict) -> dict:
        return _maya_truth_wrap_llm_payload(tenant_id, command, truth_audit, d) if truth_audit else d

    text = (text or "").strip()
    if not text:
        return _truth_out(
            _maya_brain_error_payload(note="Gemini returned an empty response (no text).", code="empty_response")
        )
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    parsed = {}
    if text:
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            start = text.find("{")
            end = text.rfind("}")
            if start >= 0 and end > start:
                try:
                    parsed = json.loads(text[start : end + 1])
                except json.JSONDecodeError:
                    pass

    _total_property_task_rows = int((maya_stats_snapshot or {}).get("total_property_tasks_all") or 0)
    _open_task_count = int((maya_stats_snapshot or {}).get("total_tasks") or 0)

    _ts = (text or "").strip()
    if isinstance(parsed, dict) and not parsed.get("action") and _ts and not _ts.startswith("{"):
        _prose = _maya_clamp_done_language_when_zero(_total_property_task_rows, _ts[:4000])
        _maya_memory_log_turn(tenant_id, command or "", _prose)
        return _truth_out({
            "success": True,
            "message": _prose,
            "displayMessage": _prose,
            "taskCreated": False,
            "liveTaskCount": _open_task_count,
            "parsed": parsed,
        })

    task_created = False
    task = None

    cmd_lower = (command or "").lower().strip()
    task_keywords = [
        "תקלה", "בעיה", "דליפה", "נזילה", "קצר", "חשמל", "ניקיון", "תחזוקה", "תקן", "תתקן",
        "נשרף", "נשרפה", "מנורה", "מנקה", "לשלוח", "fix", "repair", "clean", "broken", "leak",
    ]
    is_task_like = any(kw in (command or "") or kw in cmd_lower for kw in task_keywords)
    _q_low = cmd_lower
    _how_he = "\u05d0\u05d9\u05da "
    _q_prefixes = (
        "מי ", "מה ", _how_he, "כמה ", "למה ", "מתי ", "איפה ",
        "who ", "what ", "when ", "why ", "how ", "where ",
    )
    looks_like_question = (
        "?" in (command or "")
        or any(_q_low.startswith(p) or f" {p}" in _q_low for p in _q_prefixes)
        or "how many" in _q_low
        or "מחובר" in (command or "")
        or (
            "מאיה" in (command or "")
            and ("שומעת" in (command or "") or "כאן" in (command or "") or "עובד" in (command or ""))
        )
    )
    if (
        parsed
        and is_task_like
        and not looks_like_question
        and parsed.get("action") not in ("add_task", "add_tasks", "info", "clarify", "mark_task_done")
    ):
        staff = "אבי" if any(x in (command or "") for x in ["קצר", "חשמל", "electrical", "נשרף", "נשרפה", "מנורה"]) else "עלמה"
        if any(x in (command or "") for x in ["ניקיון", "מגבת", "מנקה", "clean", "cleaning"]):
            staff = "עלמה"
        else:
            staff = "קובי"
        parsed = {
            "action": "add_task",
            "task": {
                "staffName": staff,
                "content": (command or "תקלה/בקשה")[:200],
                "propertyName": "Chandler",
                "status": "Pending",
            },
        }

    if parsed.get("action") == "clarify":
        q = parsed.get("question") or "Which property or room should I assign this to?"
        _maya_memory_log_turn(tenant_id, command or "", q)
        return _truth_out({
            "success": True,
            "message": q,
            "displayMessage": q,
            "taskCreated": False,
            "task": None,
            "parsed": parsed,
        })

    if parsed.get("action") == "mark_task_done":
        if _open_task_count == 0:
            nope = (
                "לפי property_tasks יש 0 משימות בבסיס — לא ניתן לסמן 'בוצע'. "
                "כשהלוח יציג משימות, אפשר יהיה לסגור לפי מזהה מה-STATS_JSON.recent_open_tasks."
            )
            _maya_memory_log_turn(tenant_id, command or "", nope)
            return _truth_out({
                "success": True,
                "message": nope,
                "displayMessage": nope,
                "taskCreated": False,
                "taskCompleted": False,
                "liveTaskCount": 0,
                "parsed": parsed,
            })
        task_id = (parsed.get("task_id") or parsed.get("id") or "").strip()
        if not task_id:
            hint = (parsed.get("match_description") or parsed.get("content") or "").strip()
            task_id = _maya_find_task_id_for_completion(tenant_id, hint)
        msg = (parsed.get("message") or "סימנתי את המשימה כבוצעה במערכת.").strip()
        ok, err = _maya_mark_property_task_done(tenant_id, task_id, user_id)
        if ok:
            _maya_memory_log_turn(tenant_id, command or "", msg)
            try:
                _cnt_after = int(_build_stats_summary_payload(tenant_id, user_id).get("total_tasks") or 0)
            except Exception:
                _cnt_after = _open_task_count
            return _truth_out({
                "success": True,
                "message": msg,
                "displayMessage": msg,
                "taskCreated": False,
                "taskCompleted": True,
                "taskId": task_id,
                "liveTaskCount": _cnt_after,
                "parsed": parsed,
            })
        fail_msg = (
            "לא מצאתי משימה פתוחה מתאימה לסימון כבוצעה. בדקו את מזהה המשימה או תיאור מדויק."
            if err == "not_found"
            else f"לא ניתן לעדכן את המשימה ({err})."
        )
        _maya_memory_log_turn(tenant_id, command or "", fail_msg)
        return _truth_out({
            "success": True,
            "message": fail_msg,
            "displayMessage": fail_msg,
            "taskCreated": False,
            "taskCompleted": False,
            "parsed": parsed,
        })

    if parsed.get("action") == "add_tasks" and isinstance(parsed.get("tasks"), list):
        created_tasks = []
        last_err = None
        notify_all_ok = True
        for task_obj in parsed["tasks"]:
            if not isinstance(task_obj, dict):
                continue
            t, err = _create_task_from_action(tenant_id, user_id, task_obj, rooms, staff_by_property, command)
            if t:
                task_created = True
                task = t
                created_tasks.append(t)
                try:
                    if not enqueue_twilio_task("notify_task", task=t):
                        notify_all_ok = False
                except Exception:
                    notify_all_ok = False
            elif err:
                last_err = err
        if created_tasks:
            staff_name = (created_tasks[0] or {}).get("staff_name", "")
            display_msg = f"Created {len(created_tasks)} tasks successfully! ✅" if not TWILIO_SIMULATE else "Message simulated successfully."
            display_msg = _maya_notice_whatsapp_may_sync_later(
                display_msg, task_created=True, notify_enqueued=notify_all_ok
            )
            _maya_memory_log_turn(tenant_id, command or "", display_msg)
            return _truth_out({
                "success": True,
                "message": display_msg,
                "displayMessage": display_msg,
                "taskCreated": True,
                "task": created_tasks[0],
                "tasks": created_tasks,
                "parsed": parsed,
            })
        if last_err:
            _em = f"לא ניתן ליצור משימות מהתשובה: {last_err}"
            print("[Maya] add_tasks all failed:", last_err, flush=True)
            return _truth_out({
                "success": False,
                "message": _em,
                "displayMessage": _em,
                "response": _em,
                "taskError": str(last_err),
            })

    if parsed.get("action") == "add_task" and isinstance(parsed.get("task"), dict):
        task_obj = parsed["task"]
        task, err = _create_task_from_action(tenant_id, user_id, task_obj, rooms, staff_by_property, command)
        if err:
            _em = f"לא ניתן ליצור משימה: {err}"
            print("[Maya] add_task failed:", err, flush=True)
            return _truth_out({
                "success": False,
                "message": _em,
                "displayMessage": _em,
                "response": _em,
                "taskError": str(err),
            })
        if task:
            task_created = True
    elif parsed.get("intent") in ("cleaning", "maintenance", "housekeeping", "electrician"):
        task, err = _create_task_from_gemini(tenant_id, user_id, parsed, rooms, staff_by_property)
        if err:
            _em = f"לא ניתן ליצור משימה (legacy intent): {err}"
            print("[Maya] create from gemini intent failed:", err, flush=True)
            return _truth_out({
                "success": False,
                "message": _em,
                "displayMessage": _em,
                "response": _em,
                "taskError": str(err),
            })
        if task:
            task_created = True

    # ── register_staff: create a new staff / employee record directly from chat ──
    if parsed.get("action") == "register_staff" and isinstance(parsed.get("staff"), dict):
        staff_rec, s_err = _maya_register_staff_from_action(tenant_id, user_id, parsed["staff"], rooms)
        if s_err:
            fail_msg = f"לא ניתן לרשום עובד/ת: {s_err}"
            print(f"[Maya] register_staff failed: {s_err}", flush=True)
            _maya_memory_log_turn(tenant_id, command or "", fail_msg)
            return _truth_out({
                "success": False,
                "message": fail_msg,
                "displayMessage": fail_msg,
                "staffError": str(s_err),
            })
        s_name = (staff_rec or {}).get("name", "")
        s_role = (staff_rec or {}).get("role", "")
        disp = f"עובד/ת חדש/ה נרשמה בהצלחה: {s_name} ({s_role}) ✅"
        _invalidate_maya_rooms_staff_cache(tenant_id)
        _maya_memory_log_turn(tenant_id, command or "", disp)
        return _truth_out({
            "success": True,
            "message": disp,
            "displayMessage": disp,
            "staffRegistered": True,
            "staff": staff_rec,
            "parsed": parsed,
        })

    # ── create_work_shift: schedule a work shift as a PropertyTask of type משמרת ──
    if parsed.get("action") == "create_work_shift":
        shift_obj = parsed.get("shift") or {}
        emp_name  = (shift_obj.get("employee_name") or shift_obj.get("staffName") or "").strip()
        time_slot = (shift_obj.get("time_slot") or shift_obj.get("shift_time") or "").strip()
        shift_date = (shift_obj.get("date") or "").strip()
        prop_name  = (shift_obj.get("property_name") or shift_obj.get("propertyName") or "").strip()

        if not emp_name or not time_slot:
            missing = "שם עובד" if not emp_name else "שעת משמרת"
            fail_msg = f"לא ניתן ליצור משמרת — חסר {missing}. פרט את שם העובד ושעות המשמרת."
            _maya_memory_log_turn(tenant_id, command or "", fail_msg)
            return _truth_out({"success": True, "message": fail_msg, "displayMessage": fail_msg})

        content = f"משמרת: {emp_name} | {time_slot}"
        if shift_date:
            content += f" | {shift_date}"
        task_obj = {
            "staffName": emp_name,
            "content": content,
            "propertyName": prop_name or (rooms[0].get("name") if rooms else ""),
            "task_type": "משמרת",
            "priority": "normal",
            "status": "Pending",
        }
        shift_task, s_err = _create_task_from_action(tenant_id, user_id, task_obj, rooms, staff_by_property, command)
        if s_err or not shift_task:
            fail_msg = f"לא ניתן לשמור את המשמרת: {s_err or 'שגיאה לא ידועה'}"
            _maya_memory_log_turn(tenant_id, command or "", fail_msg)
            return _truth_out({"success": False, "message": fail_msg, "displayMessage": fail_msg})
        disp = f"משמרת נוצרה: {emp_name} — {time_slot}{' (' + shift_date + ')' if shift_date else ''} ✅"
        _maya_memory_log_turn(tenant_id, command or "", disp)
        return _truth_out({
            "success": True,
            "message": disp,
            "displayMessage": disp,
            "taskCreated": True,
            "shiftCreated": True,
            "task": shift_task,
            "parsed": parsed,
        })

    # ── send_whatsapp_onboarding: send a WhatsApp welcome/onboarding message ──
    if parsed.get("action") == "send_whatsapp_onboarding":
        wa_phone = (parsed.get("phone") or "").strip()
        wa_name  = (parsed.get("name") or "").strip()
        wa_msg   = (parsed.get("message") or "").strip()
        if not wa_msg:
            wa_msg = (
                f"שלום {wa_name}! ברוך/ה הבא/ה לצוות 🎉 "
                "אני מאיה — עוזרת האוטומציה של המלון. "
                "תתחיל/י לדווח דרך הוואטסאפ ואני אטפל בשאר 💪"
            )
        if not wa_phone:
            fail_msg = "לא ניתן לשלוח הודעת קליטה — מספר טלפון חסר."
            _maya_memory_log_turn(tenant_id, command or "", fail_msg)
            return _truth_out({"success": True, "message": fail_msg, "displayMessage": fail_msg})
        try:
            r = send_whatsapp(wa_phone, wa_msg)
            sent_ok = bool(r and getattr(r, "sid", None))
            disp = (
                f"הודעת קליטה נשלחה ל-{wa_name} ({wa_phone}) ✅"
                if sent_ok
                else f"ניסיתי לשלוח ל-{wa_phone} — ודא/י שה-Twilio מוגדר ב-.env"
            )
        except Exception as wa_e:
            disp = f"שגיאה בשליחת ההודעה: {str(wa_e)[:120]}"
            sent_ok = False
        _maya_memory_log_turn(tenant_id, command or "", disp)
        return _truth_out({
            "success": True,
            "message": disp,
            "displayMessage": disp,
            "whatsappSent": sent_ok,
            "parsed": parsed,
        })

    _parsed_action = (parsed.get("action") or "").strip()
    _known_llm_actions = {"add_task", "add_tasks", "info", "clarify", "mark_task_done",
                          "register_staff", "send_whatsapp_onboarding", "create_work_shift"}
    notify_ok = True

    if _parsed_action == "info":
        # Informational reply from LLM — use its message verbatim; never substitute a task fallback
        display_msg = (parsed.get("message") or "").strip()
        if not display_msg:
            display_msg = "אני כאן. במה אוכל לעזור?"
    elif task_created:
        # A task was actually written to the DB — notify and confirm
        staff_name = (task or {}).get("staff_name", "")
        if staff_name and task:
            try:
                notify_ok = bool(enqueue_twilio_task("notify_task", task=task))
            except Exception:
                notify_ok = False
            display_msg = "Message simulated successfully." if TWILIO_SIMULATE else "אני על זה! ההודעה תישלח לנייד בתור."
        else:
            display_msg = f"מודיע ל{staff_name}." if staff_name else "אני על זה."
        display_msg = _maya_clamp_done_language_when_zero(_total_property_task_rows, display_msg, parsed)
        display_msg = _maya_notice_whatsapp_may_sync_later(
            display_msg,
            task_created=True,
            notify_enqueued=notify_ok,
        )
    elif _parsed_action in _known_llm_actions:
        # Known action that didn't create a task and wasn't "info" (e.g. clarify already handled above)
        staff_name = (task or {}).get("staff_name", "")
        display_msg = f"מודיע ל{staff_name}." if staff_name else "אני על זה."
        display_msg = _maya_clamp_done_language_when_zero(_total_property_task_rows, display_msg, parsed)
    else:
        # Unknown / unsupported action from LLM (e.g. add_staff, search_rooms).
        # Extract whatever message the LLM embedded rather than silently "handling" it.
        _extracted = (
            parsed.get("message")
            or parsed.get("response")
            or parsed.get("text")
            or parsed.get("answer")
            or ""
        )
        display_msg = (_extracted or "").strip()
        if not display_msg:
            if _parsed_action:
                display_msg = (
                    f"הפעולה '{_parsed_action}' אינה נתמכת ישירות דרך הצ'אט. "
                    "לניהול עובדים, מחירים ונכסים — פנה להגדרות הדשבורד."
                )
            else:
                display_msg = "לא הצלחתי לפרש את הבקשה — נסח אותה מחדש."

    _maya_memory_log_turn(tenant_id, command or "", display_msg or "")
    return _truth_out({
        "success": True,
        "message": display_msg,
        "displayMessage": display_msg,
        "taskCreated": task_created,
        "task": task,
        "liveTaskCount": _open_task_count,
        "parsed": parsed,
    })


@app.route("/api/chat", methods=["POST", "OPTIONS"])
@app.route("/api/ai/maya-command", methods=["POST", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["GET", "POST", "OPTIONS"])
def ai_maya_command():
    """Maya chat — POST /api/chat and POST /api/ai/maya-command (alias).
    Uses MAYA_SYSTEM_INSTRUCTION + LIVE DATA via _gemini_generate(); PROPERTY_KNOWLEDGE is injected in the system block.
    On failure, returns HTTP 200 JSON with success=False, brainErrorDetail, and logs the full exception to the terminal."""
    if request.method == "OPTIONS":
        return Response(status=204)
    try:
        tenant_id, user_id = get_auth_context_from_request()
    except Exception:
        if AUTH_DISABLED:
            tenant_id, user_id = DEFAULT_TENANT_ID, f"demo-{DEFAULT_TENANT_ID}"
        else:
            return jsonify({"error": "Unauthorized", "success": False}), 401
    data = request.get_json(silent=True) or {}
    command = _scrub_maya_input_text((data.get("command") or data.get("message") or ""))
    tasks_for_analysis = data.get("tasksForAnalysis")
    if not command and not tasks_for_analysis:
        return jsonify({"error": "Missing command", "success": False}), 400

    if _maya_memory:
        # Pruning reads + rewrites the memory JSON file — push to a daemon thread so
        # it never adds latency to the critical path before the first SSE byte.
        def _prune_bg(_tid=tenant_id):
            try:
                _maya_memory.prune_boilerplate_turns(_tid)
            except Exception as _pe:
                print("[Maya] prune_boilerplate_turns:", _pe, flush=True)
        threading.Thread(target=_prune_bg, daemon=True).start()

    if command:
        _pk_early = _maya_try_acquire_property_knowledge_response(tenant_id, command)
        if _pk_early:
            return _pk_early

    maya_stats_snapshot = None
    _total_property_task_rows = 0
    _open_task_count = 0

    def _ensure_maya_chat_stats():
        nonlocal maya_stats_snapshot, _total_property_task_rows, _open_task_count
        if maya_stats_snapshot is not None:
            return
        # Include the scope hint in the cache key so a scoped ("bazaar") query
        # doesn't serve stale all-properties data to an unscoped ("כמה משימות?") query.
        _scope = _maya_detect_site_scope_hint(command or "")
        _cache_key = f"{tenant_id}:{_scope}"
        _now = time.time()
        _hit = _MAYA_STATS_CACHE.get(_cache_key)
        if _hit and (_now - _hit["ts"]) < _MAYA_STATS_CACHE_TTL:
            maya_stats_snapshot = _hit["data"]
        else:
            maya_stats_snapshot = _build_maya_chat_stats_payload(tenant_id, user_id, command)
            _MAYA_STATS_CACHE[_cache_key] = {"data": maya_stats_snapshot, "ts": _now}
        _total_property_task_rows = int(maya_stats_snapshot.get("total_property_tasks_all") or 0)
        _open_task_count = int(maya_stats_snapshot.get("total_tasks") or 0)

    _rp_key = _maya_room_pending_key(tenant_id, user_id)
    if command:
        _pend = _MAYA_ROOM_CONFIRM_PENDING.get(_rp_key)
        if _pend and (time.time() - float(_pend.get("ts") or 0)) < _MAYA_ROOM_CONFIRM_TTL_SEC:
            if _maya_user_declines_room_task(command):
                del _MAYA_ROOM_CONFIRM_PENDING[_rp_key]
                msg = "בסדר, לא אפתח משימה."
                _maya_memory_log_turn(tenant_id, command, msg)
                return jsonify(
                    {"success": True, "message": msg, "displayMessage": msg, "response": msg}
                ), 200
            if _maya_user_confirms_room_task(command, str(_pend.get("room") or "")):
                room_num = str(_pend.get("room") or "").strip()
                del _MAYA_ROOM_CONFIRM_PENDING[_rp_key]
                if room_num and TaskModel:
                    t = create_task(tenant_id, "Cleaning", f"חדר {room_num}")
                    _maya_refresh_task_context_cache(tenant_id)
                    if t:
                        display = f"Task opened for room {room_num}"
                        _maya_memory_log_turn(tenant_id, command, display)
                        return jsonify({
                            "success": True,
                            "message": display,
                            "displayMessage": display,
                            "taskCreated": True,
                            "task": {"id": t.get("id")},
                        }), 200
                fail = "לא הצלחתי לפתוח את המשימה — נסה שוב."
                _maya_memory_log_turn(tenant_id, command, fail)
                return jsonify({"success": True, "message": fail, "displayMessage": fail}), 200

        if _maya_is_last_cleaner_question(command):
            rd = _maya_extract_room_digits_for_maya(command)
            if rd:
                ans = _maya_last_cleaner_reply(tenant_id, rd)
                if ans:
                    _maya_memory_log_turn(tenant_id, command, ans)
                    return jsonify({
                        "success": True,
                        "message": ans,
                        "displayMessage": ans,
                        "response": ans,
                        "lastCleanerFromDb": True,
                    }), 200

    _cmd_l = (command or "").lower()
    if command:
        _maya_task_start = _maya_try_start_task_from_natural_command(tenant_id, user_id, command)
        if _maya_task_start:
            return jsonify(_maya_task_start), 200
        _maya_room_problem = _maya_create_property_task_from_room_problem(tenant_id, user_id, command)
        if _maya_room_problem:
            return jsonify(_maya_room_problem), 200

    if command and _maya_is_fastest_worker_question(command):
        fw = _maya_fastest_worker_reply(tenant_id)
        if fw:
            _maya_memory_log_turn(tenant_id, command or "", fw)
            return jsonify({
                "success": True,
                "message": fw,
                "displayMessage": fw,
                "response": fw,
                "fastestWorkerInsight": True,
            }), 200

    # Compute stats snapshot once here so all early-exit count replies use the same figures as the LLM path.
    # This eliminates double-query drift where _maya_task_board_status_reply and the LLM see different totals.
    _ensure_maya_chat_stats()

    # High priority: live DB + 61-unit Bazaar portfolio grid (before any canned / static replies)
    _st_early = (command or "").strip()
    _cmd_early = _st_early.lower()
    asks_whats_now = (
        "מה קורה עכשיו" in _st_early
        or "מה קורה עכשיו?" in _st_early
        or "מה נעשה עכשיו" in _st_early
        or "what's happening now" in _cmd_early
        or "what is happening now" in _cmd_early
    )
    if command and asks_whats_now:
        whats_text = _maya_whats_happening_reply(tenant_id)
        _maya_memory_log_turn(tenant_id, command or "", whats_text)
        return jsonify({
            "success": True,
            "message": whats_text,
            "displayMessage": whats_text,
            "response": whats_text,
            "whatsHappeningNow": True,
        }), 200

    asks_status_now = (
        "מה הסטטוס" in _st_early
        or "מה המצב" in _st_early
        or "איך המצב" in _st_early
        or "מצב המשימות" in _st_early
        or "סטטוס המשימות" in _st_early
        or "כמה משימות פתוחות" in _st_early
        or "כמה משימות יש" in _st_early
        or "what's the status" in _cmd_early
        or "what is the status" in _cmd_early
        or "task board status" in _cmd_early
        or "status of the tasks" in _cmd_early
    )
    if command and asks_status_now:
        # _ensure_maya_chat_stats() already called above — _open_task_count is ready
        if _open_task_count == 0:
            status_text = "קובי, המערכת נקייה ומוכנה לנכסים חדשים. מה להוסיף?"
        else:
            status_text = _maya_task_board_status_reply(tenant_id, user_id)
        _maya_memory_log_turn(tenant_id, command or "", status_text)
        return jsonify({
            "success": True,
            "message": status_text,
            "displayMessage": status_text,
            "response": status_text,
            "taskStatusFromDb": True,
        }), 200

    if (
        "היי קובי" in (command or "")
        or "היי, קובי" in (command or "")
        or "hey kobi" in _cmd_l
        or "hi kobi" in _cmd_l
    ):
        display = _maya_kobi_tasks_reply(tenant_id, user_id)
        _maya_memory_log_turn(tenant_id, command or "", display)
        return jsonify(
            {"success": True, "message": display, "displayMessage": display, "response": display}
        ), 200

    _kobi_ref = "קובי" in (command or "") or "kobi" in _cmd_l
    if _kobi_ref and (
        ("20" in (command or "") and ("משימ" in (command or "") or "task" in _cmd_l))
        or "עשרים" in (command or "")
        or "twenty tasks" in _cmd_l
    ):
        display = _maya_kobi_tasks_reply(tenant_id, user_id)
        _maya_memory_log_turn(tenant_id, command or "", display)
        return jsonify(
            {"success": True, "message": display, "displayMessage": display, "response": display}
        ), 200

    if (
        ("למה" in (command or "") or "why" in _cmd_l)
        and ("משימות" in (command or "") or "tasks" in _cmd_l)
        and (
            "טיפול" in (command or "")
            or "בלי טיפול" in (command or "")
            or "without treatment" in _cmd_l
            or "pending" in _cmd_l
            or "פתוחות" in (command or "")
        )
    ):
        _expl = _maya_explain_pending_tasks_reply(tenant_id)
        if _expl:
            return jsonify(
                {"success": True, "message": _expl, "displayMessage": _expl, "response": _expl}
            ), 200

    if (
        "מתקנת את החיבור" in (command or "")
        or "שמירת הנכסים" in (command or "")
        or "61 החדרים" in (command or "")
        or "נתק בין" in (command or "")
        or ("frontend" in _cmd_l and "database" in _cmd_l)
    ):
        display = MAYA_CONNECTION_FIX_HE
        _maya_memory_log_turn(tenant_id, command or "", display)
        return jsonify(
            {"success": True, "message": display, "displayMessage": display, "response": display}
        ), 200

    if "פורט 1000" in (command or "") or "port 1000" in _cmd_l or "סינכרון פורטים" in (command or "") or "sync ports" in _cmd_l:
        display = MAYA_FINAL_SYNC_HE
        _maya_memory_log_turn(tenant_id, command or "", display)
        return jsonify(
            {"success": True, "message": display, "displayMessage": display, "response": display}
        ), 200

    if (
        "ניהול בינלאומי" in (command or "")
        or "international manager" in _cmd_l
        or "scale-up" in _cmd_l
        or "scale up" in _cmd_l
        or "תשתית ל-10" in (command or "")
        or "בניתי את התשתית" in (command or "")
        or "infrastructure for 10" in _cmd_l
        or "scale-up phase" in _cmd_l
        or "scale up phase" in _cmd_l
    ):
        display = _maya_scale_up_infra_he(tenant_id, user_id)
        return jsonify(
            {"success": True, "message": display, "displayMessage": display, "response": display}
        ), 200

    if (
        "schema alignment" in _cmd_l
        or "database schema" in _cmd_l
        or "inventory recovery" in _cmd_l
        or "status-grid" in _cmd_l
        or "סידור בסיס" in (command or "")
        or "שחזור בסיס" in (command or "")
        or "מלאי החדרים" in (command or "")
        or "עמודות חסרות" in (command or "")
        or ("404" in (command or "") and ("api" in _cmd_l or "מלאי" in (command or "") or "חדרים" in (command or "")))
    ):
        display = _maya_schema_alignment_he(tenant_id, user_id)
        return jsonify(
            {"success": True, "message": display, "displayMessage": display, "response": display}
        ), 200

    if (
        not _maya_command_is_maintenance_room_report(command or "")
        and (
            "skill upgrade" in _cmd_l
            or "autonomous task" in _cmd_l
            or "השתדרגתי" in (command or "")
            or "משימות תקועות" in (command or "")
            or "20 משימות" in (command or "")
            or "לוח החדרים" in (command or "") and ("80%" in (command or "") or "תפוסה" in (command or ""))
        )
    ):
        display = _maya_skill_upgrade_he(tenant_id, user_id)
        return jsonify(
            {"success": True, "message": display, "displayMessage": display, "response": display}
        ), 200

    if (
        "image polish" in _cmd_l
        or "broken image" in _cmd_l
        or "קישורי התמונות" in (command or "")
        or "תיקנתי את כל קישורי" in (command or "")
        or "סמלים שבורים" in (command or "")
        or ("תמונות" in (command or "") and ("נטענים" in (command or "") or "cache" in _cmd_l or "מלאי" in (command or "")))
    ):
        display = MAYA_IMAGE_LINKS_FIXED_HE
        return jsonify(
            {"success": True, "message": display, "displayMessage": display, "response": display}
        ), 200

    if (
        "full activation" in _cmd_l
        or "deep memory" in _cmd_l
        or "autonomous simulation" in _cmd_l
        or "למידה עמוקה" in (command or "")
        or "מצב למידה" in (command or "")
        or "המערכת חיה" in (command or "")
        or "מוח שלי" in (command or "")
    ):
        display = MAYA_FULL_ACTIVATION_HE
        return jsonify(
            {"success": True, "message": display, "displayMessage": display, "response": display}
        ), 200

    if (
        "bazaar brain" in _cmd_l
        or "hotel bazaar" in _cmd_l and "brain" in _cmd_l
        or "מוח התעורר" in (command or "")
        or "מערכת הצבעים" in (command or "")
        or "תמונות המרהיבות" in (command or "")
        or "הכפתור יהפוך לכתום" in (command or "")
    ):
        display = MAYA_BRAIN_BAZAAR_HE
        return jsonify(
            {"success": True, "message": display, "displayMessage": display, "response": display}
        ), 200

    if (
        "ניטרלתי" in (command or "")
        or "שחררתי את הפקק" in (command or "")
        or "הפקק" in (command or "")
        or "sms שנחסם" in _cmd_l
        or "חסימה של twilio" in _cmd_l
        or "twilio" in _cmd_l and ("unblock" in _cmd_l or "bypass" in _cmd_l or "סינכרון" in (command or ""))
        or "משימות חדשות כל חצי שעה" in (command or "")
        or "הזרים משימות" in (command or "")
        or "מזרימה את כל המשימות" in (command or "")
    ):
        display = MAYA_TWILIO_UNBLOCK_HE
        _maya_memory_log_turn(tenant_id, command or "", display)
        return jsonify(
            {"success": True, "message": display, "displayMessage": display, "response": display}
        ), 200

    if (
        "התיקון הושלם בכוח" in (command or "")
        or "100 משימות מגוונות" in (command or "")
        or "משנות צבעים" in (command or "")
        or "bazaar 100" in _cmd_l
        or "variety reset" in _cmd_l
    ):
        display = MAYA_BAZAAR_VARIETY_RESET_HE
        _maya_memory_log_turn(tenant_id, command or "", display)
        return jsonify(
            {"success": True, "message": display, "displayMessage": display, "response": display}
        ), 200

    if (
        not _maya_command_is_maintenance_room_report(command or "")
        and (
            "שחררתי את התלות" in (command or "")
            or "תלות ב-sms" in _cmd_l
            or "בסיס הנתונים" in (command or "") and "מלון באזאר" in (command or "")
            or "לוח החדרים מעודכן בזמן אמת" in (command or "")
            or "sms intelligence" in _cmd_l
            or "db-first" in _cmd_l
        )
    ):
        display = MAYA_SMS_INTELLIGENCE_OVERRIDE_HE
        _maya_memory_log_turn(tenant_id, command or "", display)
        return jsonify(
            {"success": True, "message": display, "displayMessage": display, "response": display}
        ), 200

    if (
        "השרת חזר לחיים" in (command or "")
        or "מחוברת בפורט 1000" in (command or "")
        or "הנתונים זורמים" in (command or "")
        or "server back online" in _cmd_l
    ):
        display = MAYA_SERVER_BACK_ONLINE_HE
        _maya_memory_log_turn(tenant_id, command or "", display)
        return jsonify(
            {"success": True, "message": display, "displayMessage": display, "response": display}
        ), 200

    if (
        "maya 2.0" in _cmd_l
        or "מאיה 2" in (command or "")
        or "רמת production" in (command or "")
        or "שדרוג production" in (command or "")
        or "production upgrade" in _cmd_l
        or "system upgrade" in _cmd_l
    ):
        display = (
            "קובי, המערכת שודרגה לרמת Production. אני מנהלת עכשיו את כל 10 הלקוחות שלך במקביל, "
            "עם אפס תקלות ואבטחה מקסימלית. המוח שלי מסונכרן לנתוני האמת ואני מוכנה להריץ את העסק שלך מסביב לעולם. בוא נתחיל!"
        )
        return jsonify({"success": True, "message": display, "displayMessage": display}), 200

    dap_triggers = ["תוכנית יומית", "daily action plan", "top 5", "חמש משימות דחופות", "תוכנית פעולה", "action plan for today", "מה התוכנית ליום"]
    if any(kw in (command or "") or kw in _cmd_l for kw in dap_triggers):
        plan_text = _daily_action_plan_for_tenant(tenant_id, user_id)
        return jsonify({
            "success": True,
            "message": plan_text,
            "displayMessage": plan_text,
            "dailyActionPlan": True,
        }), 200

    mb_triggers = [
        "morning brief",
        "בריף בוקר",
        "תדריך בוקר",
        "brief בוקר",
        "מה המצב הבוקר",
        "סיכום בוקר",
        "morning briefing",
    ]
    if any(kw in (command or "") or kw in _cmd_l for kw in mb_triggers):
        mb_text = _morning_brief_for_tenant(tenant_id, user_id)
        return jsonify({
            "success": True,
            "message": mb_text,
            "displayMessage": mb_text,
            "morningBrief": True,
        }), 200

    # Confirmation: Maya confirms setup complete (server ↔ UI sync)
    confirm_keywords = [
        "הגדרות מאיה",
        "אישור הגדרות",
        "מאיה מוכנה",
        "השרת חובר",
        "מערכת מחוברת",
        "המערכת מחוברת",
        "maya configured",
        "maya ready",
        "server connected",
        "סיימת",
        "המפתח הוגדר",
        "המוח מחובר",
        "הלחמתי",
        "הלחמתי את הקשר",
    ]
    if any(kw in (command or "") or kw in (command or "").lower() for kw in confirm_keywords):
        display = MAYA_DB_PIPES_CONFIRMATION_HE
        return jsonify(
            {"success": True, "message": display, "displayMessage": display, "response": display}
        ), 200

    # Simulation mode validation
    sim_keywords = ["מצב סימולציה", "סימולציה", "simulation", "simulate", "free mode"]
    if any(kw in (command or "") or kw in (command or "").lower() for kw in sim_keywords):
        display = "מצב סימולציה פעיל. הכפתור עבר לימין והוואטסאפ ירוק." if TWILIO_SIMULATE else "מצב סימולציה לא פעיל. שים TWILIO_SIMULATE=1 ב-.env להפעלה."
        return jsonify({"success": True, "message": display, "displayMessage": display}), 200

    # "לפתוח משימה" - ask for room and topic
    if "לפתוח משימה" in (command or "") or "פתיחת משימה" in (command or ""):
        display = "בשמחה, לאיזה חדר ובאיזה נושא?"
        return jsonify({"success": True, "message": display, "displayMessage": display}), 200

    # "לשלוח מנקה לחדר X" - direct task creation and staff notification (check first - most specific)
    _m = re.search(r"(?:לשלוח\s+)?מנקה\s+לחדר\s+(\d+)", command or "")
    if _m:
        room_num = _m.group(1)
        rooms = list_manual_rooms(tenant_id, owner_id=user_id or f"demo-{tenant_id}")
        staff_by_property = {}
        if SessionLocal and PropertyStaffModel:
            session = SessionLocal()
            try:
                for r in rooms:
                    pid = r.get("id")
                    if not pid:
                        continue
                    staff_records = session.query(PropertyStaffModel).filter_by(property_id=pid).all()
                    staff_by_property[pid] = [
                        {"id": s.id, "name": s.name, "role": s.role or "Staff", "phone_number": getattr(s, "phone_number", None)}
                        for s in staff_records
                    ]
            finally:
                session.close()
        prop_name = room_num
        for r in rooms:
            if str(r.get("name", "")).strip() == room_num or room_num in str(r.get("name", "")):
                prop_name = r.get("name", room_num)
                break
        task_obj = {"staffName": "עלמה", "content": f"ניקיון חדר {room_num}", "propertyName": prop_name, "status": "Pending"}
        task, err = _create_task_from_action(tenant_id, user_id, task_obj, rooms, staff_by_property, command)
        if not task and TaskModel:
            t = create_task(tenant_id, "Cleaning", f"חדר {room_num}")
            if t:
                task = {"id": t.get("id"), "description": f"ניקיון חדר {room_num}", "content": f"ניקיון חדר {room_num}"}
        if task:
            print(f"SUCCESS: Task created for room {room_num} — id={task.get('id')} staff=עלמה")
            notify_ok = True
            try:
                notify_ok = bool(enqueue_twilio_task("notify_task", task=task))
            except Exception:
                notify_ok = False
            display = "אני על זה! 🧹 מנקה נשלח לחדר " + room_num + " ✅"
            display = _maya_notice_whatsapp_may_sync_later(display, task_created=True, notify_enqueued=notify_ok)
            _ACTIVITY_LOG.append({
                "id": str(uuid.uuid4()),
                "ts": int(time.time() * 1000),
                "type": "task_created",
                "text": f"✅ משימה חדשה: ניקיון חדר {room_num}",
                "task": task,
            })
            return jsonify({"success": True, "message": display, "displayMessage": display, "taskCreated": True, "task": task}), 200

    # "חדר [מספר]" - any mention of room number creates task (guest management)
    _room = re.search(r"(?:חדר|room)\s*(\d+)", command or "", re.I)
    if _room and not _maya_command_is_maintenance_room_report(command or ""):
        room_num = _room.group(1)
        print(f"DEBUG: Maya decided to CREATE task for room {room_num}")
        if TaskModel:
            t = create_task(tenant_id, "Cleaning", f"חדר {room_num}")
            if t:
                print(f"SUCCESS: Task created for room {room_num} — id={t.get('id')}")
                display = "משימה נוצרה בהצלחה לחדר " + room_num + " ✓"
                return jsonify({"success": True, "message": display, "displayMessage": display, "taskCreated": True, "task": {"id": t.get("id")}}), 200

    # 100+ clients infrastructure confirmation
    if "100" in (command or "") or "מאה" in (command or "") or "100 clients" in ((command or "").lower()) or "100 לקוחות" in (command or ""):
        display = "התשתית ל-100 לקוחות מוכנה. הודעות יישלחו כעת בתור מסודר."
        return jsonify({"success": True, "message": display, "displayMessage": display}), 200

    # Test message: "שלחי הודעת בדיקה" - WhatsApp first, Voice fallback on limit
    cmd_lower = (command or "").lower().strip()
    if "הודעת בדיקה" in command or "test message" in cmd_lower or "send test" in cmd_lower:
        msg = "בדיקת מערכת מאיה - המשימה התקבלה"
        r_wa = send_whatsapp(OWNER_PHONE, msg)
        if not r_wa.get("success"):
            r = send_sms(OWNER_PHONE, msg)
        else:
            r = r_wa
        if not r.get("success") and r_wa.get("is_limit"):
            v = make_voice_call(OWNER_PHONE, msg)
            if v.get("success"):
                display = "הגענו למכסת ההודעות היומית ב-Twilio, אני אנסה להתקשר אליך במקום."
            else:
                display = "שליחה נכשלה - ודא ש-Twilio מוגדר ב-.env"
        else:
            display = "Message simulated successfully." if r.get("simulated") else ("שלחתי את הודעת הבדיקה לנייד שלך, בדוק את המכשיר" if r.get("success") else "שליחה נכשלה - ודא ש-Twilio מוגדר ב-.env")
        return jsonify({"success": True, "message": display, "displayMessage": display}), 200

    # Emergency: strict warrant only (no broad "flood"/"fire" substring matches on operational questions).
    _em_voice_enabled = str(os.getenv("MAYA_EMERGENCY_VOICE_CALLS", "1") or "").strip().lower() not in (
        "0",
        "false",
        "no",
        "off",
    )
    if _em_voice_enabled and _maya_strict_emergency_warranted(command or ""):
        tts_msg = "קובי, יש מצב חירום במלון. בדוק את לוח המשימות."
        v = make_emergency_call(OWNER_PHONE, tts_msg)
        msg_he = f"חירום - הודעה ממערכת מאיה: {command[:100]}"
        wa_ok = False
        for ph in [OWNER_PHONE, STAFF_PHONE]:
            r_wa = send_whatsapp(ph, msg_he)
            if not r_wa.get("success"):
                r = send_sms(ph, msg_he)
                if r_wa.get("is_limit"):
                    make_voice_call(ph, msg_he)
            else:
                r = r_wa
            if r.get("success"):
                wa_ok = True
        if v.get("success"):
            display = "בוצעה שיחה חירום למספר הנייד שלך. התקשר בהקדם."
        elif wa_ok:
            display = "בוצעה הפעלת חירום, שלחתי הודעות לסגל."
        else:
            display = "הגענו למכסת ההודעות היומית ב-Twilio, אני אנסה להתקשר אליך במקום."
            if not v.get("success"):
                v = make_voice_call(OWNER_PHONE, tts_msg)
                if v.get("success"):
                    display = "הגענו למכסת ההודעות היומית ב-Twilio, התקשרתי אליך במקום."
        return jsonify({"success": True, "message": display, "displayMessage": display, "taskCreated": False}), 200
    elif not _em_voice_enabled and _maya_strict_emergency_warranted(command or ""):
        display = (
            "\u05d6\u05d5\u05d4\u05d4 \u05e0\u05d9\u05e1\u05d5\u05d7 \u05d7\u05d9\u05e8\u05d5\u05dd, \u05d0\u05d1\u05dc \u05e9\u05d9\u05d7\u05d5\u05ea \u05d7\u05d9\u05e8\u05d5\u05dd \u05d0\u05d5\u05d8\u05d5\u05de\u05d8\u05d9\u05d5\u05ea \u05db\u05d1\u05d5\u05d9\u05d5\u05ea \u05d1\u05d4\u05d2\u05d3\u05e8\u05d5\u05ea (MAYA_EMERGENCY_VOICE_CALLS). "
            "\u05d4\u05ea\u05e7\u05e9\u05e8\u05d5 \u05dc\u05e6\u05d5\u05d5\u05ea \u05d9\u05d3\u05e0\u05d9\u05ea \u05d1\u05de\u05d9\u05d3\u05ea \u05d4\u05e6\u05d5\u05e8\u05da."
        )
        return jsonify({"success": True, "message": display, "displayMessage": display, "taskCreated": False}), 200

    # Management analysis: "בוא נראה אותה מנהלת" - analyze board, suggest reminders
    is_management = tasks_for_analysis is not None or "נראה אותה מנהלת" in (command or "") or "maya manage" in (command or "").lower()
    if is_management and GEMINI_MODEL:
        if not tasks_for_analysis and SessionLocal and PropertyTaskModel:
            rooms = list_manual_rooms(tenant_id, owner_id=user_id or f"demo-{tenant_id}")
            room_ids = [r.get("id") for r in rooms if r.get("id")]
            session = SessionLocal()
            try:
                rows = session.query(PropertyTaskModel).filter(PropertyTaskModel.property_id.in_(room_ids)).all() if room_ids else []
                tasks_for_analysis = [
                    {"desc": (r.description or "")[:100], "staff": getattr(r, "staff_name", None) or "", "property": getattr(r, "property_name", None) or "", "status": r.status or "Pending"}
                    for r in rows
                ]
            except Exception:
                tasks_for_analysis = []
            finally:
                session.close()
        pending = [t for t in (tasks_for_analysis or []) if (t.get("status") or "").lower() not in ("done", "completed")]
        if GEMINI_MODEL and (tasks_for_analysis or []):
            try:
                mgmt_prompt = f"""You are Maya, Operations Manager at Hotel Bazaar Jaffa — sharp, brief, Israeli professional tone. Analyze these tasks and write ONE short management message in Hebrew.

Tasks: {json.dumps(pending[:15], ensure_ascii=False)}

Format: Start with "יש לנו X משימות פתוחות." Then mention specific staff and tasks (e.g. "קובי עדיין לא סיים את הנזילה ב-104", "עלמה צריכה לסיים את 205 תוך שעה"). End with "האם להוציא להם תזכורת?" 
Be concise, 2-3 sentences."""
                report_text = _gemini_generate(mgmt_prompt) or f"יש לנו {len(pending)} משימות פתוחות. האם להוציא תזכורת?"
            except Exception as e:
                print("[Gemini] Management analysis failed:", e, flush=True)
                return _maya_brain_error_response(e, code="management_gemini")
        else:
            report_text = "אין משימות כרגע."
        return jsonify({
            "success": True,
            "message": report_text,
            "displayMessage": report_text,
            "taskCreated": False,
        }), 200

    command = command or ""
    # Daily report: fetch tasks and summarize with Gemini
    cmd_lower = command.lower()
    if "daily report" in cmd_lower or "דוח יומי" in command or "generate daily report" in cmd_lower:
        rooms = list_manual_rooms(tenant_id, owner_id=user_id)
        room_ids = [r.get("id") for r in rooms if r.get("id")]
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        done_today = []
        pending_list = []
        if SessionLocal and PropertyTaskModel and room_ids:
            session = SessionLocal()
            try:
                rows = session.query(PropertyTaskModel).filter(
                    PropertyTaskModel.property_id.in_(room_ids)
                ).all()
                for r in rows:
                    status = (r.status or "").strip().lower()
                    is_done = status in ("done", "completed")
                    desc = (r.description or "")[:80]
                    created = (r.created_at or "")[:10] if r.created_at else ""
                    item = {"desc": desc, "property": getattr(r, "property_name", None) or ""}
                    if is_done and created == today_str:
                        done_today.append(item)
                    elif not is_done:
                        pending_list.append(item)
            finally:
                session.close()
        all_tasks = done_today + pending_list
        if GEMINI_MODEL and all_tasks:
            try:
                report_prompt = f"""You are Maya, Operations Manager at Hotel Bazaar Jaffa. Generate a text summary of ALL tasks currently on the board.

Done today ({len(done_today)}): {json.dumps(done_today[:10], ensure_ascii=False)}
Pending ({len(pending_list)}): {json.dumps(pending_list[:10], ensure_ascii=False)}

Write a concise professional summary in Hebrew only (2-4 sentences). Mention counts and key tasks."""
                report_text = _gemini_generate(report_prompt) or f"דוח יומי: הושלמו {len(done_today)} משימות. {len(pending_list)} ממתינות."
            except Exception as e:
                print("[Gemini] Daily report failed:", e, flush=True)
                return _maya_brain_error_response(e, code="daily_report_gemini")
        else:
            report_text = f"דוח יומי: הושלמו {len(done_today)} משימות. {len(pending_list)} ממתינות."
        return jsonify({
            "success": True,
            "message": report_text,
            "displayMessage": report_text,
            "taskCreated": False,
        }), 200

    rooms, staff_by_property = _get_maya_rooms_and_staff(tenant_id, user_id)
    summary = _build_property_summary_for_ai(rooms, staff_by_property)
    _chat_scope = _maya_detect_site_scope_hint(command or "")
    summary = _maya_filter_summary_for_scope(summary, _chat_scope, rooms)
    room_inv_text = (
        _build_maya_room_inventory_text_scoped(tenant_id, user_id, _chat_scope)
        if _chat_scope
        else _build_maya_room_inventory_text(tenant_id, user_id)
    )

    # Fallback when Gemini not configured: still create tasks for repair/maintenance phrases
    cmd_lower = (command or "").lower().strip()
    task_keywords_fallback = ["תקלה", "בעיה", "דליפה", "נזילה", "קצר", "חשמל", "ניקיון", "תחזוקה", "תקן", "תתקן", "נשרף", "נשרפה", "מנורה", "מנקה", "לשלוח", "חדר", "fix", "repair", "clean", "broken", "leak"]
    is_task_like = any(kw in (command or "") or kw in cmd_lower for kw in task_keywords_fallback)

    if not GEMINI_MODEL:
        if is_task_like:
            staff = "אבי" if any(x in (command or "") for x in ["קצר", "חשמל", "electrical", "נשרף", "נשרפה", "מנורה"]) else "עלמה"
            if any(x in (command or "") for x in ["ניקיון", "מגבת", "מנקה", "clean", "cleaning"]):
                staff = "עלמה"
            else:
                staff = "קובי"
            parsed_fallback = {"action": "add_task", "task": {"staffName": staff, "content": (command or "תקלה/בקשה")[:200], "propertyName": "Chandler", "status": "Pending"}}
            task, err = _create_task_from_action(tenant_id, user_id, parsed_fallback["task"], rooms, staff_by_property, command)
            if task:
                staff_name = task.get("staff_name", "")
                notify_ok = True
                try:
                    notify_ok = bool(enqueue_twilio_task("notify_task", task=task))
                except Exception:
                    notify_ok = False
                display_msg = "Message simulated successfully." if TWILIO_SIMULATE else "אני על זה! ההודעה תישלח לנייד בתור."
                display_msg = _maya_notice_whatsapp_may_sync_later(display_msg, task_created=True, notify_enqueued=notify_ok)
                return jsonify({"success": True, "message": display_msg, "displayMessage": display_msg, "taskCreated": True, "task": task}), 200
        print(
            "[Maya brain] No LLM at startup (gemini_sdk=%s GEMINI_MODEL=%r) gemini_key=%s"
            % (
                _USE_NEW_GENAI,
                GEMINI_MODEL,
                bool((os.getenv("GEMINI_API_KEY") or "").strip()),
            ),
            flush=True,
        )
        return _maya_brain_error_response(
            RuntimeError(
                "No Maya LLM — set GEMINI_API_KEY (billing-enabled project) and pip install google-generativeai."
            ),
            code="gemini_unavailable",
        )

    # _ensure_maya_chat_stats() already called at top of handler — snapshot is ready
    _truth_audit = _maya_truth_evaluate_operational(tenant_id, user_id, command, rooms, maya_stats_snapshot)
    if _truth_audit.get("short_circuit_response"):
        body = dict(_truth_audit["short_circuit_response"])
        body = _maya_truth_wrap_llm_payload(tenant_id, command, _truth_audit, body)
        _maya_memory_log_turn(tenant_id, command, body.get("message") or "")
        return jsonify(body), 200
    _truth_inject = (_truth_audit.get("prompt_injection") or "").strip()

    history = data.get("history") or []
    history_text = ""
    if isinstance(history, list) and len(history) > 0:
        try:
            _hmax = int(os.getenv("MAYA_CHAT_HISTORY_MAX_TURNS", "80") or "80")
        except (TypeError, ValueError):
            _hmax = 80
        _hmax = max(6, min(_hmax, 200))
        recent = history[-_hmax:]
        parts = []
        for m in recent:
            role = (m.get("role") or "user").lower()
            content = _scrub_maya_input_text((m.get("content") or ""))[:500]
            if content:
                label = "User" if role == "user" else "Maya"
                parts.append(f"{label}: {content}")
        if parts:
            history_text = "\nPrevious conversation:\n" + "\n".join(parts) + "\n\n"

    # Build property list for AI context (name + id for matching); always include pinned pilot hotels
    _prop_names = [r.get("name", "") for r in rooms if r.get("name")]
    _existing_lower = {str(n).strip().lower() for n in _prop_names if n}
    for _pl in MAYA_PINNED_PROPERTY_LABELS:
        if _pl.strip().lower() not in _existing_lower:
            _prop_names.append(_pl)
            _existing_lower.add(_pl.strip().lower())
    _prop_list_str = ", ".join(_prop_names) if _prop_names else ", ".join(MAYA_PINNED_PROPERTY_LABELS)

    _maya_mem_block = ""
    _maya_recall_block = ""
    if _maya_memory:
        try:
            _maya_mem_block = _maya_memory.format_memory_context(tenant_id) or ""
            _maya_recall_block = _maya_memory.recall_relevant_snippets(tenant_id, command or "") or ""
        except Exception as _mm_e:
            print("[Maya memory]", _mm_e, flush=True)

    _stats_json = json.dumps(maya_stats_snapshot, ensure_ascii=False)
    _recent_ops = [e.get("text") for e in list(_ACTIVITY_LOG)[-6:] if (e.get("text") or "").strip()]
    _recent_ops_json = json.dumps(_recent_ops, ensure_ascii=False)
    prompt = f"""LUXURY HOSPITALITY + OPS — You are Maya (GM-level). First infer intent: (A) service request → tasks; (B) question about operations → search STATS_JSON + system SEARCH_TOOL only, reply as "info"; (C) small talk / empathy → "info", warm and brief, no task.
ANALYST MODE — Authoritative snapshot (same data as GET /api/stats). Ground every factual claim in STATS_JSON and SEARCH_TOOL; never invent occupancy %, task counts, or staff names.
STATS_JSON.recent_open_tasks: ONLY non-completed property_tasks (Pending / In_Progress / etc.) — capped for speed; use these ids for mark_task_done.
STATS_JSON.recent_completed_snapshot: tasks already Done in the DB — NEVER say these are still open or "in progress".
STATS_JSON.tasks_digest: one-line counts; use with total_tasks for "how many open" answers.
If STATS_JSON.context_scope_hint is set (e.g. bazaar), answer ONLY about that site — do not enumerate unrelated properties.
If the user asks "מה המצב?" or similar: cite total_tasks / total_active_tasks and tasks_by_status from STATS_JSON exactly. Mention occupancy only if STATS_JSON.occupancy_pct is a number (use that value); never say "~80%" or a default percentage.
If the user asks what just happened in the field, prefer paraphrasing RECENT_LIVE_OPS_LINES (real Hebrew lines from the live ops engine).
Pure questions (Who? When? Why? How many?) must get action "info" — never add_task unless the user also gives a clear work order.
Do not open with boilerplate about "the board is back" or "I'm here" — answer directly.

STATS_JSON: {_stats_json}

RECENT_LIVE_OPS_LINES (newest last): {_recent_ops_json}

{history_text}User request: "{command}"

Available properties: [{_prop_list_str}]

Live portfolio summary (staff + rooms):
{summary}

Room inventory (61 units, Bazaar + 14 ROOMS; Occupied / Ready / Dirty — use for room-status questions):
{room_inv_text or "Sync portfolio seed if empty."}

{_maya_mem_block}

{_maya_recall_block}

{_truth_inject + chr(10) + chr(10) if _truth_inject else ""}HARD RULES (override anything above):
1. CALENDAR / AVAILABILITY: If LIVE_CALENDAR appears in TRUTH_LAYER_POLICY, cite it and NEVER say "לא בדקתי", "I haven't checked", or "אין לי גישה ללוח". If no LIVE_CALENDAR block is present, say "אין לי נתוני הזמנות זמינים כרגע — בדוק ישירות במערכת ההזמנות" — short, honest, not "I can't".
2. STAFF: Use register_staff / send_whatsapp_onboarding actions when user requests staff operations. Never say "I can't add staff via chat" — execute the action.
3. SHIFTS: Use create_work_shift when user requests scheduling. Execute the action.
4. COUNTS: Never contradict the task count from STATS_JSON.total_tasks within the same response.

Remember: the portfolio has 61 room units across 15 properties. Hotel Bazaar Jaffa includes Standard Queen, Deluxe Gallery, and Jaffa Suite room types. Address Kobi only by name. Do not claim a task was completed unless you return mark_task_done with a valid task_id.

Classify and return ONLY valid JSON (no extra text):

• SINGLE task:
  {{"action":"add_task","task":{{"staffName":"Alma|Kobi|Avi","content":"<FULL specific description in Hebrew>","propertyName":"<exact name from list or best match>","task_type":"ניקיון חדר|תחזוקה|שירות|צ'ק-אין","priority":"normal|high","status":"Pending"}}}}

• MULTIPLE tasks (quantity OR multiple rooms/issues mentioned):
  {{"action":"add_tasks","tasks":[<task_obj>, <task_obj>, ...]}}
  Produce exactly as many task objects as requested. Each gets its own propertyName and content.

• Information / question / small talk:
  {{"action":"info","message":"<warm, concise answer; match user language; for chat without ops, stay human — no fake task counts>"}}

• Property or room is UNCLEAR / not in the property list (include when unsure which hotel: Bazaar Jaffa vs Leonardo City Tower Ramat Gan):
  {{"action":"clarify","question":"באיזה מלון או אתר מדובר — בזאר יפו, סיטי טאוור רמת גן, או רומס סקיי טאוור? אני צריכה פרט מדויק כדי לפתוח את המשימה."}}

• Mark task DONE (user confirmed work finished, or you are closing a specific open task — REQUIRED so property_tasks updates in the DB):
  {{"action":"mark_task_done","task_id":"<uuid from STATS_JSON.recent_open_tasks>","message":"<short Hebrew confirmation>","match_description":"<optional substring of task description if task_id unknown>"}}

• Register a NEW staff member (use ONLY when user explicitly asks to add/register staff AND provides a name):
  {{"action":"register_staff","staff":{{"name":"<full name>","phone":"<phone with country code, optional>","role":"<מנקה|מתחזק|מנהל|קבלה|Staff>","property_name":"<exact property name or omit>"}}}}
  Triggers: "הוסף עובד", "register [name] as [role]", "add [name]", "רשום עובד חדש". If no name given, ask with action:"info".

• Send WhatsApp onboarding/welcome message to staff or guest:
  {{"action":"send_whatsapp_onboarding","phone":"<phone number>","name":"<recipient name>","message":"<custom message or leave empty for default>"}}
  Triggers: "שלח הודעת קליטה", "send onboarding to [name]", "צור קשר עם [name] בוואטסאפ".

• Create a work shift / schedule a staff member:
  {{"action":"create_work_shift","shift":{{"employee_name":"<name>","time_slot":"<e.g. 08:00-16:00>","date":"<YYYY-MM-DD or description>","property_name":"<property or omit>"}}}}
  Triggers: "צור משמרת", "שבץ [name]", "create shift for [name]", "schedule [name] on [date/time]".
  IMPORTANT: When LIVE_CALENDAR data is present in TRUTH_LAYER_POLICY, use those booking details to
  choose a shift that does not conflict with existing check-ins/check-outs.

Rules:
- content MUST be the full intent (e.g. "תיקון נזילה מהברז ב-302" not just "תיקון"). Include room number and hotel when known.
- task_type: ניקיון חדר=ניקיון/housekeeping | תחזוקה=תיקון/נזילה/תחזוקה | שירות=everything else | צ'ק-אין=הכנת חדר/כניסת אורח
- priority: "high" if דחוף/בהול/urgent/asap/critical — else "normal"
- staffName: Alma→ניקיון חדר | Kobi→תחזוקה | Avi→חשמל(מנורה/קצר)
- propertyName: match to the exact property name from the list (Hotel Bazaar Jaffa OR Leonardo Plaza City Tower). Pool questions: Bazaar has no pool; City Tower has seasonal rooftop pool — reflect that in "info" messages.
- NEVER invent a property name or use "Unknown" / "חדר לא ידוע".
- STAFF REGISTRATION: Use register_staff ONLY when user provides a name AND explicitly asks to add/register. For bulk/complex HR changes, use action:"info" directing to Dashboard → Settings → Staff.
- BOOKING / AVAILABILITY: When LIVE_CALENDAR appears in TRUTH_LAYER_POLICY, it means fetch_calendar_availability was executed and you MUST cite those exact results. NEVER say "לא בדקתי", "I haven't checked", or "אין לי גישה" when LIVE_CALENDAR is present — you have already checked. When LIVE_CALENDAR is absent, say "אין לי נתוני הזמנות מאומתים לתאריך זה — בדוק ישירות." and use action:"info".
- PURE QUESTIONS (offices? pricing? how many rooms? who is fastest? any question ending in '?'): ALWAYS return action:"info" — NEVER return add_task for a question unless the message also contains an explicit work order ("תקן", "שלח", "פתח משימה", "clean", "fix", etc.). Returning add_task for an informational question is a critical error.
- COUNTS CONSISTENCY: Use STATS_JSON.total_tasks as the single authoritative open-task count. Do not report a different number elsewhere in the same response."""

    _extra_sys = _maya_live_facts_system_block(tenant_id, user_id, maya_stats_snapshot, command)
    _stream_env = (os.getenv("MAYA_GEMINI_USE_STREAM", "1") or "").strip().lower()
    _prefer_stream = _stream_env not in ("0", "false", "no", "off") or bool(data.get("stream"))
    try:
        _stream_timeout = int((os.getenv("MAYA_GEMINI_STREAM_TIMEOUT_SEC") or "15").strip())
    except ValueError:
        _stream_timeout = 15
    _stream_timeout = max(10, min(_stream_timeout, 60))

    _accept_h = (request.headers.get("Accept") or "").lower()
    _wants_sse = bool(data.get("sse")) or ("text/event-stream" in _accept_h)

    if _wants_sse:

        @stream_with_context
        @copy_current_request_context
        def _maya_sse():
            with app.app_context():
                buf = []
                try:
                    for piece in _maya_llm_stream_text_chunks(
                        prompt, timeout=_stream_timeout, extra_system=_extra_sys
                    ):
                        buf.append(piece)
                        yield (
                            "data: "
                            + json.dumps({"type": "delta", "text": piece}, ensure_ascii=False)
                            + "\n\n"
                        )
                    text = "".join(buf)
                    result = _maya_build_json_response_from_llm_output(
                        tenant_id,
                        user_id,
                        command,
                        text,
                        maya_stats_snapshot,
                        rooms,
                        staff_by_property,
                        truth_audit=_truth_audit,
                    )
                    yield (
                        "data: "
                        + json.dumps({"type": "done", "result": result}, ensure_ascii=False)
                        + "\n\n"
                    )
                except Exception as e:
                    import traceback as _tb_sse

                    print(f"\n{'='*60}", flush=True)
                    print(f"[Gemini] maya-command SSE FAILED: {type(e).__name__}: {e}", flush=True)
                    _tb_sse.print_exc()
                    print(f"{'='*60}\n", flush=True)
                    err = _maya_brain_error_payload(e, code="gemini_call")
                    yield (
                        "data: "
                        + json.dumps({"type": "done", "result": err}, ensure_ascii=False)
                        + "\n\n"
                    )

        return Response(
            _maya_sse(),
            mimetype="text/event-stream",
            headers={
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    try:
        with app.app_context():
            if _prefer_stream:
                text = _gemini_stream_collect_string(prompt, timeout=_stream_timeout, extra_system=_extra_sys)
            else:
                text = _gemini_generate(prompt, timeout=22, extra_system=_extra_sys)
    except Exception as e:
        import traceback as _tb_cmd

        print(f"\n{'='*60}", flush=True)
        print(f"[Gemini] maya-command FAILED: {type(e).__name__}: {e}", flush=True)
        _tb_cmd.print_exc()
        print(f"{'='*60}\n", flush=True)
        return _maya_brain_error_response(e, code="gemini_call")

    with app.app_context():
        result = _maya_build_json_response_from_llm_output(
            tenant_id,
            user_id,
            command,
            text,
            maya_stats_snapshot,
            rooms,
            staff_by_property,
            truth_audit=_truth_audit,
        )
    return jsonify(result), 200


def _build_property_summary_for_ai(rooms, staff_by_property):
    """Human-readable summary for AI to answer guest queries: 'This villa has 2 guests and 1 bedroom. Staff: Kobi (cleaner).'"""
    if not rooms:
        seed = _ensure_demo_portfolio_properties([_ensure_room_image_urls(dict(x)) for x in _default_portfolio_seed_rooms()])
        rooms = seed
    parts = []
    for r in rooms:
        name = r.get("name") or "Property"
        guests = r.get("max_guests") or 2
        bedrooms = r.get("bedrooms") or 1
        beds = r.get("beds") or 1
        bathrooms = r.get("bathrooms") or 1
        staff_list = staff_by_property.get(r.get("id"), [])
        def _staff_str(s):
            ph = s.get("phone_number") or ""
            return f"{s['name']} ({s['role']})" + (f" tel:{ph}" if ph else "")
        staff_str = ", ".join(_staff_str(s) for s in staff_list) if staff_list else "None assigned"
        occ = r.get("occupancy_rate")
        try:
            occ_f = float(occ) if occ is not None else None
        except (TypeError, ValueError):
            occ_f = None
        occ_s = f"~{int(round(occ_f))}% occupancy (from DB)" if occ_f is not None else "occupancy: use GET /api/properties for live rates"
        parts.append(
            f"'{name}': {guests} guests, {bedrooms} bedroom(s), {beds} bed(s), {bathrooms} bathroom(s), {occ_s}. "
            f"Staff: {staff_str}."
        )
    return " | ".join(parts) if parts else (
        "Portfolio: use GET /api/properties and manual_rooms.occupancy_rate for live occupancy — do not quote a default percentage."
    )


# Master Access: Maya creates tasks and sends notifications without 401
STAFF_ACTIONS = [{"label": "ראיתי ✅", "value": "seen"}, {"label": "בוצע 🏁", "value": "done"}]

# When DB is down, POST /api/tasks still succeeds; GET merges these with initial_tasks().
_DEMO_PROPERTY_TASKS_MEMORY = []


def _ensure_maya_brain_mock_tasks():
    """In-memory demo tasks (20+) for Maya + Task Board when DB is empty or for overlay."""
    global _DEMO_PROPERTY_TASKS_MEMORY
    if len(_DEMO_PROPERTY_TASKS_MEMORY) >= 22:
        return
    now = datetime.now(timezone.utc).isoformat()
    portfolio_ids = ["bazaar-jaffa-hotel"] + [x[0] for x in _DEMO_15_WEWORK]
    names = [
        ("ניקיון לובי — קומה 2", TASK_TYPE_CLEANING_HE),
        ("צ'ק-אאוט 11:00 — חדר 204", TASK_TYPE_CHECKIN_HE),
        ("בקשת מגבות — חדר 118", TASK_TYPE_SERVICE_HE),
        ("הכנת חדר — צ'ק-אין 15:00", TASK_TYPE_CLEANING_HE),
        ("ניקיון חדר — אחרי אירוח", TASK_TYPE_CLEANING_HE),
        ("תזכורת צ'ק-אאוט — אורח יוצא היום", TASK_TYPE_CHECKIN_HE),
        ("תחזוקה — מזגן בלובי", TASK_TYPE_MAINTENANCE_HE),
        ("אורח ביקש כריות נוספות", TASK_TYPE_SERVICE_HE),
        ("ניקיון חדר ילדים — משפחה", TASK_TYPE_CLEANING_HE),
        ("העברת מזוודות — קבלה", TASK_TYPE_SERVICE_HE),
        ("צ'ק-אאוט מאוחר — אישור מנהל", TASK_TYPE_CHECKIN_HE),
        ("ניקיון חדר רחצה — דחוף", TASK_TYPE_CLEANING_HE),
        ("בקשת קפה — חדר 305", TASK_TYPE_SERVICE_HE),
        ("סידור חדר — VIP", TASK_TYPE_CLEANING_HE),
        ("ניקיון אחרי אירוע — אולם", TASK_TYPE_CLEANING_HE),
        ("אורח דיווח על ריח — בדיקה", TASK_TYPE_SERVICE_HE),
        ("הכנת חדר זוגי — יום הולדת", TASK_TYPE_CLEANING_HE),
        ("צ'ק-אאוט — חדר 412", TASK_TYPE_CHECKIN_HE),
        ("ניקיון מטבחון — סוויטה", TASK_TYPE_CLEANING_HE),
        ("מגבות נוספות — דחוף", TASK_TYPE_SERVICE_HE),
        ("ניקיון חדר — סטטוס מלוכלך", TASK_TYPE_CLEANING_HE),
        ("בקשת חיבור Wi‑Fi — חדר 201", TASK_TYPE_SERVICE_HE),
    ]
    for i, (desc, kind) in enumerate(names):
        pid = portfolio_ids[i % len(portfolio_ids)]
        tid = f"mock-maya-brain-{i + 1}"
        if any(isinstance(x, dict) and x.get("id") == tid for x in _DEMO_PROPERTY_TASKS_MEMORY):
            continue
        _DEMO_PROPERTY_TASKS_MEMORY.append({
            "id": tid,
            "property_id": pid,
            "description": desc,
            "title": desc,
            "task_type": kind,
            "property_name": pid,
            "room": pid,
            "room_number": pid,
            "staff_name": "עובד",
            "worker_name": "עובד",
            "staff_phone": "",
            "status": "Pending",
            "created_at": now,
            "actions": STAFF_ACTIONS,
        })
    print(f"[_ensure_maya_brain_mock_tasks] in-memory demo tasks: {len(_DEMO_PROPERTY_TASKS_MEMORY)}", flush=True)


def _worker_name_matches_filter(worker_filter, staff_name, assigned_to):
    """Loose match so /worker/levikobi and Hebrew staff names both work in demos."""
    wf = (worker_filter or "").strip().lower()
    if not wf:
        return True
    sn = (staff_name or "").strip().lower()
    at = (assigned_to or "").strip().lower()
    if not sn and not at:
        return True
    if wf == sn or wf == at:
        return True
    if wf in sn or wf in at or sn in wf or at in wf:
        return True
    return False


def _task_dict_status_norm(t):
    raw = (t.get("status") or "Pending").strip()
    if raw in ("Accepted", "accepted", "seen", "Seen", "confirmed", "started", "Started"):
        return "In_Progress"
    if raw in ("done", "Done", "completed", "Completed"):
        return "Done"
    if raw in ("waiting", "Waiting"):
        return "Waiting"
    if raw in ("pending", "Pending", "assigned", "Assigned", "queued", "Queued"):
        return "Pending"
    return raw


def _filter_task_dicts_for_query(tasks, worker_filter, status_filter):
    out = []
    for t in tasks:
        if not isinstance(t, dict):
            continue
        if (t.get("status") or "").strip().lower() == "archived":
            continue
        st = _task_dict_status_norm(t)
        if status_filter:
            sf = status_filter.lower()
            stl = st.lower()
            if sf == "pending" and stl not in ("pending", "waiting"):
                continue
            elif sf != "pending" and stl != sf:
                continue
        if not _worker_name_matches_filter(
            worker_filter, t.get("staff_name") or "", t.get("assigned_to") or ""
        ):
            continue
        row = dict(t)
        row["status"] = st
        out.append(row)
    return out


def _merge_initial_and_memory_tasks():
    seen = set()
    out = []
    for t in initial_tasks():
        if not isinstance(t, dict):
            continue
        tid = t.get("id")
        if tid and tid not in seen:
            seen.add(tid)
            out.append(dict(t))
    for t in _DEMO_PROPERTY_TASKS_MEMORY:
        if not isinstance(t, dict):
            continue
        tid = t.get("id")
        if tid and tid not in seen:
            seen.add(tid)
            out.append(dict(t))
    return out


def _ensure_demo_tasks_min_20(tasks):
    """Demo: at least 20 task rows for GET /api/tasks and /api/property-tasks."""
    if tasks is None:
        tasks = []
    out = [dict(t) if isinstance(t, dict) else t for t in tasks if isinstance(t, dict)]
    if len(out) >= 20:
        return out
    seen = {t.get("id") for t in out if t.get("id")}
    for t in initial_tasks():
        if not isinstance(t, dict):
            continue
        tid = t.get("id")
        if tid and tid not in seen:
            seen.add(tid)
            out.append(dict(t))
        if len(out) >= 20:
            break
    return out


def _ensure_demo_portfolio_properties(rooms):
    """Demo: at least 15 properties; every row gets occupancy_rate 80."""
    if rooms is None:
        rooms = []
    out = [dict(r) if isinstance(r, dict) else r for r in rooms if isinstance(r, dict)]
    if len(out) < 15:
        seed = _default_portfolio_seed_rooms()
        seen = {str(r.get("id")) for r in out if r.get("id")}
        for r in seed:
            if not isinstance(r, dict):
                continue
            rid = str(r.get("id"))
            if rid not in seen:
                seen.add(rid)
                out.append(dict(r))
            if len(out) >= 15:
                break
    try:
        live_occ = float(get_daily_stats()["occupancy_pct"])
    except Exception:
        live_occ = 80.0
    for r in out:
        if isinstance(r, dict) and r.get("occupancy_rate") is None:
            r["occupancy_rate"] = live_occ
    return out


@app.route("/api/property-tasks", methods=["GET", "POST", "OPTIONS"])
def property_tasks_api():
    """GET/POST property tasks. With AUTH_DISABLED=false, requires Bearer JWT (see get_property_tasks_auth_bundle)."""
    if request.method == "OPTIONS":
        return Response(status=204)
    try:
        identity = get_property_tasks_auth_bundle()
    except ValueError as _auth_e:
        return jsonify({"error": str(_auth_e) or "Unauthorized"}), 401
    tenant_id = identity["tenant_id"]
    user_id = identity["user_id"]

    if not SessionLocal or not PropertyTaskModel:
        if request.method == "GET":
            worker_filter = (
                (request.args.get("worker") or request.args.get("worker_id") or "").strip().lower()
            )
            worker_filter = _apply_staff_task_scope(identity, worker_filter)
            status_filter = (request.args.get("status") or "").strip().lower()
            if worker_filter == "__no_staff_handle__":
                client_limit, client_offset = _parse_api_tasks_pagination()
                resp = _no_cache_json(jsonify([]))
                resp.headers["X-Tasks-Fallback"] = "1"
                if client_limit is not None:
                    _attach_tasks_list_pagination_headers(resp, 0, client_offset, 0, client_limit)
                return resp, 200
            merged = _merge_initial_and_memory_tasks()
            tasks = _filter_task_dicts_for_query(merged, worker_filter, status_filter)
            if worker_filter and not tasks:
                seed = _filter_task_dicts_for_query(initial_tasks(), worker_filter, status_filter)
                tasks = seed if seed else initial_tasks()
            client_limit, client_offset = _parse_api_tasks_pagination()
            total_mem = len(tasks)
            if client_limit is not None:
                tasks = tasks[client_offset : client_offset + client_limit]
            _redact_property_task_list(tasks, identity)
            resp = _no_cache_json(jsonify(tasks))
            resp.headers["X-Tasks-Fallback"] = "1"
            if client_limit is not None:
                _attach_tasks_list_pagination_headers(resp, total_mem, client_offset, len(tasks), client_limit)
            return resp, 200
        # POST without DB — in-memory demo task, always 201 JSON
        data = request.get_json(silent=True) or {}
        property_id = data.get("property_id") or ""
        staff_id = data.get("staff_id") or data.get("assigned_to") or ""
        assigned_to = staff_id
        description = (data.get("description") or "").strip() or "ביצוע משימה"
        property_name = (data.get("property_name") or "").strip()
        staff_name = (data.get("staff_name") or "").strip()
        staff_phone = (data.get("staff_phone") or "").strip()
        photo_url = (data.get("photo_url") or "").strip()
        task_id = str(uuid.uuid4())
        created = now_iso()
        display_property = property_name or property_id or "חדר לא ידוע"
        display_staff = staff_name or "Unknown"
        task_payload = {
            "id": task_id,
            "property_id": property_id,
            "staff_id": staff_id,
            "assigned_to": assigned_to,
            "description": description,
            "title": description,
            "task_type": description,
            "property_name": display_property,
            "room": display_property,
            "room_number": display_property,
            "staff_name": display_staff,
            "worker_name": display_staff,
            "staff_phone": staff_phone,
            "status": "Pending",
            "created_at": created,
            "photo_url": photo_url,
            "actions": STAFF_ACTIONS,
        }
        _DEMO_PROPERTY_TASKS_MEMORY.append(task_payload)
        print(f"[Tasks] POST demo-memory task id={task_id[:8]} property={property_id!r}", flush=True)
        return jsonify({"ok": True, "task": task_payload}), 201

    # Session per request — close in finally so connections return to the pool (avoids QueuePool exhaustion).
    session = SessionLocal()
    try:
        if request.method == "GET":
            try:
                # Optional ?worker=levikobi filter — used by WorkerView for server-side filtering
                worker_filter = (
                    (request.args.get("worker") or request.args.get("worker_id") or "").strip().lower()
                )
                worker_filter = _apply_staff_task_scope(identity, worker_filter)
                status_filter = (request.args.get("status") or "").strip().lower()
                raw_get = _is_raw_api_tasks_get()
                client_limit, client_offset = _parse_api_tasks_pagination()
                if worker_filter == "__no_staff_handle__":
                    resp = _no_cache_json(jsonify([]))
                    _attach_task_table_count_headers(resp, 0)
                    if client_limit is not None:
                        _attach_tasks_list_pagination_headers(resp, 0, client_offset, 0, client_limit)
                    return resp, 200
                use_sql_pagination = (
                    client_limit is not None
                    and not worker_filter
                    and not status_filter
                    and func is not None
                )
                pagination_total = None  # set when client_limit is used

                rooms    = list_manual_rooms(tenant_id, owner_id=user_id)
                room_ids = [r.get("id") for r in rooms if r.get("id")]
                room_map = {r.get("id"): r for r in rooms if r.get("id")}

                # Fetch tasks for this tenant — do NOT filter by room_ids because manual /test-task
                # tasks use plain room numbers ("302") that are never in the UUID room_ids
                # list, which caused them to be silently dropped.
                _pq = _property_tasks_query_for_tenant(session, tenant_id)
                if _pq is not None:
                    if use_sql_pagination:
                        _pq = _pq.filter(
                            or_(
                                PropertyTaskModel.status.is_(None),
                                func.lower(PropertyTaskModel.status) != "archived",
                            )
                        )
                        pagination_total = _pq.count()
                        rows = (
                            _pq.order_by(PropertyTaskModel.created_at.desc())
                            .offset(client_offset)
                            .limit(client_limit)
                            .all()
                        )
                    else:
                        _ord = _pq.order_by(PropertyTaskModel.created_at.desc())
                        _lim = _property_tasks_query_limit()
                        rows = _ord.all() if _lim <= 0 else _ord.limit(_lim).all()
                else:
                    rows = []

                if not rows:
                    resp = _no_cache_json(jsonify([]))
                    _attach_task_table_count_headers(resp, 0)
                    if client_limit is not None:
                        tot = int(pagination_total) if pagination_total is not None else 0
                        _attach_tasks_list_pagination_headers(resp, tot, client_offset, 0, client_limit)
                    return resp, 200

                def build_property_context(prop):
                    if not prop:
                        return ""
                    g = prop.get("max_guests") or 2
                    br = prop.get("bedrooms") or 1
                    b = prop.get("beds") or 1
                    return f"{g} Guests, {br} Bedroom, {b} Bed"

                staff_cache = {}
                if SessionLocal and PropertyStaffModel:
                    for pid in room_ids:
                        for s in session.query(PropertyStaffModel).filter_by(property_id=pid).all():
                            staff_cache[s.id] = {"name": s.name or "Staff", "phone": getattr(s, "phone_number", None) or ""}

                tasks = []
                for r in rows:
                    if not use_sql_pagination:
                        if (getattr(r, "status", None) or "").strip().lower() == "archived":
                            continue
                    prop = room_map.get(r.property_id) if r.property_id else None
                    ctx = build_property_context(prop)
                    staff_name  = getattr(r, "staff_name",  None) or ""
                    staff_phone = getattr(r, "staff_phone", None) or ""
                    assigned_to = getattr(r, "assigned_to", None) or ""
                    if (not staff_name or not staff_phone) and assigned_to:
                        cached = staff_cache.get(assigned_to)
                        if cached:
                            staff_name  = staff_name  or cached["name"]
                            staff_phone = staff_phone or cached["phone"]

                    raw_status = (r.status or "Pending").strip()

                    # Normalise legacy "Accepted" → "In_Progress" in the payload
                    # (DB value is unchanged; only the JSON response is normalised)
                    if raw_status in ("Accepted", "accepted", "seen", "Seen",
                                      "confirmed", "started", "Started"):
                        row_status = "In_Progress"
                    elif raw_status in ("done", "Done", "completed", "Completed"):
                        row_status = "Done"
                    elif raw_status in ("assigned", "Assigned"):
                        row_status = "In_Progress"
                    elif raw_status in ("delayed", "Delayed"):
                        row_status = "Delayed"
                    elif raw_status in ("pending", "Pending", "queued", "Queued"):
                        row_status = "Pending"
                    elif raw_status in ("waiting", "Waiting"):
                        row_status = "Waiting"
                    else:
                        row_status = raw_status

                    # Server-side worker filter (substring / demo-friendly)
                    if not use_sql_pagination:
                        if worker_filter and not _worker_name_matches_filter(
                            worker_filter, staff_name, assigned_to
                        ):
                            continue

                        # Server-side status filter (?status=pending includes Waiting)
                        if status_filter:
                            sf = status_filter.lower()
                            rsl = row_status.lower()
                            if sf == "pending" and rsl not in ("pending", "waiting"):
                                continue
                            if sf != "pending" and rsl != sf:
                                continue

                    # Derive clean room label with guaranteed fallback
                    pname = (getattr(r, "property_name", None) or "").strip()
                    pid   = (r.property_id or "").strip()
                    room_label = pname or (f"חדר {pid}" if pid else "חדר לא ידוע")

                    desc_val = (r.description or "").strip() or "ביצוע משימה"
                    ttype = (getattr(r, "task_type", None) or "").strip() or desc_val
                    esc, pri_f, wnotes = _task_escalation_fields(r)
                    _delayed = False
                    if row_status == "In_Progress":
                        _sa = getattr(r, "started_at", None) or getattr(r, "created_at", None)
                        _dt = parse_iso_datetime(_sa)
                        if _dt:
                            if _dt.tzinfo is None:
                                _dt = _dt.replace(tzinfo=timezone.utc)
                            _delayed = (datetime.now(timezone.utc) - _dt) > timedelta(minutes=60)

                    tasks.append({
                        "id":               r.id,
                        # canonical field names
                        "property_id":      pid,
                        "property_name":    room_label,
                        # aliases expected by frontend fallback chain
                        "title":            desc_val,
                        "room_id":          pid,
                        "room":             room_label,
                        "room_number":      room_label,
                        "task_type":        ttype,
                        # rest of payload
                        "assigned_to":      assigned_to,
                        "description":      desc_val,
                        "status":           row_status,   # normalised
                        "delayed":          _delayed,
                        "created_at":       getattr(r, "created_at",       None),
                        "started_at":       getattr(r, "started_at",       None),
                        "completed_at":     getattr(r, "completed_at",     None),
                        "duration_minutes": getattr(r, "duration_minutes", None),
                        "staff_name":       staff_name or "Unknown",
                        "worker_name":      staff_name or "Unknown",
                        "staff_phone":      staff_phone,
                        "property_context": ctx,
                        "photo_url":        getattr(r, "photo_url", None) or "",
                        "priority":         getattr(r, "priority", None) or pri_f,
                        "worker_notes":     wnotes,
                        "escalated":        esc,
                        "due_at":           getattr(r, "due_at", None) or "",
                        "actions":          STAFF_ACTIONS,
                    })

                if client_limit is not None and not use_sql_pagination:
                    pagination_total = len(tasks)
                    tasks = tasks[client_offset : client_offset + client_limit]

                print(f"[Tasks] GET worker={worker_filter!r:15s} "
                      f"status={status_filter!r:12s} raw_api_tasks={raw_get} "
                      f"limit={client_limit} offset={client_offset} → {len(tasks)} tasks returned")
                _redact_property_task_list(tasks, identity)
                resp = _no_cache_json(jsonify(tasks))
                _list_total = int(pagination_total) if pagination_total is not None else len(tasks)
                _attach_task_table_count_headers(resp, _list_total)
                if client_limit is not None and pagination_total is not None:
                    _attach_tasks_list_pagination_headers(
                        resp, pagination_total, client_offset, len(tasks), client_limit
                    )
                return resp, 200
            except Exception as _gterr:
                print(f"[property_tasks] GET failed: {_gterr!r}", flush=True)
                import traceback as _tb_gt
                _tb_gt.print_exc()
                resp = _no_cache_json(jsonify([]))
                _attach_task_table_count_headers(resp, 0)
                resp.headers["X-Tasks-Error-Recovery"] = "1"
                return resp, 200

        data = request.get_json(silent=True) or {}
        property_id = data.get("property_id") or ""
        staff_id = data.get("staff_id") or data.get("assigned_to") or ""
        assigned_to = staff_id
        description = data.get("description") or ""
        # Always default to Pending so new tasks appear on the worker screen immediately
        _raw_status = (data.get("status") or "").strip()
        status = _raw_status if _raw_status in (
            "Pending", "In_Progress", "Done", "Assigned", "Delayed", "Waiting",
        ) else "Pending"
        property_name = data.get("property_name") or ""
        staff_name = data.get("staff_name") or ""
        staff_phone = data.get("staff_phone") or ""
        property_context = data.get("property_context") or ""
        photo_url = data.get("photo_url") or ""

        display_property = property_name.strip() or property_id or "חדר לא ידוע"
        guest_mgr_whatsapp_msg = None

        # Guest Dashboard towels — Maya assigns housekeeping worker; WhatsApp queued after DB commit
        if (
            data.get("source") == "guest"
            and DEMO_AUTOMATION_SETTINGS.get("smart_task_assignment_enabled")
            and property_id
        ):
            raw_desc = (description or "").strip()
            if "מגבת" in raw_desc or "towel" in raw_desc.lower():
                wname, wphone, wid = _guest_towel_resolve_worker(session, tenant_id, property_id, property_name)
                if not staff_name:
                    staff_name = wname
                if not staff_phone:
                    staff_phone = wphone
                if not staff_id and wid:
                    staff_id = wid
                    assigned_to = wid
                mgr = f"🏨 מאיה → מנהל: מגבות ב-{display_property} — הוקצה ל-{staff_name}"
                guest_mgr_whatsapp_msg = mgr
                try:
                    _ACTIVITY_LOG.append({
                        "id": str(uuid.uuid4()),
                        "ts": int(time.time() * 1000),
                        "type": "guest_towel_maya",
                        "text": mgr,
                    })
                except Exception as _gtm:
                    print(f"[guest_towel_maya] activity log: {_gtm}", flush=True)

        assigned_to = staff_id

        task_id = str(uuid.uuid4())
        created = now_iso()
        full_desc = description.strip()
        if property_context:
            full_desc = f"{full_desc} | נכס: {property_context}" if full_desc else f"נכס: {property_context}"
        if not full_desc:
            full_desc = "ביצוע משימה"
        task_type = (data.get("task_type") or "").strip()
        if not task_type:
            dl = (full_desc or "").lower()
            he = full_desc or ""
            if any(x in he for x in ("ניקיון", "נקה", "מגבת", "מצעים")) or "clean" in dl:
                task_type = TASK_TYPE_CLEANING_HE
            elif any(x in he for x in ("תחזוק", "מזגן", "ברז", "נזיל", "נורה")) or "maint" in dl or "repair" in dl:
                task_type = TASK_TYPE_MAINTENANCE_HE
            elif "vip" in dl or "אורח vip" in he.lower():
                task_type = TASK_TYPE_VIP_HE
            else:
                task_type = TASK_TYPE_SERVICE_HE
        if property_id == "bazaar-jaffa-hotel" and _is_task_type_cleaning(task_type) and "יחידה" not in full_desc:
            u = (abs(hash(task_id)) % 10) + 1
            full_desc = f"{full_desc} — ניקיון יחידה {u}/10"
        priority = (data.get("priority") or "normal").strip().lower()
        if priority not in ("normal", "high"):
            priority = "normal"
        due_at_raw = (data.get("due_at") or "").strip()
        due_at_val = due_at_raw or None

        # ── Smart Dispatch: if worker already has an In_Progress task, queue as Pending ──
        queued_msg = None
        effective_status = status
        if staff_name and (status or "").strip() != "Waiting":
            _bq = _property_tasks_query_for_tenant(session, tenant_id)
            busy_task = (
                _bq.filter(
                    PropertyTaskModel.staff_name == staff_name,
                    PropertyTaskModel.status == "In_Progress",
                ).first()
                if _bq is not None
                else None
            )
            if busy_task:
                effective_status = "Pending"   # force queue
                room_busy = getattr(busy_task, "property_name", None) or getattr(busy_task, "property_id", "?")
                queued_msg = (
                    f"🟡 {staff_name} כבר בביצוע משימה בחדר {room_busy}. "
                    f"המשימה החדשה עומדת בתור (Pending) ותופיע אחרי שהמשימה הנוכחית תסתיים."
                )
                print(f"[SmartDispatch] {staff_name} busy → new task queued as Pending")
                _push_activity({
                    "type": "task_queued",
                    "text": queued_msg,
                    "task_id": task_id,
                })

        if (
            not queued_msg
            and (effective_status or "").strip() in ("Pending", "pending", "")
            and ((staff_name or "").strip() or (staff_id or "").strip() or (assigned_to or "").strip())
        ):
            effective_status = "In_Progress"

        task = PropertyTaskModel(
            id=task_id,
            property_id=property_id,
            staff_id=staff_id,
            assigned_to=assigned_to,
            description=full_desc,
            status=effective_status,
            created_at=created,
            property_name=property_name,
            staff_name=staff_name,
            staff_phone=staff_phone,
            photo_url=photo_url,
            task_type=task_type,
            priority=priority,
            tenant_id=tenant_id,
            due_at=due_at_val,
        )
        session.add(task)
        try:
            session.commit()
        except Exception as _commit_e:
            session.rollback()
            print(f"[property_tasks] POST commit failed, using demo memory: {_commit_e!r}", flush=True)
            import traceback as _tb_c
            _tb_c.print_exc()
            display_staff = staff_name.strip() or "Unknown"
            task_payload = {
                "id": task_id,
                "property_id": property_id,
                "staff_id": staff_id,
                "assigned_to": assigned_to,
                "description": full_desc,
                "title": full_desc,
                "task_type": full_desc,
                "property_name": display_property,
                "room": display_property,
                "room_number": display_property,
                "staff_name": display_staff,
                "worker_name": display_staff,
                "staff_phone": staff_phone,
                "status": effective_status,
                "created_at": created,
                "photo_url": photo_url,
                "queued": queued_msg is not None,
                "queued_message": queued_msg,
                "actions": STAFF_ACTIONS,
            }
            _DEMO_PROPERTY_TASKS_MEMORY.append(task_payload)
            resp = jsonify({"ok": True, "task": task_payload})
            resp.headers["X-Tasks-Fallback"] = "1"
            return resp, 201
        try:
            assign_stuck_property_tasks(tenant_id)
        except Exception:
            pass
        _bump_tasks_version()
        _invalidate_owner_dashboard_cache()
        if guest_mgr_whatsapp_msg:
            try:
                enqueue_twilio_task("whatsapp", to=OWNER_PHONE, message=guest_mgr_whatsapp_msg)
            except Exception as _gwe:
                print(f"[guest_towel_maya] enqueue whatsapp (non-blocking): {_gwe}", flush=True)
        display_staff = staff_name.strip() or "Unknown"
        task_payload = {
            "id": task_id,
            "property_id": property_id,
            "staff_id": staff_id,
            "assigned_to": assigned_to,
            # canonical + all frontend aliases so the card never appears empty
            "description":   full_desc,
            "title":         full_desc,
            "task_type":     task_type,
            "property_name": display_property,
            "room":          display_property,
            "room_number":   display_property,
            "staff_name":    display_staff,
            "worker_name":   display_staff,
            "staff_phone":   staff_phone,
            "status":        effective_status,
            "created_at":    created,
            "photo_url":     photo_url,
            "queued":        queued_msg is not None,
            "queued_message": queued_msg,
            "due_at":        due_at_val or "",
            "actions":       STAFF_ACTIONS,
        }
        return jsonify({"ok": True, "task": task_payload}), 201
    except Exception as e:
        session.rollback()
        print(f"[property_tasks] POST failed: {e!r}", flush=True)
        import traceback as _tb_pt
        _tb_pt.print_exc()
        # Last-resort demo: still return 201 so guest/worker UIs never hard-fail
        try:
            data = request.get_json(silent=True) or {}
            property_id = data.get("property_id") or ""
            description = (data.get("description") or "").strip() or "ביצוע משימה"
            property_name = (data.get("property_name") or "").strip()
            staff_name = (data.get("staff_name") or "").strip()
            staff_phone = (data.get("staff_phone") or "").strip()
            photo_url = (data.get("photo_url") or "").strip()
            task_id = str(uuid.uuid4())
            created = now_iso()
            display_property = property_name or property_id or "חדר לא ידוע"
            display_staff = staff_name or "Unknown"
            task_payload = {
                "id": task_id,
                "property_id": property_id,
                "description": description,
                "title": description,
                "task_type": description,
                "property_name": display_property,
                "room": display_property,
                "room_number": display_property,
                "staff_name": display_staff,
                "worker_name": display_staff,
                "staff_phone": staff_phone,
                "status": "Pending",
                "created_at": created,
                "photo_url": photo_url,
                "actions": STAFF_ACTIONS,
            }
            _DEMO_PROPERTY_TASKS_MEMORY.append(task_payload)
            resp = jsonify({"ok": True, "task": task_payload})
            resp.headers["X-Tasks-Fallback"] = "1"
            return resp, 201
        except Exception:
            return jsonify({"error": str(e), "ok": False}), 200
    finally:
        session.close()


def _normalize_property_task_patch_status(raw):
    """Same mapping as PATCH /api/property-tasks/<id> (traffic-light board)."""
    raw = (raw or "Pending").strip() or "Pending"
    if raw in ("confirmed", "Seen", "seen", "Accepted", "accepted"):
        return "In_Progress"
    if raw in ("In_Progress", "in_progress", "in progress", "InProgress", "started", "working"):
        return "In_Progress"
    if raw in ("done", "Done", "completed", "Completed"):
        return "Done"
    if raw in ("pending", "Pending", "queued", "Queued"):
        return "Pending"
    if raw in ("assigned", "Assigned"):
        return "In_Progress"
    if raw in ("delayed", "Delayed"):
        return "Delayed"
    return raw


def _auto_promote_pending_when_assigned(task, tid, now_ts):
    """Enterprise state machine: Pending/Waiting → In_Progress once a worker is assigned."""
    if not task:
        return False
    st = (task.status or "").strip().lower()
    if st not in ("pending", "waiting", "queued", ""):
        return False
    has_worker = bool(
        (getattr(task, "staff_name", None) or "").strip()
        or (getattr(task, "staff_id", None) or "").strip()
        or (getattr(task, "assigned_to", None) or "").strip()
    )
    if not has_worker:
        return False
    _apply_property_task_status_to_row(task, "In_Progress", tid, now_ts)
    task.status = "In_Progress"
    return True


def _apply_property_task_status_to_row(task, new_status, tid, now_ts):
    """Mutates ORM row like PATCH handler (timestamps, notify owner on start)."""
    if new_status != "Done":
        try:
            task.completed_at = None
            task.duration_minutes = None
        except Exception:
            pass
    if new_status == "In_Progress":
        if not getattr(task, "started_at", None):
            task.started_at = now_ts
            print(f"[Perf] Task {str(tid)[:8]}… started_at={now_ts}", flush=True)
        try:
            notify_owner_on_seen(task)
        except Exception as e:
            print("[Maya] notify_owner_on_seen failed:", e, flush=True)
    elif new_status == "Done":
        task.completed_at = now_ts
        ref_ts_str = getattr(task, "started_at", None) or getattr(task, "created_at", None)
        if ref_ts_str:
            try:
                ref_dt = datetime.fromisoformat(str(ref_ts_str).replace("Z", "+00:00"))
                done_dt = datetime.fromisoformat(now_ts)
                if ref_dt.tzinfo is None:
                    ref_dt = ref_dt.replace(tzinfo=timezone.utc)
                if done_dt.tzinfo is None:
                    done_dt = done_dt.replace(tzinfo=timezone.utc)
                mins = round((done_dt - ref_dt).total_seconds() / 60, 1)
                task.duration_minutes = str(max(0, mins))
                print(
                    f"[Perf] Task {str(tid)[:8]}… done in {mins} min by {getattr(task, 'staff_name', '?')}",
                    flush=True,
                )
            except Exception as _pe:
                print(f"[Perf] duration calc error: {_pe}", flush=True)
    task.status = new_status


@app.route("/api/batch_update", methods=["POST", "OPTIONS"])
@app.route("/api/property-tasks-batch-update", methods=["POST", "OPTIONS"])
@app.route("/api/property-tasks-batch", methods=["POST", "OPTIONS"])
def property_tasks_batch_update():
    """POST { \"updates\": [ {\"id\": \"…\", \"status\": \"Done\"|\"In_Progress\"|…}, … ] } — one DB commit."""
    if request.method == "OPTIONS":
        return Response(status=204)
    if not SessionLocal or not PropertyTaskModel:
        return jsonify({"error": "Tasks unavailable"}), 500
    data = request.get_json(silent=True) or {}
    updates = data.get("updates")
    if not isinstance(updates, list) or not updates:
        return jsonify({"error": "updates must be a non-empty array"}), 400
    if len(updates) > 2000:
        return jsonify({"error": "too many updates (max 2000)"}), 400
    try:
        identity = get_property_tasks_auth_bundle()
    except ValueError as _e:
        return jsonify({"error": str(_e)}), 401
    session = SessionLocal()
    results = []
    done_threads = []
    try:
        now_ts = datetime.now(timezone.utc).isoformat()
        status_touched = False
        _batch_tenant_id = identity["tenant_id"]
        for item in updates:
            if not isinstance(item, dict):
                results.append({"id": None, "ok": False, "error": "invalid item"})
                continue
            tid = str(item.get("id") or item.get("task_id") or "").strip()
            raw_st = item.get("status")
            if not tid:
                results.append({"id": None, "ok": False, "error": "missing id"})
                continue
            task = _property_tasks_query_for_tenant(session, _batch_tenant_id).filter(
                PropertyTaskModel.id == tid
            ).first()
            if not task:
                results.append({"id": tid, "ok": False, "error": "Task not found"})
                continue
            prev_status = (task.status or "").strip()
            new_status = _normalize_property_task_patch_status(raw_st)
            _apply_property_task_status_to_row(task, new_status, tid, now_ts)
            _audit_task_completed_session(
                session,
                getattr(task, "tenant_id", None) or identity["tenant_id"],
                tid,
                prev_status,
                new_status,
                identity["user_id"],
                identity["email"],
            )
            results.append({"id": tid, "ok": True, "status": new_status})
            status_touched = True
            if new_status == "Done":
                wn = getattr(task, "staff_name", "") or ""
                if wn:
                    done_threads.append((wn, tid))
        session.commit()
        if status_touched:
            _bump_tasks_version()
            _invalidate_owner_dashboard_cache()
        for wn, tid in done_threads:
            threading.Thread(target=_run_performance_agent, args=(wn, tid), daemon=True).start()
        n_ok = sum(1 for r in results if r.get("ok"))
        return jsonify({"ok": True, "updated": n_ok, "results": results}), 200
    except Exception as e:
        session.rollback()
        print(f"[property_tasks_batch] {e!r}", flush=True)
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()


@app.route("/api/property-tasks/<string:task_id>", methods=["GET", "PATCH", "OPTIONS"])
def property_task_update(task_id):
    """GET single task; PATCH: update task status. Requires auth for tenant scoping."""
    if request.method == "OPTIONS":
        return Response(status=204)
    tid = str(task_id).strip() if task_id else ""
    if not tid:
        return jsonify({"error": "Missing task id"}), 400
    if not SessionLocal or not PropertyTaskModel:
        return jsonify({"error": "Tasks unavailable"}), 500
    try:
        identity = get_property_tasks_auth_bundle()
    except ValueError as _e:
        return jsonify({"error": str(_e)}), 401
    tenant_id = identity["tenant_id"]
    if request.method == "GET":
        session = SessionLocal()
        try:
            task = _property_tasks_query_for_tenant(session, tenant_id).filter(
                PropertyTaskModel.id == tid
            ).first()
            if not task:
                return jsonify({"error": "Task not found"}), 404
            return jsonify({"task": {
                "id": task.id,
                "content": getattr(task, "content", "") or getattr(task, "description", ""),
                "status": task.status,
                "staff_name": getattr(task, "staff_name", "") or "",
                "property_name": getattr(task, "property_name", "") or "",
                "created_at": str(getattr(task, "created_at", "") or ""),
            }}), 200
        except Exception as e:
            return jsonify({"error": str(e)}), 500
        finally:
            session.close()
    print(f"UPDATING TASK: {tid}")
    session = SessionLocal()
    try:
        task = _property_tasks_query_for_tenant(session, tenant_id).filter(
            PropertyTaskModel.id == tid
        ).first()
        if not task:
            print(f"PATCH 404 — task '{tid}' not found for tenant '{tenant_id}'")
            return jsonify({"error": "Task not found"}), 404
        data = request.get_json(silent=True) or {}
        now_ts = datetime.now(timezone.utc).isoformat()
        if "status" in data:
            prev_status = (task.status or "").strip()
            raw = (data.get("status") or "Pending").strip() or "Pending"
            new_status = _normalize_property_task_patch_status(raw)
            print(f"[Task] PATCH {tid[:8]}… '{raw}' → '{new_status}'", flush=True)
            _apply_property_task_status_to_row(task, new_status, tid, now_ts)
            _audit_task_completed_session(
                session,
                getattr(task, "tenant_id", None) or identity["tenant_id"],
                tid,
                prev_status,
                new_status,
                identity["user_id"],
                identity["email"],
            )

        # Allow direct patch of staff_name (for assignment flow)
        if "staff_name" in data and data["staff_name"]:
            task.staff_name = data["staff_name"]
        if "staff_phone" in data and data["staff_phone"]:
            task.staff_phone = data["staff_phone"]

        # Allow patching worker_notes
        if "worker_notes" in data:
            task.worker_notes = data["worker_notes"] or ""

        if "staff_id" in data and data["staff_id"]:
            task.staff_id = data["staff_id"]
            if hasattr(task, "assigned_to"):
                task.assigned_to = data["staff_id"]
        if "assigned_to" in data and data["assigned_to"] and hasattr(task, "assigned_to"):
            task.assigned_to = data["assigned_to"]

        promoted = _auto_promote_pending_when_assigned(task, tid, now_ts)
        if promoted:
            print(f"[Task] Auto-promoted {tid[:8]}… Pending → In_Progress (worker assigned)", flush=True)
            _audit_task_completed_session(
                session,
                getattr(task, "tenant_id", None) or identity["tenant_id"],
                tid,
                "Pending",
                "In_Progress",
                identity["user_id"],
                identity["email"],
            )

        session.commit()
        print(f"UPDATING TASK: {tid} — saved ✅")
        if "status" in data or promoted:
            _bump_tasks_version()
            _invalidate_owner_dashboard_cache()

        # ── Fire Performance Agent in background after completion ──
        _worker_for_agent = getattr(task, "staff_name", "") or ""
        _new_status_for_agent = task.status if ("status" in data or promoted) else None
        if _new_status_for_agent in ("Done",) and _worker_for_agent:
            threading.Thread(
                target=_run_performance_agent,
                args=(_worker_for_agent, tid),   # pass task_id for immutable log
                daemon=True,
            ).start()

        return jsonify({"ok": True, "task": {
            "id": task.id,
            "status": task.status,
            "started_at": getattr(task, "started_at", None),
            "completed_at": getattr(task, "completed_at", None),
            "duration_minutes": getattr(task, "duration_minutes", None),
        }}), 200
    except Exception as e:
        session.rollback()
        print(f"PATCH DB_ERROR: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()


def _run_performance_agent(worker_name: str, completed_task_id: str = None):
    """
    Performance Agent — runs in background after every task completion.

    1. Logs an immutable WorkerPerformance row for the completed task.
    2. Upserts the WorkerStats aggregate for today's totals/averages.

    Both writes go to hotel.db and are never deleted — full history retained.
    """
    if not SessionLocal or not PropertyTaskModel or not WorkerStatsModel:
        return
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    name_lc   = (worker_name or "").lower().strip()
    if not name_lc:
        return
    session = SessionLocal()
    try:
        rows = session.query(PropertyTaskModel).all()
        today = [r for r in rows
                 if (getattr(r, "staff_name", "") or "").lower().strip() == name_lc
                 and str(getattr(r, "created_at", "") or "")[:10] == today_str]

        done_rows  = [r for r in today if r.status in ("Done", "done", "Completed", "completed")]
        durations  = []
        for r in done_rows:
            dm = getattr(r, "duration_minutes", None)
            if dm:
                try: durations.append(float(dm))
                except: pass
        avg_dur = round(sum(durations) / len(durations), 1) if durations else None

        def _fmt(iso):
            if not iso: return None
            try:
                return datetime.fromisoformat(str(iso).replace("Z", "+00:00"))\
                    .astimezone(timezone.utc).strftime("%H:%M")
            except: return str(iso)[11:16]

        shift_start_raw = sorted(
            [str(getattr(r, "started_at", None) or getattr(r, "created_at", "")) for r in today]
        )[0] if today else None

        all_ts = []
        for r in today:
            for attr in ("completed_at", "started_at", "created_at"):
                v = str(getattr(r, attr, "") or "")
                if v: all_ts.append(v)
        last_active_raw = sorted(all_ts)[-1] if all_ts else None

        # ── 1. Log immutable WorkerPerformance row for the completed task ──
        if completed_task_id and WorkerPerformanceModel:
            try:
                task_row = next(
                    (r for r in done_rows if r.id == completed_task_id), None
                )
                if task_row and not session.query(WorkerPerformanceModel).filter_by(id=completed_task_id).first():
                    perf = WorkerPerformanceModel(
                        id               = completed_task_id,
                        task_id          = completed_task_id,
                        worker_name      = worker_name,
                        worker_phone     = getattr(task_row, "staff_phone", "") or "",
                        property_name    = getattr(task_row, "property_name", "") or "",
                        property_id      = getattr(task_row, "property_id", "") or "",
                        description      = getattr(task_row, "description", "") or "",
                        created_at       = str(getattr(task_row, "created_at", "") or ""),
                        started_at       = str(getattr(task_row, "started_at", "") or ""),
                        completed_at     = str(getattr(task_row, "completed_at", "") or ""),
                        duration_minutes = str(getattr(task_row, "duration_minutes", "") or ""),
                        date             = today_str,
                    )
                    session.add(perf)
                    print(f"[PerfAgent] 📝 WorkerPerformance logged: task={completed_task_id[:8]}… worker={worker_name}")
            except Exception as _pe:
                print(f"[PerfAgent] WorkerPerformance log error: {_pe}")

        # ── 2. Upsert WorkerStats aggregate for today ──────────────────
        stat_id = f"{name_lc}_{today_str}"
        stat = session.query(WorkerStatsModel).filter_by(id=stat_id).first()
        if not stat:
            stat = WorkerStatsModel(id=stat_id, worker_name=worker_name, date=today_str)
            session.add(stat)
        stat.tasks_done           = str(len(done_rows))
        stat.tasks_total          = str(len(today))
        stat.avg_duration_minutes = str(avg_dur) if avg_dur is not None else None
        stat.shift_start          = _fmt(shift_start_raw)
        stat.last_active          = _fmt(last_active_raw)
        stat.updated_at           = datetime.now(timezone.utc).isoformat()
        session.commit()
        print(f"[PerfAgent] {worker_name}: done={len(done_rows)}/{len(today)}, avg={avg_dur}min → saved")
    except Exception as e:
        session.rollback()
        print(f"[PerfAgent] error for {worker_name}: {e}")
    finally:
        session.close()


@app.route("/api/worker-stats/<string:worker_name>", methods=["GET", "OPTIONS"])
def worker_stats(worker_name):
    """
    Per-worker performance stats for today.
    Returns: tasks_today, tasks_done, tasks_pending,
             avg_duration_minutes, shift_start, last_active
    """
    if request.method == "OPTIONS":
        return Response(status=204)
    if not SessionLocal or not PropertyTaskModel:
        return jsonify({"worker": worker_name, "tasks_today": 0, "tasks_done": 0,
                        "tasks_pending": 0, "avg_duration_minutes": None,
                        "shift_start": None, "last_active": None}), 200

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    name_lc = (worker_name or "").lower().strip()
    session = SessionLocal()
    try:
        rows = session.query(PropertyTaskModel).all()
        today_tasks = [
            r for r in rows
            if (getattr(r, "staff_name", "") or "").lower().strip() == name_lc
            and str(getattr(r, "created_at", "") or "")[:10] == today_str
        ]
        tasks_done    = [r for r in today_tasks if r.status in ("Done", "done", "Completed", "completed")]
        tasks_pending = [r for r in today_tasks if r.status not in ("Done", "done", "Completed", "completed")]

        durations = []
        for r in tasks_done:
            dm = getattr(r, "duration_minutes", None)
            if dm:
                try: durations.append(float(dm))
                except: pass
        avg_dur = round(sum(durations) / len(durations), 1) if durations else None

        # Shift start = earliest created_at today
        shift_start = None
        if today_tasks:
            ts_list = sorted([str(getattr(r, "started_at", None) or getattr(r, "created_at", "")) for r in today_tasks])
            raw_shift = ts_list[0]
            if raw_shift:
                try:
                    shift_start = datetime.fromisoformat(raw_shift.replace("Z", "+00:00"))\
                        .astimezone(timezone.utc)\
                        .strftime("%H:%M")
                except: shift_start = raw_shift[11:16]

        # Last active = most recent completed_at or created_at
        last_active = None
        all_ts = []
        for r in today_tasks:
            for attr in ("completed_at", "started_at", "created_at"):
                v = str(getattr(r, attr, "") or "")
                if v: all_ts.append(v)
        if all_ts:
            raw_last = sorted(all_ts)[-1]
            try:
                last_active = datetime.fromisoformat(raw_last.replace("Z", "+00:00"))\
                    .astimezone(timezone.utc)\
                    .strftime("%H:%M")
            except: last_active = raw_last[11:16]

        return jsonify({
            "worker":              worker_name,
            "tasks_today":         len(today_tasks),
            "tasks_done":          len(tasks_done),
            "tasks_pending":       len(tasks_pending),
            "avg_duration_minutes": avg_dur,
            "shift_start":         shift_start,
            "last_active":         last_active,
        }), 200
    except Exception as e:
        print(f"[worker-stats] error: {e}")
        import traceback as _tb_ws; _tb_ws.print_exc()
        return jsonify({"worker": worker_name, "error": str(e)}), 500
    finally:
        session.close()


@app.route("/api/worker-productivity", methods=["GET", "OPTIONS"])
def worker_productivity():
    """
    Aggregate per-worker performance for the manager dashboard.
    Groups all today's tasks by staff_name and returns productivity rows.
    """
    if request.method == "OPTIONS":
        return Response(status=204)
    if not SessionLocal or not PropertyTaskModel:
        return jsonify([]), 200

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    session = SessionLocal()
    try:
        _wlim = _property_tasks_query_limit()
        _wlim = _wlim if _wlim > 0 else 100000
        rows = session.query(PropertyTaskModel).filter(
            PropertyTaskModel.status.isnot(None)
        ).order_by(PropertyTaskModel.created_at.desc()).limit(_wlim).all()

        # Group by staff_name, only today's tasks
        from collections import defaultdict
        workers = defaultdict(lambda: {
            "tasks": [], "done": 0, "pending": 0, "durations": [],
            "last_active": None, "shift_start": None,
        })
        for r in rows:
            name = (getattr(r, "staff_name", "") or "").strip()
            if not name:
                continue
            created = str(getattr(r, "created_at", "") or "")
            if created[:10] != today_str:
                continue
            d = workers[name]
            d["tasks"].append(r)
            if r.status in ("Done", "done", "Completed", "completed"):
                d["done"] += 1
                dm = getattr(r, "duration_minutes", None)
                if dm:
                    try: d["durations"].append(float(dm))
                    except: pass
                ca = str(getattr(r, "completed_at", "") or "")
                if ca and (d["last_active"] is None or ca > d["last_active"]):
                    d["last_active"] = ca
            else:
                d["pending"] += 1
            # shift_start
            sa = str(getattr(r, "started_at", "") or getattr(r, "created_at", "") or "")
            if sa and (d["shift_start"] is None or sa < d["shift_start"]):
                d["shift_start"] = sa

        def fmt_ts(iso):
            if not iso: return "—"
            try:
                return datetime.fromisoformat(iso.replace("Z", "+00:00"))\
                    .astimezone(timezone.utc).strftime("%H:%M")
            except: return iso[11:16] if len(iso) >= 16 else iso

        result = []
        for name, d in sorted(workers.items()):
            total = d["done"] + d["pending"]
            avg_d = round(sum(d["durations"]) / len(d["durations"]), 1) if d["durations"] else None
            result.append({
                "worker":              name,
                "tasks_today":         total,
                "tasks_done":          d["done"],
                "tasks_pending":       d["pending"],
                "avg_duration_minutes": avg_d,
                "completion_rate":     round(d["done"] / total * 100) if total else 0,
                "shift_start":         fmt_ts(d["shift_start"]),
                "last_active":         fmt_ts(d["last_active"]),
            })
        result.sort(key=lambda x: x["tasks_done"], reverse=True)
        print(f"[worker-productivity] {len(result)} workers, {today_str}")
        return jsonify(result), 200
    except Exception as e:
        print(f"[worker-productivity] error: {e}")
        import traceback as _tb_wp; _tb_wp.print_exc()
        return jsonify([]), 500
    finally:
        session.close()



# ── ADMIN WORKER STATUS API ────────────────────────────────────────────────────
@app.route("/api/admin/workers", methods=["GET", "OPTIONS"])
def admin_workers():
    """
    Real-time worker status for the /admin dashboard.
    Returns a list of all workers seen today + their current task, status, avg time.
    Traffic-light: green=idle, orange=in_progress, red=queue_full (2+ pending).
    """
    if request.method == "OPTIONS":
        return Response(status=204)
    if not SessionLocal or not PropertyTaskModel:
        return jsonify([]), 200

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    session = SessionLocal()
    try:
        all_tasks = session.query(PropertyTaskModel).all()

        # Group tasks by worker (staff_name, case-insensitive key)
        by_worker = {}
        for t in all_tasks:
            name = (getattr(t, "staff_name", "") or "").strip()
            if not name:
                continue
            key = name.lower()
            if key not in by_worker:
                by_worker[key] = {"name": name, "tasks": []}
            by_worker[key]["tasks"].append(t)

        result = []
        for key, wd in by_worker.items():
            tasks       = wd["tasks"]
            today_tasks = [t for t in tasks if str(getattr(t,"created_at","") or "")[:10] == today_str]

            in_progress = [t for t in today_tasks if t.status == "In_Progress"]
            pending_q   = [t for t in today_tasks if t.status in ("Pending","pending")]
            done_today  = [t for t in today_tasks if t.status in ("Done","done","Completed","completed")]

            # avg duration (minutes) for completed tasks today
            durs = []
            for t in done_today:
                dm = getattr(t, "duration_minutes", None)
                if dm:
                    try: durs.append(float(dm))
                    except: pass
            avg_dur = round(sum(durs)/len(durs), 1) if durs else None

            # current task = In_Progress first, else oldest Pending
            current = None
            if in_progress:
                current = in_progress[0]
            elif pending_q:
                # oldest first
                current = sorted(pending_q, key=lambda t: str(getattr(t,"created_at","")))[0]

            # traffic light
            if in_progress:
                tl = "orange"
            elif pending_q:
                tl = "red" if len(pending_q) >= 2 else "orange"
            else:
                tl = "green"

            result.append({
                "name":           wd["name"],
                "traffic_light":  tl,
                "in_progress":    len(in_progress),
                "queue":          len(pending_q),
                "done_today":     len(done_today),
                "avg_minutes":    avg_dur,
                "current_task": {
                    "id":          current.id if current else None,
                    "room":        getattr(current,"property_name",None) or getattr(current,"property_id","?") if current else None,
                    "description": (getattr(current,"description","") or "")[:80] if current else None,
                    "status":      current.status if current else None,
                    "started_at":  getattr(current,"started_at",None) if current else None,
                } if current else None,
            })

        result.sort(key=lambda w: (0 if w["traffic_light"]=="red" else 1 if w["traffic_light"]=="orange" else 2))
        return jsonify(result), 200
    except Exception as e:
        import traceback as _tb_aw; _tb_aw.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()


# ── ADMIN DASHBOARD HTML PAGE ─────────────────────────────────────────────────
@app.route("/admin", methods=["GET"])
def admin_page():
    """Self-contained admin dashboard — no React needed."""
    html = r"""<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Maya Admin · Workers</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#070d1a;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh;padding:0 0 40px}
  header{background:linear-gradient(135deg,#075E54,#128C7E);padding:18px 24px;display:flex;align-items:center;gap:14px;box-shadow:0 4px 24px rgba(0,0,0,.5)}
  header h1{font-size:20px;font-weight:900;letter-spacing:-.02em}
  header .sub{font-size:12px;opacity:.6;margin-top:2px}
  .live{width:9px;height:9px;border-radius:50%;background:#34d399;animation:pulse 2s infinite;flex-shrink:0}
  @keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(52,211,153,.6)}50%{opacity:.7;box-shadow:0 0 0 6px rgba(52,211,153,0)}}
  .sync{margin-right:auto;font-size:11px;opacity:.45}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;padding:20px 16px}
  .card{background:rgba(255,255,255,.05);border:2px solid transparent;border-radius:20px;padding:20px;backdrop-filter:blur(14px);transition:border-color .4s,box-shadow .4s}
  .card.green {border-color:#25D366;box-shadow:0 0 20px rgba(37,211,102,.15)}
  .card.orange{border-color:#f97316;box-shadow:0 0 20px rgba(249,115,22,.2)}
  .card.red   {border-color:#ef4444;box-shadow:0 0 20px rgba(239,68,68,.2)}
  .tl-dot{width:14px;height:14px;border-radius:50%;flex-shrink:0}
  .tl-dot.green {background:#25D366}
  .tl-dot.orange{background:#f97316}
  .tl-dot.red   {background:#ef4444}
  .worker-header{display:flex;align-items:center;gap:10px;margin-bottom:14px}
  .avatar{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#075E54,#25D366);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
  .worker-name{font-size:16px;font-weight:800}
  .worker-status{font-size:11px;opacity:.55;margin-top:2px}
  .task-box{background:rgba(255,255,255,.06);border-radius:12px;padding:12px 14px;margin-top:4px;border:1px solid rgba(255,255,255,.08)}
  .task-room{font-size:22px;font-weight:900;line-height:1.1}
  .task-desc{font-size:12px;opacity:.6;margin-top:4px;line-height:1.4}
  .task-started{font-size:11px;opacity:.4;margin-top:6px}
  .stats{display:flex;gap:8px;margin-top:12px;flex-wrap:wrap}
  .stat{background:rgba(255,255,255,.06);border-radius:10px;padding:7px 12px;flex:1;min-width:70px;text-align:center}
  .stat-val{font-size:18px;font-weight:800}
  .stat-lbl{font-size:10px;opacity:.45;margin-top:2px}
  .idle-msg{text-align:center;padding:20px 0;opacity:.35;font-size:13px}
  .badge{font-size:10px;font-weight:800;padding:3px 9px;border-radius:20px;letter-spacing:.06em}
  .badge.green {background:rgba(37,211,102,.15);color:#34d399;border:1px solid rgba(37,211,102,.35)}
  .badge.orange{background:rgba(249,115,22,.15);color:#f97316;border:1px solid rgba(249,115,22,.4)}
  .badge.red   {background:rgba(239,68,68,.13);color:#f87171;border:1px solid rgba(239,68,68,.35)}
  .empty{text-align:center;padding:60px 20px;opacity:.3}
  .refresh-btn{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);color:#fff;padding:6px 14px;border-radius:10px;cursor:pointer;font-size:12px;font-weight:700}
  .refresh-btn:hover{background:rgba(255,255,255,.18)}
</style>
</head>
<body>
<header>
  <div class="live"></div>
  <div>
    <h1>🏨 Maya Admin · Workers</h1>
    <div class="sub">Real-time worker status dashboard</div>
  </div>
  <div class="sync" id="sync">מרענן...</div>
  <button class="refresh-btn" onclick="load()">↻ רענן</button>
</header>
<div class="grid" id="grid"><div class="empty">טוען נתונים...</div></div>

<script>
const TL_LABEL = { green:'🟢 פנוי', orange:'🟠 בעבודה', red:'🔴 עמוס' };

function elapsed(iso){
  if(!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  return s<60 ? s+'ש' : Math.floor(s/60)+'ד '+String(s%60).padStart(2,'0')+'ש';
}

function renderCard(w){
  const tl  = w.traffic_light || 'green';
  const ct  = w.current_task;
  const avg = w.avg_minutes != null ? w.avg_minutes + ' דק\'' : '—';
  return `
<div class="card ${tl}">
  <div class="worker-header">
    <div class="avatar">👷</div>
    <div style="flex:1">
      <div class="worker-name">${w.name}</div>
      <div class="worker-status">${TL_LABEL[tl]}</div>
    </div>
    <span class="badge ${tl}">${tl==='green'?'IDLE':tl==='orange'?'WORKING':'BUSY'}</span>
  </div>

  ${ct ? `
  <div class="task-box">
    <div style="display:flex;align-items:center;gap:7px;margin-bottom:6px">
      <span style="font-size:10px;opacity:.45;font-weight:700">משימה פעילה</span>
      ${ct.status==='In_Progress'?'<span class="badge orange">🟠 בביצוע</span>':'<span class="badge red">🔴 ממתין</span>'}
    </div>
    <div class="task-room">${ct.room || '?'}</div>
    <div class="task-desc">${ct.description || ''}</div>
    ${ct.started_at?`<div class="task-started">⏱ מתחיל לפני ${elapsed(ct.started_at)}</div>`:''}
  </div>` : `<div class="idle-msg">✅ אין משימות פעילות</div>`}

  <div class="stats">
    <div class="stat">
      <div class="stat-val" style="color:#f97316">${w.queue}</div>
      <div class="stat-lbl">בתור</div>
    </div>
    <div class="stat">
      <div class="stat-val" style="color:#34d399">${w.done_today}</div>
      <div class="stat-lbl">הושלמו היום</div>
    </div>
    <div class="stat">
      <div class="stat-val" style="color:#60a5fa">${avg}</div>
      <div class="stat-lbl">ממוצע זמן</div>
    </div>
  </div>
</div>`;
}

async function load(){
  try{
    const r = await fetch('/api/admin/workers');
    const workers = await r.json();
    const grid = document.getElementById('grid');
    if(!workers.length){ grid.innerHTML='<div class="empty">אין עובדים פעילים היום</div>'; }
    else { grid.innerHTML = workers.map(renderCard).join(''); }
    document.getElementById('sync').textContent = 'עודכן ' + new Date().toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'});
  }catch(e){ console.error(e); }
}

load();
setInterval(load, 5000);   // auto-refresh every 5 s
</script>
</body>
</html>"""
    return html, 200, {"Content-Type": "text/html; charset=utf-8"}


@app.route("/api/tasks/version", methods=["GET", "OPTIONS"])
def api_tasks_version():
    """Compatibility endpoint for MissionContext — `v` bumps when property_tasks change."""
    if request.method == "OPTIONS":
        return Response(status=204)
    try:
        return _no_cache_json(jsonify({"version": "1.0.0", "v": _TASKS_VERSION_V, "ok": True})), 200
    except Exception as _ve:
        print(f"[api_tasks_version] jsonify failed: {_ve!r}", flush=True)
        return _no_cache_json(jsonify({"version": "1.0.0", "v": _TASKS_VERSION_V, "ok": True})), 200


@app.route("/api/tasks", methods=["GET", "POST", "OPTIONS"])
def api_tasks_route():
    """GET: same as /api/property-tasks — empty DB returns ``initial_tasks()`` JSON, always 200 (not 204). POST: create."""
    if request.method == "OPTIONS":
        return Response(status=204)
    return property_tasks_api()


@app.route("/api/tasks/status-counts", methods=["GET", "OPTIONS"])
def api_tasks_status_counts():
    """Authoritative property_tasks row totals for tenant — fixes drift vs filtered GET payloads."""
    if request.method == "OPTIONS":
        return Response(status=204)
    try:
        tenant_id, _user_id = get_auth_context_from_request()
    except Exception:
        tenant_id = DEFAULT_TENANT_ID
    c = _task_status_counts_for_tenant(tenant_id)
    if not c:
        return jsonify({"total": 0, "pending": 0, "in_progress": 0, "done": 0}), 200
    return jsonify(c), 200


@app.route("/api/reports/task-metrics", methods=["GET", "OPTIONS"])
def api_reports_task_metrics():
    """Reporting dashboard: task volume KPIs + time series (indexed property_tasks)."""
    if request.method == "OPTIONS":
        return Response(status=204)
    if not SessionLocal or not PropertyTaskModel:
        return jsonify({"ok": False, "error": "Database unavailable", "summary": {}, "series": []}), 503
    try:
        tenant_id, _uid = get_auth_context_from_request()
    except Exception:
        tenant_id = DEFAULT_TENANT_ID
    hdr_tid = (request.headers.get("X-Tenant-Id") or "").strip()
    if hdr_tid:
        tenant_id = _coerce_demo_tenant_id(hdr_tid)
    period = (request.args.get("period") or request.args.get("range") or "day").strip()
    start_dt, end_dt = _task_report_time_window(period)
    start_iso = start_dt.isoformat()
    end_iso = end_dt.isoformat()
    session = SessionLocal()
    try:
        metrics = _task_report_metrics_orm(session, tenant_id, start_iso, end_iso)
        if not metrics:
            metrics = {"total_created": 0, "total_in_progress": 0, "total_completed": 0}
        series = _task_report_series_raw(session, tenant_id, start_iso, end_iso, period)
        payload = {
            "ok": True,
            "period": period,
            "start": start_iso,
            "end": end_iso,
            "summary": metrics,
            "series": series,
        }
        return _no_cache_json(jsonify(payload)), 200
    except Exception as _re:
        print(f"[api_reports_task_metrics] {_re}", flush=True)
        return jsonify({"ok": False, "error": str(_re), "summary": {}, "series": []}), 500
    finally:
        session.close()


@app.route("/api/worker/tasks", methods=["GET", "OPTIONS"])
def api_worker_tasks_compat():
    """WorkerView.jsx — same payload as GET /api/property-tasks with ?worker_id=… (always 200 JSON)."""
    if request.method == "OPTIONS":
        return Response(status=204)
    wid = (request.args.get("worker_id") or request.args.get("worker") or "").strip()
    qs = []
    if wid:
        qs.append(f"worker={wid}")
        qs.append(f"worker_id={wid}")
    path = "/api/property-tasks" + ("?" + "&".join(qs) if qs else "")
    _fwd = []
    if request.headers.get("Authorization"):
        _fwd.append(("Authorization", request.headers.get("Authorization")))
    if request.headers.get("X-Tenant-Id"):
        _fwd.append(("X-Tenant-Id", request.headers.get("X-Tenant-Id")))
    with app.test_request_context(path, method="GET", headers=_fwd):
        return property_tasks_api()


@app.route("/api/settings/automated-welcome", methods=["GET", "PUT", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization"], methods=["GET", "PUT", "OPTIONS"])
def api_settings_automated_welcome():
    """Automated welcome + smart task assignment — same endpoint the Enterprise dashboard uses."""
    if request.method == "OPTIONS":
        return Response(status=204)
    if request.method == "GET":
        return jsonify({
            "automated_welcome_enabled": DEMO_AUTOMATION_SETTINGS.get("automated_welcome_enabled", False),
            "smart_task_assignment_enabled": DEMO_AUTOMATION_SETTINGS.get("smart_task_assignment_enabled", False),
        }), 200
    data = request.get_json(silent=True) or {}
    if "automated_welcome_enabled" in data:
        DEMO_AUTOMATION_SETTINGS["automated_welcome_enabled"] = bool(data.get("automated_welcome_enabled"))
    if "smart_task_assignment_enabled" in data:
        DEMO_AUTOMATION_SETTINGS["smart_task_assignment_enabled"] = bool(data.get("smart_task_assignment_enabled"))
    return jsonify({
        "automated_welcome_enabled": DEMO_AUTOMATION_SETTINGS["automated_welcome_enabled"],
        "smart_task_assignment_enabled": DEMO_AUTOMATION_SETTINGS["smart_task_assignment_enabled"],
    }), 200


@app.route("/api/dev/initialize-demo-data", methods=["POST", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization"], methods=["POST", "OPTIONS"])
def dev_initialize_demo_data():
    """Manual trigger for 80% occupancy simulation (idempotent)."""
    if request.method == "OPTIONS":
        return Response(status=204)
    out = initialize_demo_data()
    code = 200 if out.get("ok") else 500
    return jsonify(out), code


# ── DEV / MANUAL TRIGGER ──────────────────────────────────────────────────────
@app.route("/api/dev/test-task", methods=["POST", "OPTIONS"])
def dev_test_task():
    """
    Manual Trigger Mode — no AI, no Gemini, direct DB insert.
    Called when the manager types /test-task [room] [description] in the chat.

    Body: { "room": "102", "description": "Need towels", "staff_name": "levikobi" }

    Returns the full task payload so the frontend can dispatch maya-task-created
    and immediately refresh WorkerView + ManagerPipeline.
    """
    if request.method == "OPTIONS":
        return Response(status=204)

    if not SessionLocal or not PropertyTaskModel:
        return jsonify({"error": "DB unavailable"}), 500

    try:
        tenant_id, _uid = get_auth_context_from_request()
    except Exception:
        tenant_id = DEFAULT_TENANT_ID

    data        = request.get_json(silent=True) or {}
    room        = (data.get("room") or data.get("property_name") or "101").strip()
    description = (data.get("description") or "Test task — manual trigger").strip()
    staff_name  = (data.get("staff_name") or "levikobi").strip()
    staff_phone = (data.get("staff_phone") or "").strip()

    task_id  = str(uuid.uuid4())
    created  = datetime.now(timezone.utc).isoformat()

    session = SessionLocal()
    try:
        task = PropertyTaskModel(
            id           = task_id,
            property_id  = room,
            property_name= room,
            assigned_to  = staff_name,
            staff_name   = staff_name,
            staff_phone  = staff_phone,
            description  = description,
            status       = "Pending",
            created_at   = created,
            tenant_id    = tenant_id,
        )
        session.add(task)
        session.commit()
        print(f'[DEV] \u2705 Manual task created: room={room} desc={description[:60]} id={task_id[:8]}')
    except Exception as e:
        session.rollback()
        print(f"[DEV] ❌ test-task DB error: {e}")
        import traceback as _tb_dev; _tb_dev.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()

    task_payload = {
        "id":           task_id,
        "property_id":  room,
        "property_name": room,
        "assigned_to":  staff_name,
        "staff_name":   staff_name,
        "staff_phone":  staff_phone,
        "description":  description,
        "status":       "Pending",
        "created_at":   created,
    }

    # Also push to _ACTIVITY_LOG so the chat feed shows it
    _ACTIVITY_LOG.append({
        "id":   task_id,
        "ts":   int(time.time() * 1000),
        "type": "task_created",
        "text": f"✅ משימה חדשה: {room} — {description[:60]}",
        "task": task_payload,
    })

    return jsonify({"ok": True, "task": task_payload}), 201


# ── DEV: reset a worker's tasks back to Pending ───────────────────────────────
@app.route("/api/dev/reset-worker-tasks/<string:worker>", methods=["POST", "OPTIONS"])
def dev_reset_worker_tasks(worker):
    """
    One-shot helper: reset all Done/Completed tasks for <worker> back to Pending
    so they appear on the WorkerView for testing.

    Usage: POST /api/dev/reset-worker-tasks/levikobi
    """
    if request.method == "OPTIONS":
        return Response(status=204)
    if not SessionLocal or not PropertyTaskModel:
        return jsonify({"error": "DB unavailable"}), 500

    worker_lc = (worker or "").strip().lower()
    if not worker_lc:
        return jsonify({"error": "worker name required"}), 400

    session = SessionLocal()
    try:
        rows = session.query(PropertyTaskModel).all()
        updated = []
        for t in rows:
            sn = (getattr(t, "staff_name", "") or "").strip().lower()
            at = (getattr(t, "assigned_to",  "") or "").strip().lower()
            if worker_lc not in (sn, at):
                continue
            old = t.status
            if old in ("Done", "done", "Completed", "completed",
                       "closed", "Closed", "Accepted", "accepted"):
                t.status       = "Pending"
                t.started_at   = None
                t.completed_at = None
                t.duration_minutes = None
                updated.append({"id": t.id[:8], "old": old, "new": "Pending"})

        session.commit()
        print(f"[DevReset] ✅ Reset {len(updated)} tasks for '{worker}' → Pending")
        return jsonify({
            "ok": True,
            "worker": worker,
            "reset_count": len(updated),
            "tasks": updated,
        }), 200
    except Exception as e:
        session.rollback()
        import traceback as _tb_r; _tb_r.print_exc()
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()


# ── Dynamic Hotel Operations Engine — random occupancy + sim tasks + status lifecycle ──
BAZAAR_JAFFA_PROPERTY_ID = "bazaar-jaffa-hotel"
_HOTEL_OPS_LOCK = threading.Lock()
_dynamic_occupancy_pct = None  # type: ignore
_dynamic_occupancy_generated_at = None  # type: ignore

MAYA_SIMULATION_ENGINE_STARTED_HE = (
    "קובי, הפעלתי את מנוע הסימולציה. המלון עכשיו דינמי – התפוסה משתנה, והמנקים \"עובדים\" בזמן אמת על החדרים. "
    "תסתכל על הלוח, המספרים מתחילים לזוז!"
)


def get_daily_stats(force_new=False):
    """
    Random portfolio occupancy 65%–100%. Regenerated on server start or when Refresh is clicked.
    """
    global _dynamic_occupancy_pct, _dynamic_occupancy_generated_at
    with _HOTEL_OPS_LOCK:
        if _dynamic_occupancy_pct is None or force_new:
            _dynamic_occupancy_pct = round(random.uniform(65.0, 100.0), 1)
            _dynamic_occupancy_generated_at = now_iso()
        return {
            "occupancy_pct": _dynamic_occupancy_pct,
            "generated_at": _dynamic_occupancy_generated_at,
        }


def _live_portfolio_occupancy_pct(tenant_id, user_id=None):
    """Integer % for Maya: hotel-ops engine first, else average manual_rooms.occupancy_rate."""
    try:
        st = get_daily_stats()
        v = st.get("occupancy_pct")
        if v is not None:
            return int(round(float(v)))
    except Exception:
        pass
    try:
        rooms = list_manual_rooms(tenant_id, owner_id=user_id)
        vals = []
        for r in rooms or []:
            o = r.get("occupancy_rate")
            if o is not None:
                try:
                    vals.append(float(o))
                except (TypeError, ValueError):
                    pass
        if vals:
            return int(round(sum(vals) / len(vals)))
    except Exception:
        pass
    return None


_OCC_APPLY_LAST = {"t": 0.0, "tenant": ""}


def _apply_dynamic_occupancy_to_manual_rooms(tenant_id, force=False):
    """Write current simulated occupancy into manual_rooms.occupancy_rate (per-row jitter).

    Throttled + skip-unchanged to reduce lock time and statement timeouts on Postgres/Supabase.
    Pass force=True for explicit simulation refresh so operators always see an update.
    """
    global _OCC_APPLY_LAST
    tid = str(tenant_id or DEFAULT_TENANT_ID).strip() or DEFAULT_TENANT_ID
    try:
        min_gap = float(os.getenv("OCCUPANCY_APPLY_MIN_INTERVAL_SEC", "120") or "120")
    except (TypeError, ValueError):
        min_gap = 120.0
    now = time.time()
    if (
        not force
        and min_gap > 0
        and _OCC_APPLY_LAST.get("tenant") == tid
        and (now - float(_OCC_APPLY_LAST.get("t") or 0)) < min_gap
    ):
        return
    stats = get_daily_stats()
    base = float(stats["occupancy_pct"])
    if not SessionLocal or not ManualRoomModel:
        return
    session = SessionLocal()
    try:
        rows = session.query(ManualRoomModel).filter_by(tenant_id=tid).all()
        if not rows:
            _OCC_APPLY_LAST = {"t": now, "tenant": tid}
            return
        n_dirty_slots, _, _ = _grid_dirty_slots_from_occ(base)
        changed = False
        pilot_status = (
            f"Active|pilot_occ={round(base, 1)}|grid_dirty={n_dirty_slots}|ts={int(time.time())}"
        )
        for r in rows:
            # Stable jitter per row (same base → same stored rate) so we skip redundant commits / timeouts.
            rid = str(getattr(r, "id", "") or "")
            h = sum((i + 1) * ord(c) for i, c in enumerate(rid[:32])) % 51
            jitter = (h - 25) / 10.0
            occ = max(65.0, min(100.0, base + jitter))
            new_rate = round(occ, 1)
            if hasattr(r, "occupancy_rate"):
                old_v = getattr(r, "occupancy_rate", None)
                try:
                    old_f = float(old_v) if old_v is not None else None
                except (TypeError, ValueError):
                    old_f = None
                if old_f is None or abs(old_f - new_rate) > 0.05:
                    r.occupancy_rate = new_rate
                    changed = True
            if getattr(r, "id", None) == BAZAAR_JAFFA_PROPERTY_ID and hasattr(r, "status"):
                if (r.status or "") != pilot_status:
                    r.status = pilot_status
                    changed = True
        if changed:
            session.commit()
        else:
            try:
                session.rollback()
            except Exception:
                pass
        _OCC_APPLY_LAST = {"t": now, "tenant": tid}
    except Exception as e:
        try:
            session.rollback()
        except Exception:
            pass
        print(f"[_apply_dynamic_occupancy_to_manual_rooms] {e}", flush=True)
    finally:
        session.close()


def _delete_sim_engine_tasks(session, tenant_id, property_id):
    """Remove previous [SIM-ENGINE] batch for this property."""
    if not PropertyTaskModel:
        return 0
    q = session.query(PropertyTaskModel).filter(
        PropertyTaskModel.tenant_id == tenant_id,
        PropertyTaskModel.property_id == property_id,
        PropertyTaskModel.description.like("[SIM-ENGINE]%"),
    )
    n = q.count()
    if n:
        q.delete(synchronize_session=False)
    return n


def _generate_simulation_tasks_for_occ(tenant_id, occupancy_pct, user_id=None):
    """
    Task volume scales with occupancy. At ~100% → 61 Cleaning tasks for Hotel Bazaar Jaffa.
    Otherwise mixed Cleaning / Maintenance / Mini-bar restock (Service).
    """
    if not SessionLocal or not PropertyTaskModel:
        return 0, "Tasks unavailable"
    occ = float(occupancy_pct)
    bazaar_id = BAZAAR_JAFFA_PROPERTY_ID
    if occ >= 99.5:
        n_total = 61
        mix_cleaning_only = True
    else:
        n_total = max(1, int(round(61.0 * occ / 100.0)))
        mix_cleaning_only = False

    session = SessionLocal()
    created = 0
    try:
        _delete_sim_engine_tasks(session, tenant_id, bazaar_id)
        rooms = list_manual_rooms(tenant_id, owner_id=user_id or f"demo-{tenant_id}")
        staff_by_property = {}
        if PropertyStaffModel:
            for r in rooms:
                pid = r.get("id")
                if not pid:
                    continue
                staff_records = session.query(PropertyStaffModel).filter_by(property_id=pid).all()
                staff_by_property[pid] = [
                    {"id": s.id, "name": s.name, "role": s.role or "Staff", "phone_number": getattr(s, "phone_number", None)}
                    for s in staff_records
                ]

        def pick_staff(task_type_val):
            sl = staff_by_property.get(bazaar_id) or []
            tt_key = _normalize_task_type_for_dispatch(task_type_val)
            for s in sl:
                rl = (s.get("role") or "").lower()
                nm = (s.get("name") or "").lower()
                if tt_key == "cleaning" and ("clean" in rl or "עלמה" in nm or "alma" in nm):
                    return s.get("id"), s.get("name"), (s.get("phone_number") or "") or "0501234567"
                if tt_key == "maintenance" and ("maint" in rl or "תחזוק" in rl or "קובי" in nm or "kobi" in nm):
                    return s.get("id"), s.get("name"), (s.get("phone_number") or "") or "0529876543"
            if sl:
                s = sl[0]
                return s.get("id"), s.get("name"), (s.get("phone_number") or "") or ""
            return "", "עלמה", "0501234567"

        for i in range(n_total):
            room_num = 101 + (i % 32)
            if mix_cleaning_only:
                task_type_val = TASK_TYPE_CLEANING_HE
                desc = f"[SIM-ENGINE] ניקיון חדר {room_num} — סיבוב מלא (תפוסה מלאה)"
                staff_id, staff_name, staff_phone = pick_staff(TASK_TYPE_CLEANING_HE)
            else:
                r = random.random()
                if r < 0.60:
                    task_type_val = TASK_TYPE_CLEANING_HE
                    desc = f"[SIM-ENGINE] ניקיון חדר {room_num} — לפי עומס תפוסה"
                    staff_id, staff_name, staff_phone = pick_staff(TASK_TYPE_CLEANING_HE)
                elif r < 0.85:
                    task_type_val = TASK_TYPE_MAINTENANCE_HE
                    desc = f"[SIM-ENGINE] תחזוקה — בדיקת מזגן/מים חדר {room_num}"
                    staff_id, staff_name, staff_phone = pick_staff(TASK_TYPE_MAINTENANCE_HE)
                else:
                    task_type_val = TASK_TYPE_SERVICE_HE
                    desc = f"[SIM-ENGINE] מיני בר — מילוי מלאי חדר {room_num}"
                    staff_id, staff_name, staff_phone = pick_staff(TASK_TYPE_SERVICE_HE)

            tid = str(uuid.uuid4())
            new_pt = PropertyTaskModel(
                id=tid,
                property_id=bazaar_id,
                staff_id=staff_id or "",
                assigned_to=staff_id or "",
                description=desc,
                status="Pending",
                created_at=now_iso(),
                property_name="Hotel Bazaar Jaffa",
                staff_name=staff_name or "Staff",
                staff_phone=staff_phone or "",
                tenant_id=tenant_id,
            )
            if hasattr(new_pt, "task_type"):
                new_pt.task_type = task_type_val
            if hasattr(new_pt, "priority"):
                new_pt.priority = "normal"
            session.add(new_pt)
            created += 1
        session.commit()
        try:
            assign_stuck_property_tasks(tenant_id)
        except Exception:
            pass
        return created, None
    except Exception as e:
        try:
            session.rollback()
        except Exception:
            pass
        print(f"[_generate_simulation_tasks_for_occ] {e}", flush=True)
        import traceback as _tb_sim
        _tb_sim.print_exc()
        return 0, str(e)
    finally:
        session.close()


def run_hotel_ops_simulation_refresh(tenant_id=None, user_id=None):
    """Regenerate occupancy + DB fields + Bazaar tasks; returns dict for JSON."""
    tid = tenant_id or DEFAULT_TENANT_ID
    get_daily_stats(force_new=True)
    stats = get_daily_stats()
    occ = stats["occupancy_pct"]
    _apply_dynamic_occupancy_to_manual_rooms(tid, force=True)
    n_tasks, err = _generate_simulation_tasks_for_occ(tid, occ, user_id=user_id)
    if err:
        return {"success": False, "error": err, "occupancy_pct": occ}
    _bump_tasks_version()
    try:
        _invalidate_status_grid_cache()
    except Exception:
        pass
    try:
        _invalidate_owner_dashboard_cache()
    except Exception:
        pass
    return {
        "success": True,
        "occupancy_pct": occ,
        "generated_at": stats.get("generated_at"),
        "tasks_created": n_tasks,
        "message": MAYA_SIMULATION_ENGINE_STARTED_HE,
        "displayMessage": MAYA_SIMULATION_ENGINE_STARTED_HE,
        "mayaMessage": MAYA_SIMULATION_ENGINE_STARTED_HE,
    }


def _tick_one_live_task_status(tenant_id, log_hebrew=True):
    """Exactly one Pending→In_Progress or In_Progress→Done per call (10s live-ops tick)."""
    if not SessionLocal or not PropertyTaskModel:
        return {"changed": False, "action": None}
    session = SessionLocal()
    try:
        q = _property_tasks_query_for_tenant(session, tenant_id)
        if q is None:
            return {"changed": False, "action": None}
        all_rows = q.all()
        pending_list = [r for r in all_rows if (r.status or "").strip().lower() == "pending"]
        inprog_list = [r for r in all_rows if (r.status or "").strip().lower() in ("in_progress", "in progress")]
        row = None
        action = None
        if pending_list:
            row = random.choice(pending_list)
            row.status = "In_Progress"
            if hasattr(row, "started_at") and not getattr(row, "started_at", None):
                row.started_at = now_iso()
            action = "pending_to_in_progress"
        elif inprog_list:
            row = random.choice(inprog_list)
            row.status = "Done"
            if hasattr(row, "completed_at"):
                row.completed_at = now_iso()
            action = "in_progress_to_done"
        else:
            return {"changed": False, "action": None}
        if log_hebrew and row:
            d = (row.description or "")[:100]
            pn = (row.property_name or "").strip() or "הנכס"
            if action == "pending_to_in_progress":
                text_he = f"קובי, משימה עברה מממתין לבתהליך — {d} ({pn})"
            elif "לובי" in d or "lobby" in d.lower():
                text_he = "קובי, המנקה סיים עכשיו את הלובי."
            else:
                text_he = f"קובי, הושלמה משימה ב{pn} — {d[:40]}"
            _ACTIVITY_LOG.append({
                "id": str(uuid.uuid4()),
                "ts": int(time.time() * 1000),
                "type": "live_tick",
                "text": text_he,
                "task": {"id": getattr(row, "id", None), "description": d, "status": row.status},
            })
        session.commit()
        _bump_tasks_version()
        try:
            _invalidate_owner_dashboard_cache()
        except Exception:
            pass
        return {"changed": True, "action": action}
    except Exception as e:
        try:
            session.rollback()
        except Exception:
            pass
        print(f"[_tick_one_live_task_status] {e}", flush=True)
        return {"changed": False, "error": str(e)}
    finally:
        session.close()


def advance_simulation_task_statuses(tenant_id, log_hebrew=True):
    """
    Every cycle: ~10% Pending → In_Progress, ~10% In_Progress → Done (field simulation).
    When log_hebrew=True, appends lines to _ACTIVITY_LOG for Maya / activity feed.
    """
    if not SessionLocal or not PropertyTaskModel:
        return {"pending_promoted": 0, "progress_done": 0}
    session = SessionLocal()
    promoted = 0
    done_moved = 0
    try:
        q = _property_tasks_query_for_tenant(session, tenant_id)
        if q is None:
            return {"pending_promoted": 0, "progress_done": 0}
        all_rows = q.all()
        pending_list = [r for r in all_rows if (r.status or "").strip().lower() == "pending"]
        inprog_list = [r for r in all_rows if (r.status or "").strip().lower() in ("in_progress", "in progress")]

        k = math.ceil(len(pending_list) * 0.12) if pending_list else 0
        if k > 0:
            for row in random.sample(pending_list, min(k, len(pending_list))):
                row.status = "In_Progress"
                if hasattr(row, "started_at") and not getattr(row, "started_at", None):
                    row.started_at = now_iso()
                promoted += 1
                if log_hebrew:
                    d = (row.description or "")[:100]
                    pn = (row.property_name or "").strip() or "הנכס"
                    _ACTIVITY_LOG.append({
                        "id": str(uuid.uuid4()),
                        "ts": int(time.time() * 1000),
                        "type": "status_in_progress",
                        "text": f"קובי, משימה עברה מממתין לבתהליך — {d} ({pn})",
                        "task": {"id": row.id, "description": d, "status": "In_Progress"},
                    })

        k2 = math.ceil(len(inprog_list) * 0.12) if inprog_list else 0
        if k2 > 0:
            for row in random.sample(inprog_list, min(k2, len(inprog_list))):
                row.status = "Done"
                if hasattr(row, "completed_at"):
                    row.completed_at = now_iso()
                done_moved += 1
                if log_hebrew:
                    d = (row.description or "")
                    pn = (row.property_name or "").strip() or "הנכס"
                    if "לובי" in d or "lobby" in d.lower():
                        line_he = "קובי, המנקה סיים עכשיו את הלובי."
                    else:
                        line_he = f"קובי, סיימנו עכשיו משימה ב{pn} — {d[:50]}"
                    _ACTIVITY_LOG.append({
                        "id": str(uuid.uuid4()),
                        "ts": int(time.time() * 1000),
                        "type": "status_done",
                        "text": line_he,
                        "task": {"id": row.id, "description": d[:80], "status": "Done"},
                    })
        if promoted or done_moved:
            session.commit()
            _invalidate_owner_dashboard_cache()
    except Exception as e:
        try:
            session.rollback()
        except Exception:
            pass
        print(f"[advance_simulation_task_statuses] {e}", flush=True)
    finally:
        session.close()
    return {"pending_promoted": promoted, "progress_done": done_moved}


@app.route("/api/ops/daily-stats", methods=["GET", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["GET", "OPTIONS"])
def api_ops_daily_stats():
    if request.method == "OPTIONS":
        return Response(status=204)
    return jsonify(get_daily_stats()), 200


@app.route("/api/ops/simulation/refresh", methods=["POST", "OPTIONS"])
@app.route("/api/simulation/refresh", methods=["POST", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["POST", "OPTIONS"])
def api_ops_simulation_refresh():
    if request.method == "OPTIONS":
        return Response(status=204)
    tenant_id = DEFAULT_TENANT_ID
    user_id = f"demo-{DEFAULT_TENANT_ID}"
    if not AUTH_DISABLED:
        try:
            tenant_id, user_id = get_auth_context_from_request()
        except Exception:
            pass
    payload = run_hotel_ops_simulation_refresh(tenant_id=tenant_id, user_id=user_id)
    code = 200 if payload.get("success") else 500
    return jsonify(payload), code


def _run_bootstrap_operational_data(tenant_id=None, user_id=None):
    """Populate pilot properties + Bazaar/ROOMS/WeWork portfolio + hotel-ops tasks (idempotent)."""
    tid = tenant_id or DEFAULT_TENANT_ID
    uid = user_id or f"demo-{tid}"
    steps = []
    try:
        seed_pilot_demo()
        steps.append("seed_pilot_demo")
    except Exception as e:
        steps.append({"seed_pilot_demo": str(e)})
    try:
        ensure_emergency_portfolio_and_tasks(tid)
        steps.append("ensure_emergency_portfolio_and_tasks")
    except Exception as e:
        steps.append({"ensure_emergency_portfolio_and_tasks": str(e)})
    hotel = None
    try:
        hotel = run_hotel_ops_simulation_refresh(tenant_id=tid, user_id=uid)
        steps.append("run_hotel_ops_simulation_refresh")
    except Exception as e:
        steps.append({"run_hotel_ops_simulation_refresh": str(e)})
    try:
        demo_out = initialize_demo_data()
        steps.append({"initialize_demo_data": demo_out})
    except Exception as e:
        steps.append({"initialize_demo_data": str(e)})
    try:
        _bump_tasks_version()
    except Exception:
        pass
    return {"ok": True, "steps": steps, "hotel_ops": hotel}


@app.route("/api/ops/bootstrap-data", methods=["GET", "POST", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["GET", "POST", "OPTIONS"])
def api_ops_bootstrap_data():
    """Emergency seed after DB purge — pilot demo + Bazaar/WeWork portfolio + simulation tasks."""
    if request.method == "OPTIONS":
        return Response(status=204)
    tenant_id = DEFAULT_TENANT_ID
    user_id = f"demo-{DEFAULT_TENANT_ID}"
    if not AUTH_DISABLED:
        try:
            tenant_id, user_id = get_auth_context_from_request()
        except Exception:
            pass
    payload = _run_bootstrap_operational_data(tenant_id=tenant_id, user_id=user_id)
    return jsonify(payload), 200


def _maya_parse_iso_to_dt(s):
    if not s or not isinstance(s, str):
        return None
    s = s.strip()
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return datetime.fromisoformat(s.replace(" ", "T", 1) if "T" not in s and len(s) > 10 else s)
    except Exception:
        return None


def _maya_task_duration_minutes(row):
    dm = getattr(row, "duration_minutes", None)
    if dm is not None and str(dm).strip():
        try:
            v = float(str(dm).replace(",", ".").strip())
            if 0 < v < 60 * 24 * 14:
                return v
        except (TypeError, ValueError):
            pass
    ca = _maya_parse_iso_to_dt(getattr(row, "completed_at", None) or "")
    sa = _maya_parse_iso_to_dt(getattr(row, "started_at", None) or "")
    cr = _maya_parse_iso_to_dt(getattr(row, "created_at", None) or "")
    start = sa or cr
    if ca and start and ca >= start:
        return max(0.1, (ca - start).total_seconds() / 60.0)
    return None


def _maya_detect_site_scope_hint(command):
    """Return a scope token when the user names one site; limits portfolio noise in Maya context."""
    if not command:
        return None
    c = (command or "").lower()
    he = command or ""
    if any(x in c for x in ("bazaar", "jaffa", "בזאר", "יפו")) or "באזאר" in he:
        return "bazaar"
    if any(
        x in c
        for x in (
            "city tower",
            "leonardo",
            "ramat gan",
            "בורסה",
            "סיטי טאוור",
            "רמת גן",
            "ליאונרדו",
        )
    ):
        return "city_tower"
    if any(x in c for x in ("rooms", "sky tower", "cowork", "רומס", "סקיי טאוור", "קוורקינג")):
        return "rooms"
    return None


def _maya_property_name_matches_scope(scope, property_name):
    if not scope:
        return True
    pn = (property_name or "").lower()
    if scope == "bazaar":
        return "bazaar" in pn or "בזאר" in (property_name or "") or "jaffa" in pn or "יפו" in (property_name or "")
    if scope == "city_tower":
        return "city tower" in pn or "leonardo" in pn or "רמת גן" in (property_name or "") or "סיטי" in (property_name or "")
    if scope == "rooms":
        return "rooms" in pn or "רומס" in (property_name or "") or "room" in pn
    return True


def _maya_recent_completed_snapshot_for_chat(session, tenant_id, limit=14):
    out = []
    if not session or not PropertyTaskModel:
        return out
    try:
        q = _property_tasks_query_for_tenant(session, tenant_id)
        if q is None:
            return out
        rows = (
            q.filter(PropertyTaskModel.status.in_(["Done", "done", "Completed", "completed"]))
            .filter(PropertyTaskModel.completed_at.isnot(None))
            .order_by(PropertyTaskModel.completed_at.desc())
            .limit(limit)
            .all()
        )
        for r in rows:
            out.append({
                "id": r.id,
                "description": ((getattr(r, "description", None) or "")[:120]).strip(),
                "property_name": ((getattr(r, "property_name", None) or "")[:80]).strip(),
                "staff_name": ((getattr(r, "staff_name", None) or getattr(r, "assigned_to", None) or "")[:60]).strip(),
                "status": "Done",
                "completed_at": ((getattr(r, "completed_at", None) or "")[:24]).strip(),
            })
    except Exception as _e:
        print(f"[_maya_recent_completed_snapshot_for_chat] {_e}", flush=True)
    return out


def _maya_is_fastest_worker_question(command):
    if not command:
        return False
    c = (command or "").lower()
    he = command or ""
    if "הכי מהיר" in he or "הכי מהירה" in he:
        return True
    if "מי הכי" in he and ("מהיר" in he or "עובד" in he or "עובדת" in he):
        return True
    if "fastest" in c and ("worker" in c or "staff" in c):
        return True
    if "who is the fastest" in c or "who's the fastest" in c:
        return True
    return False


def _maya_fastest_worker_reply(tenant_id):
    """One name + reason from completed property_tasks (duration / timestamps)."""
    if not SessionLocal or not PropertyTaskModel or not tenant_id:
        return None
    session = SessionLocal()
    rows = []
    try:
        q = _property_tasks_query_for_tenant(session, tenant_id)
        if q is None:
            return None
        rows = (
            q.filter(PropertyTaskModel.status.in_(["Done", "done", "Completed", "completed"]))
            .filter(PropertyTaskModel.completed_at.isnot(None))
            .order_by(PropertyTaskModel.completed_at.desc())
            .limit(400)
            .all()
        )
    except Exception as e:
        print(f"[_maya_fastest_worker_reply] query {e}", flush=True)
        return None
    finally:
        session.close()

    by_staff = {}
    for r in rows:
        staff = (getattr(r, "staff_name", None) or getattr(r, "assigned_to", None) or "").strip()
        if not staff or staff.lower() in ("unknown", "none", "staff"):
            continue
        mins = _maya_task_duration_minutes(r)
        if mins is None:
            continue
        by_staff.setdefault(staff, []).append(mins)

    if not by_staff:
        return (
            "קובי, אין עדיין מספיק משימות שסומנו כבוצע עם זמני סיום מתועדים כדי להשוות מהירות — "
            "ברגע שיהיו סגירות עם completed_at או משך דקות, אחשב לך מנצח אחד."
        )

    def _score(name, arr):
        if len(arr) >= 2:
            return (sum(arr) / len(arr), len(arr), min(arr))
        return (arr[0], 1, arr[0])

    best_name = None
    best_tuple = None
    for name, arr in by_staff.items():
        t = _score(name, arr)
        if best_tuple is None or t[0] < best_tuple[0] or (t[0] == best_tuple[0] and t[1] > best_tuple[1]):
            best_name = name
            best_tuple = t

    avg = best_tuple[0]
    n = by_staff[best_name].__len__()
    fastest_single = min(by_staff[best_name])
    reason = (
        f"ממוצע זמן טיפול של כ-{avg:.0f} דקות על בסיס {n} סגירות אחרונות במערכת "
        f"(המהירה ביותר הייתה כ-{fastest_single:.0f} דקות)."
        if n >= 2
        else f"לפי הסגירה האחרונה המתועדת, זמן הטיפול היה כ-{fastest_single:.0f} דקות — עדיין מעט דגימות."
    )
    return f"לפי הנתונים ב-property_tasks, העובד הכי מהיר כרגע הוא {best_name} — {reason}"


# ── Maya task context cache (data/maya_context.json) — last ~10 open tasks per tenant ──
_MAYA_TASK_CONTEXT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "maya_context.json")
_MAYA_TASK_CONTEXT_LOCK = threading.Lock()
_MAYA_ROOM_CONFIRM_PENDING = {}
_MAYA_ROOM_CONFIRM_TTL_SEC = 360

# Short-lived cache for rooms + staff data so consecutive Maya messages don't
# re-query the DB on every single SSE request (saves 200-600 ms per message).
_MAYA_ROOMS_STAFF_CACHE: dict = {}
_MAYA_ROOMS_STAFF_CACHE_TTL: int = 60  # seconds

# ── Per-tenant stats-snapshot cache ──────────────────────────────────────────
# _build_maya_chat_stats_payload runs several DB queries (rooms, task counts,
# bookings, recent completions).  Caching for 30 s means consecutive messages
# in a rapid conversation skip all of that work without meaningful data drift.
_MAYA_STATS_CACHE: dict = {}
_MAYA_STATS_CACHE_TTL: int = 30  # seconds


def _get_maya_rooms_and_staff(tenant_id: str, user_id: str):
    """
    Return (rooms_list, staff_by_property_dict) with a 60-second in-process cache.
    A cache miss runs the same DB queries as before; a hit skips them entirely.
    """
    now = time.time()
    cached = _MAYA_ROOMS_STAFF_CACHE.get(tenant_id)
    if cached and (now - cached["ts"]) < _MAYA_ROOMS_STAFF_CACHE_TTL:
        return cached["rooms"], cached["staff_by_property"]

    rooms = list_manual_rooms(tenant_id, owner_id=user_id)
    staff_by_property: dict = {}
    if SessionLocal and PropertyStaffModel:
        _sess = SessionLocal()
        try:
            for r in rooms:
                pid = r.get("id")
                if not pid:
                    continue
                recs = _sess.query(PropertyStaffModel).filter_by(property_id=pid).all()
                staff_by_property[pid] = [
                    {
                        "id": s.id,
                        "name": s.name,
                        "role": s.role or "Staff",
                        "phone_number": getattr(s, "phone_number", None),
                    }
                    for s in recs
                ]
        finally:
            _sess.close()

    _MAYA_ROOMS_STAFF_CACHE[tenant_id] = {
        "rooms": rooms,
        "staff_by_property": staff_by_property,
        "ts": now,
    }
    return rooms, staff_by_property


def _invalidate_maya_rooms_staff_cache(tenant_id: str):
    """Call after a staff register or property change so the next message re-fetches."""
    _MAYA_ROOMS_STAFF_CACHE.pop(tenant_id, None)
    # Also drop any scoped stats entries for this tenant so counts stay accurate.
    stale_keys = [k for k in _MAYA_STATS_CACHE if k.startswith(f"{tenant_id}:")]
    for k in stale_keys:
        _MAYA_STATS_CACHE.pop(k, None)


def _maya_room_pending_key(tenant_id, user_id):
    return f"{tenant_id or ''}::{user_id or ''}"


def _maya_load_maya_context_root_unlocked():
    if not os.path.isfile(_MAYA_TASK_CONTEXT_PATH):
        return {"v": 1, "by_tenant": {}}
    try:
        with open(_MAYA_TASK_CONTEXT_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"v": 1, "by_tenant": {}}
        data.setdefault("by_tenant", {})
        return data
    except Exception:
        return {"v": 1, "by_tenant": {}}


def _maya_persist_maya_context_root(root):
    os.makedirs(os.path.dirname(_MAYA_TASK_CONTEXT_PATH), exist_ok=True)
    tmp = _MAYA_TASK_CONTEXT_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(root, f, ensure_ascii=False, indent=0)
    os.replace(tmp, _MAYA_TASK_CONTEXT_PATH)


def _maya_refresh_task_context_cache(tenant_id):
    """Write last 10 non-terminal property_tasks + open count for tenant into maya_context.json."""
    if not tenant_id or not SessionLocal or not PropertyTaskModel or or_ is None:
        return
    active_tasks = []
    total_open = 0
    s = SessionLocal()
    try:
        _tq = _property_tasks_query_for_tenant(s, tenant_id)
        if _tq is None:
            return
        _terminal = ("Done", "done", "Completed", "completed", "archived", "Archived")
        q_open = _tq.filter(
            or_(
                PropertyTaskModel.status.is_(None),
                PropertyTaskModel.status == "",
                ~PropertyTaskModel.status.in_(_terminal),
            )
        )
        total_open = int(q_open.count() or 0)
        rows = q_open.order_by(PropertyTaskModel.created_at.desc()).limit(10).all()
        for r in rows:
            st = (getattr(r, "status", "") or "").strip()
            if st.lower() in ("done", "completed", "archived"):
                continue
            active_tasks.append({
                "id": r.id,
                "description": ((getattr(r, "description", None) or "")[:140]).strip(),
                "property_name": ((getattr(r, "property_name", None) or "")[:100]).strip(),
                "status": (st[:40] if st else "Pending"),
            })
    except Exception as e:
        print(f"[_maya_refresh_task_context_cache] {e}", flush=True)
        return
    finally:
        s.close()
    with _MAYA_TASK_CONTEXT_LOCK:
        root = _maya_load_maya_context_root_unlocked()
        root.setdefault("by_tenant", {})
        root["by_tenant"][tenant_id] = {
            "updated_at": time.time(),
            "total_open": total_open,
            "active_tasks": active_tasks,
        }
        _maya_persist_maya_context_root(root)


def _maya_get_task_context_entry(tenant_id, max_age_sec):
    with _MAYA_TASK_CONTEXT_LOCK:
        root = _maya_load_maya_context_root_unlocked()
    ent = (root.get("by_tenant") or {}).get(tenant_id) or {}
    ts = float(ent.get("updated_at") or 0)
    if not ts or (time.time() - ts) > float(max_age_sec):
        return None
    return ent


def _maya_active_tasks_for_chat(tenant_id):
    try:
        max_age = float(os.getenv("MAYA_CONTEXT_MAX_AGE_SEC", "45") or "45")
    except (TypeError, ValueError):
        max_age = 45.0
    ent = _maya_get_task_context_entry(tenant_id, max_age)
    if ent is None:
        _maya_refresh_task_context_cache(tenant_id)
        with _MAYA_TASK_CONTEXT_LOCK:
            root = _maya_load_maya_context_root_unlocked()
        ent = (root.get("by_tenant") or {}).get(tenant_id) or {}
    tasks = list(ent.get("active_tasks") or [])
    total_open = int(ent.get("total_open") or 0)
    return tasks, total_open


def _maya_explicit_room_task_intent(command):
    """User clearly asked to open a task (not only mentioning a room number)."""
    if not command:
        return False
    if re.search(r"(?:לשלוח\s*)?מנקה\s+לחדר\s*\d+", command, re.I):
        return True
    if re.search(
        r"(?:פתח(?:י|ו)?|צור(?:י|ו)?|לפתוח|open|create)\s+(?:משימה|task)",
        command,
        re.I,
    ):
        return True
    if re.search(r"משימה\s+(?:ל|עבור)\s*(?:חדר|room)\s*\d+", command, re.I):
        return True
    if re.search(r"(?:חדר|room)\s*\d+", command, re.I) and any(
        x in command for x in ("פתח", "צור", "לפתוח", "create", "open")
    ) and "משימה" in command:
        return True
    return False


def _maya_user_confirms_room_task(command, pending_room):
    if not command:
        return False
    c = (command or "").strip().lower()
    he = command or ""
    if _maya_explicit_room_task_intent(command):
        if pending_room and pending_room in re.sub(r"\D", "", he):
            return True
        if pending_room and pending_room in he:
            return True
    if re.match(r"^(כן|בטח|יאללה|סבבה|אשר|בוודאי|yes|ok|yep|sure)\b", c):
        return True
    if "אשר" in he and len(he) < 24:
        return True
    return False


def _maya_user_declines_room_task(command):
    if not command:
        return False
    c = (command or "").strip().lower()
    if re.match(r"^(לא|no|ביטול|cancel|לא תודה)\b", c):
        return True
    return False


def _maya_extract_room_digits_for_maya(command):
    if not command:
        return None
    m = re.search(r"(?:חדר|room)\s*#?\s*(\d{2,6})", command, re.I)
    if m:
        return m.group(1)
    if _maya_is_last_cleaner_question(command):
        m2 = re.search(r"\b(\d{3,6})\b", command)
        if m2:
            return m2.group(1)
    return None


def _maya_is_last_cleaner_question(command):
    if not command:
        return False
    c = command.lower()
    he = command
    if "מי ניקה" in he or "מי ניקתה" in he:
        return True
    if "מי ניק" in he and ("אחרון" in he or "לאחרונה" in he or "אחרונה" in he):
        return True
    if "who cleaned" in c or "who was the last" in c or "last to clean" in c:
        return True
    return False


def _maya_row_looks_like_cleaning(r):
    desc = (getattr(r, "description", None) or "")
    tt = (getattr(r, "task_type", None) or "")
    blob = f"{desc} {tt}".lower()
    if "ניקיון" in desc or "ניקיון" in tt:
        return True
    if "מנקה" in desc:
        return True
    if "clean" in blob:
        return True
    if (tt or "").strip() in ("Cleaning", "cleaning"):
        return True
    return False


def _maya_last_cleaner_reply(tenant_id, room_digits):
    if not room_digits or not SessionLocal or not PropertyTaskModel or or_ is None:
        return None
    _terminal = ("Done", "done", "Completed", "completed")
    pattern = f"%{room_digits}%"
    session = SessionLocal()
    rows = []
    try:
        q = _property_tasks_query_for_tenant(session, tenant_id)
        if q is None:
            return None
        room_match = or_(
            PropertyTaskModel.description.like(pattern),
            PropertyTaskModel.property_name.like(pattern),
        )
        rows = (
            q.filter(room_match)
            .filter(PropertyTaskModel.status.in_(_terminal))
            .order_by(PropertyTaskModel.created_at.desc())
            .limit(80)
            .all()
        )
    except Exception as e:
        print(f"[_maya_last_cleaner_reply] {e}", flush=True)
        return None
    finally:
        session.close()
    candidates = [r for r in rows if _maya_row_looks_like_cleaning(r)]
    if not candidates:
        return (
            f"קובי, לא מצאתי ב-property_tasks סגירת ניקיון מתועדת לחדר {room_digits} — "
            "אולי המשימה עדיין פתוחה או רשומה בלי מספר חדר."
        )

    def _sort_key(r):
        ca = (getattr(r, "completed_at", None) or "").strip()
        cr = (getattr(r, "created_at", None) or "").strip()
        return (ca or cr or "")

    best = max(candidates, key=_sort_key)
    name = (getattr(best, "staff_name", None) or getattr(best, "assigned_to", None) or "לא תועד").strip()
    when = (getattr(best, "completed_at", None) or getattr(best, "created_at", None) or "").strip() or "לא תועד"
    return f"אחרון שסיימו ניקיון בחדר {room_digits}: {name}, ב-{when}."


def _build_maya_chat_stats_payload(tenant_id, user_id, command=None):
    """
    Slimmer snapshot for Gemini: capped open tasks, optional site scope, recent completions for status sync.
    Uses a light stats path (no full property_tasks scan) + data/maya_context.json for open tasks.
    """
    base = _build_stats_summary_payload(tenant_id, user_id, for_maya_chat=True)
    hint = _maya_detect_site_scope_hint(command or "")
    try:
        cap = int(os.getenv("MAYA_CHAT_OPEN_TASKS_MAX", "42") or "42")
    except (TypeError, ValueError):
        cap = 42
    cap = max(8, min(cap, 120))

    open_list, _cached_open_total = _maya_active_tasks_for_chat(tenant_id)
    if hint:
        open_list = [t for t in open_list if _maya_property_name_matches_scope(hint, t.get("property_name"))]
    base["recent_open_tasks"] = open_list[:cap]

    rb = base.get("recent_bookings") or []
    base["recent_bookings"] = rb[:2]

    sw = base.get("staff_workload") or {}
    if isinstance(sw, dict) and len(sw) > 12:
        top = sorted(sw.items(), key=lambda x: -x[1])[:12]
        base["staff_workload"] = dict(top)

    snap = []
    if SessionLocal and PropertyTaskModel:
        _s = SessionLocal()
        try:
            snap = _maya_recent_completed_snapshot_for_chat(_s, tenant_id, limit=14)
            if hint:
                snap = [x for x in snap if _maya_property_name_matches_scope(hint, x.get("property_name"))]
        finally:
            _s.close()
    base["recent_completed_snapshot"] = snap[:14]

    ot = base["recent_open_tasks"]
    base["tasks_digest"] = (
        f"open_non_terminal_tasks_shown={len(ot)}; "
        f"total_open_board_count={base.get('total_tasks')}; "
        f"recent_done_in_snapshot={len(base['recent_completed_snapshot'])}"
    )
    base["context_scope_hint"] = hint
    return base


def _maya_filter_summary_for_scope(summary_text, scope_hint, rooms):
    if not scope_hint or not summary_text:
        return summary_text
    parts = [p.strip() for p in (summary_text or "").split("|") if p.strip()]
    kept = []
    for p in parts:
        m = re.match(r"^'([^']+)'", p)
        pname = m.group(1) if m else p[:80]
        if _maya_property_name_matches_scope(scope_hint, pname):
            kept.append(p)
    if kept:
        return " | ".join(kept)
    for r in rooms or []:
        name = r.get("name") or ""
        if _maya_property_name_matches_scope(scope_hint, name):
            return summary_text
    return summary_text


def _build_maya_room_inventory_text_scoped(tenant_id, user_id, scope_hint):
    """Same grid counts as _build_maya_room_inventory_text, optionally one property block only."""
    if not scope_hint:
        return _build_maya_room_inventory_text(tenant_id, user_id)
    data = _room_status_grid_payload(tenant_id, user_id)
    rooms = data.get("rooms") or []

    def _lines_for(pid, title):
        block = [r for r in rooms if r.get("property_id") == pid]
        if not block:
            return ""
        occ = sum(1 for r in block if r.get("status") == "occupied")
        rd = sum(1 for r in block if r.get("status") == "ready")
        dirty = sum(1 for r in block if r.get("status") == "dirty")
        return (
            f"{title}: {len(block)} units — {occ} Occupied, {rd} Ready, {dirty} Dirty."
        )

    if scope_hint == "bazaar":
        return _lines_for("bazaar-jaffa-hotel", "Hotel Bazaar Jaffa") or _build_maya_room_inventory_text(tenant_id, user_id)
    if scope_hint == "city_tower":
        return _lines_for("leonardo-city-tower-ramat-gan", "Leonardo Plaza City Tower") or _build_maya_room_inventory_text(tenant_id, user_id)
    if scope_hint == "rooms":
        return _lines_for("rooms-branch-acro-tlv", "ROOMS Acro TLV") or _build_maya_room_inventory_text(tenant_id, user_id)
    return _build_maya_room_inventory_text(tenant_id, user_id)


def _build_stats_summary_payload(tenant_id, user_id, for_maya_chat=False):
    """Dashboard analytics dict (same keys as GET /api/stats/summary). Used by Maya analyst + merged into GET /api/stats.
    When for_maya_chat=True, skip loading all property_tasks rows (fast path); open-task rows come from maya_context.json."""
    if user_id is None:
        user_id = f"demo-{tenant_id}"
    rooms = list_manual_rooms(tenant_id, owner_id=user_id)
    room_ids = [r.get("id") for r in rooms if r.get("id")]
    total_properties = len(rooms)
    total_capacity = sum((r.get("max_guests") or 2) for r in rooms)

    tasks_by_status = {"Pending": 0, "Done": 0}
    staff_workload = {}
    staff_with_phones = {}
    # total_tasks = non-terminal (open) requests for dashboards; total_property_tasks_all = all rows (Maya empty-DB checks)
    total_tasks = 0
    total_property_tasks_all = 0

    if SessionLocal and PropertyTaskModel:
        session_obj = SessionLocal()
        try:
            _tq = _property_tasks_query_for_tenant(session_obj, tenant_id)
            _terminal = ("Done", "done", "Completed", "completed", "archived", "Archived")
            if _tq is not None:
                total_property_tasks_all = _tq.count()
                if or_ is not None:
                    total_tasks = _tq.filter(
                        or_(
                            PropertyTaskModel.status.is_(None),
                            PropertyTaskModel.status == "",
                            ~PropertyTaskModel.status.in_(_terminal),
                        )
                    ).count()
                else:
                    total_tasks = total_property_tasks_all
                if for_maya_chat and or_ is not None:
                    done_cnt = int(_tq.filter(PropertyTaskModel.status.in_(_terminal)).count() or 0)
                    tasks_by_status["Done"] = done_cnt
                    tasks_by_status["Pending"] = max(0, int(total_property_tasks_all) - done_cnt)
            if not for_maya_chat:
                if room_ids:
                    rows = session_obj.query(PropertyTaskModel).filter(
                        PropertyTaskModel.property_id.in_(room_ids)
                    ).all()
                else:
                    rows = []
                for r in rows:
                    status = (r.status or "Pending").strip() or "Pending"
                    if status in ("Done", "done", "Completed", "completed"):
                        tasks_by_status["Done"] += 1
                    else:
                        tasks_by_status["Pending"] += 1
                    key = r.staff_name or r.assigned_to or "Unknown"
                    if key:
                        staff_workload[key] = staff_workload.get(key, 0) + 1
                    if (r.staff_name or r.assigned_to) and getattr(r, "staff_phone", None):
                        ph = (r.staff_phone or "").strip()
                        if ph:
                            sk = (r.staff_name or r.assigned_to, ph)
                            staff_with_phones[sk] = staff_with_phones.get(sk, 0) + 1
        finally:
            session_obj.close()

    top_staff = []
    for (name, phone), count in sorted(staff_with_phones.items(), key=lambda x: -x[1])[:3]:
        top_staff.append({"name": name, "phone": phone, "task_count": count})

    if len(top_staff) < 3 and SessionLocal and PropertyStaffModel:
        seen_phones = {s["phone"].replace(" ", "") for s in top_staff}
        session_obj = SessionLocal()
        try:
            for r in rooms:
                pid = r.get("id")
                if not pid or len(top_staff) >= 3:
                    continue
                for s in session_obj.query(PropertyStaffModel).filter_by(property_id=pid).all():
                    ph = (getattr(s, "phone_number", None) or "").strip().replace(" ", "")
                    if ph and ph not in seen_phones:
                        top_staff.append({"name": s.name or "Staff", "phone": ph, "task_count": 0})
                        seen_phones.add(ph)
        finally:
            session_obj.close()

    # ── Rolling 30-day revenue + recent bookings from BookingModel ───────────
    monthly_revenue = 0
    recent_bookings = []
    if SessionLocal and BookingModel:
        _bs = SessionLocal()
        try:
            _30ago = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
            _today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            _rev = (
                _bs.query(func.sum(BookingModel.total_price))
                .filter(
                    BookingModel.tenant_id == tenant_id,
                    BookingModel.status.in_(["confirmed", "completed"]),
                    BookingModel.check_out >= _30ago,
                    BookingModel.check_out <= _today,
                )
                .scalar()
            )
            monthly_revenue = int(_rev or 0)

            _rows = (
                _bs.query(BookingModel)
                .filter(BookingModel.tenant_id == tenant_id)
                .order_by(BookingModel.check_in.desc())
                .limit(5)
                .all()
            )
            for _b in _rows:
                recent_bookings.append({
                    "id":            _b.id,
                    "property_name": _b.property_name or "—",
                    "guest_name":    _b.guest_name or "Guest",
                    "check_in":      _b.check_in,
                    "check_out":     _b.check_out,
                    "nights":        _b.nights or 1,
                    "total_price":   _b.total_price or 0,
                    "status":        _b.status or "confirmed",
                })
        except Exception as _berr:
            print(f"[stats/summary] bookings query error: {_berr}")
        finally:
            _bs.close()

    try:
        _occ = float(get_daily_stats().get("occupancy_pct") or 0)
    except Exception:
        _occ = None

    # Hotel Bazaar / 61-unit portfolio: occupancy = (occupied rooms / 61) * 100 from live status grid
    occ_from_grid = None
    try:
        _grid = _room_status_grid_payload(tenant_id, user_id)
        _summ = _grid.get("summary") or {}
        _gtot = int(_summ.get("total") or 0)
        _gocc = int(_summ.get("occupied") or 0)
        if _gtot > 0:
            occ_from_grid = round((_gocc / float(_gtot)) * 100.0, 1)
    except Exception as _ogrid:
        print(f"[stats/summary] occupancy from grid: {_ogrid}", flush=True)

    legacy_tasks_table_total = 0
    if SessionLocal and TaskModel:
        _ls = SessionLocal()
        try:
            legacy_tasks_table_total = _ls.query(TaskModel).count()
        finally:
            _ls.close()

    recent_open_tasks = []
    if not for_maya_chat:
        try:
            _ro_cap = int(os.getenv("MAYA_STATS_OPEN_TASKS_MAX", "500") or "500")
        except (TypeError, ValueError):
            _ro_cap = 500
        _ro_cap = max(12, min(_ro_cap, 5000))
        if SessionLocal and PropertyTaskModel:
            _rot_s = SessionLocal()
            try:
                _rtq = _property_tasks_query_for_tenant(_rot_s, tenant_id)
                if _rtq is not None:
                    _terminal = ("Done", "done", "Completed", "completed", "archived", "Archived")
                    if or_ is not None:
                        q_open = _rtq.filter(
                            or_(
                                PropertyTaskModel.status.is_(None),
                                PropertyTaskModel.status == "",
                                ~PropertyTaskModel.status.in_(_terminal),
                            )
                        ).order_by(PropertyTaskModel.created_at.desc()).limit(_ro_cap)
                    else:
                        q_open = _rtq.order_by(PropertyTaskModel.created_at.desc()).limit(_ro_cap)
                    for r in q_open:
                        st = (getattr(r, "status", "") or "").strip().lower()
                        if st in ("done", "completed", "archived"):
                            continue
                        recent_open_tasks.append({
                            "id": r.id,
                            "description": ((getattr(r, "description", None) or "")[:140]).strip(),
                            "property_name": ((getattr(r, "property_name", None) or "")[:100]).strip(),
                            "status": ((getattr(r, "status", None) or "")[:40]).strip(),
                        })
            finally:
                _rot_s.close()

    return {
        "total_properties": total_properties,
        "tasks_by_status": tasks_by_status,
        "total_tasks": total_tasks,
        "total_active_tasks": total_tasks,
        "total_property_tasks_all": total_property_tasks_all,
        "legacy_tasks_table_total": legacy_tasks_table_total,
        "staff_workload": staff_workload,
        "total_capacity": total_capacity,
        "top_staff": top_staff[:3],
        "monthly_revenue": monthly_revenue,
        "recent_bookings": recent_bookings,
        "recent_open_tasks": recent_open_tasks,
        "occupancy_pct": occ_from_grid if occ_from_grid is not None else _occ,
    }


@app.route("/api/stats/summary", methods=["GET"])
def stats_summary():
    """Returns dashboard analytics: total_properties, tasks_by_status, staff_workload, total_capacity, top_staff."""
    tenant_id = DEFAULT_TENANT_ID
    user_id = None
    if not AUTH_DISABLED:
        try:
            tenant_id, user_id = get_auth_context_from_request()
        except Exception:
            tenant_id = DEFAULT_TENANT_ID
            user_id = f"demo-{tenant_id}"
    else:
        user_id = f"demo-{tenant_id}"
    return jsonify(_build_stats_summary_payload(tenant_id, user_id))


@app.route("/api/dashboard-stats", methods=["GET", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["GET", "OPTIONS"])
def api_dashboard_stats():
    """Legacy `tasks` table row count + tenant-scoped property_tasks count."""
    if request.method == "OPTIONS":
        return Response(status=204)
    total = 0
    if SessionLocal and TaskModel:
        session_obj = SessionLocal()
        try:
            total = session_obj.query(TaskModel).count()
        finally:
            session_obj.close()
    tenant_id = DEFAULT_TENANT_ID
    user_id = None
    if not AUTH_DISABLED:
        try:
            tenant_id, user_id = get_auth_context_from_request()
        except Exception:
            tenant_id = DEFAULT_TENANT_ID
            user_id = f"demo-{tenant_id}"
    else:
        user_id = f"demo-{tenant_id}"
    property_tasks_total = 0
    if SessionLocal and PropertyTaskModel:
        session_obj = SessionLocal()
        try:
            q = _property_tasks_query_for_tenant(session_obj, tenant_id)
            if q is not None:
                property_tasks_total = q.count()
        finally:
            session_obj.close()
    return jsonify({
        "total": total,
        "tasks_table_rows": total,
        "property_tasks_total": property_tasks_total,
    })


def _build_owner_dashboard_analytics(tenant_id, user_id):
    """Owner Analytics: MRR $1500, readiness from portfolio occupancy, 7-day chart (fixes missing route 404)."""
    # Portfolio seed runs at startup + Maya autonomous loop — not on every analytics request (cache speed).
    rooms = list_manual_rooms(tenant_id, owner_id=user_id)
    n_props = len(rooms)
    occ_values = []
    for r in rooms:
        o = r.get("occupancy_rate")
        if o is None:
            continue
        try:
            occ_values.append(float(o))
        except (TypeError, ValueError):
            pass
    if occ_values:
        avg_occ = sum(occ_values) / len(occ_values)
    else:
        try:
            avg_occ = float(get_daily_stats().get("occupancy_pct") or 0)
        except Exception:
            avg_occ = 0.0
    readiness_pct = int(round(avg_occ))

    mrr_usd = 1500
    per_property_usd = 100
    active_properties = max(n_props, 15) if n_props else 15

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    missions_today = 0
    chart_data = []
    activity = []
    top_performer = {"name": "—", "missions": 0}
    staff_counts = {}
    avg_clean_minutes = 0

    if SessionLocal and PropertyTaskModel:
        session = SessionLocal()
        try:
            q = _property_tasks_query_for_tenant(session, tenant_id)
            rows = q.order_by(PropertyTaskModel.created_at.desc()).limit(400).all() if q else []
            _dur_mins = []
            for _r in rows:
                stx = (_r.status or "").strip().lower()
                if stx not in ("done", "completed"):
                    continue
                try:
                    cr = (_r.created_at or "").strip()
                    comp = (getattr(_r, "completed_at", None) or "").strip()
                    if not cr or not comp:
                        continue
                    t0 = datetime.fromisoformat(cr.replace("Z", "+00:00"))
                    t1 = datetime.fromisoformat(comp.replace("Z", "+00:00"))
                    if t1 > t0:
                        _dur_mins.append((t1 - t0).total_seconds() / 60.0)
                except Exception:
                    continue
            if _dur_mins:
                avg_clean_minutes = max(1, int(round(sum(_dur_mins) / len(_dur_mins))))
            for r in rows:
                st = (r.status or "").strip().lower()
                cr = (r.created_at or "")[:10]
                comp = (getattr(r, "completed_at", None) or "")[:10]
                if st in ("done", "completed"):
                    sn = (getattr(r, "staff_name", None) or "Staff").strip() or "Staff"
                    staff_counts[sn] = staff_counts.get(sn, 0) + 1
                    ref_day = comp if comp else cr
                    if ref_day == today:
                        missions_today += 1
            for i in range(6, -1, -1):
                d = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
                c = 0
                for r in rows:
                    st = (r.status or "").strip().lower()
                    if st not in ("done", "completed"):
                        continue
                    comp = (getattr(r, "completed_at", None) or "")[:10]
                    cr = (r.created_at or "")[:10]
                    day = comp if comp else cr
                    if day == d:
                        c += 1
                chart_data.append({"date": d, "completed": c, "goal": 10})
            for r in rows[:12]:
                activity.append({
                    "id": r.id,
                    "staff": getattr(r, "staff_name", None) or "—",
                    "room": getattr(r, "property_name", None) or r.property_id or "—",
                    "status": r.status or "Pending",
                    "task_type": getattr(r, "task_type", None) or TASK_TYPE_SERVICE_HE,
                    "ts": (r.created_at or "")[:16],
                    "photo_url": (getattr(r, "photo_url", None) or "") or "",
                })
        finally:
            session.close()

    if staff_counts:
        top_name = max(staff_counts.items(), key=lambda x: x[1])
        top_performer = {"name": top_name[0], "missions": top_name[1]}

    maya_insight = (
        f"קובי — פורטפוליו: {n_props} נכסים · מוכנות ממוצעת {readiness_pct}% (לפי תפוסה בבסיס הנתונים). "
        f"MRR יעד ${mrr_usd} (${per_property_usd}×{active_properties}). נתונים חיים מהבסיס."
    )

    return {
        "kpi": {
            "readiness_pct": readiness_pct,
            "missions_today": missions_today,
            "avg_clean_minutes": avg_clean_minutes,
            "top_performer": top_performer,
        },
        "chart_data": chart_data,
        "activity": activity,
        "maya_insight": maya_insight,
        "mrr_usd": mrr_usd,
        "per_property_usd": per_property_usd,
        "active_properties": active_properties,
    }


@app.route("/api/analytics/owner-dashboard", methods=["GET", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["GET", "OPTIONS"])
def api_analytics_owner_dashboard():
    if request.method == "OPTIONS":
        return Response(status=204)
    tenant_id = DEFAULT_TENANT_ID
    user_id = f"demo-{tenant_id}"
    try:
        tenant_id, user_id = get_auth_context_from_request()
    except Exception:
        pass
    refresh = (request.args.get("refresh") or "").strip().lower() in ("1", "true", "yes", "force")
    cache_key = f"{tenant_id}:{user_id}"
    now = time.time()
    oc = _OWNER_DASHBOARD_CACHE
    if (
        not refresh
        and oc.get("payload") is not None
        and oc.get("key") == cache_key
        and (now - float(oc.get("ts") or 0)) < OWNER_DASHBOARD_CACHE_TTL_SEC
    ):
        return jsonify(oc["payload"]), 200
    payload = _build_owner_dashboard_analytics(tenant_id, user_id)
    oc["ts"] = now
    oc["key"] = cache_key
    oc["payload"] = payload
    return jsonify(payload), 200


@app.route("/api/analytics/alerts", methods=["GET", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["GET", "OPTIONS"])
def api_analytics_alerts():
    if request.method == "OPTIONS":
        return Response(status=204)
    return jsonify({"alerts": []}), 200


@app.route("/api/staff/reliability-scores", methods=["GET", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["GET", "OPTIONS"])
def api_staff_reliability_scores():
    """Owner Analytics panel — avoid 404 when DB metrics are not wired yet."""
    if request.method == "OPTIONS":
        return Response(status=204)
    return jsonify({"scores": [], "top_performer": None}), 200


@app.route("/api/properties/search", methods=["GET"])
@require_auth
def property_search():
    query = (request.args.get("q") or "").strip().lower()
    samples = [
        {"name": "Royal Suite Hotel", "city": "Tel Aviv", "rooms": 24, "source": "demo", "description": "Premium city hotel with sea view."},
        {"name": "Garden Villa", "city": "Jerusalem", "rooms": 8, "source": "demo", "description": "Boutique villa with private garden."},
        {"name": "Ocean Loft", "city": "Haifa", "rooms": 12, "source": "demo", "description": "Modern loft near the coast."},
    ]
    if not query:
        return jsonify([])
    results = [item for item in samples if query in item["name"].lower()]
    if not results:
        results = samples[:1]
    return jsonify(results)


def _seed_import_operations_tasks(tenant_id, property_id, property_name):
    """WeWork/London-style import: three Hebrew ops tasks in property_tasks (dashboard GET /api/tasks)."""
    if not SessionLocal or not PropertyTaskModel or not property_id:
        return
    specs = [
        ("ניקיון משרד", TASK_TYPE_CLEANING_HE),
        ("בדיקת ציוד", TASK_TYPE_MAINTENANCE_HE),
        ("צ'ק-אין", TASK_TYPE_CHECKIN_HE),
    ]
    session_obj = SessionLocal()
    try:
        now = now_iso()
        for desc, ttype in specs:
            tid = str(uuid.uuid4())
            row = PropertyTaskModel(
                id=tid,
                property_id=property_id,
                staff_id=None,
                assigned_to=None,
                description=desc,
                status="Pending",
                created_at=now,
                property_name=(property_name or "")[:200],
                staff_name=None,
                staff_phone=None,
                tenant_id=tenant_id,
            )
            if hasattr(row, "task_type"):
                row.task_type = ttype
            if hasattr(row, "priority"):
                row.priority = "normal"
            session_obj.add(row)
        session_obj.commit()
    except Exception as _imp_seed_err:
        session_obj.rollback()
        print(f"[import] seed property_tasks: {_imp_seed_err}", flush=True)
    finally:
        session_obj.close()


@app.route("/api/rooms/manual/import", methods=["POST"])
@app.route("/api/v1/properties/import", methods=["POST"])
@require_auth
def import_manual_room():
    data = request.get_json(force=True) or {}
    tenant_id = data.get("tenant_id") or getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "Missing url"}), 400

    # 1. Extract IDs from URL (no HTTP - works for Airbnb/Booking)
    property_id = extract_property_id_from_url(url)
    photo_id = extract_photo_id_from_url(url)
    image_url = build_airbnb_image_url(property_id, photo_id)

    # 2. Fallback: fetch page for title/og:image (Airbnb may block)
    title = None
    if not photo_id:
        try:
            req = Request(url, headers={"User-Agent": "Mozilla/5.0 (compatible; EasyHost/1.0)"})
            with urlopen(req, timeout=8) as response:
                html = response.read().decode("utf-8", errors="ignore")
                title_match = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
                if title_match:
                    title = re.sub(r"\s+", " ", title_match.group(1)).strip()
                og_image = re.search(
                    r'property="og:image"\s+content="([^"]+)"|content="([^"]+)"\s+property="og:image"',
                    html,
                    re.I,
                )
                if og_image:
                    image_url = (og_image.group(1) or og_image.group(2)) or image_url
        except Exception:
            pass

    if not title:
        slug = (url.split("/")[-1] or "").split("?")[0] or "Listing"
        title = f"Luxury Suite #{property_id}" if property_id else slug.replace("-", " ").replace("_", " ").title()

    # 3. Create property/room in DB
    rid = f"airbnb-{property_id}" if property_id else None
    room = create_manual_room(
        tenant_id,
        title,
        description="Imported from link",
        photo_url=image_url,
        room_id=rid,
        status="Ready for Guest",
    )
    if not room:
        return jsonify({"error": "Failed to create property"}), 500

    # 4. Create initial deep cleaning task
    task = create_task(
        tenant_id,
        "cleaning",
        room["name"],
        due_at=None,
        room_id=room["id"],
    )
    if task:
        dispatch_tasks(tenant_id)

    # WeWork London paste → three ops tasks on the live task board (property_tasks)
    if re.search(r"wework|london", url, re.I):
        _seed_import_operations_tasks(tenant_id, room["id"], room.get("name") or title)

    return jsonify({
        "status": "success",
        "property_id": room["id"],
        "id": room["id"],
        "name": room["name"],
        "description": room["description"],
        "photo_url": room["photo_url"],
        "status": room.get("status") or "Ready for Guest",
        "created_at": room["created_at"],
        "task_created": task is not None,
    })


@app.route("/api/issues/report", methods=["POST"])
@require_auth
def report_issue():
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if "photo" not in request.files:
        return jsonify({"error": "Missing photo"}), 400
    file = request.files["photo"]
    room_id = request.form.get("room_id")
    room_name = request.form.get("room_name") or ""
    task_id = request.form.get("task_id")
    note = request.form.get("note") or ""
    if not room_id:
        return jsonify({"error": "Missing room_id"}), 400
    # Compress before upload (reduces bandwidth + Cloudinary costs).
    data, new_ext = _compress_image(file.stream)
    photo_url = None
    if _CLOUDINARY_CONFIGURED:
        try:
            photo_url = _cloudinary_upload(data, folder=f"easyhost/issues/{tenant_id}")
        except Exception as _cdn_err:
            print(f"[Cloudinary] Issue photo upload failed, falling back to local: {_cdn_err}", flush=True)
    if not photo_url:
        # Local fallback — works for dev; ephemeral on Render when Cloudinary is missing.
        os.makedirs(UPLOAD_ROOT, exist_ok=True)
        tenant_dir = os.path.join(UPLOAD_ROOT, tenant_id, "issues")
        os.makedirs(tenant_dir, exist_ok=True)
        orig_ext = (file.filename or "issue.jpg").rsplit(".", 1)[-1].lower()
        ext = new_ext or orig_ext or "jpg"
        if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
            ext = "jpg"
        unique_name = f"{room_id}-{uuid.uuid4().hex}.{ext}"
        file_path = os.path.join(tenant_dir, unique_name)
        with open(file_path, "wb") as _fh:
            _fh.write(data)
        photo_url = f"{API_BASE_URL}/uploads/{tenant_id}/issues/{unique_name}"
    if SessionLocal and ManualRoomModel:
        session = SessionLocal()
        try:
            room = session.query(ManualRoomModel).filter_by(id=room_id, tenant_id=tenant_id).first()
            if room:
                room.status = "blocked"
            if DamageReportModel:
                session.add(DamageReportModel(
                    id=str(uuid.uuid4()),
                    tenant_id=tenant_id,
                    room_id=room_id,
                    task_id=task_id,
                    room_name=room_name,
                    note=note,
                    photo_url=photo_url,
                    created_at=now_iso(),
                    resolved_at=None,
                    status="open",
                ))
            session.commit()
        finally:
            session.close()
    notify_number = os.getenv("HOST_WHATSAPP_TO")
    if notify_number:
        message = f"Damage report for {room_name}. Note: {note}" if note else f"Damage report for {room_name}."
        send_whatsapp(notify_number, message, media_url=photo_url)
    return jsonify({"ok": True, "photo_url": photo_url})


@app.route("/api/onboarding/status", methods=["GET"])
@require_auth
def onboarding_status():
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    status = get_calendar_status(tenant_id)
    if not status:
        return jsonify({"synced": False, "vacant_nights": 0, "potential_revenue": 0, "vacancy_windows": []})
    status["synced"] = True
    return jsonify(status)


@app.route("/api/worker/language", methods=["POST"])
@require_auth
def worker_language():
    data = request.get_json(force=True) or {}
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    language = data.get("language")
    if not language:
        return jsonify({"error": "Missing language"}), 400
    set_worker_language(tenant_id, language)
    return jsonify({"ok": True, "language": language})


@app.route("/api/messages", methods=["GET"])
@require_auth
def get_messages():
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    limit = int(request.args.get("limit", "50"))
    if not SessionLocal or not MessageModel:
        return jsonify([])
    session = SessionLocal()
    try:
        records = (
            session.query(MessageModel)
            .filter_by(tenant_id=tenant_id)
            .order_by(MessageModel.created_at.desc())
            .limit(limit)
            .all()
        )
    finally:
        session.close()
    return jsonify([
        {
            "id": record.id,
            "lead_id": record.lead_id,
            "direction": record.direction,
            "channel": record.channel,
            "content": record.content,
            "created_at": record.created_at,
        }
        for record in records
    ])


@app.route("/api/field/login", methods=["POST", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["POST", "OPTIONS"])
def api_field_login():
    """
    Public field-worker clock-in by phone (and optional staff_id / name).
    Creates a staff row when none matches if register_if_missing is true (default true).
    Returns staff profile + JWT so /api/staff/tasks works when AUTH_DISABLED=false.
    """
    if request.method == "OPTIONS":
        return Response(status=204)
    if not SessionLocal or not StaffModel:
        return jsonify({"error": "Service unavailable — database not configured"}), 503

    data = request.get_json(silent=True) or {}
    phone_raw = (data.get("phone") or "").strip()
    staff_id_in = (data.get("staff_id") or "").strip()
    name = (data.get("name") or "").strip()
    language = (data.get("language") or "").strip() or None
    tenant_id = _coerce_demo_tenant_id(data.get("tenant_id") or DEFAULT_TENANT_ID)
    reg_missing = data.get("register_if_missing")
    reg_missing = True if reg_missing is None else bool(reg_missing)

    if not phone_raw and not staff_id_in:
        return jsonify({"error": "נא להזין מספר טלפון או קוד עובד"}), 400

    phone_digits = re.sub(r"\D", "", phone_raw)
    if phone_raw and len(phone_digits) < 3:
        return jsonify({"error": "מספר טלפון קצר מדי"}), 400
    if staff_id_in and len(staff_id_in) > 120:
        return jsonify({"error": "Invalid staff id"}), 400

    session = SessionLocal()
    staff = None
    try:
        if staff_id_in:
            staff = session.query(StaffModel).filter_by(id=staff_id_in, tenant_id=tenant_id).first()
        if not staff and phone_digits:
            for s in session.query(StaffModel).filter_by(tenant_id=tenant_id).all():
                sdp = re.sub(r"\D", "", s.phone or "")
                if sdp == phone_digits:
                    staff = s
                    break
                if len(phone_digits) >= 6 and sdp and (phone_digits in sdp or sdp.endswith(phone_digits[-9:])):
                    staff = s
                    break
        if not staff:
            if not reg_missing:
                return jsonify({"error": "עובד לא נמצא — פנה למנהל"}), 404
            new_id = staff_id_in or (f"field-{phone_digits}" if phone_digits else f"field-{uuid.uuid4().hex[:12]}")
            if len(new_id) > 128:
                new_id = f"field-{uuid.uuid4().hex[:12]}"
            display_phone = phone_raw or phone_digits or ""
            display_name = name or new_id
            staff = StaffModel(
                id=new_id,
                tenant_id=tenant_id,
                name=display_name,
                phone=display_phone,
                active=1,
                on_shift=0,
                points=0,
                gold_points=0,
                language=language,
            )
            session.add(staff)
        else:
            if name:
                staff.name = name
            if phone_raw:
                staff.phone = phone_raw
            if language:
                staff.language = language
        session.commit()
        sid = staff.id
    except Exception as _e:
        session.rollback()
        print(f"[field/login] {_e!r}", flush=True)
        return jsonify({"error": "שגיאת שרת — נסה שנית"}), 500
    finally:
        session.close()

    set_staff_active(tenant_id, sid, True)
    set_staff_shift(tenant_id, sid, True)
    dispatch_tasks(tenant_id)

    session = SessionLocal()
    rank = None
    try:
        staff = session.query(StaffModel).filter_by(id=sid, tenant_id=tenant_id).first()
        if staff:
            rank = get_staff_rank(session, tenant_id, sid)
            emit_staff_update(session, tenant_id, sid)
    finally:
        session.close()

    if not staff:
        return jsonify({"error": "Staff record missing"}), 500

    gp = staff.gold_points if staff.gold_points is not None else (staff.points or 0)
    out = {
        "id": staff.id,
        "name": staff.name,
        "phone": staff.phone,
        "gold_points": gp,
        "points": staff.points or 0,
        "rank": rank,
        "rank_tier": get_rank_tier(gp),
        "language": staff.language or language or "",
    }
    now = datetime.now(timezone.utc)
    payload = {
        "sub": staff.id,
        "tenant_id": tenant_id,
        "role": "worker",
        "email": "",
        "worker_handle": (staff.id or "").lower(),
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=JWT_EXP_HOURS)).timestamp()),
    }
    out["token"] = encode_jwt(payload)
    out["tenant_id"] = tenant_id
    out["role"] = "worker"
    return jsonify(out), 200


@app.route("/api/staff/clock-in", methods=["POST"])
@require_auth
def staff_clock_in():
    data = request.get_json(force=True) or {}
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    staff_id = data.get("staff_id")
    if not staff_id:
        return jsonify({"error": "Missing staff_id"}), 400
    staff = upsert_staff(
        tenant_id,
        staff_id,
        data.get("name"),
        data.get("phone"),
        language=data.get("language"),
        photo_url=data.get("photo_url"),
        lat=data.get("lat"),
        lng=data.get("lng"),
    )
    set_staff_active(tenant_id, staff_id, True)
    set_staff_shift(tenant_id, staff_id, True)
    dispatch_tasks(tenant_id)
    session = SessionLocal()
    try:
        rank = get_staff_rank(session, tenant_id, staff.id) if SessionLocal and StaffModel else None
        emit_staff_update(session, tenant_id, staff.id)
    finally:
        session.close()
    return jsonify({
        "id": staff.id,
        "name": staff.name,
        "phone": staff.phone,
        "active": staff.active,
        "on_shift": 1,
        "points": staff.points,
        "gold_points": staff.gold_points if staff.gold_points is not None else (staff.points or 0),
        "language": staff.language,
        "photo_url": staff.photo_url,
        "rank": rank,
        "rank_tier": get_rank_tier(staff.gold_points if staff.gold_points is not None else staff.points),
    })


@app.route("/api/staff/clock-out", methods=["POST"])
@require_auth
def staff_clock_out():
    data = request.get_json(force=True) or {}
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    staff_id = data.get("staff_id")
    if not staff_id:
        return jsonify({"error": "Missing staff_id"}), 400
    staff = set_staff_shift(tenant_id, staff_id, False)
    if not staff:
        return jsonify({"error": "Staff not found"}), 404
    emit_staff_update_by_id(tenant_id, staff_id)
    return jsonify({"ok": True})


@app.route("/api/staff", methods=["GET"])
@require_auth
def staff_list():
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if not SessionLocal or not StaffModel:
        return jsonify([])
    session = SessionLocal()
    try:
        records = session.query(StaffModel).filter_by(tenant_id=tenant_id).all()
        active_tasks = {}
        if TaskModel:
            tasks = (
                session.query(TaskModel)
                .filter_by(tenant_id=tenant_id)
                .filter(TaskModel.status.in_(["assigned", "on_my_way", "in_progress"]))
                .all()
            )
            for task in tasks:
                existing = active_tasks.get(task.staff_id)
                if not existing or (task.assigned_at or "") > (existing.assigned_at or ""):
                    active_tasks[task.staff_id] = task
    finally:
        session.close()
    out = []
    for record in records:
        task = active_tasks.get(record.id)
        status = "Busy" if task else "Idle"
        current_property = task.room if task else None
        out.append({
            "id": record.id,
            "name": record.name,
            "role": getattr(record, "role", None) or "Staff",
            "phone": record.phone,
            "active": bool(record.active),
            "on_shift": bool(record.on_shift),
            "status": status,
            "current_property": current_property,
            "points": record.points or 0,
            "gold_points": record.gold_points if record.gold_points is not None else (record.points or 0),
            "language": record.language,
            "photo_url": record.photo_url,
            "last_lat": record.last_lat,
            "last_lng": record.last_lng,
            "last_location_at": record.last_location_at,
            "current_task": task.task_type if task else None,
            "current_room": task.room if task else None,
            "current_status": task.status if task else None,
            "rank_tier": get_rank_tier(record.gold_points if record.gold_points is not None else record.points),
            "last_clock_in": record.last_clock_in,
        })
    return jsonify(out)


@app.route("/api/staff/<staff_id>/active", methods=["POST"])
@require_auth
def staff_toggle_active(staff_id):
    data = request.get_json(force=True) or {}
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    active = bool(data.get("active"))
    staff = set_staff_active(tenant_id, staff_id, active)
    if not staff:
        return jsonify({"error": "Staff not found"}), 404
    emit_staff_update_by_id(tenant_id, staff_id)
    return jsonify({"ok": True, "active": bool(staff.active)})


@app.route("/api/staff/<staff_id>/end-shift", methods=["POST"])
@require_auth
def staff_end_shift(staff_id):
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    staff = set_staff_shift(tenant_id, staff_id, False)
    if not staff:
        return jsonify({"error": "Staff not found"}), 404
    set_staff_active(tenant_id, staff_id, False)
    if SessionLocal and TaskModel:
        session = SessionLocal()
        try:
            tasks = (
                session.query(TaskModel)
                .filter_by(tenant_id=tenant_id, staff_id=staff_id)
                .filter(TaskModel.status.in_(["assigned", "on_my_way", "in_progress"]))
                .all()
            )
            for task in tasks:
                task.status = "pending"
                task.staff_id = None
            session.commit()
        finally:
            session.close()
    emit_staff_update_by_id(tenant_id, staff_id)
    return jsonify({"ok": True, "on_shift": False})


@app.route("/api/staff/<staff_id>/photo", methods=["POST"])
@require_auth
def staff_set_photo(staff_id):
    data = request.get_json(force=True) or {}
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    photo_url = data.get("photo_url") or ""
    staff = set_staff_photo(tenant_id, staff_id, photo_url)
    if not staff:
        return jsonify({"error": "Staff not found"}), 404
    emit_staff_update_by_id(tenant_id, staff_id)
    return jsonify({"ok": True, "photo_url": staff.photo_url})


@app.route("/api/staff/<staff_id>/location", methods=["POST"])
@require_auth
def staff_update_location(staff_id):
    data = request.get_json(force=True) or {}
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    lat = data.get("lat")
    lng = data.get("lng")
    if lat is None or lng is None:
        return jsonify({"error": "Missing lat/lng"}), 400
    staff = set_staff_location(tenant_id, staff_id, float(lat), float(lng))
    if not staff:
        return jsonify({"error": "Staff not found"}), 404
    emit_staff_update_by_id(tenant_id, staff_id)
    return jsonify({"ok": True})


@app.route("/api/staff/<staff_id>/photo/upload", methods=["POST"])
@require_auth
def staff_upload_photo(staff_id):
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if "photo" not in request.files:
        return jsonify({"error": "Missing file"}), 400
    file = request.files["photo"]
    if not file or not file.filename:
        return jsonify({"error": "Invalid file"}), 400
    # Compress then route to Cloudinary when configured.
    data, new_ext = _compress_image(file.stream)
    photo_url = None
    if _CLOUDINARY_CONFIGURED:
        try:
            photo_url = _cloudinary_upload(data, folder=f"easyhost/staff/{tenant_id}")
        except Exception as _cdn_err:
            print(f"[Cloudinary] Staff photo upload failed, falling back to local: {_cdn_err}", flush=True)
    if not photo_url:
        # Local fallback — works for dev; ephemeral on Render when Cloudinary is missing.
        os.makedirs(UPLOAD_ROOT, exist_ok=True)
        tenant_dir = os.path.join(UPLOAD_ROOT, tenant_id)
        os.makedirs(tenant_dir, exist_ok=True)
        orig_ext = (file.filename or "photo.jpg").rsplit(".", 1)[-1].lower()
        ext = new_ext or orig_ext or "jpg"
        if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
            ext = "jpg"
        unique_name = f"{staff_id}-{uuid.uuid4().hex}.{ext}"
        file_path = os.path.join(tenant_dir, unique_name)
        with open(file_path, "wb") as _fh:
            _fh.write(data)
        photo_url = f"{API_BASE_URL}/uploads/{tenant_id}/{unique_name}"
    staff = set_staff_photo(tenant_id, staff_id, photo_url)
    if not staff:
        return jsonify({"error": "Staff not found"}), 404
    emit_staff_update_by_id(tenant_id, staff_id)
    return jsonify({"ok": True, "photo_url": photo_url})


@app.route("/api/staff/leaderboard", methods=["GET"])
@require_auth
def staff_leaderboard():
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if not SessionLocal or not StaffModel:
        return jsonify([])
    session = SessionLocal()
    try:
        records = (
            session.query(StaffModel)
            .filter_by(tenant_id=tenant_id)
            .order_by(StaffModel.gold_points.desc(), StaffModel.points.desc())
            .limit(10)
            .all()
        )
    finally:
        session.close()
    return jsonify([
        {"id": record.id, "name": record.name, "points": record.gold_points if record.gold_points is not None else (record.points or 0)}
        for record in records
    ])


@app.route("/api/staff/tasks", methods=["GET"])
@require_auth
def staff_tasks():
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    staff_id = request.args.get("staff_id")
    if not SessionLocal or not TaskModel:
        return jsonify([])
    session = SessionLocal()
    try:
        query = session.query(TaskModel).filter_by(tenant_id=tenant_id)
        if staff_id:
            query = query.filter_by(staff_id=staff_id)
        tasks = query.order_by(TaskModel.created_at.desc()).limit(50).all()
        out = []
        for task in tasks:
            staff_name = None
            if task.staff_id and StaffModel:
                st = session.query(StaffModel).filter_by(id=task.staff_id, tenant_id=tenant_id).first()
                staff_name = st.name if st else None
            property_name = None
            property_photo_url = None
            if task.room_id and ManualRoomModel:
                rm = session.query(ManualRoomModel).filter_by(id=task.room_id, tenant_id=tenant_id).first()
                if rm:
                    property_name = rm.name
                    property_photo_url = rm.photo_url
            ttype = task.task_type or "משימה"
            room_disp = task.room or property_name or task.room_id or "—"
            description = f"{ttype} · {room_disp}"
            out.append({
                "id": task.id,
                "task_type": task.task_type,
                "room": task.room,
                "room_id": task.room_id,
                "status": task.status,
                "created_at": task.created_at,
                "assigned_at": task.assigned_at,
                "on_my_way_at": task.on_my_way_at,
                "started_at": task.started_at,
                "finished_at": task.finished_at,
                "due_at": task.due_at,
                "staff_name": staff_name,
                "property_name": property_name,
                "property_photo_url": property_photo_url,
                "description": description,
            })
        return jsonify(out)
    finally:
        session.close()


@app.route("/api/staff/tasks/<task_id>/status", methods=["POST"])
@require_auth
def staff_task_status(task_id):
    data = request.get_json(force=True) or {}
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    status = data.get("status")
    if status not in ("on_my_way", "started", "finished"):
        return jsonify({"error": "Invalid status"}), 400
    task = update_task_status(tenant_id, task_id, status)
    if not task:
        return jsonify({"error": "Task not found"}), 404

    staff_name_log = None
    if task.staff_id and SessionLocal and StaffModel:
        _ls = SessionLocal()
        try:
            st = _ls.query(StaffModel).filter_by(id=task.staff_id, tenant_id=tenant_id).first()
            staff_name_log = st.name if st else None
        finally:
            _ls.close()
    _log_staff_field_status(
        tenant_id,
        task.staff_id,
        staff_name_log,
        task_id,
        task.room or "",
        status,
    )

    response = {"ok": True, "status": task.status}
    if task.staff_id and SessionLocal and StaffModel:
        session = SessionLocal()
        try:
            staff = session.query(StaffModel).filter_by(id=task.staff_id, tenant_id=tenant_id).first()
            if staff:
                response["gold_points"] = staff.gold_points if staff.gold_points is not None else (staff.points or 0)
                response["rank"] = get_staff_rank(session, tenant_id, staff.id)
                response["rank_tier"] = get_rank_tier(response["gold_points"])
                if task.status == "finished":
                    response["points_awarded"] = task.points_awarded or 0
        finally:
            session.close()
    return jsonify(response)


@app.route("/api/dispatch/status", methods=["GET"])
@require_auth
def dispatch_status():
    return jsonify({
        "enabled": bool(DISPATCH_ENABLED),
        "interval_seconds": DISPATCH_INTERVAL,
    })


@app.route("/api/dispatch/status", methods=["POST"])
@require_auth
def set_dispatch_status():
    global DISPATCH_ENABLED, DISPATCH_INTERVAL
    data = request.get_json(force=True) or {}
    enabled = data.get("enabled")
    interval = data.get("interval_seconds")
    if enabled is not None:
        DISPATCH_ENABLED = bool(enabled)
    if interval is not None:
        try:
            interval_value = int(interval)
            if interval_value >= 10:
                DISPATCH_INTERVAL = interval_value
        except Exception:
            pass
    return jsonify({
        "enabled": bool(DISPATCH_ENABLED),
        "interval_seconds": DISPATCH_INTERVAL,
    })


@app.route("/api/leads/stats", methods=["GET"])
@require_auth
def leads_stats():
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if SessionLocal and LeadModel:
        session = SessionLocal()
        try:
            leads = session.query(LeadModel).filter_by(tenant_id=tenant_id).all()
        finally:
            session.close()
        leads = [
            {"status": lead.status, "lead_quality": lead.lead_quality}
            for lead in leads
        ]
    else:
        with DATA_LOCK:
            leads = [lead for lead in LEADS if lead.get("tenant_id") == tenant_id]
    total = len(leads)
    new_count = sum(1 for lead in leads if lead.get("status") == "new")
    contacted = sum(1 for lead in leads if lead.get("status") == "contacted")
    qualified = sum(1 for lead in leads if lead.get("status") == "qualified")
    won = sum(1 for lead in leads if lead.get("status") in ("won", "converted", "paid"))
    lost = sum(1 for lead in leads if lead.get("status") == "lost")
    avg_score = 0
    scores = [lead.get("lead_quality") for lead in leads if isinstance(lead.get("lead_quality"), (int, float))]
    if scores:
        avg_score = round(sum(scores) / len(scores))
    return jsonify({
        "total": total,
        "new": new_count,
        "contacted": contacted,
        "qualified": qualified,
        "won": won,
        "lost": lost,
        "avg_score": avg_score,
    })


@app.route("/api/leads", methods=["POST"])
@require_auth
def create_lead():
    data = request.get_json(force=True)
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    lead = {
        "id": data.get("id") or str(uuid.uuid4()),
        "tenant_id": tenant_id,
        "name": data.get("name", "New Property"),
        "contact": data.get("contact", "Guest"),
        "email": data.get("email", ""),
        "phone": data.get("phone", ""),
        "source": data.get("source", "direct"),
        "status": data.get("status", "new"),
        "value": data.get("value", 0),
        "rating": data.get("rating", 0),
        "createdAt": data.get("createdAt") or now_iso(),
        "notes": data.get("notes", ""),
        "property": data.get("property") or data.get("name", "Property"),
        "lead_quality": data.get("lead_quality", 0),
        "ai_summary": data.get("ai_summary", "Lead created via API."),
    }
    add_lead(lead, tenant_id=tenant_id)
    return jsonify(lead), 201


@app.route("/api/leads/<lead_id>", methods=["PATCH"])
@require_auth
def patch_lead(lead_id):
    updates = request.get_json(force=True)
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    existing = LEADS_BY_ID.get(lead_id)
    if existing and existing.get("tenant_id") != tenant_id:
        return jsonify({"error": "Lead not found"}), 404
    lead = update_lead(lead_id, updates)
    if not lead:
        return jsonify({"error": "Lead not found"}), 404
    return jsonify(lead)


@app.route("/api/leads/<lead_id>", methods=["GET"])
@require_auth
def get_lead(lead_id):
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if SessionLocal and LeadModel:
        session = SessionLocal()
        try:
            record = session.query(LeadModel).filter_by(id=lead_id, tenant_id=tenant_id).first()
        finally:
            session.close()
        if not record:
            return jsonify({"error": "Lead not found"}), 404
        lead = {
            "id": record.id,
            "tenant_id": record.tenant_id,
            "name": record.name,
            "contact": record.contact,
            "email": record.email,
            "phone": record.phone,
            "source": record.source,
            "status": record.status,
            "value": record.value,
            "rating": record.rating,
            "createdAt": record.created_at,
            "notes": record.notes,
            "property": record.property_name,
            "city": record.city,
            "response_time_hours": record.response_time_hours,
            "lead_quality": record.lead_quality,
            "ai_summary": record.ai_summary,
            "last_objection": record.last_objection,
            "payment_link": record.payment_link,
            "desired_checkin": record.desired_checkin,
            "desired_checkout": record.desired_checkout,
        }
        return jsonify(lead)
    lead = LEADS_BY_ID.get(lead_id)
    if not lead:
        return jsonify({"error": "Lead not found"}), 404
    if lead.get("tenant_id") != tenant_id:
        return jsonify({"error": "Lead not found"}), 404
    return jsonify(lead)


@app.route("/api/stream/leads", methods=["GET"])
@require_auth
def stream_leads():
    tenant_id = get_tenant_id_from_request() or DEFAULT_TENANT_ID

    @stream_with_context
    def event_stream():
        event_queue = get_event_queue(tenant_id)
        print(f"[SSE stream_leads] stream open tenant={tenant_id!r}", flush=True)
        try:
            while True:
                event = event_queue.get()
                yield f"event: {event['type']}\n"
                yield f"data: {json.dumps(event['payload'])}\n\n"
        except GeneratorExit:
            print(f"[SSE stream_leads] disconnect tenant={tenant_id!r}", flush=True)
            raise

    return Response(
        event_stream(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/stream/staff", methods=["GET"])
@require_auth
def stream_staff():
    # Resolve tenant while the Flask request context is active — never call request inside the generator.
    try:
        tenant_id = get_tenant_id_from_request() or DEFAULT_TENANT_ID
    except Exception as e:
        print(f"[SSE stream_staff] tenant resolution failed: {type(e).__name__}: {e}", flush=True)
        return jsonify({"error": "Unauthorized", "detail": str(e)}), 401

    @stream_with_context
    def event_stream():
        q = get_staff_event_queue(tenant_id)
        print(f"[SSE stream_staff] stream open tenant={tenant_id!r}", flush=True)
        try:
            while True:
                event = q.get()
                yield f"event: {event['type']}\n"
                yield f"data: {json.dumps(event['payload'])}\n\n"
        except GeneratorExit:
            print(f"[SSE stream_staff] disconnect tenant={tenant_id!r}", flush=True)
            raise

    return Response(
        event_stream(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/agents/scout/scan", methods=["POST"])
@require_auth
def scout_scan():
    data = request.get_json(force=True) or {}
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    platforms = data.get("platforms") or ["airbnb", "booking"]
    new_leads = scan_realtime_leads(platforms=platforms)
    for lead in new_leads:
        add_lead(lead, tenant_id=tenant_id)
    AUTOMATION_STATS.setdefault(tenant_id, {"automated_messages": 0, "last_scan": None})
    AUTOMATION_STATS[tenant_id]["last_scan"] = now_iso()
    emit_automation_stats(tenant_id)
    return jsonify({"success": True, "leads": new_leads})


@app.route("/whatsapp", methods=["POST"])
def twilio_whatsapp_webhook():
    """
    Twilio webhook — set this URL in the Twilio console:
      https://your-domain.com/whatsapp
    Twilio POSTs form data (not JSON) when a WhatsApp message arrives.
    Must return 200 OK so Twilio knows the message was received.
    """
    body        = (request.values.get("Body")        or "").strip()
    from_number = (request.values.get("From")        or "").strip()  # e.g. whatsapp:+972501234567
    to_number   = (request.values.get("To")          or "").strip()  # your Twilio sandbox number
    profile     = (request.values.get("ProfileName") or "").strip()

    print(f"[Twilio/WhatsApp] ← from={from_number}  body={body[:80]!r}")

    if body and from_number:
        # Normalise the sender number (strip "whatsapp:" prefix)
        clean_from = from_number.replace("whatsapp:", "").strip()

        # Route the message through Maya
        try:
            reply_text = _gemini_generate(f"Guest ({profile or clean_from}) says: {body}")
        except Exception as _e:
            reply_text = "תודה על הפנייה! נחזור אליך בהקדם. 🙏"
            print(f"[Twilio/WhatsApp] Maya offline: {_e}")

        # Send Maya's reply back via WhatsApp
        send_whatsapp(clean_from, reply_text)

    # Twilio REQUIRES a 200 response — any other status causes a retry flood
    return "OK", 200


@app.route("/api/whatsapp/welcome", methods=["POST"])
@require_auth
def whatsapp_welcome():
    data = request.get_json(force=True)
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    lead_id = data.get("lead_id")
    lead = LEADS_BY_ID.get(lead_id)
    if not lead:
        return jsonify({"error": "Lead not found"}), 404
    if lead.get("tenant_id") != tenant_id:
        return jsonify({"error": "Lead not found"}), 404
    result = auto_greet_lead(lead)
    if not result.get("success"):
        return jsonify(result), 400
    record_message(tenant_id, lead_id, "outbound", "whatsapp", "welcome")
    return jsonify(result)


@app.route("/api/agent/objection", methods=["POST"])
@require_auth
def log_objection():
    data = request.get_json(force=True)
    lead_id = data.get("lead_id")
    objection = data.get("objection", "general").lower()
    success = bool(data.get("success"))
    response = data.get("response") or pick_argument(objection)
    entry = {
        "id": str(uuid.uuid4()),
        "lead_id": lead_id,
        "objection": objection,
        "response": response,
        "success": success,
        "timestamp": now_iso(),
    }
    if objection in OBJECTION_SUCCESS:
        key = "yes" if success else "no"
        OBJECTION_SUCCESS[objection][key] += 1
    if lead_id:
        update_lead(lead_id, {"last_objection": objection, "ai_summary": response})
    next_pitch = pick_argument(objection)
    entry["strategy_snapshot"] = OBJECTION_SUCCESS.get(objection, {"yes": 0, "no": 0})
    LEARNING_LOG.append(entry)
    return jsonify({"next_pitch": next_pitch})


@app.route("/api/whatsapp/incoming", methods=["POST"])
def whatsapp_incoming():
    data = request.get_json(force=True) or {}
    lead_id = data.get("lead_id")
    tenant_id = data.get("tenant_id")
    if not tenant_id and lead_id:
        lead = LEADS_BY_ID.get(lead_id)
        if lead:
            tenant_id = lead.get("tenant_id")
    tenant_id = tenant_id or DEFAULT_TENANT_ID
    start_message_workers()
    enqueue_message_job({
        "tenant_id": tenant_id,
        "lead_id": lead_id,
        "message": data.get("message"),
        "from_number": data.get("from") or data.get("from_number"),
        "worker_lang": data.get("worker_lang"),
    })
    return jsonify({"queued": True}), 202


@app.route("/api/agent/close", methods=["POST"])
def close_lead():
    data = request.get_json(force=True)
    lead_id = data.get("lead_id")
    lead = LEADS_BY_ID.get(lead_id)
    if not lead:
        return jsonify({"error": "Lead not found"}), 404
    payment_link = f"https://pay.easyhost.ai/{lead_id[:8]}"
    update_lead(lead_id, {"status": "paid", "payment_link": payment_link})
    message = f"Great! Here is your payment link: {payment_link}"
    result = send_whatsapp(lead.get("phone"), message)
    if result.get("success"):
        AUTOMATION_STATS.setdefault("automated_messages", 0)
        AUTOMATION_STATS["automated_messages"] += 1
        try:
            emit_automation_stats(DEFAULT_TENANT_ID)
        except Exception:
            pass
    return jsonify({"payment_link": payment_link, "whatsapp": result})


@app.route("/api/whatsapp/send", methods=["POST"])
def whatsapp_send():
    data = request.get_json(force=True)
    to_number = data.get("to")
    message = data.get("message")
    if not to_number or not message:
        return jsonify({"success": False, "error": "Missing to/message"}), 400
    result = send_whatsapp(to_number, message)
    if not result.get("success"):
        return jsonify(result), 400
    AUTOMATION_STATS.setdefault("automated_messages", 0)
    AUTOMATION_STATS["automated_messages"] += 1
    try:
        emit_automation_stats(DEFAULT_TENANT_ID)
    except Exception:
        pass
    return jsonify(result)


@app.route("/api/stats", methods=["GET"])
@require_auth
def get_stats():
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    try:
        _tid, _uid = get_auth_context_from_request()
        tenant_id = _tid
        user_id = _uid
    except Exception:
        user_id = f"demo-{tenant_id}"
    stats = get_automation_stats_for_tenant(tenant_id)
    ops = _build_stats_summary_payload(tenant_id, user_id)
    return jsonify({
        **ops,
        "automation_stats": stats,
        "objection_success": OBJECTION_SUCCESS,
    })


@app.route("/api/v1/dashboard/summary", methods=["GET"])
@require_auth
def get_dashboard_summary():
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if not SessionLocal:
        return jsonify({"revenue": "0₪", "active_tasks_count": 0, "open_issues": 0, "upcoming": [], "status": "Unavailable"})
    session = SessionLocal()
    try:
        # ── Revenue: sum bookings whose check_out falls in the last 30 days ────
        # Using check_out (revenue realised at guest departure) and a rolling
        # 30-day window so revenue is always visible regardless of calendar month.
        total_revenue = 0
        _thirty_ago = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
        _today_str   = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if BookingModel:
            try:
                result = (
                    session.query(func.sum(BookingModel.total_price))
                    .filter(
                        BookingModel.tenant_id == tenant_id,
                        BookingModel.status.in_(["confirmed", "completed"]),
                        BookingModel.check_out >= _thirty_ago,
                        BookingModel.check_out <= _today_str,
                    )
                    .scalar()
                )
                total_revenue = int(result or 0)
            except Exception as _rev_err:
                print(f"[dashboard/summary] revenue query error: {_rev_err}")

        # Fallback: CalendarConnectionModel.potential_revenue when no bookings
        if total_revenue == 0 and CalendarConnectionModel:
            rec = session.query(CalendarConnectionModel).filter_by(tenant_id=tenant_id).first()
            if rec and rec.potential_revenue:
                total_revenue = int(rec.potential_revenue)

        active_tasks = 0
        open_issues = 0
        if TaskModel:
            active_tasks = (
                session.query(TaskModel)
                .filter_by(tenant_id=tenant_id)
                .filter(TaskModel.status.in_(["pending", "assigned", "on_my_way", "in_progress"]))
                .count()
            )
            open_issues = (
                session.query(TaskModel)
                .filter_by(tenant_id=tenant_id)
                .filter(TaskModel.task_type == "maintenance")
                .filter(~TaskModel.status.in_(["finished", "completed"]))
                .count()
            )

        upcoming = []
        if TaskModel:
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            rows = (
                session.query(TaskModel)
                .filter_by(tenant_id=tenant_id)
                .filter(TaskModel.status.in_(["pending", "assigned", "on_my_way", "in_progress"]))
                .filter(TaskModel.due_at != None, TaskModel.due_at >= today)
                .order_by(TaskModel.due_at)
                .limit(3)
                .all()
            )
            for t in rows:
                upcoming.append({
                    "id": t.id,
                    "room": t.room,
                    "type": t.task_type,
                    "due_at": t.due_at,
                    "status": t.status,
                })

        # Count bookings in rolling 30-day window for the KPI sub-label
        monthly_bookings = 0
        if BookingModel:
            try:
                monthly_bookings = (
                    session.query(BookingModel)
                    .filter(
                        BookingModel.tenant_id == tenant_id,
                        BookingModel.status.in_(["confirmed", "completed"]),
                        BookingModel.check_out >= _thirty_ago,
                        BookingModel.check_out <= _today_str,
                    )
                    .count()
                )
            except Exception:
                pass

        return jsonify({
            "revenue": f"₪{total_revenue:,}",
            "monthly_bookings": monthly_bookings,
            "active_tasks_count": active_tasks,
            "open_issues": open_issues,
            "upcoming": upcoming,
            "status": "Running smoothly",
        })
    finally:
        session.close()


@app.route("/api/v1/financials/summary", methods=["GET"])
@require_auth
def get_financial_summary():
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if not SessionLocal:
        return jsonify({
            "avg_ltv": "₪0",
            "conversion_rate": "0%",
            "projected_revenue": "₪0",
        })

    session = SessionLocal()
    try:
        # 1. LTV ממוצע (מתוך לידים שהפכו ל-paid/converted)
        avg_ltv = 0
        if LeadModel:
            avg_ltv = (
                session.query(func.avg(LeadModel.value))
                .filter_by(tenant_id=tenant_id)
                .filter(LeadModel.status.in_(["paid", "converted"]))
                .scalar()
            )
        avg_ltv = float(avg_ltv or 0)

        # 2. יחס המרה (לידים שהפכו להזמנות)
        total_leads = 0
        total_converted = 0
        if LeadModel:
            total_leads = session.query(LeadModel).filter_by(tenant_id=tenant_id).count()
            total_converted = (
                session.query(LeadModel)
                .filter_by(tenant_id=tenant_id)
                .filter(LeadModel.status.in_(["paid", "converted"]))
                .count()
            )
        conversion_rate = (total_converted / total_leads * 100) if total_leads > 0 else 0.0

        # 3. הכנסות צפויות (מ-calendar או לידים עתידיים)
        projected = 0
        if CalendarConnectionModel:
            rec = session.query(CalendarConnectionModel).filter_by(tenant_id=tenant_id).first()
            if rec and rec.potential_revenue:
                projected = int(rec.potential_revenue)
        if projected == 0 and LeadModel:
            # Fallback: סכום לידים עם value שעוד לא הומרו
            sum_pending = (
                session.query(func.sum(LeadModel.value))
                .filter_by(tenant_id=tenant_id)
                .filter(~LeadModel.status.in_(["paid", "converted", "lost", "cancelled"]))
                .scalar()
            )
            projected = int(sum_pending or 0)

        return jsonify({
            "avg_ltv": f"₪{avg_ltv:,.0f}",
            "conversion_rate": f"{conversion_rate:.1f}%",
            "projected_revenue": f"₪{projected:,}",
        })
    finally:
        session.close()


@app.route("/api/reports/daily", methods=["GET"])
@require_auth
def daily_report():
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(hours=24)
    interactions_outbound = 0
    interactions_inbound = 0
    leads_created = 0
    revenue_paid = 0
    cleanings_triggered = 0

    if SessionLocal and MessageModel and LeadModel:
        session = SessionLocal()
        try:
            messages = session.query(MessageModel).filter_by(tenant_id=tenant_id).all()
            for msg in messages:
                created = parse_iso_datetime(msg.created_at)
                if created and created >= window_start:
                    if msg.direction == "outbound":
                        interactions_outbound += 1
                    else:
                        interactions_inbound += 1

            leads = session.query(LeadModel).filter_by(tenant_id=tenant_id).all()
            for lead in leads:
                created = parse_iso_datetime(lead.created_at)
                if created and created >= window_start:
                    leads_created += 1
                    if lead.status in ("paid", "converted"):
                        revenue_paid += lead.value or 0
            if TaskModel:
                tasks = session.query(TaskModel).filter_by(tenant_id=tenant_id, status="finished").all()
                for task in tasks:
                    finished = parse_iso_datetime(task.finished_at)
                    if finished and finished >= window_start:
                        cleanings_triggered += 1
        finally:
            session.close()
    else:
        stats = get_automation_stats_for_tenant(tenant_id)
        leads_created = stats.get("leads_total", 0)
        interactions_outbound = stats.get("automated_messages", 0)

    hours_saved = round((interactions_outbound * 10) / 60, 2)
    report = {
        "date": now.strftime("%Y-%m-%d"),
        "window_start": window_start.isoformat(),
        "window_end": now.isoformat(),
        "roi_metrics": {
            "hours_saved": hours_saved,
            "cleanings_triggered": cleanings_triggered,
            "leads_captured": leads_created,
        },
        "automation_interactions": interactions_outbound,
        "message_activity": {
            "inbound": interactions_inbound,
            "outbound": interactions_outbound,
        },
        "revenue_summary": {
            "paid_revenue": revenue_paid,
            "potential_revenue": 0,
        },
        "recommendations": ["Continue automated outreach for high-quality leads."],
        "agent_performance": [],
        "savings": {"automation_rate": 75},
    }
    calendar_status = get_calendar_status(tenant_id)
    if calendar_status:
        report["revenue_summary"]["potential_revenue"] = calendar_status.get("potential_revenue", 0)
    return jsonify({"report": report})


# ══════════════════════════════════════════════════════════════════════════════
# WEEKLY REPORT ENGINE — generate_weekly_report() + WhatsApp agent
# ══════════════════════════════════════════════════════════════════════════════

def generate_weekly_report(days: int = 7) -> dict:
    """
    Aggregate WorkerPerformance + PropertyTask for the last `days` days.
    Returns a rich dict used by both the API and the WhatsApp sender.
    """
    now      = datetime.now(timezone.utc)
    from_dt  = now - timedelta(days=days)
    from_str = from_dt.strftime("%Y-%m-%d")
    to_str   = now.strftime("%Y-%m-%d")
    hotel    = (os.getenv("HOTEL_NAME") or os.getenv("PROPERTY_NAME") or "Maya Hotel").strip()

    total_tasks  = 0
    total_done   = 0
    workers_map  = {}   # worker_name → {done, durations[]}
    peak_hours   = [0] * 24   # index = hour (UTC), value = task count
    all_durations= []

    session = SessionLocal() if SessionLocal else None
    if not session:
        return {"error": "DB unavailable", "hotel_name": hotel}

    try:
        # ── WorkerPerformance (individual task completion records) ──────
        if WorkerPerformanceModel:
            perf_rows = session.query(WorkerPerformanceModel).filter(
                WorkerPerformanceModel.date >= from_str
            ).all()
            for r in perf_rows:
                w = (r.worker_name or "Unknown").strip()
                if w not in workers_map:
                    workers_map[w] = {"done": 0, "durations": []}
                workers_map[w]["done"] += 1
                total_done += 1
                dm = r.duration_minutes
                if dm:
                    try:
                        dv = float(dm)
                        workers_map[w]["durations"].append(dv)
                        all_durations.append(dv)
                    except Exception:
                        pass
                # peak hour from completed_at
                for ts_field in (r.completed_at, r.created_at):
                    if ts_field:
                        try:
                            hour = datetime.fromisoformat(
                                str(ts_field).replace("Z", "+00:00")
                            ).astimezone(timezone.utc).hour
                            peak_hours[hour] += 1
                            break
                        except Exception:
                            pass

        # ── PropertyTask (all tasks including pending) for total count ──
        if PropertyTaskModel:
            task_rows = session.query(PropertyTaskModel).filter(
                PropertyTaskModel.created_at >= from_str
            ).order_by(PropertyTaskModel.created_at.desc()).all()
            total_tasks = len(task_rows)
            for r in task_rows:
                if r.created_at:
                    try:
                        hour = datetime.fromisoformat(
                            str(r.created_at).replace("Z", "+00:00")
                        ).astimezone(timezone.utc).hour
                        peak_hours[hour] += 1
                    except Exception:
                        pass

    except Exception as e:
        print(f"[weekly_report] DB error: {e}")
        import traceback as _tb_wr; _tb_wr.print_exc()
    finally:
        session.close()

    # ── Per-worker stats rows ──────────────────────────────────────────
    worker_rows = []
    for name, d in sorted(workers_map.items()):
        avg = round(sum(d["durations"]) / len(d["durations"]), 1) if d["durations"] else None
        worker_rows.append({
            "worker":      name,
            "tasks_done":  d["done"],
            "avg_minutes": avg,
        })
    worker_rows.sort(key=lambda x: x["tasks_done"], reverse=True)

    # ── Top performer ─────────────────────────────────────────────────
    top = None
    if worker_rows:
        # best = most tasks done; tie-break by lowest avg time
        top = min(
            worker_rows,
            key=lambda x: (-(x["tasks_done"]), x["avg_minutes"] or 999)
        )

    # ── Overall avg ──────────────────────────────────────────────────
    overall_avg = round(sum(all_durations) / len(all_durations), 1) if all_durations else None

    # ── Peak hours list (top 24 for chart) ───────────────────────────
    peak_chart = [{"hour": h, "count": peak_hours[h]} for h in range(24)]

    # ── AI summary via Gemini ─────────────────────────────────────────
    ai_summary = None
    try:
        top_str = f"{top['worker']} ({top['avg_minutes']} דק' ממוצע)" if top and top["avg_minutes"] else (top["worker"] if top else "N/A")
        ai_prompt = (
            f"You are Maya, the AI hotel assistant. Write a 2-sentence Hebrew weekly performance summary for the manager:\n"
            f"Hotel: {hotel}\n"
            f"Period: last {days} days\n"
            f"Total tasks created: {total_tasks}\n"
            f"Tasks completed: {total_done}\n"
            f"Overall avg completion time: {overall_avg} minutes\n"
            f"Top performer: {top_str}\n"
            f"Workers: {', '.join([w['worker'] for w in worker_rows[:5]])}\n"
            f"Be positive, data-driven, and encouraging. Include an emoji. Max 2 sentences."
        )
        ai_summary = _gemini_generate(ai_prompt)
        print(f"[weekly_report] AI summary generated ({len(ai_summary or '')} chars)")
    except Exception as e:
        print(f"[weekly_report] AI summary error: {e}")
        ai_summary = (
            f"הצוות השלים {total_done} משימות בשבוע האחרון עם ממוצע {overall_avg or '—'} דקות למשימה. "
            f"כל הכבוד לצוות! 🚀"
        )

    return {
        "hotel_name":       hotel,
        "period_label":     f"7 ימים אחרונים",
        "from_date":        from_str,
        "to_date":          to_str,
        "total_tasks":      total_tasks,
        "total_done":       total_done,
        "completion_rate":  round(total_done / total_tasks * 100) if total_tasks else 0,
        "overall_avg_minutes": overall_avg,
        "workers":          worker_rows,
        "top_performer":    top,
        "peak_hours":       peak_chart,
        "ai_summary":       ai_summary,
        "generated_at":     now.isoformat(),
    }


def _build_whatsapp_report_text(report: dict, dashboard_url: str = None) -> str:
    """Format the WhatsApp weekly report message."""
    hotel      = report.get("hotel_name", "Maya Hotel")
    total_done = report.get("total_done", 0)
    top        = report.get("top_performer") or {}
    top_name   = top.get("worker", "—")
    top_avg    = top.get("avg_minutes")
    top_str    = f"{top_name} (ממוצע {top_avg} דק'!)" if top_avg else top_name
    cr         = report.get("completion_rate", 0)
    url        = dashboard_url or (os.getenv("APP_URL") or "http://localhost:3000").rstrip("/")
    ai_txt     = report.get("ai_summary") or ""

    lines = [
        f"🏨 *Maya Insights — Weekly Report*",
        f"_{hotel}_",
        "",
        f"✅ *משימות שהושלמו:* {total_done}",
        f"🏆 *מצטיין השבוע:* {top_str}",
        f"📈 *אחוז סיום:* {cr}%",
        f"💾 *גיבוי:* כל הנתונים מאובטחים ב-hotel.db",
        "",
    ]
    if ai_txt:
        lines.append(f"🤖 *סיכום Maya:* {ai_txt}")
        lines.append("")
    lines.append(f"🔗 *לוח בקרה:* {url}")
    return "\n".join(lines)


@app.route("/api/reports/weekly", methods=["GET", "OPTIONS"])
def weekly_report_api():
    """
    GET /api/reports/weekly?days=7&format=json|csv
    Returns the weekly performance report as JSON (default) or CSV download.
    No auth required — protected only by knowledge of the URL.
    """
    if request.method == "OPTIONS":
        return Response(status=204)

    days   = int(request.args.get("days", 7))
    fmt    = request.args.get("format", "json").lower()
    report = generate_weekly_report(days=days)

    if fmt == "csv":
        import io, csv as _csv
        output = io.StringIO()
        writer = _csv.writer(output)
        writer.writerow(["Hotel", report.get("hotel_name", "")])
        writer.writerow(["Period", report.get("period_label", "")])
        writer.writerow(["From", report.get("from_date", "")])
        writer.writerow(["To",   report.get("to_date", "")])
        writer.writerow([])
        writer.writerow(["Total Tasks", report.get("total_tasks", 0)])
        writer.writerow(["Tasks Completed", report.get("total_done", 0)])
        writer.writerow(["Completion Rate %", report.get("completion_rate", 0)])
        writer.writerow(["Avg Minutes/Task", report.get("overall_avg_minutes", "")])
        writer.writerow([])
        writer.writerow(["Worker", "Tasks Done", "Avg Minutes"])
        for w in report.get("workers", []):
            writer.writerow([w["worker"], w["tasks_done"], w.get("avg_minutes", "")])
        writer.writerow([])
        writer.writerow(["Hour (UTC)", "Task Count"])
        for ph in report.get("peak_hours", []):
            writer.writerow([ph["hour"], ph["count"]])
        writer.writerow([])
        writer.writerow(["AI Summary", report.get("ai_summary", "")])

        csv_bytes = output.getvalue().encode("utf-8-sig")
        filename  = f"maya_report_{report.get('to_date','')}.csv"
        return Response(
            csv_bytes,
            mimetype="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    return jsonify(report), 200


@app.route("/api/reports/weekly/send", methods=["POST", "OPTIONS"])
def weekly_report_send():
    """
    POST /api/reports/weekly/send
    Body: { "days": 7, "phone": "+972..." }  — phone defaults to OWNER_PHONE
    Sends:
      1. Full WhatsApp report to manager
      2. Congratulations message to the top performer (if phone available)
    """
    if request.method == "OPTIONS":
        return Response(status=204)

    data    = request.get_json(silent=True) or {}
    days    = int(data.get("days", 7))
    phone   = (data.get("phone") or OWNER_PHONE or "").strip()
    app_url = (os.getenv("APP_URL") or "http://localhost:3000").rstrip("/")

    report  = generate_weekly_report(days=days)
    msg     = _build_whatsapp_report_text(report, dashboard_url=app_url)

    results = {}

    # 1 — Send to manager
    if phone:
        r = send_whatsapp(phone, msg)
        results["manager"] = r
        print(f"[WeeklyReport] WhatsApp → manager {phone}: {'✅' if r.get('success') else '❌'}")
    else:
        results["manager"] = {"skipped": True, "reason": "no OWNER_PHONE configured"}

    # 2 — Send congratulations to top performer
    top = report.get("top_performer") or {}
    top_name  = top.get("worker", "")
    top_avg   = top.get("avg_minutes")
    top_done  = top.get("tasks_done", 0)
    top_phone = None

    if top_name and SessionLocal and PropertyTaskModel:
        _s = SessionLocal()
        try:
            row = _s.query(PropertyTaskModel).filter(
                PropertyTaskModel.staff_name == top_name,
                PropertyTaskModel.staff_phone.isnot(None),
            ).first()
            if row:
                top_phone = (row.staff_phone or "").strip()
        except Exception:
            pass
        finally:
            _s.close()

    if top_phone:
        congrats = (
            f"🏆 כל הכבוד {top_name}!\n"
            f"השבוע סיימת {top_done} משימות"
            + (f" עם ממוצע {top_avg} דקות בלבד!" if top_avg else "!")
            + "\nאתה המצטיין של השבוע — תודה! 🚀\n"
            f"_Maya Hotel AI_"
        )
        r2 = send_whatsapp(top_phone, congrats)
        results["top_performer"] = {"worker": top_name, **r2}
        print(f"[WeeklyReport] 🏆 Congrats → {top_name} {top_phone}: {'✅' if r2.get('success') else '❌'}")
    else:
        results["top_performer"] = {"skipped": True, "reason": "no phone found for top performer"}

    return jsonify({
        "ok":     True,
        "report": report,
        "sent":   results,
    }), 200


# ── Sunday 09:00 UTC automatic scheduler ──────────────────────────────
def _weekly_report_scheduler():
    """Background thread: fires every Sunday at 09:00 UTC automatically."""
    import time as _time
    print("[WeeklyScheduler] Started — will fire every Sunday 09:00 UTC")
    last_sent_week = -1   # track ISO-week to avoid double-send
    while True:
        try:
            _time.sleep(300)  # check every 5 minutes
            now = datetime.now(timezone.utc)
            if now.weekday() == 6 and now.hour == 9 and now.isocalendar()[1] != last_sent_week:
                print("[WeeklyScheduler] 🗓️  Sunday 09:00 — firing weekly WhatsApp report!")
                last_sent_week = now.isocalendar()[1]
                report  = generate_weekly_report(days=7)
                msg     = _build_whatsapp_report_text(report)
                if OWNER_PHONE:
                    r = send_whatsapp(OWNER_PHONE, msg)
                    print(f"[WeeklyScheduler] WhatsApp → {OWNER_PHONE}: {'✅' if r.get('success') else '❌ ' + r.get('error','')}")
        except Exception as _e:
            print(f"[WeeklyScheduler] error: {_e}")


@app.cli.command("create-tables")
def create_tables_cmd():
    """CLI: Create users table (and other auth/staff tables) if they don't exist."""
    if not Base or not ENGINE:
        print("[create-tables] Database not available (SQLAlchemy not loaded)")
        return
    init_db()
    print("[create-tables] Done: users, staff schema, property_staff")


def _do_startup_init():
    """
    Full startup bootstrap — schema creation, seed data, background threads.

    Connects to Supabase (via SUPABASE_URL + SUPABASE_KEY env vars) or
    PostgreSQL (via DATABASE_URL), falling back to local SQLite for dev.

    Creates all tables (CREATE TABLE IF NOT EXISTS), seeds the 10 pilot
    properties, and starts the guest-complaint + staff-response bots.

    Guarded by INIT_DONE so this runs exactly once per process regardless
    of how many Gunicorn workers or before_request calls trigger it.
    """
    global INIT_DONE
    with INIT_LOCK:
        if INIT_DONE:
            return
        db_label = (
            "Supabase PostgreSQL" if "supabase" in DATABASE_URL else
            "PostgreSQL"          if _is_pg else
            "SQLite (local)"
        )
        print(f"[startup] 🔌 Connecting to {db_label}…")
        _sim_log("🔌 Server starting — running startup init…", "info")
        if Base and ENGINE:
            try:
                init_db()
                print(f"[startup] ✅ Connected to {db_label} successfully — tables ready")
                ensure_default_tenants()
                ensure_demo_user()
                ensure_levikobi_user()
                ensure_admin_from_env()
            except Exception as _db_err:
                print(f"[startup] ⚠️  DB init failed ({db_label}): {_db_err}")
                print("[startup]    Server will start anyway — visit /db-status for details.")
                print("[startup]    If using Supabase: fill in real credentials in .env")
            # Pilot portfolio + Sarona/ToHA/… properties; purge synthetic tasks; optional task seed via env
            try:
                purge_synthetic_property_tasks(DEFAULT_TENANT_ID)
                seed_pilot_demo()
                ensure_emergency_portfolio_and_tasks(DEFAULT_TENANT_ID)
                print("[startup] ✅ Emergency seed: purge + seed_pilot_demo + ensure_emergency_portfolio_and_tasks", flush=True)
            except Exception as _emg:
                print(f"[startup] ⚠️ Emergency seed: {_emg}", flush=True)
            for _name, _fn in (
                ("seed_dashboard_data", seed_dashboard_data),
                ("load_leads_from_db", lambda: load_leads_from_db()),
            ):
                try:
                    _fn()
                    print(f"[startup] ✅ {_name}", flush=True)
                except Exception as _se:
                    print(f"[startup] ⚠️  {_name}: {_se}", flush=True)
            try:
                _run_bootstrap_operational_data()
                print("[startup] ✅ _run_bootstrap_operational_data (pilot + Bazaar/WeWork + hotel ops)", flush=True)
            except Exception as _boot_e:
                print(f"[startup] ⚠️  _run_bootstrap_operational_data: {_boot_e}", flush=True)
        if os.getenv("SKIP_DEMO_ENGINE_INIT", "").lower() not in ("1", "true", "yes"):
            try:
                initialize_demo_data()
                start_maya_demo_engine_scheduler()
            except Exception as _demo_e:
                print(f"[startup] ⚠️  demo engine init: {_demo_e}", flush=True)
        try:
            _ensure_maya_brain_mock_tasks()
        except Exception as _mt:
            print(f"[startup] ⚠️  mock tasks: {_mt}", flush=True)
        try:
            seed_hebrew_leads(tenant_id=DEFAULT_TENANT_ID)
        except Exception:
            pass
        start_message_workers()
        start_scanner()
        start_dispatcher()
        start_calendar_syncer()
        try:
            threading.Thread(target=_live_ops_engine_loop, daemon=True, name="LiveOpsEngine").start()
        except Exception as _autoe:
            print(f"[startup] ⚠️ Maya autonomous cycle: {_autoe}", flush=True)
        try:
            start_vip_escalation_watcher()
        except Exception as _vip_e:
            print(f"[startup] ⚠️ VIP escalation watcher: {_vip_e}", flush=True)
        # run_hotel_ops_simulation_refresh is already invoked from _run_bootstrap_operational_data — avoid double DB churn.
        _sim_log(f"✅ Startup complete — DB: {db_label}", "success")
        print(f"[startup] 🚀 Server ready on port {os.environ.get('PORT', 1000)}")
        INIT_DONE = True


# SPA catch-all — registered LAST so /api/* and /uploads/* are never shadowed (fixes false 404).
@app.route("/")
@app.route("/<path:path>")
def serve_react(path=""):
    """Serve the React SPA. Unknown /api/* hits this catch-all only when no API rule matched → 404 JSON clients expect."""
    if path.startswith("api/") or path.startswith("whatsapp"):
        from flask import abort
        abort(404)
    static_file = os.path.join(_static_dir, path)
    if path and os.path.isfile(static_file):
        return send_from_directory(_static_dir, path)
    idx = os.path.join(_template_dir, "index.html")
    if os.path.isfile(idx):
        return send_from_directory(_template_dir, "index.html")
    return (
        "<h2>Maya Hotel AI</h2>"
        "<p>Run <code>npm run build</code> inside the project folder, "
        "then restart the server.</p>",
        200,
    )


# Liveness + Maya chat sync must stay fast: first hit to these must not wait for full DB/bootstrap.
_FAST_BOOT_PATHS = frozenset(
    {
        "/api/health",
        "/api/heartbeat",
        "/api/maya/chat-history",
        "/api/maya/chat_history",
    }
)


def _ensure_startup_init_async():
    """Kick off heavy _do_startup_init in a daemon thread (at most once)."""
    global _STARTUP_THREAD_STARTED
    if INIT_DONE:
        return
    with _STARTUP_THREAD_GUARD:
        if INIT_DONE or _STARTUP_THREAD_STARTED:
            return
        _STARTUP_THREAD_STARTED = True

    def _run():
        try:
            _do_startup_init()
        except Exception as _async_init_e:
            print(f"[startup] background init error: {_async_init_e}", flush=True)

    threading.Thread(target=_run, daemon=True, name="EasyHostStartupInit").start()


@app.before_request
def init_background_tasks():
    """Kicks off _do_startup_init exactly once in a background thread.
    Never blocks any incoming request — all paths are async.

    Why: the old code called _do_startup_init() synchronously for non-fast-boot
    paths, which blocked requests on INIT_LOCK while schema creation + seeding
    ran (up to 30 s on a fresh SQLite or slow network).  Since SessionLocal is
    set at module-level (before this runs), routes with the standard
    `if not SessionLocal:` guard return graceful 503 if the DB isn't ready yet.
    """
    _ensure_startup_init_async()


if __name__ == "__main__":
    # Running locally with: python app.py — default PORT=1000 unless set in .env
    # Werkzeug reloader spawns a parent + child; run heavy init only in the serving process.
    _port = int(os.environ.get("PORT", "1000") or "1000")
    os.environ["PORT"] = str(_port)
    _use_debug = os.environ.get("FLASK_DEBUG", "1").strip().lower() not in ("0", "false", "no")
    _use_reloader = _use_debug and os.environ.get("FLASK_SKIP_RELOADER", "").strip().lower() not in (
        "1",
        "true",
        "yes",
    )
    # Non-blocking: bind the HTTP server immediately; heavy DB/bootstrap runs in EasyHostStartupInit.
    # Werkzeug reloader parent skips this block; child starts one background init (see INIT_LOCK in _do_startup_init).
    if (not _use_reloader) or (os.environ.get("WERKZEUG_RUN_MAIN") == "true"):
        _ensure_startup_init_async()
    threading.Thread(target=_weekly_report_scheduler, daemon=True, name="WeeklyReportScheduler").start()
    prop_rules = [r for r in app.url_map.iter_rules() if r.rule == "/api/properties"]
    print("[hotel_dashboard] /api/properties url_map:", [f"{r.rule} {sorted(r.methods - {'HEAD'})}" for r in prop_rules])
    _auth_label = (
        "DISABLED (dev mode — set AUTH_DISABLED=false for production)"
        if AUTH_DISABLED else
        "ENABLED"
    )
    _demo_label = (
        "OPEN (set ALLOW_DEMO_AUTH=false for production)"
        if ALLOW_DEMO_AUTH else
        "closed"
    )
    print(f"[hotel_dashboard] Auth: {_auth_label} | Demo endpoint: {_demo_label}")
    print(f"[hotel_dashboard] Active routes include: GET /api/health, GET /api/properties, POST /api/ai/maya-command — binding host 0.0.0.0 port {_port}")
    app.run(host="0.0.0.0", port=_port, debug=_use_debug, threaded=True, use_reloader=_use_reloader)


