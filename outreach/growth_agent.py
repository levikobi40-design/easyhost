"""
EasyHost AI growth agent — slow, tracked cold outreach with an inbox auto-responder.

Lead records and statuses live in the app database (leads table, source "cold_email"), so they
appear in the dashboard's lead management screen; a status changed there is respected here.
leads_tracker.json only keeps agent state: variant, send time, Message-ID, reply summaries.

What it does on every cycle:
  1. Imports new leads.csv rows into the database as Pending and reads every status back.
  2. Scans the Gmail inbox (IMAP) for replies from leads, classifies them with Gemini and
     auto-replies with a calendar link when the lead is interested.
  3. Sends at most one new email, only if: fewer than DAILY_LIMIT sent today, inside the send
     window, and the random 30–60 minute gap since the previous send has passed.
  4. Rewrites ab_report.json with reply / interest / booking rates per email variant and month.

Environment (.env next to this script or in the project root):
    GMAIL_ADDRESS, GMAIL_APP_PASSWORD   Gmail account + App Password (IMAP must be enabled in Gmail)
    GEMINI_API_KEY                      reply classification (keyword fallback if missing)
    CALENDAR_LINK                       booking link sent to interested leads (no auto-reply without it)
    SENDER_NAME                         optional, default "EasyHost AI"
    BUSINESS_ADDRESS                    optional postal address added to the footer (required by CAN-SPAM for US leads)
    SEND_WINDOW                         optional local hours "HH-HH", default "09-18"
    GEMINI_MODEL                        optional, default "gemini-2.5-flash"
    GROWTH_DATABASE_URL, GROWTH_TENANT_ID   app database + tenant (see leads_db.py)

Commands:
    python growth_agent.py run            # long-running agent loop
    python growth_agent.py once           # a single cycle (for Windows Task Scheduler / cron)
    python growth_agent.py status         # lead counts per status + today's quota
    python growth_agent.py report         # A/B results (add --month YYYY-MM for one month)
    python growth_agent.py mark EMAIL Booked   # manual status change (Pending/Sent/Replied/Booked/Opt-Out)
Add --dry-run to run/once to print actions without sending, replying, saving or writing to the database.
"""

from __future__ import annotations

import argparse
import csv
import email
import imaplib
import json
import os
import random
import re
import smtplib
import ssl
import sys
import time
import warnings
from datetime import datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr, make_msgid, parseaddr
from pathlib import Path

from sqlalchemy.exc import SQLAlchemyError

from leads_db import DO_NOT_SEND, STATUSES, LeadStore, LeadStoreError, open_store

HERE = Path(__file__).resolve().parent
LEADS_FILE = HERE / "leads.csv"
TRACKER_FILE = HERE / "leads_tracker.json"
REPORT_FILE = HERE / "ab_report.json"
LEGACY_SENT_LOG = HERE / "sent_log.csv"

SMTP_HOST, SMTP_PORT = "smtp.gmail.com", 465
IMAP_HOST = "imap.gmail.com"

DAILY_LIMIT = 5
MIN_GAP_MIN, MAX_GAP_MIN = 30, 60
INBOX_INTERVAL_SEC = 15 * 60
LOOP_TICK_SEC = 60

FOOTER = (
    "\n\nP.S. If this isn't relevant, just reply \"unsubscribe\" and I won't email you again."
)

VARIANTS = {
    "A": {
        "subject": "Operational AI & Interactive Voice Avatar for {company}",
        "body": """Hi {company} Team,

I came across your luxury property portfolio in {location}.

Managing high-end villas and vacation rentals often means endless messaging threads, 24/7 guest inquiries (Wi-Fi, pool/HVAC controls, check-ins), and manual maintenance dispatching.

We built EasyHost AI with Maya – an interactive AI Voice & Text Avatar designed specifically for luxury property management:

- 24/7 AI Guest Concierge: Answers guest inquiries instantly in natural English or native languages via voice or WhatsApp.
- Instant Operational Dispatch: Logs maintenance, housekeeping, and pool issues directly into your operations dashboard.
- No PMS Overhaul Required: Works alongside your current setup.

We are currently offering a 14-day free pilot for select luxury property teams.

Are you open to a brief 3-minute video demo or a live preview link to test Maya?

Best regards,
Founder, EasyHost AI""",
    },
    "B": {
        "subject": "Quick question about guest messages at {company}",
        "body": """Hi {company} Team,

How many guest messages about Wi-Fi codes, pool heating and check-in does your team answer each week in {location}?

Maya, our AI voice & text concierge, answers those instantly (voice or WhatsApp, in the guest's language) and logs any maintenance issue straight into your operations dashboard. It runs alongside your current PMS, nothing to replace.

We're opening a free 14-day pilot for a few luxury villa teams. Worth a 3-minute demo?

Best regards,
Founder, EasyHost AI""",
    },
}

