# EasyHost – Developer Handoff (MVP)

## Purpose
This document is the single source of truth for external developers.
The goal is to build EasyHost MVP based on existing product documents.

---

## Product Summary
EasyHost is a lightweight dashboard for Airbnb hosts that:
- Shows daily check-ins and check-outs
- Displays upcoming reservations
- Sends automated and manual guest messages
- Connects to Airbnb (read-only in MVP)

No payments. No analytics. No billing.

---

## Scope – Version 1 (MVP)
IN SCOPE:
- Login (email + password)
- Airbnb connection status (mock or real)
- Dashboard with:
  - Today check-ins
  - Today check-outs
  - Next 7 days reservations
- Manual guest message (basic UI)
- Simple responsive web app

OUT OF SCOPE:
- Payments
- Analytics
- Multi-language
- Mobile app (web only)

---

## Source Documents
Developer must read:
- /02_Product/PRD.md
- /03_UX_UI/Screens_Map.md
- /03_UX_UI/User_Flows.md
- /04_Tech/API_Spec.md
- /04_Tech/Data_Model.md

---

## Technical Notes
- MVP first, clean architecture
- Prefer simple stack (React / Next / Firebase or similar)
- Authentication can be basic
- Airbnb integration can be mocked if needed

---

## Success Criteria
- Host can log in
- Host sees real or mock reservation data
- Host can send a manual message
- UI matches Screens Map
