"""
CalendarScanner — fetches and parses iCal links for guest reservations.
Extracts: Guest Name, Phone Number, Room Name, Check-in Date.
Used for automated pre-arrival welcome messages (24h before check-in).
"""
import re
import uuid
from datetime import datetime, timezone
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

try:
    import icalendar
    ICAL_AVAILABLE = True
except ImportError:
    ICAL_AVAILABLE = False


def fetch_ical(url):
    """Fetch iCal content from URL. Returns raw string or None on error."""
    if not url or not isinstance(url, str):
        return None
    url = url.strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        return None
    try:
        req = Request(url, headers={"User-Agent": "EasyHost-AI/1.0"})
        with urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except (URLError, HTTPError, OSError) as e:
        print(f"[CalendarScanner] Fetch error: {e}")
        return None


def _parse_phone_from_text(text):
    """Extract phone from SUMMARY, DESCRIPTION, or ORGANIZER. Returns normalized E.164 or None."""
    if not text:
        return None
    # Match +972..., 050..., 052..., 054..., 04..., etc.
    patterns = [
        r"\+?\d{10,15}",
        r"0\d{8,9}",
        r"05\d{8}",
        r"04\d{7}",
    ]
    for p in patterns:
        m = re.search(p, text)
        if m:
            raw = m.group(0).replace(" ", "").replace("-", "")
            if raw.startswith("0") and len(raw) == 10:
                return "+972" + raw[1:]
            if not raw.startswith("+"):
                raw = "+972" + raw.lstrip("0")
            if len(raw) >= 11:
                return raw
    return None


def _parse_date(dt):
    """Convert ical DTSTART to YYYY-MM-DD string."""
    if dt is None:
        return None
    if hasattr(dt, "dt"):
        dt = dt.dt
    if isinstance(dt, datetime):
        return dt.strftime("%Y-%m-%d")
    if isinstance(dt, str) and len(dt) >= 10:
        return dt[:10]
    return None


def parse_ical(ical_content):
    """
    Parse iCal content and extract reservations.
    Returns list of dicts: { guest_name, guest_phone, room_name, check_in, check_out, uid }
    """
    if not ICAL_AVAILABLE:
        print("[CalendarScanner] icalendar not installed — pip install icalendar")
        return []
    if not ical_content:
        return []

    reservations = []
    try:
        cal = icalendar.Calendar.from_ical(ical_content)
        for component in cal.walk():
            if component.name != "VEVENT":
                continue
            uid = str(component.get("uid", ""))
            summary = str(component.get("summary", "") or "")
            desc = str(component.get("description", "") or "")
            location = str(component.get("location", "") or "")
            dtstart = component.get("dtstart")
            dtend = component.get("dtend")
            organizer = component.get("organizer")
            org_str = ""
            if organizer:
                org_str = str(organizer) if hasattr(organizer, "__str__") else ""

            check_in = _parse_date(dtstart)
            check_out = _parse_date(dtend)
            if not check_in:
                continue

            # Guest name: from SUMMARY (e.g. "John Doe - Room 405") or ORGANIZER CN=
            guest_name = "Guest"
            if summary:
                # Common formats: "Guest Name", "Guest Name - Room 405", "Room 405: Guest Name"
                parts = re.split(r"\s*[-–—:]\s*", summary, maxsplit=1)
                if parts:
                    candidate = parts[0].strip()
                    if candidate and not re.match(r"^room\s*\d+$", candidate, re.I):
                        guest_name = candidate[:100]

            # Room name: from SUMMARY, LOCATION, or DESCRIPTION
            room_name = location or "Room"
            if not room_name or room_name == "Room":
                if "room" in summary.lower():
                    m = re.search(r"room\s*(\d+[a-z]?|\w+)", summary, re.I)
                    if m:
                        room_name = f"Room {m.group(1)}"
                if "room" in desc.lower():
                    m = re.search(r"room\s*(\d+[a-z]?|\w+)", desc, re.I)
                    if m:
                        room_name = f"Room {m.group(1)}"

            # Phone: from DESCRIPTION, ORGANIZER, or SUMMARY
            guest_phone = _parse_phone_from_text(desc) or _parse_phone_from_text(org_str) or _parse_phone_from_text(summary)

            reservations.append({
                "uid": uid or str(uuid.uuid4()),
                "guest_name": guest_name,
                "guest_phone": guest_phone,
                "room_name": room_name,
                "check_in": check_in,
                "check_out": check_out or check_in,
            })
    except Exception as e:
        print(f"[CalendarScanner] Parse error: {e}")
    return reservations


def scan_calendar(ical_url):
    """
    Fetch and parse iCal URL. Returns list of reservation dicts.
    """
    content = fetch_ical(ical_url)
    if not content:
        return []
    return parse_ical(content)