AUTO_REPLY_BODY = """Hi {company} Team,

Thank you for getting back to me — great to hear you're interested!

You can pick a time that suits you for a short call or live demo of Maya here:
{calendar_link}

If none of the slots work, just reply with a time that's convenient and I'll make it happen.

Best regards,
Founder, EasyHost AI"""

CLASSIFY_PROMPT = """You classify replies to a B2B cold email offering an AI concierge for luxury villa managers.
Return ONLY a JSON object: {{"intent": "<interested|question|not_interested|opt_out|out_of_office|other>", "summary": "<max 15 words>"}}
- interested: wants a demo, call, pilot, link or more info.
- question: asks something (price, features) without clearly asking for a call.
- not_interested: declines.
- opt_out: asks to stop emailing / unsubscribe / remove.
- out_of_office: automatic away or vacation message.
- other: anything else (bounce, unrelated).

Reply from {company}:
\"\"\"{text}\"\"\""""

INTENT_TO_STATUS = {
    "interested": "Replied",
    "question": "Replied",
    "other": "Replied",
    "not_interested": "Opt-Out",
    "opt_out": "Opt-Out",
}

DRY_RUN = False
STORE: LeadStore | None = None


def log(msg: str) -> None:
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def load_env() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(HERE / ".env")
    load_dotenv(HERE.parent / ".env")


def cfg(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def gmail_credentials() -> tuple[str, str]:
    return cfg("GMAIL_ADDRESS"), cfg("GMAIL_APP_PASSWORD").replace(" ", "")


# ---------------------------------------------------------------- tracker (JSON database)

def load_tracker() -> dict:
    if TRACKER_FILE.exists():
        with TRACKER_FILE.open(encoding="utf-8") as f:
            data = json.load(f)
    else:
        data = {}
    data.setdefault("leads", {})
    data.setdefault("processed_message_ids", [])
    data.setdefault("next_send_at", None)
    return data


def save_tracker(tracker: dict) -> None:
    if DRY_RUN:
        return
    tmp = TRACKER_FILE.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(tracker, f, ensure_ascii=False, indent=2)
    os.replace(tmp, TRACKER_FILE)


def set_status(lead: dict, status: str, note: str = "", *, db: bool = True, summary: str | None = None) -> None:
    """Change a lead's status locally and, unless db=False, in the app database."""
    if status not in STATUSES:
        raise ValueError(f"Unknown status {status!r}; use one of {', '.join(STATUSES)}")
    if db and STORE:
        STORE.set_status(lead["email"], status, note, summary=summary)
    lead["status"] = status
    lead["updated_at"] = now_iso()
    lead.setdefault("history", []).append({"at": lead["updated_at"], "status": status, "note": note})


def sync_leads(tracker: dict) -> None:
    """
    Import new leads.csv rows into the database (Pending), then take every status from the database,
    and mark leads already emailed by send_emails.py as Sent.
    """
    leads = tracker["leads"]
    csv_rows = []
    with LEADS_FILE.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            addr = (row.get("email") or "").strip()
            company = (row.get("company") or "").strip()
            if not addr or not company:
                continue
            csv_rows.append({"company": company, "email": addr, "location": (row.get("location") or "").strip()})
            if addr.lower() not in leads:
                lead = dict(csv_rows[-1])
                set_status(lead, "Pending", "imported from leads.csv", db=False)
                leads[addr.lower()] = lead

    if STORE:
        STORE.import_leads(csv_rows)
        for addr, row in STORE.fetch().items():
            lead = leads.get(addr)
            if lead is None:
                lead = {"company": row.get("name") or addr, "email": row["email"], "location": row.get("city") or ""}
                set_status(lead, row.get("status") or "Pending", "found in database", db=False)
                leads[addr] = lead
            elif lead.pop("db_sync_pending", False) or (lead.get("sent_at") and row.get("status") == "Pending"):
                set_status(lead, lead["status"], "re-synced from growth agent")
            elif row.get("status") in STATUSES and row["status"] != lead["status"]:
                set_status(lead, row["status"], "changed in database", db=False)

    if LEGACY_SENT_LOG.exists():
        with LEGACY_SENT_LOG.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                lead = leads.get((row.get("email") or "").strip().lower())
                if lead and not lead.get("sent_at"):
                    lead.update(variant="A", sent_at=row.get("sent_at") or now_iso())
                    if lead["status"] == "Pending":
                        set_status(lead, "Sent", "sent earlier by send_emails.py")


def sent_today(tracker: dict) -> int:
    today = datetime.now().date().isoformat()
    return sum(1 for lead in tracker["leads"].values() if (lead.get("sent_at") or "").startswith(today))


# ---------------------------------------------------------------- sending

def smtp_send(msg: EmailMessage) -> None:
    if DRY_RUN:
        log(f"[DRY RUN] would send to {msg['To']}: {msg['Subject']}")
        return
    sender, password = gmail_credentials()
    with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, context=ssl.create_default_context()) as smtp:
        smtp.login(sender, password)
        smtp.send_message(msg)


