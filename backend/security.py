import hashlib
import hmac
import os
import json
import base64
import time
from typing import Optional
from fastapi import Header, HTTPException, status

SECRET_KEY = os.environ.get("CODELOOP_SECRET_KEY", "codeloop-master-secret-key-2026-production-grade")

def hash_password(password: str, salt: Optional[str] = None) -> tuple[str, str]:
    if salt is None:
        salt = os.urandom(16).hex()
    pwd_bytes = password.encode('utf-8')
    salt_bytes = salt.encode('utf-8')
    hash_obj = hashlib.pbkdf2_hmac('sha256', pwd_bytes, salt_bytes, 100000)
    return hash_obj.hex(), salt

def verify_password(password: str, password_hash: str, salt: str) -> bool:
    computed_hash, _ = hash_password(password, salt)
    return hmac.compare_digest(computed_hash, password_hash)

def create_session_token(user_id: str, email: str) -> str:
    payload = {
        "user_id": user_id,
        "email": email,
        "iat": int(time.time()),
        "exp": int(time.time()) + (30 * 24 * 3600)  # 30 days
    }
    raw_payload = json.dumps(payload)
    b64_payload = base64.urlsafe_b64encode(raw_payload.encode('utf-8')).decode('utf-8')
    sig = hmac.new(SECRET_KEY.encode('utf-8'), b64_payload.encode('utf-8'), hashlib.sha256).hexdigest()
    return f"{b64_payload}.{sig}"

def verify_session_token(token: str) -> Optional[dict]:
    try:
        parts = token.split('.')
        if len(parts) != 2:
            return None
        b64_payload, sig = parts
        expected_sig = hmac.new(SECRET_KEY.encode('utf-8'), b64_payload.encode('utf-8'), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        payload_bytes = base64.urlsafe_b64decode(b64_payload.encode('utf-8'))
        payload = json.loads(payload_bytes.decode('utf-8'))
        if time.time() > payload.get("exp", 0):
            return None
        return payload
    except Exception:
        return None

def get_current_user_id(authorization: Optional[str] = Header(None)) -> str:
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication credentials were not provided."
        )
    token = authorization.replace("Bearer ", "").strip()
    payload = verify_session_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session token. Please log in again."
        )
    
    user_id = payload["user_id"]
    email = payload.get("email", "")

    # Ensure user record exists in current serverless/local SQLite instance
    try:
        from database import get_db
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE id = ?", (user_id,))
        if not cursor.fetchone():
            from datetime import datetime, date
            now_iso = datetime.now().isoformat()
            student_name = email.split("@")[0].replace(".", " ").title() if email else "Student"
            cursor.execute("""
            INSERT OR IGNORE INTO users (id, name, email, password_hash, salt, experience_level, preferred_languages, learning_goals, created_at)
            VALUES (?, ?, ?, '', '', 'Beginner', '["Python"]', 'Master programming concepts', ?)
            """, (user_id, student_name, email.lower(), now_iso))

            cursor.execute("""
            INSERT OR IGNORE INTO learning_progress (user_id, completed_topics, problems_solved, accuracy, learning_streak, last_streak_date, weak_topics, daily_goal_target, daily_goal_completed, last_active_date)
            VALUES (?, '[]', 0, 0.0, 1, ?, '[]', 3, 0, ?)
            """, (user_id, date.today().isoformat(), now_iso))
            conn.commit()
        conn.close()
    except Exception:
        pass

    return user_id
