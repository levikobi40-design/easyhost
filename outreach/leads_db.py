"""
Shared access to the app's `leads` table for the outreach scripts (send_emails.py, growth_agent.py).

The database is the source of truth for outreach leads and their status, so they show up in the
dashboard's lead management screen (GET /api/leads, filtered by tenant). Rows written here use
source="cold_email" and a deterministic id per email address, so repeated imports never duplicate.

Connection (first match wins):
    GROWTH_DATABASE_URL   explicit URL — set this to the Railway service's DATABASE_URL to reach production
    DATABASE_URL          when it is PostgreSQL (same normalisation as app.py)
    ../leads.db           the app's local SQLite fallback
Tenant: GROWTH_TENANT_ID, then DEFAULT_TENANT_ID, then "default" — must match the tenant you log in with.

In dry-run mode reads still hit the database (when reachable) but every write is only printed.
"""

from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import MetaData, Table, and_, create_engine, func, insert, select, update
from sqlalchemy.exc import SQLAlchemyError

HERE = Path(__file__).resolve().parent
SOURCE = "cold_email"
STATUSES = ("Pending", "Sent", "Replied", "Booked", "Opt-Out")
DO_NOT_SEND = {"Sent", "Replied", "Booked", "Opt-Out"}
_ID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "easyhost-ai/outreach")


class LeadStoreError(RuntimeError):
    pass


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def resolve_database_url() -> str:
    raw = (os.getenv("GROWTH_DATABASE_URL") or "").strip()
    if not raw:
        env_url = (os.getenv("DATABASE_URL") or "").strip()
        raw = env_url if env_url and not env_url.startswith("sqlite") else ""
    if not raw:
        return f"sqlite:///{HERE.parent / 'leads.db'}"
    if raw.startswith("postgres://"):
        raw = raw.replace("postgres://", "postgresql://", 1)
    raw = re.sub(r"[?&]direct=[^&]*", "", raw).replace("?&", "?").rstrip("?&")
    if raw.startswith("postgresql") and "sslmode" not in raw and "localhost" not in raw and "127.0.0.1" not in raw:
        raw += ("&" if "?" in raw else "?") + "sslmode=require"
    return raw


def mask_url(url: str) -> str:
    return re.sub(r":([^:@/]+)@", ":***@", url)


def lead_id_for(email_addr: str) -> str:
    return "outreach-" + uuid.uuid5(_ID_NAMESPACE, email_addr.strip().lower()).hex[:20]


class LeadStore:
    def __init__(self, dry_run: bool = False):
        self.dry_run = dry_run
        self.url = resolve_database_url()
        self.tenant_id = (os.getenv("GROWTH_TENANT_ID") or os.getenv("DEFAULT_TENANT_ID") or "default").strip()
        try:
            self.engine = create_engine(self.url, pool_pre_ping=True)
            meta = MetaData()
            self.leads = Table("leads", meta, autoload_with=self.engine)
            self.tenants = Table("tenants", meta, autoload_with=self.engine)
        except SQLAlchemyError as e:
            raise LeadStoreError(f"cannot open the leads table at {mask_url(self.url)}: {e}") from e
        with self.engine.connect() as conn:
            tenant = conn.execute(select(self.tenants.c.id).where(self.tenants.c.id == self.tenant_id)).first()
        if tenant is None:
            raise LeadStoreError(f"tenant {self.tenant_id!r} does not exist in {mask_url(self.url)}; set GROWTH_TENANT_ID")

    def describe(self) -> str:
        return f"{mask_url(self.url)} (tenant {self.tenant_id})"

    def _scope(self):
        return and_(self.leads.c.tenant_id == self.tenant_id, self.leads.c.source == SOURCE)

    def fetch(self) -> dict[str, dict]:
        """All outreach leads of the tenant, keyed by lower-case email."""
        cols = [self.leads.c[n] for n in ("id", "name", "email", "city", "status") if n in self.leads.c]
        with self.engine.connect() as conn:
            rows = conn.execute(select(*cols).where(self._scope())).mappings().all()
        return {(r["email"] or "").lower(): dict(r) for r in rows if r["email"]}

    def import_leads(self, rows: list[dict]) -> int:
        """Insert leads.csv rows that are not in the database yet (as Pending). Returns how many."""
        existing = self.fetch()
        new_rows = [r for r in rows if r["email"].lower() not in existing]
        if not new_rows:
            return 0
        if self.dry_run:
            print(f"[DRY RUN] DB: would add {len(new_rows)} lead(s) as Pending to {self.describe()}", flush=True)
            return len(new_rows)
        now = _now_iso()
        values = []
        for r in new_rows:
            row = {
                "id": lead_id_for(r["email"]),
                "tenant_id": self.tenant_id,
                "name": r["company"],
                "contact": f"{r['company']} Team",
                "email": r["email"],
                "phone": "",
                "source": SOURCE,
                "status": "Pending",
                "value": 0,
                "rating": 0,
                "created_at": now,
                "notes": f"{now[:16].replace('T', ' ')} Pending: imported from leads.csv",
                "property_name": r["company"],
                "city": r.get("location", ""),
                "ai_summary": "Cold outreach lead (EasyHost AI growth agent).",
            }
            values.append({k: v for k, v in row.items() if k in self.leads.c})
        with self.engine.begin() as conn:
            conn.execute(insert(self.leads), values)
        return len(values)

    def set_status(self, email_addr: str, status: str, note: str = "", summary: str | None = None) -> None:
        if status not in STATUSES:
            raise ValueError(f"Unknown status {status!r}; use one of {', '.join(STATUSES)}")
        if self.dry_run:
            print(f"[DRY RUN] DB: would set {email_addr} -> {status}" + (f" ({note})" if note else ""), flush=True)
            return
        line = f"{_now_iso()[:16].replace('T', ' ')} {status}" + (f": {note}" if note else "")
        where = and_(self._scope(), func.lower(self.leads.c.email) == email_addr.strip().lower())
        with self.engine.begin() as conn:
            current = conn.execute(select(self.leads.c.notes).where(where)).first()
            if current is None:
                raise LeadStoreError(f"lead {email_addr} not found in {self.describe()}")
            values = {"status": status, "notes": ((current[0] or "") + "\n" + line).strip()}
            if summary is not None and "ai_summary" in self.leads.c:
                values["ai_summary"] = summary
            conn.execute(update(self.leads).where(where).values(**values))


def open_store(dry_run: bool) -> LeadStore | None:
    """Open the store; in dry-run an unreachable database only prints a warning and returns None."""
    try:
        return LeadStore(dry_run=dry_run)
    except LeadStoreError as e:
        if dry_run:
            print(f"[DRY RUN] DB unavailable, continuing with local data only: {e}", flush=True)
            return None
        raise