def new_message(to: str, subject: str, body: str) -> EmailMessage:
    sender, _ = gmail_credentials()
    msg = EmailMessage()
    msg["From"] = formataddr((cfg("SENDER_NAME", "EasyHost AI"), sender or "you@gmail.com"))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(domain=(sender or "gmail.com").split("@")[-1])
    msg.set_content(body)
    return msg


def pick_variant(tracker: dict) -> str:
    """Keep the variants balanced: choose the one sent the fewest times (ties broken randomly)."""
    counts = {v: 0 for v in VARIANTS}
    for lead in tracker["leads"].values():
        if lead.get("variant") in counts and lead.get("sent_at"):
            counts[lead["variant"]] += 1
    fewest = min(counts.values())
    return random.choice([v for v, c in counts.items() if c == fewest])


def in_send_window() -> bool:
    m = re.fullmatch(r"(\d{1,2})-(\d{1,2})", cfg("SEND_WINDOW", "09-18"))
    start, end = (int(m.group(1)), int(m.group(2))) if m else (9, 18)
    return start <= datetime.now().hour < end


def maybe_send_one(tracker: dict) -> bool:
    if sent_today(tracker) >= DAILY_LIMIT:
        return False
    if not in_send_window():
        return False
    next_at = tracker.get("next_send_at")
    if next_at and datetime.now() < datetime.fromisoformat(next_at):
        return False
    lead = next(
        (l for l in tracker["leads"].values() if l["status"] not in DO_NOT_SEND and not l.get("sent_at")),
        None,
    )
    if lead is None:
        return False

    variant = pick_variant(tracker)
    tpl = VARIANTS[variant]
    fields = {"company": lead["company"], "location": lead["location"] or "your region"}
    body = tpl["body"].format(**fields) + FOOTER
    if cfg("BUSINESS_ADDRESS"):
        body += "\n" + cfg("BUSINESS_ADDRESS")
    msg = new_message(lead["email"], tpl["subject"].format(**fields), body)

    try:
        smtp_send(msg)
    except (smtplib.SMTPException, OSError) as e:
        log(f"[FAIL] {lead['company']} <{lead['email']}>: {e}")
        tracker["next_send_at"] = (datetime.now() + timedelta(minutes=MIN_GAP_MIN)).isoformat(timespec="seconds")
        return False

    lead.update(variant=variant, sent_at=now_iso(), message_id=msg["Message-ID"], subject=msg["Subject"])
    try:
        set_status(lead, "Sent", f"variant {variant}")
    except (LeadStoreError, SQLAlchemyError) as e:
        set_status(lead, "Sent", f"variant {variant}", db=False)
        lead["db_sync_pending"] = True
        log(f"[WARN] sent, but the database status was not updated: {e}")
    gap = random.randint(MIN_GAP_MIN, MAX_GAP_MIN)
    tracker["next_send_at"] = (datetime.now() + timedelta(minutes=gap)).isoformat(timespec="seconds")
    log(f"[SENT] {lead['company']} <{lead['email']}> variant {variant} "
        f"({sent_today(tracker)}/{DAILY_LIMIT} today, next in {gap} min)")
    return True


