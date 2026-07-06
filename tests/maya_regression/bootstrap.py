"""Isolated environment bootstrap — must run before importing app."""
from __future__ import annotations

import os
import sys
import tempfile
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ISOLATION: dict = {}


def _stub_dotenv() -> None:
    """Prevent app.py from loading .env (which would enable AUTH_DISABLED and leads.db)."""
    fake = types.ModuleType("dotenv")
    fake.load_dotenv = lambda *args, **kwargs: False  # noqa: ARG005
    sys.modules["dotenv"] = fake


def configure_isolated_environment() -> dict:
    """Set env vars so app.py never touches leads.db or production PostgreSQL."""
    if ISOLATION.get("configured"):
        return ISOLATION

    _stub_dotenv()

    test_root = Path(tempfile.mkdtemp(prefix="maya_regression_"))
    test_db = test_root / "isolated_maya_test.db"
    test_data = test_root / "data"
    test_data.mkdir(parents=True, exist_ok=True)

    # Remove remote DB credentials that might exist in the parent process env.
    for key in list(os.environ.keys()):
        if key.startswith(("SUPABASE_", "DATABASE_URL", "POSTGRES")):
            os.environ.pop(key, None)

    os.environ["DATABASE_URL"] = f"sqlite:///{test_db.as_posix()}"
    os.environ["AUTH_DISABLED"] = "false"
    os.environ["ALLOW_DEMO_AUTH"] = "false"
    os.environ["SEED_DEMO_DATA"] = "false"
    os.environ["JWT_SECRET"] = "maya-regression-test-secret-fixed-32b!"
    os.environ["JWT_ISSUER"] = "easyhost"
    os.environ["JWT_AUDIENCE"] = "easyhost-dashboard"
    os.environ["SKIP_TWILIO_WHATSAPP"] = "true"
    os.environ["TWILIO_SIMULATE"] = "false"
    os.environ["GEMINI_API_KEY"] = "test-key-not-used"
    os.environ["AUTO_MODE"] = "0"
    os.environ["BACKGROUND_SCAN"] = "0"

    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))

    ISOLATION.update(
        {
            "configured": True,
            "test_root": str(test_root),
            "test_db": str(test_db),
            "test_data": str(test_data),
            "leads_db_path": str(ROOT / "leads.db"),
        }
    )
    return ISOLATION


def load_app_module():
    """Import app after isolation env is configured."""
    iso = configure_isolated_environment()

    import maya_service

    maya_service._DATA_DIR = iso["test_data"]  # noqa: SLF001 — test-only redirect

    import app as app_module
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    # app._build_database_url() ignores sqlite:// DATABASE_URL and falls back to leads.db.
    # Rebind ENGINE to the isolated temp file without modifying app.py source.
    test_url = f"sqlite:///{Path(iso['test_db']).as_posix()}"
    app_module.DATABASE_URL = test_url
    app_module._is_sqlite = True  # noqa: SLF001
    app_module._is_pg = False  # noqa: SLF001
    app_module.ENGINE = create_engine(
        test_url,
        connect_args={"check_same_thread": False},
        pool_pre_ping=True,
    )
    app_module.SessionLocal = sessionmaker(bind=app_module.ENGINE)

    try:
        app_module._do_startup_init()
    except Exception as exc:
        print(f"[maya_regression] startup init note: {exc}", flush=True)

    iso["database_url"] = app_module.DATABASE_URL
    iso["auth_disabled"] = app_module.AUTH_DISABLED
    iso["app_module"] = app_module
    return app_module
