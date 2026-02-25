import os
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
from functools import wraps
from datetime import datetime, timezone, timedelta
import math

# ── Shared activity log — captures every SIMULATE event ──────────────────────
# Frontend polls /api/activity-feed and shows these as Maya chat messages.
_ACTIVITY_LOG: deque = deque(maxlen=80)

try:
    from dotenv import load_dotenv
    _app_dir = os.path.dirname(os.path.abspath(__file__))
    _env_path = os.path.join(_app_dir, ".env")
    load_dotenv(_env_path)
    load_dotenv(os.path.join(_app_dir, "..", ".env"))
    load_dotenv()
except Exception:
    pass

from flask import Flask, request, jsonify, Response, send_from_directory, g
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from flask_cors import CORS, cross_origin

try:
    from sqlalchemy import create_engine, Column, String, Integer, Float, Text, ForeignKey, text, func, or_
    from sqlalchemy.orm import sessionmaker, declarative_base, relationship
    from sqlalchemy.exc import SQLAlchemyError
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
    sessionmaker = None
    declarative_base = None
    relationship = None
    SQLAlchemyError = Exception

try:
    from twilio.rest import Client as TwilioClient
except Exception:
    TwilioClient = None

# ══════════════════════════════════════════════════════════════════
# GEMINI AI — hardcoded key, new google.genai SDK (v1.64+)
# Model priority: gemini-2.0-flash → gemini-2.0-flash-lite → offline
# ══════════════════════════════════════════════════════════════════
_GEMINI_API_KEY = "AIzaSyBFtKTlij6hojLc1he7HBCHK02TEYMTv3E"  # hardcoded — bypass .env
_GEMINI_CLIENT  = None
_USE_NEW_GENAI  = False

try:
    from google import genai as _gnai
    _GEMINI_CLIENT = _gnai.Client(api_key=_GEMINI_API_KEY)
    _USE_NEW_GENAI = True
    print(f"[Gemini] ✅ google.genai SDK loaded — client ready")
except Exception as _ge1:
    import traceback as _tb1
    print(f"[Gemini] ❌ google.genai failed: {type(_ge1).__name__}: {_ge1}")
    _tb1.print_exc()

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

MAYA_SYSTEM_INSTRUCTION = """את מאיה, מנהלת המלון באריזונה. את המנהלת והראוטרית.
You are the manager. When a task is reported (נזילה, ניקיון, תחזוקה, דוחות, לשלוח מנקה, לפתוח משימה) you MUST create it or ask follow-up.
INTENT: If user says "לפתוח משימה" (open task) → reply "בשמחה, לאיזה חדר ובאיזה נושא?" - never say you don't understand.
If user says "לשלוח מנקה לחדר X" or "מנקה לחדר X" → create add_task with staffName "עלמה", content "ניקיון חדר X".
RTL integrity: Answer in Hebrew when the user writes in Hebrew. Keep Hebrew as primary for IL market.
Process every request. Never say you don't understand. For tasks: output valid JSON."""

# Staff mapping: Hebrew keywords -> canonical staff name (עלמה, קובי, אבי)
STAFF_KEYWORDS = {
    "עלמה": ["נקיון", "ניקיון", "עלמה", "מגבת", "cleaning", "clean", "alma"],
    "קובי": ["תיקון", "נזילה", "דליפה", "תקלה", "תחזוקה", "maintenance", "fix", "repair", "kobi", "leak"],
    "אבי": ["חשמל", "electrical", "קצר", "נשרף", "נשרפה", "מנורה", "avi", "lamp", "bulb"],
}

# Sentinel so existing `if GEMINI_MODEL:` guards still work
GEMINI_MODEL = True if _USE_NEW_GENAI else None

if _USE_NEW_GENAI:
    print("MAYA BRAIN ACTIVATED ✅  (google.genai SDK — gemini-1.5-flash primary)")
else:
    print("[Gemini] ⚠️  Brain offline — task fallback only")


# ── Model preference order ────────────────────────────────────────
# gemini-1.5-flash has higher free-tier quota than 2.0 variants
_GEMINI_MODELS = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"]


def _gemini_generate(prompt: str) -> str:
    """
    Unified Gemini call.  Tries each model in _GEMINI_MODELS until one works.
    Prints full traceback for every error so the terminal always shows why.
    Raises on hard failure so caller can serve a friendly offline message.
    """
    import traceback as _tb

    if not (_USE_NEW_GENAI and _GEMINI_CLIENT):
        raise RuntimeError("[Gemini] Client not initialised — install google-genai and check API key")

    from google.genai import types as _gt

    last_exc = None
    for model_name in _GEMINI_MODELS:
        try:
            print("--- API CALL START ---")
            print(f"[Gemini] → calling {model_name} …")
            resp = _GEMINI_CLIENT.models.generate_content(
                model=model_name,
                contents=prompt,
                config=_gt.GenerateContentConfig(
                    system_instruction=MAYA_SYSTEM_INSTRUCTION,
                    temperature=0.35,
                    max_output_tokens=512,
                ),
            )
            text = (resp.text or "").strip()
            print(f"[Gemini] ✅ {model_name} responded ({len(text)} chars)")
            return text
        except Exception as e:
            last_exc = e
            err_str = str(e).lower()
            print(f"Error: {e}")
            print(f"[Gemini] ❌ {model_name} failed: {type(e).__name__}: {e}")
            _tb.print_exc()
            if "not_found" in err_str or "404" in err_str:
                continue   # model doesn't exist for this key, try next
            if "quota" in err_str or "429" in err_str or "resource_exhausted" in err_str:
                continue   # quota hit, try cheaper model
            break  # auth/network error — no point retrying other models

    raise last_exc or RuntimeError("[Gemini] All models failed")

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*", "methods": ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"], "allow_headers": ["Content-Type", "Authorization", "X-Tenant-Id"]}})


@app.before_request
def handle_options_preflight():
    if request.method == "OPTIONS":
        resp = Response(status=204)
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Tenant-Id"
        return resp


@app.before_request
def bypass_auth_for_ai_routes():
    """Skip authentication for Maya, tasks, and messages - fixes 401 when server runs without login."""
    if request.method == "OPTIONS":
        return
    if request.path.startswith("/api/ai/"):
        g.bypass_ai_auth = True
    elif request.path == "/api/property-tasks" or request.path.startswith("/api/property-tasks/"):
        g.bypass_ai_auth = True
    elif request.path == "/api/messages" or request.path.startswith("/api/messages"):
        g.bypass_ai_auth = True
    elif request.path.startswith("/api/notify/"):
        g.bypass_ai_auth = True


@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Tenant-Id"
    return response


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


DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///leads.db")
JWT_SECRET = os.getenv("JWT_SECRET", "change-me-in-production")
JWT_ISSUER = os.getenv("JWT_ISSUER", "easyhost")
JWT_AUDIENCE = os.getenv("JWT_AUDIENCE", "easyhost-dashboard")
JWT_EXP_HOURS = int(os.getenv("JWT_EXP_HOURS", "24"))
ALLOW_DEMO_AUTH = os.getenv("ALLOW_DEMO_AUTH", "true").lower() == "true"
AUTH_DISABLED = os.getenv("AUTH_DISABLED", "true").lower() == "true"  # true = no 401 for Maya/tasks
DEFAULT_TENANT_ID = os.getenv("DEFAULT_TENANT_ID", "default")


