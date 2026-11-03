import sqlite3
import os
import json
import uuid
from datetime import datetime, date

def is_serverless() -> bool:
    return bool(
        os.environ.get("VERCEL") or 
        os.environ.get("VERCEL_ENV") or 
        os.environ.get("VERCEL_REGION") or 
        os.environ.get("AWS_LAMBDA_FUNCTION_NAME") or 
        not os.access(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), os.W_OK)
    )

if is_serverless():
    DB_PATH = "/tmp/codeloop.db"
else:
    DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "codeloop.db")

_initialized = False

def get_db():
    global _initialized
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    first_time = not os.path.exists(DB_PATH)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        if not is_serverless():
            conn.execute("PRAGMA journal_mode = WAL")
        else:
            conn.execute("PRAGMA journal_mode = MEMORY")
    except Exception:
        pass
    if first_time or not _initialized:
        _initialized = True
        init_db_tables(conn)
    return conn

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = OFF")
    init_db_tables(conn)
    conn.close()

def init_db_tables(conn):
    cursor = conn.cursor()

    # Users table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        experience_level TEXT DEFAULT 'Beginner',
        preferred_languages TEXT DEFAULT '["Python"]',
        learning_goals TEXT DEFAULT 'Learn programming fundamentals',
        created_at TEXT NOT NULL
    )
    """)

    # Programs table (Saved user code)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS programs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        language TEXT NOT NULL,
        code TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)

    # Quiz Results table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS quiz_results (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        language TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        score INTEGER NOT NULL,
        total_questions INTEGER NOT NULL,
        answers_json TEXT NOT NULL,
        weak_topics_json TEXT DEFAULT '[]',
        attempt_date TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)

    # Learning Progress table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS learning_progress (
        user_id TEXT PRIMARY KEY,
        completed_topics TEXT DEFAULT '[]',
        problems_solved INTEGER DEFAULT 0,
        accuracy REAL DEFAULT 0.0,
        learning_streak INTEGER DEFAULT 1,
        last_streak_date TEXT,
        weak_topics TEXT DEFAULT '[]',
        daily_goal_target INTEGER DEFAULT 3,
        daily_goal_completed INTEGER DEFAULT 0,
        last_active_date TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)

    # Study Materials table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS study_materials (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_type TEXT NOT NULL,
        file_path TEXT NOT NULL,
        extracted_content TEXT,
        summary TEXT,
        key_concepts_json TEXT DEFAULT '[]',
        upload_date TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)

    # Notes table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS notes (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags_json TEXT DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)

    # Coding History table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS coding_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        program_id TEXT,
        language TEXT NOT NULL,
        code TEXT NOT NULL,
        status TEXT NOT NULL,
        output TEXT,
        execution_time_ms INTEGER DEFAULT 0,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)

    # Practice Submissions table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS practice_submissions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        problem_id TEXT NOT NULL,
        language TEXT NOT NULL,
        code TEXT NOT NULL,
        status TEXT NOT NULL,
        passed_tests INTEGER NOT NULL,
        total_tests INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
    """)

    # Password Reset Tokens table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS password_resets (
        email TEXT NOT NULL,
        token TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL
    )
    """)

    conn.commit()

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully at", DB_PATH)
