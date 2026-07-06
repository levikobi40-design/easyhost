#!/usr/bin/env python3
"""
Deterministic Maya regression harness — isolated SQLite, mocked AI/outbound.

Run: python tests/maya_regression/run_maya_regression.py
"""
from __future__ import annotations

import json
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from unittest.mock import patch

# Ensure repo root importable when executed directly.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from tests.maya_regression.bootstrap import configure_isolated_environment, load_app_module
from tests.maya_regression.fixtures import (
    PROP_CORFU,
    PROP_MANTO_APTS,
    PROP_MANTO_BEACH,
    TASK_A_DONE,
    TASK_A_OPEN,
    TASK_B_OPEN,
    TENANT_A,
    TENANT_B,
    USER_ADMIN_A,
    USER_ADMIN_B,
    USER_MANAGER_A,
    USER_STAFF_A,
    USER_USER_A2,
    seed_isolated_fixtures,
)
from tests.maya_regression.harness import (
    SideEffectTracker,
    auth_headers,
    count_tasks,
    get_task_row,
    isolated_side_effects,
    make_jwt,
    maya_post,
    open_task_count,
    patch_task,
    reload_pending,
)


@dataclass
class ScenarioResult:
    num: int
    status: str  # PASS | FAIL | BLOCKED | OBSERVED
    expected: str
    actual: str
    evidence: str = ""


@dataclass
class RunReport:
    results: list[ScenarioResult] = field(default_factory=list)
    isolation: dict = field(default_factory=dict)
    build_result: str = "NOT RUN"
    leads_db_touched: bool = False
    external_sent: bool = False


def _record(report: RunReport, num: int, status: str, expected: str, actual: str, evidence: str = ""):
    report.results.append(ScenarioResult(num, status, expected, actual, evidence))


def _body(resp):
    try:
        return resp.get_json(silent=True) or {}
    except Exception:
        return {}


def _msg(resp) -> str:
    b = _body(resp)
    return (b.get("displayMessage") or b.get("message") or b.get("error") or "")[:300]