ENGINE = None
SessionLocal = None
Base = None

if create_engine and sessionmaker and declarative_base:
    connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
    ENGINE = create_engine(
        DATABASE_URL,
        connect_args=connect_args,
        pool_pre_ping=True,
        pool_size=int(os.getenv("DB_POOL_SIZE", "10")),
        max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
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

        tenant = relationship("TenantModel")

    class PropertyStaffModel(Base):
        """Property-specific employees: id, property_id (FK manual_rooms), name, role, phone_number."""
        __tablename__ = "property_staff"

        id = Column(String, primary_key=True)
        property_id = Column(String, ForeignKey("manual_rooms.id"))
        name = Column(String)
        role = Column(String)
        phone_number = Column(String)

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

    def ensure_staff_schema():
        if not ENGINE or not text:
            return
        with ENGINE.connect() as connection:
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
            try:
                connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN IF NOT EXISTS last_checkin_at VARCHAR"))
            except Exception:
                try:
                    connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN last_checkin_at VARCHAR"))
                except Exception:
                    pass
            try:
                connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN IF NOT EXISTS description TEXT"))
            except Exception:
                try:
                    connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN description TEXT"))
                except Exception:
                    pass
            try:
                connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN IF NOT EXISTS photo_url TEXT"))
            except Exception:
                try:
                    connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN photo_url TEXT"))
                except Exception:
                    pass
            try:
                connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN IF NOT EXISTS status VARCHAR"))
            except Exception:
                try:
                    connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN status VARCHAR"))
                except Exception:
                    pass
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
            try:
                connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN IF NOT EXISTS ai_automation_enabled INTEGER DEFAULT 0"))
            except Exception:
                try:
                    connection.execute(text("ALTER TABLE manual_rooms ADD COLUMN ai_automation_enabled INTEGER DEFAULT 0"))
                except Exception:
                    pass
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
                try:
                    connection.execute(text(f"ALTER TABLE manual_rooms ADD COLUMN IF NOT EXISTS {col} {col_type}"))
                except Exception:
                    try:
                        connection.execute(text(f"ALTER TABLE manual_rooms ADD COLUMN {col} {col_type}"))
                    except Exception:
                        pass

    def init_db():
        Base.metadata.create_all(ENGINE)
        ensure_users_table()
        ensure_staff_schema()
        ensure_property_staff_table()
        ensure_property_tasks_table()

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

    def ensure_property_staff_table():
        """Create property_staff table if it doesn't exist. Columns: id, property_id, name, role, phone_number."""
        if not ENGINE or not text:
            return
        with ENGINE.connect() as connection:
            try:
                connection.execute(text("""
                    CREATE TABLE IF NOT EXISTS property_staff (
                        id VARCHAR PRIMARY KEY,
                        property_id VARCHAR NOT NULL,
                        name VARCHAR NOT NULL,
                        role VARCHAR,
                        phone_number VARCHAR
                    )
                """))
                connection.commit()
            except Exception as e:
                print("[ensure_property_staff_table] Note:", e)
            try:
                connection.execute(text("ALTER TABLE property_staff ADD COLUMN IF NOT EXISTS phone_number VARCHAR"))
            except Exception:
                try:
                    connection.execute(text("ALTER TABLE property_staff ADD COLUMN phone_number VARCHAR"))
                except Exception:
                    pass

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
                        staff_phone VARCHAR
                    )
                """))
                connection.commit()
            except Exception as e:
                print("[ensure_property_tasks_table] Note:", e)
            for col in ["property_name", "staff_name", "staff_phone", "staff_id",
                        "started_at", "completed_at", "duration_minutes", "worker_notes"]:
                try:
                    connection.execute(text(f"ALTER TABLE property_tasks ADD COLUMN IF NOT EXISTS {col} VARCHAR"))
                except Exception:
                    try:
                        connection.execute(text(f"ALTER TABLE property_tasks ADD COLUMN {col} VARCHAR"))
                    except Exception:
                        pass

else:
    TenantModel = None
    UserModel = None
    LeadModel = None
    CalendarConnectionModel = None
    MessageModel = None
    StaffModel = None
    TaskModel = None
    ManualRoomModel = None
    PropertyStaffModel = None
    PropertyTaskModel       = None
    WorkerStatsModel        = None
    WorkerPerformanceModel  = None
    DamageReportModel       = None

LEADS = []
LEADS_BY_ID = {}
LEARNING_LOG = []
DATA_LOCK = threading.Lock()
SCANNER_STARTED = False
SCANNER_LOCK = threading.Lock()
INIT_DONE = False
INIT_LOCK = threading.Lock()

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
API_BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:5000").rstrip("/")
os.makedirs(UPLOAD_ROOT, exist_ok=True)
os.makedirs(UPLOAD_STATIC, exist_ok=True)
os.makedirs(os.path.join(UPLOAD_ROOT, "default", "properties"), exist_ok=True)

STAFF_EVENT_QUEUES = {}
STAFF_EVENT_LOCK = threading.Lock()

AUTOMATION_STATS = {}

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
        return request.headers.get("X-Tenant-Id") or request.args.get("tenant_id") or DEFAULT_TENANT_ID
    if not token:
        raise ValueError("Missing authorization token")
    payload = decode_jwt(token)
    return payload.get("tenant_id")


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
        return tid, f"demo-{tid}"
    if not token:
        raise ValueError("Missing authorization token")
    payload = decode_jwt(token)
    tenant_id = payload.get("tenant_id") or DEFAULT_TENANT_ID
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


TWILIO_SENDER = "+14155238886"  # Sender for all WhatsApp, SMS, Voice alerts

def _is_whatsapp_limit_error(err):
    """Twilio 63030 = WhatsApp daily limit reached."""
    s = (err or "").lower()
    return "63030" in s or "limit" in s or "quota" in s or "daily" in s


def _is_retryable_error(err):
    """Temporary/rate-limit errors worth retrying."""
    s = (err or "").lower()
    return "limit" in s or "429" in s or "rate" in s or "timeout" in s or "503" in s or "502" in s or "temporarily" in s


TWILIO_SIMULATE = str(os.getenv("TWILIO_SIMULATE") or "").strip().lower() in ("1", "true", "yes", "on")
if TWILIO_SIMULATE:
    print("[Twilio] SIMULATE mode - messages print to terminal, no API calls (no 401/503)")

def send_whatsapp(to_number, message, media_url=None, _retries=3):
    to = _normalize_phone(to_number)
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
            if attempt < _retries - 1 and _is_retryable_error(err_str):
                time.sleep(1.5 * (attempt + 1))
                continue
            r = {"success": False, "error": err_str}
            if _is_whatsapp_limit_error(err_str):
                r["is_limit"] = True
            return r
    return {"success": False, "error": "Twilio send failed after retries"}


def send_sms(to_number, message, _retries=3):
    """Send SMS via Twilio. Sender: +14155238886. Retries on temporary errors."""
    to = _normalize_phone(to_number)
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
            if attempt < _retries - 1 and _is_retryable_error(str(e)):
                time.sleep(1.5 * (attempt + 1))
                continue
            print("[Twilio] SMS send failed:", e)
            return {"success": False, "error": str(e)}
    return {"success": False, "error": "SMS failed after retries"}


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


def notify_staff_on_task_created(task):
    """Push message to Owner (050-3233332) AND Staff (052-8155537).
    Staff gets a /worker?task_id=XXX link; Owner gets the dashboard link."""
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
    owner = (os.getenv("OWNER_PHONE") or "050-3233332").strip().replace("-", "").replace(" ", "")
    if owner.startswith("0"):
        owner = "+972" + owner[1:]
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
    """Push message to phone via Twilio - no window.open. Body: { to_phone, message }."""
    if request.method == "OPTIONS":
        return Response(status=204)
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
    """Push task message to phone via Twilio - no window.open. Used when Maya sends to staff."""
    if request.method == "OPTIONS":
        return Response(status=204)
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
        return {
            "id": rid, "name": name, "description": description or "", "photo_url": photo_url or "",
            "amenities": list(amenities) if amenities else [], "status": status, "created_at": created,
            "last_checkout_at": None, "last_checkin_at": None,
            "max_guests": room.max_guests or 2, "bedrooms": room.bedrooms or 1, "beds": room.beds or 1, "bathrooms": room.bathrooms or 1,
        }
    finally:
        session.close()


def list_manual_rooms(tenant_id, owner_id=None):
    """Return list of dicts. When owner_id is set, only return properties owned by that user."""
    if not SessionLocal or not ManualRoomModel:
        return []
    session = SessionLocal()
    try:
        q = session.query(ManualRoomModel).filter_by(tenant_id=tenant_id)
        if owner_id is not None:
            q = q.filter(or_(ManualRoomModel.owner_id.is_(None), ManualRoomModel.owner_id == owner_id))
        rows = q.all()
        out = []
        for r in rows:
            try:
                am = json.loads(r.amenities) if r.amenities else []
            except Exception:
                am = []
            purl = r.photo_url or ""
            if purl and not purl.startswith("http"):
                path = purl.lstrip("/")
                if path.startswith("uploads/"):
                    purl = f"{API_BASE_URL}/{path}"
                else:
                    purl = f"{API_BASE_URL}/uploads/{path}"
            out.append({
                "id": r.id,
                "name": r.name,
                "description": r.description or "",
                "photo_url": purl,
                "image_url": purl,
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
            })
        return out
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
                role="owner",
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
AUTO_MODE = str(os.getenv("AUTO_MODE", "0")).strip().lower() in ("1", "true", "yes")
if AUTO_MODE:
    print("[Maya] ✅ AUTO_MODE = True  — Maya is running autonomously")
else:
    print("[Maya] 🔕 AUTO_MODE = False — Manual Trigger Mode active. Use /test-task in chat.")

BACKGROUND_SCAN_ENABLED = AUTO_MODE or (
    str(os.getenv("BACKGROUND_SCAN", "0")).strip().lower() in ("1", "true", "yes")
)

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


@app.route("/health", methods=["GET"])
def health():
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


@app.route("/api/completed-today", methods=["GET", "OPTIONS"])
def completed_today():
    """
    Returns all PropertyTask rows whose status is Done/Completed
    and whose updated_at (or created_at) falls on today (UTC).
    Used by ManagerPipeline.jsx for the 'Completed Today' glassmorphism feed.
    """
    if request.method == "OPTIONS":
        return Response(status=204)

    if not SessionLocal or not PropertyTaskModel:
        return jsonify([]), 200

    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    session = SessionLocal()
    try:
        rows = session.query(PropertyTaskModel).filter(
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
            role="owner",
            created_at=now_iso(),
        )
        session.add(user)
        session.commit()
        now = datetime.now(timezone.utc)
        payload = {
            "sub": user_id,
            "tenant_id": DEFAULT_TENANT_ID,
            "role": "owner",
            "iss": JWT_ISSUER,
            "aud": JWT_AUDIENCE,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(hours=JWT_EXP_HOURS)).timestamp()),
        }
        return jsonify({"token": encode_jwt(payload), "tenant_id": DEFAULT_TENANT_ID, "role": "owner"}), 201
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
    payload = {
        "sub": user.id,
        "tenant_id": user.tenant_id,
        "role": user.role,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=JWT_EXP_HOURS)).timestamp()),
    }
    return jsonify({"token": encode_jwt(payload), "tenant_id": user.tenant_id, "role": user.role})


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
        "role": "owner",
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=JWT_EXP_HOURS)).timestamp()),
    }
    return jsonify({"token": encode_jwt(payload), "tenant_id": tenant_id, "role": "owner"})


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
    if task and booking_data.get("guest_phone"):
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
    העלאת תמונות גנרית – מקבל רשימת קבצים, מחזיר URLs.
    Supports: files (multiple) or file (single). Only image/* allowed.
    """
    files = request.files.getlist("files") or (
        [request.files["file"]] if request.files.get("file") else []
    )
    if not files:
        return jsonify({"error": "Missing files", "urls": []}), 400

    uploaded_urls = []
    for f in files:
        if not f or not f.filename:
            continue
        ct = (f.content_type or "").lower()
        if not ct.startswith("image/"):
            return jsonify({"error": f"Invalid file type: {f.filename}", "urls": []}), 400

        ext = f.filename.rsplit(".", 1)[-1].lower() if "." in f.filename else "jpg"
        if ext not in ("jpg", "jpeg", "png", "gif", "webp"):
            ext = "jpg"
        unique_name = f"{uuid.uuid4().hex}.{ext}"
        file_path = os.path.join(UPLOAD_STATIC, unique_name)
        f.save(file_path)
        url = f"{API_BASE_URL}/uploads/shared/{unique_name}"
        uploaded_urls.append(url)

    return jsonify({"urls": uploaded_urls})


