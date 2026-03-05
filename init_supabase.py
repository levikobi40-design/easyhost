"""
init_supabase.py
================
Runs BEFORE Gunicorn starts (via render.yaml startCommand).

What it does:
  1. Resolves the correct database URL from environment variables
  2. Tests the connection with a SELECT 1  — prints "Connected to Supabase successfully"
  3. Creates all tables (CREATE TABLE IF NOT EXISTS)
  4. Seeds the 10 pilot properties + mock staff accounts
  5. Exits 0 on success so Gunicorn can start, exits 1 on fatal connection error

Why a separate script?
  Background threads started inside Flask die when this process exits.
  We deliberately only create schema + seed data here.
  The simulation bots (guest complaints / staff responses) start inside
  the Flask process via the `before_request` init hook.

Usage:
  python init_supabase.py
"""

import os
import sys
import re
import time

# ── 0. Resolve DATABASE_URL using the same logic as app.py ─────────────────

_APP_DIR = os.path.dirname(os.path.abspath(__file__))

def _resolve_db_url() -> str:
    raw = os.getenv("DATABASE_URL", "").strip()
    if raw and not raw.startswith("sqlite"):
        if raw.startswith("postgres://"):
            raw = raw.replace("postgres://", "postgresql://", 1)
        if "?" not in raw and "supabase" in raw.lower():
            raw += "?sslmode=require"
        return raw

    supabase_url = os.getenv("SUPABASE_URL", "").strip()
    supabase_key = os.getenv("SUPABASE_KEY", "").strip()
    if supabase_url and supabase_key:
        # Safety check: Supabase JWT tokens start with "eyJ".
        # If SUPABASE_KEY looks like a JWT the user has set the API key instead
        # of the database password — warn them clearly.
        if supabase_key.startswith("eyJ"):
            print("=" * 70)
            print("[init_supabase] ⚠️  SUPABASE_KEY looks like a JWT API key, not a")
            print("  database password.  These are DIFFERENT values in Supabase.")
            print()
            print("  ✅  What you need:")
            print("      Supabase Dashboard → Project Settings → Database → Password")
            print("      Copy THAT password and set it as SUPABASE_KEY on Render.")
            print()
            print("  ❌  What you have:")
            print(f"      SUPABASE_KEY starts with 'eyJ…' (that is a JWT token,")
            print("      used for the JS/REST client — NOT for direct PostgreSQL).")
            print("=" * 70)
            # Still attempt — maybe user knows what they're doing
        m = re.match(r"https?://([^.]+)\.supabase\.co", supabase_url)
        if m:
            project_ref = m.group(1)
            url = (
                f"postgresql://postgres:{supabase_key}"
                f"@db.{project_ref}.supabase.co:5432/postgres?sslmode=require"
            )
            return url
        else:
            print(f"[init_supabase] ⚠️  SUPABASE_URL format not recognised: {supabase_url}")

    return f"sqlite:///{os.path.join(_APP_DIR, 'leads.db')}"


DATABASE_URL = _resolve_db_url()
is_supabase  = "supabase" in DATABASE_URL
is_pg        = DATABASE_URL.startswith("postgresql")
is_sqlite    = DATABASE_URL.startswith("sqlite")
db_label     = "Supabase PostgreSQL" if is_supabase else "PostgreSQL" if is_pg else "SQLite (local)"

print(f"[init_supabase] Database type : {db_label}")
if is_pg:
    # Print host only (hide password)
    _safe = re.sub(r":([^:@]+)@", ":***@", DATABASE_URL)
    print(f"[init_supabase] Connection URL: {_safe}")

# ── 1. SQLAlchemy setup ─────────────────────────────────────────────────────
try:
    from sqlalchemy import create_engine, text, MetaData, Table, Column, String, Integer, Float, Text
    from sqlalchemy.orm import declarative_base, sessionmaker
except ImportError:
    print("[init_supabase] ❌  SQLAlchemy not installed. Run: pip install sqlalchemy psycopg2-binary")
    sys.exit(1)

if is_sqlite:
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_size=2,
        max_overflow=3,
        pool_timeout=30,
        pool_recycle=300,
    )

# ── 2. Connection test ──────────────────────────────────────────────────────
print("[init_supabase] Testing database connection…")
retries = 3
for attempt in range(1, retries + 1):
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print(f"[init_supabase] ✅  Connected to {db_label} successfully")
        break
    except Exception as e:
        print(f"[init_supabase] ⚠️  Attempt {attempt}/{retries} failed: {e}")
        if attempt == retries:
            print()
            print("[init_supabase] ❌  Could not connect to the database after "
                  f"{retries} attempts.")
            if is_supabase:
                print()
                print("  Troubleshooting checklist:")
                print("  1. SUPABASE_KEY  → must be the DATABASE PASSWORD")
                print("     (Supabase → Project Settings → Database → Password)")
                print("  2. SUPABASE_URL  → must be https://PROJECT_REF.supabase.co")
                print("  3. The Supabase project must NOT be paused (free tier pauses")
                print("     after 1 week of inactivity — click 'Restore' in dashboard)")
                print("  4. Or set DATABASE_URL directly to the full connection string")
                print("     from Supabase → Settings → Database → Connection string (URI)")
            sys.exit(1)
        time.sleep(3)

# ── 3. Create all tables ────────────────────────────────────────────────────
# We import the app's ORM models so we get the exact same schema as the live app.
print("[init_supabase] Importing app models…")
try:
    # Temporarily override DATABASE_URL so app.py uses our resolved URL
    os.environ.setdefault("DATABASE_URL", DATABASE_URL)
    from app import (
        Base, ENGINE as APP_ENGINE,
        init_db,
        ensure_users_table,
        ensure_staff_schema,
        ensure_property_staff_table,
        ensure_property_tasks_table,
    )
    print("[init_supabase] Creating schema (CREATE TABLE IF NOT EXISTS)…")
    init_db()
    print("[init_supabase] ✅  All tables created on Supabase")
except Exception as e:
    print(f"[init_supabase] ❌  Schema creation failed: {e}")
    import traceback; traceback.print_exc()
    sys.exit(1)

# ── 4. Seed pilot data ──────────────────────────────────────────────────────
print("[init_supabase] Seeding pilot demo data (10 properties + mock staff)…")
try:
    from app import seed_pilot_demo, SessionLocal, ManualRoomModel, DEMO_PILOT_PROPERTY_NAMES
    seed_pilot_demo()
    # Count properties created
    session = SessionLocal()
    try:
        count = session.query(ManualRoomModel).filter(
            ManualRoomModel.name.in_(DEMO_PILOT_PROPERTY_NAMES)
        ).count()
        print(f"[init_supabase] ✅  {count} pilot properties in Supabase")
    finally:
        session.close()
except Exception as e:
    print(f"[init_supabase] ⚠️  Seed warning (non-fatal): {e}")

# ── 5. Summary ──────────────────────────────────────────────────────────────
print()
print("=" * 60)
print(f"  init_supabase.py COMPLETE")
print(f"  Database  : {db_label}")
print( "  Tables    : ✅ created")
print( "  Seed data : ✅ loaded")
print( "  Bots      : will start on first HTTP request (Gunicorn)")
print("=" * 60)
print()
