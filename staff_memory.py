"""Maya remembers staff conversations — staff_memory table."""
from sqlalchemy import text


def save_staff_message(conn, worker, message, role):
    """Insert a message into staff_memory. conn: SQLAlchemy connection."""
    conn.execute(
        text("INSERT INTO staff_memory (worker_name, message, role) VALUES (:worker, :message, :role)"),
        {"worker": worker, "message": message, "role": role},
    )
    conn.commit()


def get_staff_history(conn, worker, limit=10):
    """Fetch recent messages for worker, oldest first. Returns list of (role, message)."""
    result = conn.execute(
        text("""
            SELECT role, message FROM staff_memory
            WHERE worker_name = :worker
            ORDER BY created_at DESC
            LIMIT :limit
        """),
        {"worker": worker, "limit": limit},
    )
    rows = result.fetchall()
    return rows[::-1]
