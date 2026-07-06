"""Seed isolated tenants, properties, staff, and tasks for Maya regression."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

TENANT_A = "tenant-a"
TENANT_B = "tenant-b"

USER_ADMIN_A = "user-admin-a"
USER_MANAGER_A = "user-manager-a"
USER_STAFF_A = "user-staff-a"
USER_USER_A2 = "user-a2-tenant-a"
USER_ADMIN_B = "user-admin-b"

PROP_MANTO_APTS = "christos-manto-beach-apartment-barbati"
PROP_MANTO_BEACH = "christos-manto-luxury-beach-2p-barbati"
PROP_CORFU = "christos-thaleri-villa-corfu"

TASK_A_OPEN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
TASK_B_OPEN = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
TASK_A_DONE = "cccccccc-cccc-cccc-cccc-cccccccccccc"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def seed_isolated_fixtures(app_module) -> dict:
    """Insert minimal Christos-like portfolio for both tenants."""
    SessionLocal = app_module.SessionLocal
    TenantModel = app_module.TenantModel
    ManualRoomModel = app_module.ManualRoomModel
    PropertyStaffModel = app_module.PropertyStaffModel
    PropertyTaskModel = app_module.PropertyTaskModel

    if not SessionLocal:
        raise RuntimeError("SessionLocal unavailable — DB not initialized")

    session = SessionLocal()
    created = {"tenants": [], "properties": [], "tasks": []}
    try:
        for tid, name in ((TENANT_A, "Tenant A Test"), (TENANT_B, "Tenant B Test")):
            if not session.query(TenantModel).filter_by(id=tid).first():
                session.add(TenantModel(id=tid, name=name, created_at=_now()))
                created["tenants"].append(tid)

        props = [
            (TENANT_A, PROP_MANTO_APTS, "Manto Apartments"),
            (TENANT_A, PROP_MANTO_BEACH, "Manto Beach Suite"),
            (TENANT_A, PROP_CORFU, "Corfu Luxury Villa"),
            (TENANT_B, PROP_MANTO_APTS, "Manto Apartments B"),
            (TENANT_B, PROP_MANTO_BEACH, "Manto Beach Suite B"),
        ]
        for tenant_id, pid, pname in props:
            if session.query(ManualRoomModel).filter_by(id=pid).first():
                continue
            session.add(
                ManualRoomModel(
                    id=pid,
                    tenant_id=tenant_id,
                    owner_id=f"owner-{tenant_id}",
                    name=pname,
                    description="Regression fixture",
                    status="active",
                    created_at=_now(),
                    max_guests=4,
                    bedrooms=2,
                    beds=2,
                    bathrooms=1,
                    occupancy_rate=75.0,
                )
            )
            created["properties"].append(pid)
            staff_id = f"staff-alma-{pid}"
            if not session.query(PropertyStaffModel).filter_by(id=staff_id).first():
                session.add(
                    PropertyStaffModel(
                        id=staff_id,
                        property_id=pid,
                        name="Alma",
                        role="housekeeping",
                        department="cleaning",
                        phone_number="0500000001",
                    )
                )
            staff_id2 = f"staff-kobi-{pid}"
            if not session.query(PropertyStaffModel).filter_by(id=staff_id2).first():
                session.add(
                    PropertyStaffModel(
                        id=staff_id2,
                        property_id=pid,
                        name="Kobi",
                        role="maintenance",
                        department="maintenance",
                        phone_number="0500000002",
                    )
                )

        tasks = [
            (
                TASK_A_OPEN,
                TENANT_A,
                PROP_MANTO_BEACH,
                "Manto Beach Suite",
                "Open task tenant-a",
                "Pending",
            ),
            (
                TASK_B_OPEN,
                TENANT_B,
                PROP_MANTO_BEACH,
                "Manto Beach Suite B",
                "Open task tenant-b",
                "Pending",
            ),
            (
                TASK_A_DONE,
                TENANT_A,
                PROP_MANTO_APTS,
                "Manto Apartments",
                "Completed task tenant-a",
                "completed",
            ),
        ]
        for tid, tenant_id, prop_id, prop_name, desc, status in tasks:
            if session.query(PropertyTaskModel).filter_by(id=tid).first():
                continue
            session.add(
                PropertyTaskModel(
                    id=tid,
                    tenant_id=tenant_id,
                    property_id=prop_id,
                    property_name=prop_name,
                    description=desc,
                    status=status,
                    created_at=_now(),
                    staff_name="Alma",
                    staff_phone="0500000001",
                    task_type="Cleaning",
                    priority="normal",
                    source="manual",
                )
            )
            created["tasks"].append(tid)

        session.commit()
        return created
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