@app.route("/api/rooms/manual/photo/upload", methods=["POST"])
@require_auth
def room_photo_upload():
    """העלאת תמונה לנכס – מחזיר photo_url לשימוש ביצירת נכס"""
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if "photo" not in request.files:
        return jsonify({"error": "Missing file"}), 400
    file = request.files["photo"]
    if not file or not file.filename:
        return jsonify({"error": "Invalid file"}), 400
    os.makedirs(UPLOAD_ROOT, exist_ok=True)
    tenant_dir = os.path.join(UPLOAD_ROOT, tenant_id, "properties")
    os.makedirs(tenant_dir, exist_ok=True)
    filename = secure_filename(file.filename)
    unique_name = f"prop-{uuid.uuid4().hex}-{filename}"
    file_path = os.path.join(tenant_dir, unique_name)
    file.save(file_path)
    photo_url = f"{API_BASE_URL}/uploads/{tenant_id}/properties/{unique_name}"
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
    """GET: list properties. POST: create property. OPTIONS: preflight."""
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
        request.tenant_id = DEFAULT_TENANT_ID
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    try:
        _, request.user_id = get_auth_context_from_request()
    except Exception:
        request.user_id = f"demo-{tenant_id}"

    if request.method == "GET":
        user_id = getattr(request, "user_id", None)
        rooms = list_manual_rooms(tenant_id, owner_id=user_id)
        return jsonify(rooms if isinstance(rooms, list) else []), 200

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
        return jsonify({"ok": True, "property": room}), 201
    except Exception as e:
        err_msg = f"{type(e).__name__}: {str(e)}"
        print("[create_property] Error:", err_msg, flush=True)
        import traceback
        traceback.print_exc()
        return jsonify({"error": err_msg, "detail": str(e)}), 500