# ---------------------------------------------------------------- inbox + Gemini

def message_text(msg: email.message.Message) -> str:
    part = None
    if msg.is_multipart():
        for p in msg.walk():
            if p.get_content_type() == "text/plain" and "attachment" not in str(p.get("Content-Disposition")):
                part = p
                break
    else:
        part = msg
    if part is None:
        return ""
    payload = part.get_payload(decode=True) or b""
    text = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
    if part.get_content_type() == "text/html":
        text = re.sub(r"<[^>]+>", " ", text)
    # Drop the quoted original ("On ... wrote:" and "> " lines) so only the lead's words are classified.
    text = re.split(r"\n\s*On .{0,200}wrote:\s*\n", text, maxsplit=1)[0]
    lines = [ln for ln in text.splitlines() if not ln.lstrip().startswith(">")]
    return re.sub(r"\s+", " ", " ".join(lines)).strip()[:3000]


def keyword_intent(text: str) -> str:
    t = text.lower()
    if re.search(r"unsubscribe|remove me|stop (emailing|sending)|do not contact", t):
        return "opt_out"
    if re.search(r"out of (the )?office|on vacation|auto.?reply|away until", t):
        return "out_of_office"
    if re.search(r"not interested|no thanks|no, thank|not for us", t):
        return "not_interested"
    if re.search(r"interested|demo|call|schedule|let'?s talk|send (me )?(the )?link|sounds good", t):
        return "interested"
    return "question" if "?" in t else "other"


def classify_reply(company: str, text: str) -> tuple[str, str]:
    api_key = cfg("GEMINI_API_KEY")
    if api_key:
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                import google.generativeai as genai
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel(cfg("GEMINI_MODEL", "gemini-2.5-flash"))
            resp = model.generate_content(
                CLASSIFY_PROMPT.format(company=company, text=text),
                generation_config={"temperature": 0, "response_mime_type": "application/json"},
                request_options={"timeout": 30},
            )
            data = json.loads(re.search(r"\{.*\}", resp.text, re.S).group(0))
            intent = str(data.get("intent", "")).strip()
            if intent in {"interested", "question", "not_interested", "opt_out", "out_of_office", "other"}:
                return intent, str(data.get("summary", ""))[:200]
        except Exception as e:
            log(f"[WARN] Gemini classification failed, using keywords: {type(e).__name__}: {e}")
    return keyword_intent(text), "keyword classification"


def send_auto_reply(lead: dict, incoming: email.message.Message) -> bool:
    link = cfg("CALENDAR_LINK")
    if not link:
        log(f"[WARN] CALENDAR_LINK not set — reply manually to {lead['company']} <{lead['email']}>")
        return False
    to = parseaddr(incoming.get("Reply-To") or incoming.get("From", ""))[1] or lead["email"]
    subject = incoming.get("Subject") or lead.get("subject") or "Our conversation"
    if not subject.lower().startswith("re:"):
        subject = "Re: " + subject
    msg = new_message(to, subject, AUTO_REPLY_BODY.format(company=lead["company"], calendar_link=link))
    in_reply_to = incoming.get("Message-ID")
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = f"{incoming.get('References', '')} {in_reply_to}".strip()
    try:
        smtp_send(msg)
    except (smtplib.SMTPException, OSError) as e:
        log(f"[FAIL] auto-reply to {to}: {e}")
        return False
    return True


GENERIC_DOMAINS = {"gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com"}


