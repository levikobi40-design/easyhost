#!/usr/bin/env python3
"""Force update user levikobi40@gmail.com: password 123456 (hashed), role admin."""
import os
import sys

# Add parent dir so we can import app modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def main():
    from werkzeug.security import generate_password_hash
    db_url = os.getenv("DATABASE_URL", "sqlite:///leads.db")
    if db_url.startswith("sqlite"):
        db_path = db_url.replace("sqlite:///", "")
        if not os.path.isabs(db_path):
            db_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), db_path)
        db_url = "sqlite:///" + db_path
    from sqlalchemy import create_engine, text
    engine = create_engine(db_url)
    pw_hash = generate_password_hash("123456", method="pbkdf2:sha256")
    with engine.connect() as conn:
        # Ensure users table exists
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR PRIMARY KEY,
                tenant_id VARCHAR,
                email VARCHAR UNIQUE,
                password_hash VARCHAR,
                role VARCHAR,
                created_at VARCHAR
            )
        """))
        conn.commit()
        # Update or insert user
        result = conn.execute(
            text("SELECT id FROM users WHERE email = :email"),
            {"email": "levikobi40@gmail.com"}
        )
        row = result.fetchone()
        if row:
            conn.execute(
                text("UPDATE users SET password_hash = :pw, role = 'admin' WHERE email = :email"),
                {"pw": pw_hash, "email": "levikobi40@gmail.com"}
            )
            conn.commit()
            print("Updated user levikobi40@gmail.com: password=123456, role=admin")
        else:
            import uuid
            from datetime import datetime, timezone
            uid = str(uuid.uuid4())
            created = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"
            conn.execute(
                text("""
                    INSERT INTO users (id, tenant_id, email, password_hash, role, created_at)
                    VALUES (:id, 'default', :email, :pw, 'admin', :created)
                """),
                {"id": uid, "email": "levikobi40@gmail.com", "pw": pw_hash, "created": created}
            )
            conn.commit()
            print("Created user levikobi40@gmail.com: password=123456, role=admin")

if __name__ == "__main__":
    main()