@app.route("/api/properties/<string:property_id>", methods=["PUT", "PATCH", "OPTIONS"])
def update_property(property_id):
    """PUT/PATCH /api/properties/<id> - update property in manual_rooms. Accepts UUID strings."""
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
        request.tenant_id = DEFAULT_TENANT_ID
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    if not SessionLocal or not ManualRoomModel:
        return jsonify({"error": "Database unavailable"}), 500
    try:
        data = request.get_json(silent=True) or {}
        session = SessionLocal()
        try:
            room = session.query(ManualRoomModel).filter_by(id=pid, tenant_id=tenant_id).first()
            if not room:
                return jsonify({"error": "Property not found"}), 404
            if data.get("name"):
                room.name = (data.get("name") or "").strip() or room.name
            if "description" in data:
                room.description = data.get("description") or ""
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
            purl = room.photo_url or ""
            if purl and not purl.startswith("http"):
                path = purl.lstrip("/") if purl.startswith("/") else purl
                purl = f"{API_BASE_URL}/uploads/{path}"
            return jsonify({
                "ok": True,
                "property": {
                    "id": room.id,
                    "name": room.name,
                    "description": room.description or "",
                    "photo_url": purl,
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
        request.tenant_id = DEFAULT_TENANT_ID
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
        return jsonify({"ok": True, "deleted": pid}), 200
    except Exception as e:
        session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()


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
                    {"id": s.id, "name": s.name, "role": s.role or "Staff", "phone": getattr(s, "phone_number", None), "phone_number": getattr(s, "phone_number", None)}
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
        phone_number = (data.get("phone_number") or data.get("phone") or "").strip() or None
        if not name:
            return jsonify({"error": "Missing name"}), 400

        if PropertyStaffModel:
            staff_id = str(uuid.uuid4())
            emp = PropertyStaffModel(id=staff_id, property_id=pid, name=name, role=role, phone_number=phone_number)
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
                session.commit()
                return jsonify({"ok": True, "staff": {"id": emp.id, "name": emp.name, "role": emp.role, "phone_number": emp.phone_number}}), 200
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
    rooms = list_manual_rooms(tenant_id, owner_id=user_id)
    if not SessionLocal or not PropertyStaffModel:
        return jsonify({"properties": rooms, "staff_by_property": {}})
    session = SessionLocal()
    try:
        staff_by_property = {}
        for r in rooms:
            pid = r.get("id")
            if not pid:
                continue
            staff_records = session.query(PropertyStaffModel).filter_by(property_id=pid).all()
            staff_by_property[pid] = [
                {"id": s.id, "name": s.name, "role": s.role or "Staff", "phone_number": getattr(s, "phone_number", None)}
                for s in staff_records
            ]
        return jsonify({
            "properties": rooms,
            "staff_by_property": staff_by_property,
            "summary_for_ai": _build_property_summary_for_ai(rooms, staff_by_property),
        })
    finally:
        session.close()


# Real-world numbers: Owner receives confirmations, Staff receives task notifications
OWNER_PHONE = (os.getenv("OWNER_PHONE") or "050-3233332").strip().replace("-", "").replace(" ", "")
STAFF_PHONE = (os.getenv("STAFF_PHONE") or "052-8155537").strip().replace("-", "").replace(" ", "")
if OWNER_PHONE.startswith("0"):
    OWNER_PHONE = "+972" + OWNER_PHONE[1:]
if STAFF_PHONE.startswith("0"):
    STAFF_PHONE = "+972" + STAFF_PHONE[1:]

# Hardcoded fallbacks for staff by name
STAFF_PHONE_FALLBACK = {"alma": "0501234567", "עלמה": "0501234567", "kobi": "0529876543", "קובי": "0529876543", "avi": "050-2223334", "אבי": "050-2223334"}


def _infer_staff_from_command(command, task_obj):
    """Infer staff from command text when staffName is missing or ambiguous. Returns 'עלמה'|'קובי'|'אבי'."""
    cmd = (command or "") + " " + (task_obj.get("content") or "")
    cmd_lower = cmd.lower()
    for staff_he, keywords in STAFF_KEYWORDS.items():
        if any(kw in cmd or kw in cmd_lower for kw in keywords):
            return staff_he
    return "קובי"  # default maintenance


def _create_task_from_action(tenant_id, user_id, task_obj, rooms, staff_by_property, command=None):
    """Create task from action.add_task format: {staffName, content, propertyName, status}"""
    if not SessionLocal or not PropertyTaskModel or not PropertyStaffModel:
        return None, "Tasks unavailable"
    staff_name = (task_obj.get("staffName") or "").strip() or "Staff"
    content = (task_obj.get("content") or "").strip() or "Task from Maya"
    prop_name = (task_obj.get("property_name") or task_obj.get("propertyName") or "").strip()
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
    gemini_result = {
        "intent": "cleaning" if suggested == "alma" else "maintenance" if suggested == "kobi" else "electrician" if suggested == "avi" else "housekeeping",
        "content": content,
        "description": content,
        "property_name": prop_name,
        "suggested_staff": suggested,
        "staffName": staff_name,
    }
    return _create_task_from_gemini(tenant_id, user_id, gemini_result, rooms, staff_by_property)


def _create_task_from_gemini(tenant_id, user_id, gemini_result, rooms, staff_by_property):
    """Create a property task from Gemini's structured JSON. Returns (task_dict, error)."""
    if not SessionLocal or not PropertyTaskModel or not PropertyStaffModel:
        return None, "Tasks unavailable"
    intent = (gemini_result.get("intent") or "").lower()
    if intent not in ("cleaning", "maintenance", "housekeeping", "electrician"):
        return None, None  # Not a task-creating intent
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

    staff_id = ""
    staff_name = ""
    staff_phone = ""
    if prop_id and staff_by_property.get(prop_id):
        staff_list = staff_by_property[prop_id]
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
    # Hardcoded phones: Alma=0501234567, Kobi=0529876543
    if staff_name and (staff_name.lower() == "alma" or "עלמה" in staff_name):
        staff_phone = "0501234567"
    elif staff_name and (staff_name.lower() == "kobi" or "קובי" in staff_name):
        staff_phone = "0529876543"

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
        dup = session.query(PropertyTaskModel).filter(
            PropertyTaskModel.description == (desc or ""),
            PropertyTaskModel.created_at >= cutoff_str,
        ).first()
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

        print(f"DEBUG: Maya decided to CREATE task for room {room_log}")
        task_id = str(uuid.uuid4())
        created = now_iso()
        full_desc = desc
        if prop_ctx:
            full_desc = f"{desc} | נכס: {prop_ctx}" if desc else f"נכס: {prop_ctx}"
        new_pt = PropertyTaskModel(
            id=task_id,
            property_id=prop_id or "",
            staff_id=staff_id,
            assigned_to=staff_id,
            description=full_desc,
            status="Pending",
            created_at=created,
            property_name=prop_display,
            staff_name=staff_name,
            staff_phone=staff_phone,
        )
        session.add(new_pt)
        session.commit()
        print(f"SUCCESS: Task created for room {room_log} — id={task_id} staff={staff_name}")
        return {
            "id": task_id,
            "property_id": prop_id,
            "assigned_to": staff_id,
            "description": full_desc,
            "status": "Pending",
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


@app.route("/api/ai/maya-command", methods=["POST", "OPTIONS"])
@cross_origin(origins="*", allow_headers=["Content-Type", "Authorization", "X-Tenant-Id"], methods=["GET", "POST", "OPTIONS"])
def ai_maya_command():
    """Public route - no @login_required. Maya chat must work without auth."""
    if request.method == "OPTIONS":
        return Response(status=204)
    tenant_id = DEFAULT_TENANT_ID
    user_id = f"demo-{DEFAULT_TENANT_ID}"
    # No auth - always allow Maya (bypass_ai_auth from before_request)

    data = request.get_json(silent=True) or {}
    command = (data.get("command") or data.get("message") or "").strip()
    tasks_for_analysis = data.get("tasksForAnalysis")
    if not command and not tasks_for_analysis:
        return jsonify({"error": "Missing command", "success": False}), 400

    # Confirmation: Maya confirms setup complete
    confirm_keywords = ["הגדרות מאיה", "אישור הגדרות", "מאיה מוכנה", "השרת חובר", "מערכת מחוברת", "המערכת מחוברת", "maya configured", "maya ready", "server connected", "סיימת", "המפתח הוגדר", "המוח מחובר"]
    if any(kw in (command or "") or kw in (command or "").lower() for kw in confirm_keywords):
        display = "קובי, המערכת מחוברת ומוכנה למכירה!"
        return jsonify({"success": True, "message": display, "displayMessage": display}), 200

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
            enqueue_twilio_task("notify_task", task=task)
            display = "אני על זה! 🧹 מנקה נשלח לחדר " + room_num + " ✅"
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
    if _room:
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

    # Emergency: VOICE FIRST to 050-3233332 (WhatsApp may be blocked by limit 63030). Fallback: Voice.
    emergency_keywords = ["חירום", "מצב חירום", "אש", "דליקה", "שריפה", "flood", "fire", "emergency", "דליפה חריפה", "נזילה חמורה"]
    is_emergency = any(kw in (command or "") or kw in cmd_lower for kw in emergency_keywords)
    if is_emergency:
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

    # Management analysis: "בוא נראה אותה מנהלת" - analyze board, suggest reminders
    is_management = tasks_for_analysis is not None or "נראה אותה מנהלת" in (command or "") or "maya manage" in (command or "").lower()
    if is_management and (GEMINI_MODEL or _USE_NEW_GENAI):
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
        if (GEMINI_MODEL or _USE_NEW_GENAI) and (tasks_for_analysis or []):
            try:
                mgmt_prompt = f"""You are Maya, proactive hotel manager. Analyze these tasks and write ONE short management message in Hebrew.

Tasks: {json.dumps(pending[:15], ensure_ascii=False)}

Format: Start with "יש לנו X משימות פתוחות." Then mention specific staff and tasks (e.g. "קובי עדיין לא סיים את הנזילה ב-104", "עלמה צריכה לסיים את 205 תוך שעה"). End with "האם להוציא להם תזכורת?" 
Be concise, 2-3 sentences."""
                report_text = _gemini_generate(mgmt_prompt) or f"יש לנו {len(pending)} משימות פתוחות. האם להוציא תזכורת?"
            except Exception as e:
                print("[Gemini] Management analysis failed:", e)
                return jsonify({
                    "success": False,
                    "message": str(e),
                    "displayMessage": "שגיאה בחיבור ל-AI. בדוק את GEMINI_API_KEY ב-.env",
                }), 200
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
        if (GEMINI_MODEL or _USE_NEW_GENAI) and all_tasks:
            try:
                report_prompt = f"""You are Maya, hotel manager. Generate a text summary of ALL tasks currently on the board.

Done today ({len(done_today)}): {json.dumps(done_today[:10], ensure_ascii=False)}
Pending ({len(pending_list)}): {json.dumps(pending_list[:10], ensure_ascii=False)}

Write a concise professional summary in Hebrew only (2-4 sentences). Mention counts and key tasks."""
                report_text = _gemini_generate(report_prompt) or f"דוח יומי: הושלמו {len(done_today)} משימות. {len(pending_list)} ממתינות."
            except Exception as e:
                print("[Gemini] Daily report failed:", e)
                return jsonify({
                    "success": False,
                    "message": str(e),
                    "displayMessage": "שגיאה בחיבור ל-AI. בדוק את GEMINI_API_KEY ב-.env",
                }), 200
        else:
            report_text = f"דוח יומי: הושלמו {len(done_today)} משימות. {len(pending_list)} ממתינות."
        return jsonify({
            "success": True,
            "message": report_text,
            "displayMessage": report_text,
            "taskCreated": False,
        }), 200

    rooms = list_manual_rooms(tenant_id, owner_id=user_id)
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
    summary = _build_property_summary_for_ai(rooms, staff_by_property)

    # Fallback when Gemini not configured: still create tasks for repair/maintenance phrases
    cmd_lower = (command or "").lower().strip()
    task_keywords_fallback = ["תקלה", "בעיה", "דליפה", "נזילה", "קצר", "חשמל", "ניקיון", "תחזוקה", "תקן", "תתקן", "נשרף", "נשרפה", "מנורה", "מנקה", "לשלוח", "חדר", "fix", "repair", "clean", "broken", "leak"]
    is_task_like = any(kw in (command or "") or kw in cmd_lower for kw in task_keywords_fallback)

    if not GEMINI_MODEL and not _USE_NEW_GENAI:
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
                enqueue_twilio_task("notify_task", task=task)
                display_msg = "Message simulated successfully." if TWILIO_SIMULATE else "אני על זה! ההודעה תישלח לנייד בתור."
                return jsonify({"success": True, "message": display_msg, "displayMessage": display_msg, "taskCreated": True, "task": task}), 200
        return jsonify({
            "success": False,
            "message": "AI not configured. Add GEMINI_API_KEY to .env",
            "displayMessage": "הוסף GEMINI_API_KEY לקובץ .env. קבל מפתח חינם: https://aistudio.google.com/apikey",
        }), 200

    history = data.get("history") or []
    history_text = ""
    if isinstance(history, list) and len(history) > 0:
        recent = history[-6:]
        parts = []
        for m in recent:
            role = (m.get("role") or "user").lower()
            content = (m.get("content") or "").strip()[:500]
            if content:
                label = "User" if role == "user" else "Maya"
                parts.append(f"{label}: {content}")
        if parts:
            history_text = "\nPrevious conversation:\n" + "\n".join(parts) + "\n\n"

    TASK_TRIGGERS = "תקלה|בעיה|דליפה|קצר|חשמל|ניקיון|תחזוקה|תקן|נשרף|נשרפה|מנורה|fix|repair|clean|broken|leak|electrical|lamp|bulb"
    lang_hint = "Reply in the SAME language as the user's last message." if history_text else "If user wrote in Hebrew, reply in Hebrew. If in English, reply in English."
    prompt = f"""{history_text}Current: User said: "{command}"

Context: {summary}

{lang_hint} NEVER reply with "לא הצלחתי להבין" or "I don't understand". Always process the request.
RULES (never break):
- Staff mapping (Hebrew names in JSON): נקיון/ניקיון/עלמה → staffName "עלמה" | תיקון/נזילה/תקלה → staffName "קובי" | חשמל → staffName "אבי"
- If user mentions ANY problem (יש תקלה, נזילה, ניקיון, fix, etc.) → return add_task. When unsure → קובי.
- Return ONLY JSON. Never raw property data unless user asks "summary" or "דוח".
- Extract room number into content. propertyName: Chandler or first from context.
- Return ONLY this JSON, nothing else. Use staffName: עלמה | קובי | אבי (Hebrew):
{{"action": "add_task", "task": {{"staffName": "קובי", "content": "תקלה - " + user request, "propertyName": "Chandler", "status": "Pending"}}}}

Only if user asks a simple question (not a task): {{"action": "info", "message": "..."}}"""

    try:
        text = _gemini_generate(prompt)
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*", "", text)
            text = re.sub(r"\s*```$", "", text)
        parsed = {}
        if text:
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                start = text.find('{')
                end = text.rfind('}')
                if start >= 0 and end > start:
                    try:
                        parsed = json.loads(text[start : end + 1])
                    except json.JSONDecodeError:
                        pass
    except json.JSONDecodeError as e:
        print("[Gemini] maya-command JSON parse error:", e)
        cmd_lower = (command or "").lower().strip()
        task_kw = ["תקלה", "בעיה", "דליפה", "נזילה", "קצר", "חשמל", "ניקיון", "תחזוקה", "תקן", "נשרף", "נשרפה", "מנורה", "fix", "repair", "clean", "leak"]
        if any(kw in (command or "") or kw in cmd_lower for kw in task_kw):
            staff = "אבי" if any(x in (command or "") for x in ["קצר", "חשמל", "נשרף", "נשרפה", "מנורה"]) else "עלמה"
            if any(x in (command or "") for x in ["ניקיון", "מגבת", "מנקה", "clean"]):
                staff = "עלמה"
            else:
                staff = "קובי"
            parsed_fb = {"action": "add_task", "task": {"staffName": staff, "content": (command or "תקלה")[:200], "propertyName": "Chandler", "status": "Pending"}}
            task, err = _create_task_from_action(tenant_id, user_id, parsed_fb["task"], rooms, staff_by_property, command)
            if task:
                enqueue_twilio_task("notify_task", task=task)
                sim_msg = "Message simulated successfully." if TWILIO_SIMULATE else "אני על זה! ההודעה תישלח לנייד בתור."
                return jsonify({"success": True, "message": sim_msg, "displayMessage": sim_msg, "taskCreated": True, "task": task}), 200
        return jsonify({
            "success": False,
            "message": str(e),
            "displayMessage": "לא הצלחתי להבין את התשובה. נסה שוב.",
        }), 200
    except Exception as e:
        import traceback as _tb_cmd
        print(f"\n{'='*60}")
        print(f"[Gemini] maya-command FAILED: {type(e).__name__}: {e}")
        _tb_cmd.print_exc()
        print(f"{'='*60}\n")
        err_str = str(e).lower()
        print(f"Error: {e}")
        if "quota" in err_str or "429" in err_str or "resource_exhausted" in err_str:
            display_msg = "קובי, יש תקלה בחיבור לשרת גוגל. תבדוק את הטרמינל 🔴"
        elif "not_found" in err_str or "404" in err_str:
            display_msg = "קובי, יש תקלה בחיבור לשרת גוגל. תבדוק את הטרמינל 🔴"
        elif any(x in err_str for x in ["401", "403", "permission", "key", "auth"]):
            display_msg = "קובי, יש תקלה בחיבור לשרת גוגל. תבדוק את הטרמינל 🔴"
        elif any(x in err_str for x in ["timeout", "connection", "network", "502", "503"]):
            display_msg = "קובי, יש תקלה בחיבור לשרת גוגל. תבדוק את הטרמינל 🔴"
        else:
            display_msg = "קובי, יש תקלה בחיבור לשרת גוגל. תבדוק את הטרמינל 🔴"
        return jsonify({
            "success": False,
            "message": str(e),
            "displayMessage": display_msg,
        }), 200

    task_created = False
    task = None

    # Task detection: נזילה, תקלה, ניקיון etc - always create task, never "don't understand"
    cmd_lower = (command or "").lower().strip()
    task_keywords = ["תקלה", "בעיה", "דליפה", "נזילה", "קצר", "חשמל", "ניקיון", "תחזוקה", "תקן", "תתקן", "נשרף", "נשרפה", "מנורה", "מנקה", "לשלוח", "חדר", "fix", "repair", "clean", "broken", "leak"]
    is_task_like = any(kw in (command or "") or kw in cmd_lower for kw in task_keywords)
    if is_task_like and parsed.get("action") != "add_task":
        staff = "אבי" if any(x in (command or "") for x in ["קצר", "חשמל", "electrical", "נשרף", "נשרפה", "מנורה"]) else "עלמה"
        if any(x in (command or "") for x in ["ניקיון", "מגבת", "מנקה", "clean", "cleaning"]):
            staff = "עלמה"
        else:
            staff = "קובי"
        parsed = {
            "action": "add_task",
            "task": {"staffName": staff, "content": (command or "תקלה/בקשה")[:200], "propertyName": "Chandler", "status": "Pending"},
        }

    # Handle action: "add_task" format (strict JSON from Gemini)
    if parsed.get("action") == "add_task" and isinstance(parsed.get("task"), dict):
        task_obj = parsed["task"]
        task, err = _create_task_from_action(tenant_id, user_id, task_obj, rooms, staff_by_property, command)
        if err:
            return jsonify({
                "success": False,
                "message": err,
                "displayMessage": err,
            }), 500
        if task:
            task_created = True
    elif parsed.get("intent") in ("cleaning", "maintenance", "housekeeping", "electrician"):
        task, err = _create_task_from_gemini(tenant_id, user_id, parsed, rooms, staff_by_property)
        if err:
            return jsonify({
                "success": False,
                "message": err,
                "displayMessage": err,
            }), 500
        if task:
            task_created = True

    if parsed.get("action") == "info":
        display_msg = parsed.get("message", "מטופל.")
    else:
        staff_name = (task or {}).get("staff_name", "")
        if task_created and staff_name and task:
            enqueue_twilio_task("notify_task", task=task)
            display_msg = "Message simulated successfully." if TWILIO_SIMULATE else "אני על זה! ההודעה תישלח לנייד בתור."
        else:
            display_msg = f"מודיע ל{staff_name}." if staff_name else "משימה טופלה."

    return jsonify({
        "success": True,
        "message": display_msg,
        "displayMessage": display_msg,
        "taskCreated": task_created,
        "task": task,
        "parsed": parsed,
    }), 200


def _build_property_summary_for_ai(rooms, staff_by_property):
    """Human-readable summary for AI to answer guest queries: 'This villa has 2 guests and 1 bedroom. Staff: Kobi (cleaner).'"""
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
        parts.append(
            f"'{name}': {guests} guests, {bedrooms} bedroom(s), {beds} bed(s), {bathrooms} bathroom(s). "
            f"Staff: {staff_str}."
        )
    return " | ".join(parts) if parts else "No properties."


# Master Access: Maya creates tasks and sends notifications without 401
STAFF_ACTIONS = [{"label": "ראיתי ✅", "value": "seen"}, {"label": "בוצע 🏁", "value": "done"}]


@app.route("/api/property-tasks", methods=["GET", "POST", "OPTIONS"])
def property_tasks_api():
    """GET/POST: No auth. Maya has Master Access to create tasks and notify staff."""
    if request.method == "OPTIONS":
        return Response(status=204)
    tenant_id = DEFAULT_TENANT_ID
    user_id = f"demo-{DEFAULT_TENANT_ID}"

    if not SessionLocal or not PropertyTaskModel:
        if request.method == "GET":
            return jsonify([]), 200
        return jsonify({"error": "Tasks unavailable"}), 500

    session = SessionLocal()
    try:
        if request.method == "GET":
            # Optional ?worker=levikobi filter — used by WorkerView for server-side filtering
            worker_filter = (request.args.get("worker") or "").strip().lower()
            status_filter = (request.args.get("status") or "").strip().lower()

            rooms    = list_manual_rooms(tenant_id, owner_id=user_id)
            room_ids = [r.get("id") for r in rooms if r.get("id")]
            room_map = {r.get("id"): r for r in rooms if r.get("id")}

            # Fetch ALL tasks — do NOT filter by room_ids because manual /test-task
            # tasks use plain room numbers ("302") that are never in the UUID room_ids
            # list, which caused them to be silently dropped.
            rows = session.query(PropertyTaskModel).order_by(
                PropertyTaskModel.created_at.desc()
            ).limit(200).all()

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
                elif raw_status in ("pending", "Pending", "assigned", "Assigned",
                                    "queued", "Queued"):
                    row_status = "Pending"
                else:
                    row_status = raw_status

                # Server-side worker filter (case-insensitive on both sides)
                if worker_filter:
                    sn_lc = staff_name.lower()
                    at_lc = assigned_to.lower()
                    if worker_filter not in (sn_lc, at_lc):
                        continue

                # Server-side status filter
                if status_filter and row_status.lower() != status_filter:
                    continue

                # Derive clean room label with guaranteed fallback
                pname = (getattr(r, "property_name", None) or "").strip()
                pid   = (r.property_id or "").strip()
                room_label = pname or (f"חדר {pid}" if pid else "חדר לא ידוע")

                desc_val = (r.description or "").strip() or "ביצוע משימה"

                tasks.append({
                    "id":               r.id,
                    # canonical field names
                    "property_id":      pid,
                    "property_name":    room_label,
                    # aliases expected by older frontend code
                    "room_id":          pid,
                    "room":             room_label,
                    "task_type":        desc_val,
                    # rest of payload
                    "assigned_to":      assigned_to,
                    "description":      desc_val,
                    "status":           row_status,   # normalised
                    "created_at":       getattr(r, "created_at",       None),
                    "started_at":       getattr(r, "started_at",       None),
                    "completed_at":     getattr(r, "completed_at",     None),
                    "duration_minutes": getattr(r, "duration_minutes", None),
                    "staff_name":       staff_name or "Unknown",
                    "staff_phone":      staff_phone,
                    "property_context": ctx,
                    "actions":          STAFF_ACTIONS,
                })

            print(f"[Tasks] GET /api/property-tasks worker={worker_filter!r:15s} "
                  f"status={status_filter!r:12s} → {len(tasks)} tasks returned")
            return jsonify(tasks), 200

        data = request.get_json(silent=True) or {}
        property_id = data.get("property_id") or ""
        staff_id = data.get("staff_id") or data.get("assigned_to") or ""
        assigned_to = staff_id
        description = data.get("description") or ""
        # Always default to Pending so new tasks appear on the worker screen immediately
        _raw_status = (data.get("status") or "").strip()
        status = _raw_status if _raw_status in ("Pending","In_Progress","Done") else "Pending"
        property_name = data.get("property_name") or ""
        staff_name = data.get("staff_name") or ""
        staff_phone = data.get("staff_phone") or ""
        property_context = data.get("property_context") or ""

        task_id = str(uuid.uuid4())
        created = now_iso()
        full_desc = description
        if property_context:
            full_desc = f"{description} | נכס: {property_context}" if description else f"נכס: {property_context}"

        # ── Smart Dispatch: if worker already has an In_Progress task, queue as Pending ──
        queued_msg = None
        effective_status = status
        if staff_name:
            busy_task = session.query(PropertyTaskModel).filter(
                PropertyTaskModel.staff_name == staff_name,
                PropertyTaskModel.status == "In_Progress",
            ).first()
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
        )
        session.add(task)
        session.commit()
        task_payload = {
            "id": task_id,
            "property_id": property_id,
            "staff_id": staff_id,
            "assigned_to": assigned_to,
            "description": full_desc,
            "status": effective_status,
            "created_at": created,
            "property_name": property_name,
            "staff_name": staff_name,
            "staff_phone": staff_phone,
            "queued": queued_msg is not None,
            "queued_message": queued_msg,
            "actions": STAFF_ACTIONS,
        }
        return jsonify({"ok": True, "task": task_payload}), 201
    except Exception as e:
        session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()


@app.route("/api/property-tasks/<string:task_id>", methods=["GET", "PATCH", "OPTIONS"])
def property_task_update(task_id):
    """GET single task; PATCH: update task status. No auth - staff buttons must work."""
    if request.method == "OPTIONS":
        return Response(status=204)
    if request.method == "GET":
        tid = str(task_id).strip() if task_id else ""
        if not tid or not SessionLocal or not PropertyTaskModel:
            return jsonify({"error": "Task not found"}), 404
        session = SessionLocal()
        try:
            task = session.query(PropertyTaskModel).filter_by(id=tid).first()
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
    tid = str(task_id).strip() if task_id else ""
    print(f"UPDATING TASK: {tid}")
    if not tid:
        return jsonify({"error": "Missing task id"}), 400
    if not SessionLocal or not PropertyTaskModel:
        return jsonify({"error": "Tasks unavailable"}), 500
    session = SessionLocal()
    try:
        task = session.query(PropertyTaskModel).filter_by(id=tid).first()
        if not task:
            # Diagnosis: show what IDs exist in the DB
            existing_ids = [r.id for r in session.query(PropertyTaskModel.id).limit(10).all()]
            print(f"PATCH 404 — task '{tid}' not found. Sample IDs in DB: {existing_ids}")
            return jsonify({"error": "Task not found", "task_id": tid, "hint": "check terminal for DB sample"}), 404
        data = request.get_json(silent=True) or {}
        if "status" in data:
            raw = (data.get("status") or "Pending").strip() or "Pending"

            # ── Traffic-light status normalisation ──────────────
            # Pending → Red   |  In_Progress → Orange  |  Done → Green
            if raw in ("confirmed", "Seen", "seen", "Accepted", "accepted"):
                new_status = "In_Progress"      # treat old "Accepted" as started
            elif raw in ("In_Progress", "in_progress", "in progress",
                         "InProgress", "started", "working"):
                new_status = "In_Progress"
            elif raw in ("done", "Done", "completed", "Completed"):
                new_status = "Done"
            elif raw in ("pending", "Pending", "queued", "Queued"):
                new_status = "Pending"
            else:
                new_status = raw
            print(f"[Task] PATCH {tid[:8]}… '{raw}' → '{new_status}'")

            now_ts = datetime.now(timezone.utc).isoformat()

            # ── Performance timestamps ──────────────────────────
            if new_status == "In_Progress":
                # Worker started — stamp started_at once (never overwrite)
                if not getattr(task, "started_at", None):
                    task.started_at = now_ts
                    print(f"[Perf] 🟠 Task {tid[:8]}… started_at={now_ts}")
                try:
                    notify_owner_on_seen(task)
                except Exception as e:
                    print("[Maya] notify_owner_on_seen failed:", e)

            elif new_status == "Done":
                # Worker finished — stamp completed_at and compute duration
                task.completed_at = now_ts
                # Use started_at → fall back to created_at
                ref_ts_str = getattr(task, "started_at", None) or getattr(task, "created_at", None)
                if ref_ts_str:
                    try:
                        ref_dt  = datetime.fromisoformat(str(ref_ts_str).replace("Z", "+00:00"))
                        done_dt = datetime.fromisoformat(now_ts)
                        if ref_dt.tzinfo  is None: ref_dt  = ref_dt.replace(tzinfo=timezone.utc)
                        if done_dt.tzinfo is None: done_dt = done_dt.replace(tzinfo=timezone.utc)
                        mins = round((done_dt - ref_dt).total_seconds() / 60, 1)
                        task.duration_minutes = str(max(0, mins))
                        print(f"[Perf] ✅ Task {tid[:8]}… done in {mins} min by {getattr(task,'staff_name','?')}")
                    except Exception as _pe:
                        print(f"[Perf] duration calc error: {_pe}")

            task.status = new_status

        # Allow direct patch of staff_name (for assignment flow)
        if "staff_name" in data and data["staff_name"]:
            task.staff_name = data["staff_name"]
        if "staff_phone" in data and data["staff_phone"]:
            task.staff_phone = data["staff_phone"]

        # Allow patching worker_notes
        if "worker_notes" in data:
            task.worker_notes = data["worker_notes"] or ""

        session.commit()
        print(f"UPDATING TASK: {tid} — saved ✅")

        # ── Fire Performance Agent in background after completion ──
        _worker_for_agent = getattr(task, "staff_name", "") or ""
        _new_status_for_agent = task.status if "status" in data else None
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
        rows = session.query(PropertyTaskModel).filter(
            PropertyTaskModel.status.isnot(None)
        ).order_by(PropertyTaskModel.created_at.desc()).limit(500).all()

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


@app.route("/api/tasks", methods=["POST", "OPTIONS"])
def api_tasks_create():
    """POST: Create task. AI or User can call to create a task linked to property_id. Same behavior as /api/property-tasks POST."""
    if request.method == "OPTIONS":
        return Response(status=204)
    return property_tasks_api()


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

    rooms = list_manual_rooms(tenant_id, owner_id=user_id)
    room_ids = [r.get("id") for r in rooms if r.get("id")]
    total_properties = len(rooms)
    total_capacity = sum((r.get("max_guests") or 2) for r in rooms)

    tasks_by_status = {"Pending": 0, "Done": 0}
    staff_workload = {}
    staff_with_phones = {}

    if SessionLocal and PropertyTaskModel:
        session_obj = SessionLocal()
        try:
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

    return jsonify({
        "total_properties": total_properties,
        "tasks_by_status": tasks_by_status,
        "staff_workload": staff_workload,
        "total_capacity": total_capacity,
        "top_staff": top_staff[:3],
    })


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
    os.makedirs(UPLOAD_ROOT, exist_ok=True)
    tenant_dir = os.path.join(UPLOAD_ROOT, tenant_id, "issues")
    os.makedirs(tenant_dir, exist_ok=True)
    filename = secure_filename(file.filename or "issue.jpg")
    unique_name = f"{room_id}-{uuid.uuid4().hex}-{filename}"
    file_path = os.path.join(tenant_dir, unique_name)
    file.save(file_path)
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
    os.makedirs(UPLOAD_ROOT, exist_ok=True)
    tenant_dir = os.path.join(UPLOAD_ROOT, tenant_id)
    os.makedirs(tenant_dir, exist_ok=True)
    filename = secure_filename(file.filename)
    unique_name = f"{staff_id}-{uuid.uuid4().hex}-{filename}"
    file_path = os.path.join(tenant_dir, unique_name)
    file.save(file_path)
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
    finally:
        session.close()
    out = []
    for task in tasks:
        staff_name = None
        if task.staff_id and StaffModel:
            staff = session.query(StaffModel).filter_by(id=task.staff_id, tenant_id=tenant_id).first()
            staff_name = staff.name if staff else None
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
        })
    return jsonify(out)


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

    def event_stream():
        with app.app_context():
            event_queue = get_event_queue(tenant_id)
            while True:
                event = event_queue.get()
                yield f"event: {event['type']}\n"
                yield f"data: {json.dumps(event['payload'])}\n\n"

    return Response(event_stream(), mimetype="text/event-stream")


@app.route("/api/stream/staff", methods=["GET"])
@require_auth
def stream_staff():
    def event_stream():
        tenant_id = get_tenant_id_from_request()
        event_queue = get_staff_event_queue(tenant_id)
        while True:
            event = event_queue.get()
            yield f"event: {event['type']}\n"
            yield f"data: {json.dumps(event['payload'])}\n\n"

    return Response(event_stream(), mimetype="text/event-stream")


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
        AUTOMATION_STATS["automated_messages"] += 1
        emit_automation_stats()
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
    AUTOMATION_STATS["automated_messages"] += 1
    emit_automation_stats()
    return jsonify(result)


@app.route("/api/stats", methods=["GET"])
@require_auth
def get_stats():
    tenant_id = getattr(request, "tenant_id", DEFAULT_TENANT_ID)
    stats = get_automation_stats_for_tenant(tenant_id)
    return jsonify({
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
        total_revenue = 0
        if CalendarConnectionModel:
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

        return jsonify({
            "revenue": f"{total_revenue}₪",
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


if __name__ == "__main__":
    if Base and ENGINE:
        init_db()
        ensure_default_tenants()
        ensure_demo_user()
        ensure_levikobi_user()
        load_leads_from_db()
    seed_hebrew_leads(tenant_id=DEFAULT_TENANT_ID)
    start_message_workers()
    start_scanner()
    start_dispatcher()
    start_calendar_syncer()
    threading.Thread(target=_weekly_report_scheduler, daemon=True, name="WeeklyReportScheduler").start()
    prop_rules = [r for r in app.url_map.iter_rules() if r.rule == "/api/properties"]
    print("[hotel_dashboard] /api/properties url_map:", [f"{r.rule} {sorted(r.methods - {'HEAD'})}" for r in prop_rules])
    print("[hotel_dashboard] AUTH_DISABLED:", AUTH_DISABLED)
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)


@app.before_request
def init_background_tasks():
    global INIT_DONE
    with INIT_LOCK:
        if INIT_DONE:
            return
        if Base and ENGINE:
            init_db()
            ensure_default_tenants()
            ensure_demo_user()
            ensure_levikobi_user()
            seed_dashboard_data()
            load_leads_from_db()
        seed_hebrew_leads(tenant_id=DEFAULT_TENANT_ID)
        start_message_workers()
        start_scanner()
        start_dispatcher()
        start_calendar_syncer()
        INIT_DONE = True