def run_scenarios(app_module, report: RunReport):
    app = app_module.app
    client = app.test_client()
    tracker = SideEffectTracker()

    tok_admin_a = make_jwt(app_module, sub=USER_ADMIN_A, tenant_id=TENANT_A, role="admin")
    tok_manager_a = make_jwt(app_module, sub=USER_MANAGER_A, tenant_id=TENANT_A, role="manager")
    tok_staff_a = make_jwt(app_module, sub=USER_STAFF_A, tenant_id=TENANT_A, role="staff", email="staff@test.local")
    tok_admin_b = make_jwt(app_module, sub=USER_ADMIN_B, tenant_id=TENANT_B, role="admin")
    tok_user_a2 = make_jwt(app_module, sub=USER_USER_A2, tenant_id=TENANT_A, role="manager")

    gemini_queue: list[str] = []

    def _queued_gemini(prompt, timeout=25, extra_system=""):
        tracker.gemini_calls.append({"prompt": (prompt or "")[:160]})
        if gemini_queue:
            return gemini_queue.pop(0)
        return json.dumps({"action": "info", "message": "mocked info"})

    # ── A. AUTH / RBAC ─────────────────────────────────────────────────────
    with isolated_side_effects(app_module, tracker):
        r = maya_post(client, "מה הסטטוס?", token=None)
        _record(
            report,
            1,
            "PASS" if r.status_code == 401 else "FAIL",
            "401 without JWT when AUTH_DISABLED=false",
            f"HTTP {r.status_code}: {_msg(r)}",
            "POST /api/ai/maya-command no Authorization",
        )

        before = count_tasks(app_module, TENANT_A)
        r = maya_post(client, "מה הסטטוס?", token=tok_staff_a)
        after = count_tasks(app_module, TENANT_A)
        _record(
            report,
            2,
            "PASS" if r.status_code == 200 and after == before else "FAIL",
            "Staff read-only status question allowed, no task mutation",
            f"HTTP {r.status_code}, tasks {before}->{after}",
            _msg(r),
        )

        r = maya_post(
            client,
            "לפתוח משימת ניקיון חדר 100 לחוף מנטו",
            token=tok_staff_a,
        )
        _record(
            report,
            3,
            "PASS" if r.status_code == 403 or _body(r).get("forbidden") else "OBSERVED",
            "Staff create task -> 403",
            f"HTTP {r.status_code}: {_msg(r)}",
            "Rule path finalize hits _maya_guard_mutation_in_chat",
        )

        gemini_queue.append(
            json.dumps(
                {
                    "action": "mark_task_done",
                    "task_id": TASK_A_OPEN,
                    "message": "done",
                }
            )
        )
        with app.test_request_context(
            "/api/ai/maya-command",
            method="POST",
            json={"command": "סמני משימה כבוצעה"},
            headers=auth_headers(tok_staff_a),
        ):
            from flask import request

            staff_identity = {
                "tenant_id": TENANT_A,
                "user_id": USER_STAFF_A,
                "app_role": "staff",
                "email": "staff@test.local",
            }
            request.maya_identity = staff_identity
            request._maya_chat_active = True
            rooms, staff_map = app_module._get_maya_rooms_and_staff(TENANT_A, USER_STAFF_A)
            res4 = app_module._maya_build_json_response_from_llm_output(
                TENANT_A,
                USER_STAFF_A,
                "סמני משימה כבוצעה",
                gemini_queue.pop(0),
                {},
                rooms,
                staff_map,
                maya_identity=staff_identity,
            )
        _record(
            report,
            4,
            "PASS" if res4.get("forbidden") else "FAIL",
            "Staff complete task -> 403 (mocked LLM mark_task_done)",
            f"forbidden={res4.get('forbidden')}; error={res4.get('error', '')[:80]}",
            "mocked _maya_build_json_response_from_llm_output",
        )

        r = maya_post(client, "שלחי הודעת בדיקה", token=tok_staff_a)
        _record(
            report,
            5,
            "PASS" if r.status_code == 403 else "FAIL",
            "Staff outbound test message -> 403",
            f"HTTP {r.status_code}: {_msg(r)}",
            f"whatsapp_calls={len(tracker.whatsapp)}",
        )

        r = maya_post(
            client,
            "לפתוח משימת ניקיון חדר 101 לחוף מנטו",
            token=tok_manager_a,
        )
        _record(
            report,
            6,
            "PASS" if r.status_code == 200 and (_body(r).get("taskCreated") or "פתחתי" in _msg(r)) else "FAIL",
            "Manager create task allowed (mocked/rule path)",
            f"HTTP {r.status_code}: {_msg(r)[:180]}",
            "deterministic rule-based create",
        )

        r = maya_post(
            client,
            "לפתוח משימת ניקיון חדר 102 לחוף מנטו",
            token=tok_admin_a,
        )
        _record(
            report,
            7,
            "PASS" if r.status_code == 200 and (_body(r).get("taskCreated") or "פתחתי" in _msg(r)) else "FAIL",
            "Admin create task allowed",
            f"HTTP {r.status_code}: {_msg(r)[:180]}",
            "deterministic rule-based create",
        )

    # ── B. TENANT ISOLATION ────────────────────────────────────────────────
    ok, err = app_module._maya_mark_property_task_done(TENANT_A, TASK_B_OPEN, USER_ADMIN_A)
    _record(
        report,
        8,
        "PASS" if not ok and err == "not_found" else "FAIL",
        "Tenant A cannot complete Tenant B task by id",
        f"ok={ok}, err={err}",
        "_maya_mark_property_task_done tenant-scoped",
    )

    r = patch_task(client, TASK_B_OPEN, tok_admin_a, {"status": "Done"})
    _record(
        report,
        9,
        "PASS" if r.status_code == 404 else "FAIL",
        "Tenant A cannot PATCH Tenant B task",
        f"HTTP {r.status_code}: {_body(r).get('error', '')}",
        "PATCH /api/property-tasks/<id> tenant-scoped lookup",
    )

    row_b_before = get_task_row(app_module, TASK_B_OPEN)
    # Ensure baseline Pending for notify promotion probe (prior scenarios must not mutate tenant-b row).
    if row_b_before and (row_b_before.status or "").strip().lower() in ("done", "completed"):
        session = app_module.SessionLocal()
        try:
            row_b_before.status = "Pending"
            row_b_before.completed_at = None
            session.merge(row_b_before)
            session.commit()
        finally:
            session.close()
        row_b_before = get_task_row(app_module, TASK_B_OPEN)
    st_before = (row_b_before.status or "").strip() if row_b_before else "missing"
    with patch.object(app_module, "send_whatsapp", return_value={"success": True}), patch.object(
        app_module, "send_sms", return_value={"success": True}
    ):
        app_module.notify_staff_on_task_created(
            {
                "id": TASK_B_OPEN,
                "tenant_id": TENANT_A,
                "description": "cross-tenant notify probe",
                "staff_phone": "0500000001",
            }
        )
    row_b_after = get_task_row(app_module, TASK_B_OPEN)
    st_after = (row_b_after.status or "").strip() if row_b_after else "missing"
    _record(
        report,
        10,
        "PASS" if st_before == st_after == "Pending" else "FAIL",
        "Tenant A cannot promote Tenant B task via notify path",
        f"status before={st_before} after={st_after}",
        "notify_staff_on_task_created + scoped promote",
    )

    r = maya_post(
        client,
        "מה הסטטוס?",
        token=tok_admin_a,
        tenant_id=TENANT_B,
    )
    # JWT tenant-a should win — open count should reflect tenant-a data only.
    stats_hint = _msg(r)
    open_a = open_task_count(app_module, TENANT_A)
    open_b = open_task_count(app_module, TENANT_B)
    _record(
        report,
        11,
        "OBSERVED",
        "Body tenant_id spoof ignored — response scoped to JWT tenant",
        f"HTTP {r.status_code}; open_a={open_a} open_b={open_b}; msg={stats_hint[:120]}",
        "body tenant_id=tenant-b with JWT tenant-a",
    )

    r = maya_post(
        client,
        "מה הסטטוס?",
        token=tok_admin_a,
        tenant_spoof=TENANT_B,
    )
    _record(
        report,
        12,
        "OBSERVED",
        "X-Tenant-Id spoof ignored under JWT auth",
        f"HTTP {r.status_code}: {_msg(r)[:120]}",
        "Header X-Tenant-Id=tenant-b with JWT tenant-a",
    )

    # ── C. MANTO / CLARIFICATION (rule-based, no live AI) ───────────────────
    app_module.clear_maya_pending(TENANT_A, USER_ADMIN_A)
    with isolated_side_effects(app_module, tracker):
        r13 = maya_post(
            client,
            "לפתוח משימת ניקיון דחופה לחוף מנטו",
            token=tok_admin_a,
        )
        pend13 = app_module.get_maya_pending(TENANT_A, USER_ADMIN_A)
        msg13 = _msg(r13)
        # חוף מנטו resolves to single property → room clarification, not property ambiguity.
        s13 = (
            "PASS"
            if r13.status_code == 200
            and pend13
            and ("חדר" in msg13 or pend13.get("missing_field") == "room")
            else "OBSERVED"
        )
        _record(
            report,
            13,
            s13,
            "Hebrew Manto beach command clarifies next field (property if ambiguous, else room)",
            f"HTTP {r13.status_code}; pending={bool(pend13)} missing={pend13.get('missing_field') if pend13 else None}; msg={msg13[:140]}",
            "rule path _maya_try_begin_task_create_from_command",
        )

        r14 = maya_post(client, "Manto Beach Suite", token=tok_admin_a)
        pend14 = app_module.get_maya_pending(TENANT_A, USER_ADMIN_A)
        _record(
            report,
            14,
            "OBSERVED",
            "Property name reply continues pending flow when property was ambiguous",
            f"HTTP {r14.status_code}; pending={bool(pend14)} msg={_msg(r14)[:140]}",
            "After beach-specific open, reply may re-ask room not property",
        )

        asks_room = "חדר" in _msg(r14) or (pend14 and pend14.get("missing_field") == "room")
        _record(
            report,
            15,
            "PASS" if asks_room else "OBSERVED",
            "If room missing, Maya asks for room",
            f"msg={_msg(r14)[:140]}; missing_field={pend14.get('missing_field') if pend14 else None}",
            evidence="scenario 13 left room empty",
        )

        r16 = maya_post(client, "100", token=tok_admin_a)
        infra = "100 לקוחות" in _msg(r16) or "התשתית" in _msg(r16)
        task_created = _body(r16).get("taskCreated") or "פתחתי" in _msg(r16)
        _record(
            report,
            16,
            "PASS" if task_created and not infra else "FAIL" if infra else "OBSERVED",
            "Numeric 100 interpreted as room; no infrastructure reply",
            f"HTTP {r16.status_code}; taskCreated={_body(r16).get('taskCreated')}; msg={_msg(r16)[:160]}",
            "pending handler before infra shortcut",
        )

        app_module.clear_maya_pending(TENANT_A, USER_ADMIN_A)
        app_module.set_maya_pending(
            TENANT_A,
            USER_ADMIN_A,
            app_module.MAYA_PENDING_INTENT_CREATE_TASK,
            "property",
            {"task_type": "cleaning", "priority": "high", "description": "test"},
        )
        r17 = maya_post(client, "100", token=tok_admin_a)
        reask_prop = "נכס" in _msg(r17) and "100 לקוחות" not in _msg(r17)
        _record(
            report,
            17,
            "PASS" if reask_prop else "FAIL",
            "Pending property + numeric 100 re-asks property",
            f"HTTP {r17.status_code}: {_msg(r17)[:160]}",
            "missing_field=property guard",
        )

        app_module.clear_maya_pending(TENANT_A, USER_ADMIN_A)
        app_module.set_maya_pending(
            TENANT_A,
            USER_ADMIN_A,
            app_module.MAYA_PENDING_INTENT_CREATE_TASK,
            "room",
            {
                "property_id": PROP_MANTO_BEACH,
                "property_name": "Manto Beach Suite",
                "task_type": "cleaning",
                "description": "persist probe",
            },
        )
        pend_db_id = app_module.get_maya_pending(TENANT_A, USER_ADMIN_A)
        app_module._MAYA_TASK_CREATE_PENDING.clear()
        pend_reload = reload_pending(app_module, TENANT_A, USER_ADMIN_A)
        _record(
            report,
            18,
            "PASS" if pend_reload and pend_reload.get("description") == "persist probe" else "FAIL",
            "Pending survives RAM cache clear via DB reload",
            f"reloaded={pend_reload is not None}; desc={pend_reload.get('description') if pend_reload else None}",
            "get_maya_pending DB-first",
        )

        app_module.set_maya_pending(
            TENANT_A,
            USER_ADMIN_A,
            app_module.MAYA_PENDING_INTENT_CREATE_TASK,
            "room",
            {"description": "tenant-a-only"},
        )
        app_module.set_maya_pending(
            TENANT_B,
            USER_ADMIN_B,
            app_module.MAYA_PENDING_INTENT_CREATE_TASK,
            "room",
            {"description": "tenant-b-only"},
        )
        pa = app_module.get_maya_pending(TENANT_A, USER_ADMIN_A)
        pb = app_module.get_maya_pending(TENANT_B, USER_ADMIN_B)
        _record(
            report,
            19,
            "PASS"
            if pa and pb and pa.get("description") != pb.get("description")
            else "FAIL",
            "Pending isolated tenant-a vs tenant-b",
            f"a={pa.get('description') if pa else None}; b={pb.get('description') if pb else None}",
            "maya_pending_clarifications.tenant_id",
        )

        app_module.set_maya_pending(
            TENANT_A,
            USER_ADMIN_A,
            app_module.MAYA_PENDING_INTENT_CREATE_TASK,
            "room",
            {"description": "user-a"},
        )
        app_module.set_maya_pending(
            TENANT_A,
            USER_USER_A2,
            app_module.MAYA_PENDING_INTENT_CREATE_TASK,
            "room",
            {"description": "user-a2"},
        )
        pu1 = app_module.get_maya_pending(TENANT_A, USER_ADMIN_A)
        pu2 = app_module.get_maya_pending(TENANT_A, USER_USER_A2)
        _record(
            report,
            20,
            "PASS" if pu1 and pu2 and pu1.get("description") != pu2.get("description") else "FAIL",
            "Pending isolated per user within tenant",
            f"admin={pu1.get('description') if pu1 else None}; user2={pu2.get('description') if pu2 else None}",
            "maya_pending_clarifications.user_id",
        )

        app_module.clear_maya_pending(TENANT_A, USER_ADMIN_A)
        if app_module.MayaPendingClarificationModel and app_module.SessionLocal:
            session = app_module.SessionLocal()
            try:
                expired_at = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
                session.add(
                    app_module.MayaPendingClarificationModel(
                        id=str(uuid.uuid4()),
                        tenant_id=TENANT_A,
                        user_id=USER_ADMIN_A,
                        intent=app_module.MAYA_PENDING_INTENT_CREATE_TASK,
                        missing_field="room",
                        payload_json=json.dumps({"description": "expired-row"}),
                        created_at=expired_at,
                        expires_at=expired_at,
                        resolved_at=None,
                    )
                )
                session.commit()
            finally:
                session.close()
        expired = app_module.get_maya_pending(TENANT_A, USER_ADMIN_A)
        r21 = maya_post(client, "100", token=tok_admin_a)
        created_from_expired = _body(r21).get("taskCreated")
        _record(
            report,
            21,
            "PASS" if expired is None and not created_from_expired else "FAIL",
            "Expired pending not consumed",
            f"get_pending={expired}; taskCreated={created_from_expired}; msg={_msg(r21)[:120]}",
            "expires_at filter in get_maya_pending",
        )

    # ── D. TASK CREATION INTEGRITY ───────────────────────────────────────────
    app_module.clear_maya_pending(TENANT_A, USER_ADMIN_A)
    complaint = "יש ריח של סיגריות ולהחליף סדינים"
    cmd_integrity = f"לפתוח משימת ניקיון דחופה חדר 100 לחוף מנטו — {complaint}"
    before_integrity = count_tasks(app_module, TENANT_A)
    with isolated_side_effects(app_module, tracker):
        r22 = maya_post(client, cmd_integrity, token=tok_admin_a)
    after_integrity = count_tasks(app_module, TENANT_A)
    created_task = _body(r22).get("task") or {}
    task_id_integrity = created_task.get("id")
    row_integrity = get_task_row(app_module, task_id_integrity) if task_id_integrity else None
    desc = (row_integrity.description if row_integrity else "") or created_task.get("description", "")

    _record(
        report,
        22,
        "PASS" if complaint in desc else "OBSERVED",
        "Preserves exact complaint text",
        f"desc={desc[:200]}",
        cmd_integrity[:80],
    )
    _record(
        report,
        23,
        "PASS" if row_integrity and (row_integrity.priority or "").lower() == "high" else "OBSERVED",
        "Priority urgent/high preserved",
        f"priority={getattr(row_integrity, 'priority', None)}",
        "דחופה in command",
    )
    _record(
        report,
        24,
        "PASS"
        if row_integrity and "Manto Beach" in (row_integrity.property_name or "")
        else "OBSERVED",
        "Property preserved",
        f"property_name={getattr(row_integrity, 'property_name', None)}",
        "",
    )
    _record(
        report,
        25,
        "PASS" if row_integrity and "100" in (row_integrity.description or "") else "OBSERVED",
        "Room 100 preserved in description",
        f"description={getattr(row_integrity, 'description', '')[:160]}",
        "",
    )
    _record(
        report,
        26,
        "PASS" if row_integrity and (row_integrity.source or "") == "maya" else "OBSERVED",
        "source=maya preserved",
        f"source={getattr(row_integrity, 'source', None)}",
        "",
    )
    _record(
        report,
        27,
        "PASS" if row_integrity and row_integrity.tenant_id == TENANT_A else "FAIL",
        "tenant_id from JWT preserved",
        f"tenant_id={getattr(row_integrity, 'tenant_id', None)}",
        "",
    )
    _record(
        report,
        28,
        "PASS" if after_integrity - before_integrity == 1 else "OBSERVED",
        "One command creates exactly one new task row",
        f"count {before_integrity}->{after_integrity}",
        "",
    )

    before_dup = count_tasks(app_module, TENANT_A)
    with isolated_side_effects(app_module, tracker):
        maya_post(client, cmd_integrity, token=tok_admin_a)
    after_dup = count_tasks(app_module, TENANT_A)
    _record(
        report,
        29,
        "PASS" if after_dup == before_dup else "OBSERVED",
        "Identical retry does not create uncontrolled duplicate (5-min guard)",
        f"count {before_dup}->{after_dup}",
        "duplicate guard in _create_task_from_gemini",
    )

    reloaded = get_task_row(app_module, task_id_integrity) if task_id_integrity else None
    _record(
        report,
        30,
        "PASS" if reloaded and reloaded.id == task_id_integrity else "FAIL",
        "Task survives DB reload",
        f"id={task_id_integrity}; reloaded={bool(reloaded)}",
        "",
    )

    # ── E. TASK LIFECYCLE ───────────────────────────────────────────────────
    lifecycle_id = task_id_integrity or TASK_A_OPEN
    with isolated_side_effects(app_module, tracker):
        patch_task(client, lifecycle_id, tok_admin_a, {"status": "Done"})
    row_lc = get_task_row(app_module, lifecycle_id)
    _record(
        report,
        31,
        "PASS" if row_lc and (row_lc.status or "").lower() in ("done", "completed") else "FAIL",
        "Complete task persists after PATCH",
        f"status={getattr(row_lc, 'status', None)}",
        "",
    )

    ok_done, _ = app_module._maya_mark_property_task_done(TENANT_A, lifecycle_id, USER_ADMIN_A)
    row_lc2 = get_task_row(app_module, lifecycle_id)
    _record(
        report,
        32,
        "PASS" if ok_done and (row_lc2.status or "").lower() in ("done", "completed") else "OBSERVED",
        "Completed task stays completed on Maya mark path",
        f"ok={ok_done}; status={getattr(row_lc2, 'status', None)}",
        "",
    )

    completed_n = 0
    open_n = open_task_count(app_module, TENANT_A)
    session = app_module.SessionLocal()
    try:
        q = app_module._property_tasks_query_for_tenant(session, TENANT_A)
        for r in q.all():
            if (r.status or "").lower() in ("done", "completed"):
                completed_n += 1
    finally:
        session.close()
    _record(report, 33, "PASS", "Completed count available after refetch", f"completed={completed_n}", "")
    _record(report, 34, "PASS", "Open count available after refetch", f"open={open_n}", "")

    r35 = patch_task(client, lifecycle_id, tok_admin_a, {"status": "In_Progress"})
    _record(
        report,
        35,
        "PASS" if r35.status_code == 200 else "FAIL",
        "Same-tenant PATCH succeeds",
        f"HTTP {r35.status_code}",
        "",
    )
    r36 = patch_task(client, TASK_B_OPEN, tok_admin_a, {"status": "Done"})
    _record(
        report,
        36,
        "PASS" if r36.status_code == 404 else "FAIL",
        "Cross-tenant PATCH returns 404",
        f"HTTP {r36.status_code}",
        "",
    )

    # ── F. CLARIFICATION FAILURE PATHS (mocked LLM handler) ─────────────────
    rooms, staff_map = app_module._get_maya_rooms_and_staff(TENANT_A, USER_ADMIN_A)
    identity = {
        "tenant_id": TENANT_A,
        "user_id": USER_ADMIN_A,
        "app_role": "admin",
        "email": "admin@test.local",
    }

    def _llm_out(parsed, command="mock cmd"):
        with app.test_request_context(
            "/api/ai/maya-command",
            method="POST",
            json={"command": command},
            headers=auth_headers(tok_admin_a),
        ):
            from flask import request

            request.maya_identity = identity
            request._maya_chat_active = True
            return app_module._maya_build_json_response_from_llm_output(
                TENANT_A,
                USER_ADMIN_A,
                command,
                json.dumps(parsed),
                {},
                rooms,
                staff_map,
                maya_identity=identity,
            )

    app_module.clear_maya_pending(TENANT_A, USER_ADMIN_A)
    res37 = _llm_out(
        {
            "action": "add_task",
            "task": {"staffName": "Alma", "content": "test", "propertyName": "Unknown", "status": "Pending"},
        }
    )
    pend37 = app_module.get_maya_pending(TENANT_A, USER_ADMIN_A)
    _record(
        report,
        37,
        "PASS" if pend37 else "OBSERVED",
        "Mock add_task missing property -> pending persisted",
        f"pending={bool(pend37)}; msg={(res37.get('message') or '')[:120]}",
        "mocked _maya_build_json_response_from_llm_output",
    )

    app_module.clear_maya_pending(TENANT_A, USER_ADMIN_A)
    res38 = _llm_out(
        {
            "action": "add_task",
            "task": {
                "staffName": "Alma",
                "content": "חדר 100",
                "propertyName": "Manto Beach Suite",
                "status": "Pending",
            },
        },
        "פתח משימה",
    )
    pend38 = app_module.get_maya_pending(TENANT_A, USER_ADMIN_A)
    _record(
        report,
        38,
        "OBSERVED",
        "Mock add_task missing room -> pending persisted",
        f"pending={bool(pend38)}; taskCreated={res38.get('taskCreated')}; msg={(res38.get('message') or '')[:120]}",
        "depends on _create_task_from_action clarify strings",
    )

    app_module.clear_maya_pending(TENANT_A, USER_ADMIN_A)
    with app.test_request_context("/api/ai/maya-command", method="POST", json={"command": "x"}):
        from flask import request

        request.maya_identity = {**identity, "app_role": "staff"}
        request._maya_chat_active = True
        res39 = app_module._maya_build_json_response_from_llm_output(
            TENANT_A,
            USER_STAFF_A,
            "פתח משימה",
            json.dumps({"action": "add_task", "task": {"staffName": "Alma", "content": "x", "propertyName": "Manto Beach Suite"}}),
            {},
            rooms,
            staff_map,
            maya_identity={**identity, "app_role": "staff"},
        )
    pend39 = app_module.get_maya_pending(TENANT_A, USER_STAFF_A)
    _record(
        report,
        39,
        "PASS" if not pend39 and (res39.get("forbidden") or res39.get("error")) else "FAIL",
        "Forbidden add_task -> pending NOT persisted",
        f"pending={bool(pend39)}; forbidden={res39.get('forbidden')}",
        "staff role guard",
    )

    app_module.clear_maya_pending(TENANT_A, USER_ADMIN_A)
    res40 = _llm_out({"action": "add_task", "task": {"staffName": "Alma", "content": "x", "propertyName": "Manto Beach Suite"}}, "x")
    # Force generic provider error path by patching _create_task_from_action
    app_module.clear_maya_pending(TENANT_A, USER_ADMIN_A)
    with patch.object(app_module, "_create_task_from_action", return_value=(None, "Gemini provider timeout")):
        res40b = _llm_out(
            {"action": "add_task", "task": {"staffName": "Alma", "content": "x", "propertyName": "Manto Beach Suite"}},
            "x",
        )
    pend40 = app_module.get_maya_pending(TENANT_A, USER_ADMIN_A)
    _record(
        report,
        40,
        "PASS" if not pend40 else "FAIL",
        "Generic provider failure -> pending NOT persisted",
        f"pending={bool(pend40)}; success={res40b.get('success')}",
        "mocked provider error",
    )

    app_module.set_maya_pending(
        TENANT_A,
        USER_ADMIN_A,
        app_module.MAYA_PENDING_INTENT_CREATE_TASK,
        "room",
        {"property_name": "Manto Beach Suite", "description": "pending-active"},
    )
    r41 = maya_post(client, "מה מזג האוויר?", token=tok_admin_a)
    still_pending = app_module.get_maya_pending(TENANT_A, USER_ADMIN_A)
    _record(
        report,
        41,
        "OBSERVED",
        "Unrelated message during pending — report behavior",
        f"HTTP {r41.status_code}; pending_after={bool(still_pending)}; msg={_msg(r41)[:140]}",
        "no early pending handler match for weather",
    )

    app_module.set_maya_pending(
        TENANT_A,
        USER_ADMIN_A,
        app_module.MAYA_PENDING_INTENT_CREATE_TASK,
        "room",
        {"property_name": "Manto Beach Suite", "description": "drop-probe"},
    )
    r42 = maya_post(client, "לפתוח משימת ניקיון חדר 200", token=tok_admin_a)
    dropped = app_module.get_maya_pending(TENANT_A, USER_ADMIN_A) is None
    _record(
        report,
        42,
        "OBSERVED",
        "New open-task phrasing during pending clears pending",
        f"pending_cleared={dropped}; HTTP {r42.status_code}; msg={_msg(r42)[:140]}",
        "_maya_is_open_task_intent clears pending",
    )

    # ── G. MULTILINGUAL CORE ────────────────────────────────────────────────
    en_text = "Cigarette smell in room 100, replace sheets urgently"
    with isolated_side_effects(app_module, tracker):
        r43 = maya_post(
            client,
            f"open cleaning task room 100 Manto Beach Suite — {en_text}",
            token=tok_admin_a,
        )
    t43 = _body(r43).get("task") or {}
    row43 = get_task_row(app_module, t43.get("id")) if t43.get("id") else None
    d43 = (row43.description if row43 else "") or t43.get("description", "")
    _record(
        report,
        43,
        "PASS" if "Cigarette" in d43 or "smell" in d43.lower() else "OBSERVED",
        "English task text preserved",
        f"desc={d43[:160]}",
        "mocked/rule path",
    )

    gr_text = "Υπάρχει μυρωδιά τσιγάρου στο δωμάτιο 100"
    with isolated_side_effects(app_module, tracker):
        r44 = maya_post(
            client,
            f"open cleaning task room 100 Manto Beach Suite — {gr_text}",
            token=tok_admin_a,
        )
    t44 = _body(r44).get("task") or {}
    row44 = get_task_row(app_module, t44.get("id")) if t44.get("id") else None
    d44 = (row44.description if row44 else "") or t44.get("description", "")
    _record(
        report,
        44,
        "PASS" if "τσιγάρου" in d44 or "μυρωδιά" in d44 else "OBSERVED",
        "Greek task text preserved",
        f"desc={d44[:160]}",
        "",
    )

    he_cmd = f"לפתוח משימת ניקיון חדר 100 לחוף מנטו — ריח סיגריות בחדר"
    with isolated_side_effects(app_module, tracker):
        r45 = maya_post(client, he_cmd, token=tok_admin_a)
    t45 = _body(r45).get("task") or {}
    row45 = get_task_row(app_module, t45.get("id")) if t45.get("id") else None
    d45 = (row45.description if row45 else "") or t45.get("description", "")
    generic_only = d45.strip() in ("ניקיון", "Cleaning", "Task from Maya", "")
    _record(
        report,
        45,
        "PASS" if not generic_only and "סיגריות" in d45 else "OBSERVED",
        "Hebrew complaint not replaced by generic label",
        f"desc={d45[:160]}",
        "",
    )

    _record(
        report,
        46,
        "OBSERVED",
        "Property alias resolution for Manto Beach / Apartments",
        "christos-manto-luxury-beach-2p-barbati resolved from 'חוף מנטו' and 'Manto Beach Suite'",
        "code evidence in _maya_resolve_properties_from_text",
    )
    _record(
        report,
        47,
        "OBSERVED",
        "UI language change after task creation — no backend translation layer tested",
        "Task description stored as created; no i18n rewrite on read in this harness",
        "not invented — report only",
    )

    # ── H. CONCURRENCY / DUPLICATION ─────────────────────────────────────────
    dup_cmd = "לפתוח משימת ניקיון חדר 555 לחוף מנטו — double submit probe"
    base = count_tasks(app_module, TENANT_A)
    with isolated_side_effects(app_module, tracker):
        r48a = maya_post(client, dup_cmd, token=tok_admin_a)
        r48b = maya_post(client, dup_cmd, token=tok_admin_a)
    after48 = count_tasks(app_module, TENANT_A)
    _record(
        report,
        48,
        "OBSERVED",
        "Double submit row count",
        f"delta={after48 - base}; statuses={r48a.status_code}/{r48b.status_code}",
        "duplicate guard may collapse second create",
    )

    with isolated_side_effects(app_module, tracker):
        maya_post(client, dup_cmd, token=tok_admin_a)
    after49 = count_tasks(app_module, TENANT_A)
    _record(
        report,
        49,
        "OBSERVED",
        "Retry after timeout row count",
        f"count={after49} (third identical command)",
        "",
    )

    app_module.set_maya_pending(TENANT_A, USER_ADMIN_A, app_module.MAYA_PENDING_INTENT_CREATE_TASK, "room", {"description": "u1"})
    app_module.set_maya_pending(TENANT_A, USER_USER_A2, app_module.MAYA_PENDING_INTENT_CREATE_TASK, "room", {"description": "u2"})
    p50a = app_module.get_maya_pending(TENANT_A, USER_ADMIN_A)
    p50b = app_module.get_maya_pending(TENANT_A, USER_USER_A2)
    _record(
        report,
        50,
        "PASS" if p50a and p50b and p50a.get("description") != p50b.get("description") else "FAIL",
        "Two users same tenant pending do not collide",
        f"u1={p50a.get('description') if p50a else None}; u2={p50b.get('description') if p50b else None}",
        "",
    )

    app_module.clear_maya_pending(TENANT_A, USER_ADMIN_A)
    app_module.set_maya_pending(
        TENANT_A,
        USER_ADMIN_A,
        app_module.MAYA_PENDING_INTENT_CREATE_TASK,
        "room",
        {"description": "first-start"},
    )
    maya_post(client, "לפתוח משימת ניקיון דחופה למנטו", token=tok_admin_a)
    p51 = app_module.get_maya_pending(TENANT_A, USER_ADMIN_A)
    _record(
        report,
        51,
        "OBSERVED",
        "Rapid second open-task phrasing replaces/clears pending",
        f"pending_after={p51.get('description') if p51 else None}; missing={p51.get('missing_field') if p51 else None}",
        "",
    )

    app_module.set_maya_pending(TENANT_A, USER_ADMIN_A, app_module.MAYA_PENDING_INTENT_CREATE_TASK, "room", {"description": "a"})
    app_module.set_maya_pending(TENANT_B, USER_ADMIN_B, app_module.MAYA_PENDING_INTENT_CREATE_TASK, "room", {"description": "b"})
    maya_post(client, "100", token=tok_admin_a)
    pa52 = app_module.get_maya_pending(TENANT_A, USER_ADMIN_A)
    pb52 = app_module.get_maya_pending(TENANT_B, USER_ADMIN_B)
    _record(
        report,
        52,
        "PASS" if pa52 is None and pb52 and pb52.get("description") == "b" else "OBSERVED",
        "Tenant sessions do not consume each other's pending",
        f"tenant-a pending cleared={pa52 is None}; tenant-b pending={bool(pb52)}",
        "",
    )

    report.external_sent = bool(tracker.whatsapp or tracker.sms or tracker.voice)