def check_inbox(tracker: dict) -> None:
    """Find replies from Sent leads (same address, or same company domain) and act on them."""
    sender, password = gmail_credentials()
    awaiting = [l for l in tracker["leads"].values() if l["status"] == "Sent"]
    if not awaiting or not sender or not password:
        return
    processed = set(tracker["processed_message_ids"])

    imap = imaplib.IMAP4_SSL(IMAP_HOST)
    try:
        imap.login(sender, password)
        imap.select("INBOX", readonly=True)
        for lead in awaiting:
            domain = lead["email"].split("@")[-1].lower()
            needle = lead["email"] if domain in GENERIC_DOMAINS else domain
            sent_at = datetime.fromisoformat(lead["sent_at"]) if lead.get("sent_at") else datetime.now() - timedelta(days=30)
            since = sent_at.strftime("%d-%b-%Y")
            status, data = imap.search(None, "FROM", f'"{needle}"', "SINCE", since)
            if status != "OK":
                continue
            for num in data[0].split():
                _, fetched = imap.fetch(num, "(BODY.PEEK[])")
                raw = next((part[1] for part in fetched if isinstance(part, tuple)), None)
                if not raw:
                    continue
                incoming = email.message_from_bytes(raw)
                mid = incoming.get("Message-ID") or f"{lead['email']}#{num.decode()}"
                if mid in processed:
                    continue
                handle_reply(lead, incoming)
                processed.add(mid)
                tracker["processed_message_ids"].append(mid)
                if lead["status"] != "Sent":
                    break
    finally:
        try:
            imap.logout()
        except Exception:
            pass


def handle_reply(lead: dict, incoming: email.message.Message) -> None:
    text = message_text(incoming)
    intent, summary = classify_reply(lead["company"], text)
    log(f"[REPLY] {lead['company']}: {intent} — {summary}")
    if intent == "out_of_office":
        return
    lead.update(replied_at=now_iso(), reply_intent=intent, reply_summary=summary)
    set_status(lead, INTENT_TO_STATUS.get(intent, "Replied"), f"reply: {intent}", summary=f"Reply ({intent}): {summary}")
    if intent == "interested" and send_auto_reply(lead, incoming):
        lead["auto_replied_at"] = now_iso()
        log(f"[AUTO-REPLY] calendar link sent to {lead['company']}")


# ---------------------------------------------------------------- A/B report

def build_report(tracker: dict, month: str | None = None) -> dict:
    def empty() -> dict:
        return {v: {"sent": 0, "replied": 0, "interested": 0, "booked": 0, "opt_out": 0} for v in VARIANTS}

    by_month: dict[str, dict] = {}
    for lead in tracker["leads"].values():
        variant, sent_at = lead.get("variant"), lead.get("sent_at")
        if variant not in VARIANTS or not sent_at:
            continue
        stats = by_month.setdefault(sent_at[:7], empty())[variant]
        stats["sent"] += 1
        if lead.get("replied_at"):
            stats["replied"] += 1
        if lead.get("reply_intent") == "interested":
            stats["interested"] += 1
        if lead["status"] == "Booked":
            stats["booked"] += 1
        if lead["status"] == "Opt-Out":
            stats["opt_out"] += 1

    def with_rates(stats: dict) -> dict:
        for s in stats.values():
            n = s["sent"] or 1
            s["reply_rate_pct"] = round(100 * s["replied"] / n, 1)
            s["interest_rate_pct"] = round(100 * s["interested"] / n, 1)
            s["booking_rate_pct"] = round(100 * s["booked"] / n, 1)
        return stats

    months = {m: with_rates(s) for m, s in sorted(by_month.items()) if not month or m == month}
    total = empty()
    for stats in months.values():
        for v, s in stats.items():
            for k in ("sent", "replied", "interested", "booked", "opt_out"):
                total[v][k] += s[k]
    return {
        "generated_at": now_iso(),
        "variants": {v: VARIANTS[v]["subject"] for v in VARIANTS},
        "total": with_rates(total),
        "by_month": months,
    }


