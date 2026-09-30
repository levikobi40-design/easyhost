"""
Cold-outreach auto-mailer for EasyHost AI.

Sends one personalised email per row of leads.csv through Gmail SMTP, waiting between sends.

Environment (a .env file next to this script or in the project root also works):
    GMAIL_ADDRESS       sender Gmail address
    GMAIL_APP_PASSWORD  16-character Google App Password (not the account password)
    SENDER_NAME         optional display name, default "EasyHost AI"
    GROWTH_DATABASE_URL / GROWTH_TENANT_ID   app database + tenant for lead statuses (see leads_db.py)

Usage:
    python send_emails.py --dry-run   # print every email, send nothing, write nothing
    python send_emails.py             # send for real

Leads are imported into the app database (status Pending) and marked Sent there after each email.
Leads whose database status is Sent, Replied, Booked or Opt-Out, or that are listed in sent_log.csv,
are skipped, so a rerun after a failure never double-sends.
"""

import argparse
import csv
import os
import smtplib
import ssl
import sys
import time
from datetime import datetime
from email.message import EmailMessage
from email.utils import formataddr, make_msgid
from pathlib import Path

from leads_db import DO_NOT_SEND, LeadStoreError, open_store

HERE = Path(__file__).resolve().parent
LEADS_FILE = HERE / "leads.csv"
SENT_LOG_FILE = HERE / "sent_log.csv"
SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 465
DELAY_SECONDS = 5

SUBJECT_TEMPLATE = "Operational AI & Interactive Voice Avatar for {company}"

BODY_TEMPLATE = """Hi {company} Team,

I came across your luxury property portfolio in {location}.

Managing high-end villas and vacation rentals often means endless messaging threads, 24/7 guest inquiries (Wi-Fi, pool/HVAC controls, check-ins), and manual maintenance dispatching.

We built EasyHost AI with Maya – an interactive AI Voice & Text Avatar designed specifically for luxury property management:

- 24/7 AI Guest Concierge: Answers guest inquiries instantly in natural English or native languages via voice or WhatsApp.
- Instant Operational Dispatch: Logs maintenance, housekeeping, and pool issues directly into your operations dashboard.
- No PMS Overhaul Required: Works alongside your current setup.

We are currently offering a 14-day free pilot for select luxury property teams.

Are you open to a brief 3-minute video demo or a live preview link to test Maya?

Best regards,
Founder, EasyHost AI
"""


def load_env() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(HERE / ".env")
    load_dotenv(HERE.parent / ".env")


def read_leads() -> list[dict]:
    with LEADS_FILE.open(newline="", encoding="utf-8") as f:
        leads = []
        for row in csv.DictReader(f):
            company = (row.get("company") or "").strip()
            email = (row.get("email") or "").strip()
            location = (row.get("location") or "").strip()
            if company and email:
                leads.append({"company": company, "email": email, "location": location})
        return leads


def already_sent() -> set[str]:
    if not SENT_LOG_FILE.exists():
        return set()
    with SENT_LOG_FILE.open(newline="", encoding="utf-8") as f:
        return {(row.get("email") or "").strip().lower() for row in csv.DictReader(f)}


def log_sent(lead: dict) -> None:
    is_new = not SENT_LOG_FILE.exists()
    with SENT_LOG_FILE.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["sent_at", "company", "email", "location"])
        if is_new:
            writer.writeheader()
        writer.writerow({"sent_at": datetime.now().isoformat(timespec="seconds"), **lead})


def build_message(lead: dict, sender: str, sender_name: str) -> EmailMessage:
    msg = EmailMessage()
    msg["From"] = formataddr((sender_name, sender))
    msg["To"] = lead["email"]
    msg["Subject"] = SUBJECT_TEMPLATE.format(**lead)
    msg["Message-ID"] = make_msgid(domain=sender.split("@")[-1])
    msg.set_content(BODY_TEMPLATE.format(**lead))
    return msg


def main() -> int:
    parser = argparse.ArgumentParser(description="Send cold-outreach emails to leads.csv via Gmail SMTP.")
    parser.add_argument("--dry-run", action="store_true", help="print emails instead of sending them")
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    load_env()
    sender = os.getenv("GMAIL_ADDRESS", "").strip()
    app_password = os.getenv("GMAIL_APP_PASSWORD", "").replace(" ", "").strip()
    sender_name = os.getenv("SENDER_NAME", "EasyHost AI").strip() or "EasyHost AI"

    if not args.dry_run and (not sender or not app_password):
        print("Missing GMAIL_ADDRESS or GMAIL_APP_PASSWORD in the environment.", file=sys.stderr)
        return 1

    try:
        store = open_store(args.dry_run)
    except LeadStoreError as e:
        print(f"Database unavailable, nothing sent: {e}", file=sys.stderr)
        return 1

    leads = read_leads()
    logged = already_sent()
    db_status: dict[str, str] = {}
    if store:
        print(f"Database: {store.describe()}")
        store.import_leads(leads)
        db_status = {addr: row["status"] for addr, row in store.fetch().items()}
        for lead in leads:
            if lead["email"].lower() in logged and db_status.get(lead["email"].lower()) == "Pending":
                store.set_status(lead["email"], "Sent", "sent earlier (sent_log.csv)")
                db_status[lead["email"].lower()] = "Sent"

    def skipped(lead: dict) -> bool:
        addr = lead["email"].lower()
        return addr in logged or db_status.get(addr, "Pending") in DO_NOT_SEND

    pending = [lead for lead in leads if not skipped(lead)]
    print(f"{len(pending)} lead(s) to email, {len(leads) - len(pending)} skipped (already sent, replied, booked or opted out).")
    if not pending:
        return 0

    if args.dry_run:
        for lead in pending:
            msg = build_message(lead, sender or "you@gmail.com", sender_name)
            print(f"\n--- To: {msg['To']}\nSubject: {msg['Subject']}\n\n{msg.get_content()}")
        print(f"\n[DRY RUN] {len(pending)} email(s) prepared, none sent, database unchanged.")
        return 0

    sent, failed = 0, 0
    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ssl.create_default_context()) as smtp:
        smtp.login(sender, app_password)
        for i, lead in enumerate(pending):
            try:
                smtp.send_message(build_message(lead, sender, sender_name))
            except smtplib.SMTPServerDisconnected:
                print("[STOP] Gmail closed the connection (possibly a sending limit). Rerun later to continue.")
                failed += len(pending) - i
                break
            except smtplib.SMTPException as e:
                failed += 1
                print(f"[FAIL] {lead['company']} <{lead['email']}>: {e}")
            else:
                sent += 1
                log_sent(lead)
                print(f"[SENT] {datetime.now():%H:%M:%S} {lead['company']} <{lead['email']}>")
                try:
                    store.set_status(lead["email"], "Sent", "sent by send_emails.py")
                except Exception as e:
                    print(f"[WARN] sent, but the database status was not updated ({e}); sent_log.csv still prevents a resend.")
            if i < len(pending) - 1:
                time.sleep(DELAY_SECONDS)

    print(f"\nDone: {sent} sent, {failed} failed. Log: {SENT_LOG_FILE.name}")
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
