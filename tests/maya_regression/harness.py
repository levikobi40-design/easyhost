"""Flask test client helpers, JWT builders, and side-effect trackers."""
from __future__ import annotations

import json
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import patch


def make_jwt(app_module, *, sub: str, tenant_id: str, role: str, email: str = "") -> str:
    exp = int((datetime.now(timezone.utc) + timedelta(hours=2)).timestamp())
    payload = {
        "sub": sub,
        "tenant_id": tenant_id,
        "role": role,
        "email": email or f"{sub}@test.local",
        "iss": app_module.JWT_ISSUER,
        "aud": app_module.JWT_AUDIENCE,
        "exp": exp,
    }
    return app_module.encode_jwt(payload)


def auth_headers(token: str | None, *, tenant_spoof: str | None = None) -> dict:
    h = {"Content-Type": "application/json"}
    if token:
        h["Authorization"] = f"Bearer {token}"
    if tenant_spoof:
        h["X-Tenant-Id"] = tenant_spoof
    return h


class SideEffectTracker:
    def __init__(self):
        self.whatsapp: list = []
        self.sms: list = []
        self.voice: list = []
        self.gemini_calls: list = []

    def reset(self):
        self.whatsapp.clear()
        self.sms.clear()
        self.voice.clear()
        self.gemini_calls.clear()


@contextmanager
def isolated_side_effects(app_module, tracker: SideEffectTracker):
    """Block outbound channels and capture Gemini invocations."""

    def _fake_gemini(prompt, timeout=25, extra_system=""):
        tracker.gemini_calls.append({"prompt": (prompt or "")[:200], "timeout": timeout})
        return json.dumps({"action": "info", "message": "mocked deterministic info response"})

    def _fake_whatsapp(to, message, media_url=None):
        tracker.whatsapp.append({"to": to, "message": (message or "")[:120]})
        return {"success": True, "simulated": True}

    def _fake_sms(to, message):
        tracker.sms.append({"to": to, "message": (message or "")[:120]})
        return {"success": True, "simulated": True}

    def _fake_voice(to, message):
        tracker.voice.append({"to": to, "message": (message or "")[:120]})
        return {"success": True, "simulated": True}

    with patch.object(app_module, "_gemini_generate", side_effect=_fake_gemini), patch.object(
        app_module, "send_whatsapp", side_effect=_fake_whatsapp
    ), patch.object(app_module, "send_sms", side_effect=_fake_sms), patch.object(
        app_module, "make_voice_call", side_effect=_fake_voice
    ):
        yield


def maya_post(client, command: str, token: str | None = None, **extra):
    body = {"command": command, **extra}
    headers = auth_headers(token, tenant_spoof=extra.pop("tenant_spoof", None))
    if "tenant_id" in extra:
        body["tenant_id"] = extra.pop("tenant_id")
    return client.post("/api/ai/maya-command", json=body, headers=headers)


def patch_task(client, task_id: str, token: str, payload: dict):
    headers = auth_headers(token)
    return client.patch(f"/api/property-tasks/{task_id}", json=payload, headers=headers)


def count_tasks(app_module, tenant_id: str, **filters) -> int:
    SessionLocal = app_module.SessionLocal
    PropertyTaskModel = app_module.PropertyTaskModel
    session = SessionLocal()
    try:
        q = app_module._property_tasks_query_for_tenant(session, tenant_id)
        if q is None:
            return 0
        for key, val in filters.items():
            q = q.filter(getattr(PropertyTaskModel, key) == val)
        return q.count()
    finally:
        session.close()


def open_task_count(app_module, tenant_id: str) -> int:
    SessionLocal = app_module.SessionLocal
    PropertyTaskModel = app_module.PropertyTaskModel
    session = SessionLocal()
    try:
        q = app_module._property_tasks_query_for_tenant(session, tenant_id)
        if q is None:
            return 0
        rows = q.all()
        n = 0
        for r in rows:
            st = (r.status or "").strip().lower()
            if st not in ("done", "completed", "archived", "cancelled", "closed"):
                n += 1
        return n
    finally:
        session.close()


def get_task_row(app_module, task_id: str):
    SessionLocal = app_module.SessionLocal
    PropertyTaskModel = app_module.PropertyTaskModel
    session = SessionLocal()
    try:
        return session.query(PropertyTaskModel).filter(PropertyTaskModel.id == task_id).first()
    finally:
        session.close()


def reload_pending(app_module, tenant_id: str, user_id: str):
    app_module._MAYA_TASK_CREATE_PENDING.clear()
    return app_module.get_maya_pending(tenant_id, user_id)


def wait_brief(seconds: float = 0.05):
    time.sleep(seconds)