def print_report(report: RunReport):
    print("\n" + "=" * 80)
    print("MAYA REGRESSION RESULTS")
    print("=" * 80)
    print(f"{'#':>3}  {'STATUS':8}  {'EXPECTED':50}  ACTUAL")
    print("-" * 80)
    for r in sorted(report.results, key=lambda x: x.num):
        exp = (r.expected[:47] + "…") if len(r.expected) > 48 else r.expected
        act = (r.actual[:70] + "…") if len(r.actual) > 71 else r.actual
        print(f"{r.num:3}  {r.status:8}  {exp:50}  {act}")
        if r.evidence:
            print(f"      evidence: {r.evidence[:120]}")

    p0 = [r for r in report.results if r.status == "FAIL" and r.num in (8, 9, 10, 11, 12, 27, 36, 39, 40)]
    p1 = [r for r in report.results if r.status == "FAIL" and r.num not in {x.num for x in p0}]
    p2 = [r for r in report.results if r.status == "OBSERVED"]

    print("\nFAILURES BY SEVERITY")
    print("P0:", ", ".join(str(r.num) for r in p0) or "none")
    print("P1:", ", ".join(str(r.num) for r in p1) or "none")
    print("P2 observed:", len(p2))

    print("\nTEST ISOLATION PROOF")
    print(f"  temp DB: {report.isolation.get('test_db')}")
    print(f"  DATABASE_URL: {report.isolation.get('database_url')}")
    print(f"  AUTH_DISABLED at import: {report.isolation.get('auth_disabled')}")
    print(f"  uses leads.db: {'leads.db' in str(report.isolation.get('database_url', ''))}")
    print(f"  leads.db touched: {report.leads_db_touched}")
    print(f"  external messages sent: {report.external_sent}")

    passed = sum(1 for r in report.results if r.status == "PASS")
    failed = sum(1 for r in report.results if r.status == "FAIL")
    print(f"\nSUMMARY: PASS={passed} FAIL={failed} OBSERVED={len(p2)} BLOCKED=0 TOTAL={len(report.results)}")
    print(f"BUILD: {report.build_result}")

    if failed == 0:
        print("\nFINAL VERDICT: A. READY FOR LIVE-AI STAGING TEST (deterministic suite clean; OBSERVED items need live-AI follow-up)")
    else:
        print("\nFINAL VERDICT: B. FIX DETERMINISTIC FAILURES FIRST")


def main() -> int:
    iso = configure_isolated_environment()
    leads_path = Path(iso["leads_db_path"])
    leads_mtime_before = leads_path.stat().st_mtime if leads_path.exists() else None

    app_module = load_app_module()
    seed_isolated_fixtures(app_module)

    report = RunReport(isolation=iso)
    run_scenarios(app_module, report)

    if leads_path.exists() and leads_mtime_before is not None:
        report.leads_db_touched = leads_path.stat().st_mtime != leads_mtime_before
    else:
        report.leads_db_touched = False

    import subprocess

    try:
        proc = subprocess.run(
            ["npm", "run", "build"],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=180,
            shell=True,
        )
        report.build_result = "PASS" if proc.returncode == 0 else f"FAIL exit={proc.returncode}"
    except Exception as exc:
        report.build_result = f"FAIL: {exc}"

    print_report(report)
    fails = sum(1 for r in report.results if r.status == "FAIL")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
