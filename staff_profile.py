"""
Maya knows workers: adaptive messaging by personality profile.
- style: friendly / serious / funny
- motivation: praise / challenge / calm
- learns from response_time
"""
from sqlalchemy import text
from staff_memory import save_staff_message, get_staff_history


def get_staff_profile(conn, worker):
    """Returns (style, motivation, last_seen, notes) or None."""
    result = conn.execute(
        text("SELECT style, motivation, last_seen, notes FROM staff_profile WHERE worker_name = :worker"),
        {"worker": worker},
    )
    row = result.fetchone()
    return row if row else None


def update_worker_profile(conn, worker, response_time):
    """Learn from response_time and update style/motivation."""
    if response_time < 2:
        style, motivation = "funny", "challenge"
    else:
        style, motivation = "friendly", "praise"

    existing = conn.execute(text("SELECT 1 FROM staff_profile WHERE worker_name = :worker"), {"worker": worker}).fetchone()
    if existing:
        conn.execute(
            text("UPDATE staff_profile SET style = :style, motivation = :motivation, last_seen = CURRENT_TIMESTAMP WHERE worker_name = :worker"),
            {"worker": worker, "style": style, "motivation": motivation},
        )
    else:
        conn.execute(
            text("INSERT INTO staff_profile (worker_name, style, motivation, last_seen) VALUES (:worker, :style, :motivation, CURRENT_TIMESTAMP)"),
            {"worker": worker, "style": style, "motivation": motivation},
        )
    conn.commit()


def generate_staff_message(conn, worker, situation):
    """
    Maya speaks "per worker" — adaptive tone based on profile.
    situation: no_response | great_job | default
    Saves message to staff_memory and returns it.
    """
    get_staff_history(conn, worker)  # preload history (for future AI context)
    profile = get_staff_profile(conn, worker)
    style = profile[0] if profile else "friendly"
    motivation = profile[1] if profile else "praise"

    if situation == "no_response":
        if motivation == "challenge":
            msg = f"👀 {worker}, אני סומכת עליך שתיקח את זה מהר 💪"
        else:
            msg = f"👋 {worker}, ראית את המשימה? צריך עזרה?"
    elif situation == "great_job":
        if style == "funny":
            msg = f"🔥 {worker} אתה על טורבו היום 😎"
        else:
            msg = f"💪 עבודה מצוינת {worker}!"
    elif situation == "assigned_task":
        if style == "funny":
            msg = f"🎯 {worker}, משימה חדשה נשלחה אליך — בוא נראה את זה! 💪"
        else:
            msg = f"👋 {worker}, שויכה אליך משימה חדשה. נא לאשר."
    else:
        msg = f"{worker}, ממשיכים יחד 👍"

    save_staff_message(conn, worker, msg, "maya")
    return msg


def update_profile_notes(conn, worker, notes):
    """Add emotional memory: stress, overload, excellence."""
    existing = conn.execute(text("SELECT 1 FROM staff_profile WHERE worker_name = :worker"), {"worker": worker}).fetchone()
    if existing:
        conn.execute(text("UPDATE staff_profile SET notes = :notes WHERE worker_name = :worker"), {"worker": worker, "notes": notes})
    else:
        conn.execute(text("INSERT INTO staff_profile (worker_name, notes) VALUES (:worker, :notes)"), {"worker": worker, "notes": notes})
    conn.commit()