def write_report(tracker: dict) -> None:
    if DRY_RUN:
        return
    with REPORT_FILE.open("w", encoding="utf-8") as f:
        json.dump(build_report(tracker), f, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------- commands

def cycle(tracker: dict, do_inbox: bool) -> None:
    try:
        sync_leads(tracker)
    except (LeadStoreError, SQLAlchemyError) as e:
        log(f"[WARN] database sync failed, skipping this cycle (nothing sent): {e}")
        return
    if do_inbox:
        try:
            check_inbox(tracker)
        except (imaplib.IMAP4.error, OSError, LeadStoreError, SQLAlchemyError) as e:
            log(f"[WARN] inbox check failed: {e}")
    maybe_send_one(tracker)
    save_tracker(tracker)
    write_report(tracker)


def cmd_run() -> None:
    log(f"Growth agent started (max {DAILY_LIMIT}/day, {MIN_GAP_MIN}-{MAX_GAP_MIN} min gaps, "
        f"send window {cfg('SEND_WINDOW', '09-18')}{', DRY RUN' if DRY_RUN else ''}).")
    last_inbox = 0.0
    while True:
        tracker = load_tracker()
        do_inbox = time.monotonic() - last_inbox >= INBOX_INTERVAL_SEC
        cycle(tracker, do_inbox)
        if do_inbox:
            last_inbox = time.monotonic()
        time.sleep(LOOP_TICK_SEC)


def cmd_status() -> None:
    tracker = load_tracker()
    sync_leads(tracker)
    save_tracker(tracker)
    counts = {s: 0 for s in STATUSES}
    for lead in tracker["leads"].values():
        counts[lead["status"]] += 1
    print("  ".join(f"{s}: {n}" for s, n in counts.items()))
    print(f"Sent today: {sent_today(tracker)}/{DAILY_LIMIT}. Next send not before: {tracker.get('next_send_at') or 'now'}")
    for lead in tracker["leads"].values():
        if lead["status"] in {"Replied", "Booked"}:
            print(f"  {lead['status']:8} {lead['company']} <{lead['email']}> — {lead.get('reply_summary', '')}")


def cmd_report(month: str | None) -> None:
    report = build_report(load_tracker(), month)
    print(f"{'month':8} {'var':3} {'sent':>5} {'reply%':>7} {'interest%':>10} {'booked%':>8} {'opt-out':>8}")
    for m, stats in list(report["by_month"].items()) + [("TOTAL", report["total"])]:
        for v, s in stats.items():
            print(f"{m:8} {v:3} {s['sent']:5} {s['reply_rate_pct']:7} {s['interest_rate_pct']:10} "
                  f"{s['booking_rate_pct']:8} {s['opt_out']:8}")


def cmd_mark(addr: str, status: str) -> int:
    tracker = load_tracker()
    sync_leads(tracker)
    lead = tracker["leads"].get(addr.strip().lower())
    if not lead:
        print(f"No lead with email {addr}", file=sys.stderr)
        return 1
    set_status(lead, status, "manual")
    save_tracker(tracker)
    write_report(tracker)
    print(f"{lead['company']} -> {status}")
    return 0


def main() -> int:
    global DRY_RUN, STORE
    parser = argparse.ArgumentParser(description="EasyHost AI growth agent.")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("run", "once"):
        p = sub.add_parser(name)
        p.add_argument("--dry-run", action="store_true")
    sub.add_parser("status")
    rp = sub.add_parser("report")
    rp.add_argument("--month", help="YYYY-MM")
    mp = sub.add_parser("mark")
    mp.add_argument("email")
    mp.add_argument("status", choices=STATUSES)
    args = parser.parse_args()

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    load_env()
    DRY_RUN = bool(getattr(args, "dry_run", False))

    if args.command in ("run", "once") and not DRY_RUN:
        sender, password = gmail_credentials()
        if not sender or not password:
            print("Missing GMAIL_ADDRESS or GMAIL_APP_PASSWORD in the environment.", file=sys.stderr)
            return 1

    if args.command in ("run", "once", "status", "mark"):
        try:
            STORE = open_store(DRY_RUN)
        except LeadStoreError as e:
            print(f"Database unavailable: {e}", file=sys.stderr)
            return 1
        if STORE:
            log(f"Database: {STORE.describe()}")

    if args.command == "run":
        try:
            cmd_run()
        except KeyboardInterrupt:
            log("Stopped.")
    elif args.command == "once":
        cycle(load_tracker(), do_inbox=True)
    elif args.command == "status":
        cmd_status()
    elif args.command == "report":
        cmd_report(args.month)
    elif args.command == "mark":
        return cmd_mark(args.email, args.status)
    return 0


if __name__ == "__main__":
    sys.exit(main())
