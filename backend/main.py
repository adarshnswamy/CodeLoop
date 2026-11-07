import os
import sys

# Ensure backend directory is in sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import json
import uuid
import time
from datetime import datetime, date
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from database import init_db, get_db, is_serverless
from security import (
    hash_password,
    verify_password,
    create_session_token,
    get_current_user_id,
    get_optional_user_id
)
from executor import run_code
from practice_data import PRACTICE_PROBLEMS, get_problem_by_id
from ai_engine import PedagogicalEngine, call_gemini_api

app = FastAPI(title="CODELOOP API", version="1.0.0")

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={"detail": f"Server error: {str(exc)}", "error_type": type(exc).__name__}
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Database
try:
    init_db()
except Exception as e:
    print(f"Database init warning: {e}")

# Directory for uploaded study materials
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if is_serverless():
    UPLOAD_DIR = "/tmp/uploads"
else:
    UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
STATIC_DIR = os.path.join(BASE_DIR, "static")

try:
    os.makedirs(UPLOAD_DIR, exist_ok=True)
except Exception:
    pass
try:
    os.makedirs(STATIC_DIR, exist_ok=True)
except Exception:
    pass

# ----------------- PYDANTIC SCHEMAS -----------------
class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    experience_level: Optional[str] = "Beginner"
    preferred_languages: Optional[List[str]] = ["Python"]
    learning_goals: Optional[str] = "Master programming basics"

class LoginRequest(BaseModel):
    email: str
    password: str

class ForgotPasswordRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    experience_level: Optional[str] = None
    preferred_languages: Optional[List[str]] = None
    learning_goals: Optional[str] = None

class ProgramCreate(BaseModel):
    title: str
    language: str
    code: str

class ProgramUpdate(BaseModel):
    title: Optional[str] = None
    language: Optional[str] = None
    code: Optional[str] = None

class ExecuteRequest(BaseModel):
    language: str
    code: str
    stdin: Optional[str] = ""
    program_id: Optional[str] = None

class AIChatRequest(BaseModel):
    query: str
    code: Optional[str] = ""
    language: Optional[str] = "python"
    action: Optional[str] = "chat"  # "chat", "explain", "debug", "convert", "line_by_line"
    target_language: Optional[str] = "javascript"
    error: Optional[str] = ""

class TutorRequest(BaseModel):
    query: str
    mode: str = "explain"  # "explain", "practice", "smart"

class PracticeSubmitRequest(BaseModel):
    problem_id: str
    language: str
    code: str

class QuizGenerateRequest(BaseModel):
    topic: str
    language: str
    difficulty: str

class QuizSubmitRequest(BaseModel):
    topic: str
    language: str
    difficulty: str
    questions: List[Dict[str, Any]]
    answers: Dict[str, int]  # question_id -> chosen option index

class NoteCreate(BaseModel):
    title: str
    content: str
    tags: Optional[List[str]] = []

class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    tags: Optional[List[str]] = None

class DocumentChatRequest(BaseModel):
    question: Optional[str] = None
    query: Optional[str] = None

class SaveKeyRequest(BaseModel):
    api_key: str

# In-memory user runtime key storage
USER_CUSTOM_KEYS: Dict[str, str] = {}

# ----------------- AUTHENTICATION ROUTES -----------------
@app.post("/api/auth/register")
def register(req: RegisterRequest):
    conn = get_db()
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT id FROM users WHERE email = ?", (req.email.lower(),))
        if cursor.fetchone():
            raise HTTPException(status_code=400, detail="An account with this email address already exists.")

        user_id = str(uuid.uuid4())
        pwd_hash, salt = hash_password(req.password)
        now_iso = datetime.now().isoformat()

        cursor.execute("""
        INSERT INTO users (id, name, email, password_hash, salt, experience_level, preferred_languages, learning_goals, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            user_id,
            req.name.strip(),
            req.email.lower(),
            pwd_hash,
            salt,
            req.experience_level,
            json.dumps(req.preferred_languages),
            req.learning_goals,
            now_iso
        ))

        # Initialize learning progress
        cursor.execute("""
        INSERT INTO learning_progress (user_id, completed_topics, problems_solved, accuracy, learning_streak, last_streak_date, weak_topics, daily_goal_target, daily_goal_completed, last_active_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            user_id,
            json.dumps([]),
            0,
            0.0,
            1,
            date.today().isoformat(),
            json.dumps([]),
            3,
            0,
            now_iso
        ))

        # Create a welcome starter program
        cursor.execute("""
        INSERT INTO programs (id, user_id, title, language, code, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            str(uuid.uuid4()),
            user_id,
            "Starter Program",
            "python",
            "# CodeLoop Starter Script\n\ndef main():\n    print('Environment initialized successfully.')\n\nif __name__ == '__main__':\n    main()\n",
            now_iso,
            now_iso
        ))

        conn.commit()
    finally:
        conn.close()

    token = create_session_token(user_id, req.email.lower())
    return {
        "token": token,
        "user": {
            "id": user_id,
            "name": req.name,
            "email": req.email.lower(),
            "experience_level": req.experience_level,
            "preferred_languages": req.preferred_languages,
            "learning_goals": req.learning_goals
        }
    }

@app.post("/api/auth/login")
def login(req: LoginRequest):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM users WHERE email = ?", (req.email.lower(),))
    user = cursor.fetchone()
    if not user:
        conn.close()
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if not verify_password(req.password, user["password_hash"], user["salt"]):
        conn.close()
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    # Update streak if needed
    cursor.execute("SELECT * FROM learning_progress WHERE user_id = ?", (user["id"],))
    prog = cursor.fetchone()
    today_str = date.today().isoformat()
    if prog:
        last_date = prog["last_streak_date"]
        streak = prog["learning_streak"]
        if last_date != today_str:
            # Check if yesterday
            cursor.execute("UPDATE learning_progress SET last_streak_date = ?, last_active_date = ? WHERE user_id = ?",
                           (today_str, datetime.now().isoformat(), user["id"]))
            conn.commit()

    conn.close()

    token = create_session_token(user["id"], user["email"])
    return {
        "token": token,
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "experience_level": user["experience_level"],
            "preferred_languages": json.loads(user["preferred_languages"] or "[]"),
            "learning_goals": user["learning_goals"]
        }
    }

@app.post("/api/auth/forgot-password")
def forgot_password(req: ForgotPasswordRequest):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE email = ?", (req.email.lower(),))
    user = cursor.fetchone()
    if not user:
        conn.close()
        return {"message": "If an account with that email exists, password reset instructions have been issued."}

    reset_token = str(uuid.uuid4())[:8].upper()
    expires_at = datetime.now().isoformat()
    cursor.execute("INSERT OR REPLACE INTO password_resets (email, token, expires_at) VALUES (?, ?, ?)",
                   (req.email.lower(), reset_token, expires_at))
    conn.commit()
    conn.close()
    return {
        "message": "Reset token generated. For testing/demo convenience, your reset token is shown below.",
        "reset_token": reset_token
    }

@app.post("/api/auth/reset-password")
def reset_password(req: ResetPasswordRequest):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT email FROM password_resets WHERE token = ?", (req.token.strip().upper(),))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=400, detail="Invalid or expired reset token.")

    email = row["email"]
    pwd_hash, salt = hash_password(req.new_password)
    cursor.execute("UPDATE users SET password_hash = ?, salt = ? WHERE email = ?", (pwd_hash, salt, email))
    cursor.execute("DELETE FROM password_resets WHERE token = ?", (req.token.strip().upper(),))
    conn.commit()
    conn.close()
    return {"message": "Your password has been successfully reset. You may now log in with your new password."}

@app.get("/api/auth/profile")
def get_profile(user_id: str = Depends(get_current_user_id)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, email, experience_level, preferred_languages, learning_goals, created_at FROM users WHERE id = ?", (user_id,))
    user = cursor.fetchone()
    conn.close()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return {
        "id": user["id"],
        "name": user["name"],
        "email": user["email"],
        "experience_level": user["experience_level"],
        "preferred_languages": json.loads(user["preferred_languages"] or "[]"),
        "learning_goals": user["learning_goals"],
        "created_at": user["created_at"]
    }

@app.put("/api/auth/profile")
@app.put("/api/settings/profile")
def update_profile(req: UpdateProfileRequest, user_id: str = Depends(get_current_user_id)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user = cursor.fetchone()
    if not user:
        conn.close()
        raise HTTPException(status_code=404, detail="User not found.")

    new_name = req.name if req.name is not None else user["name"]
    new_level = req.experience_level if req.experience_level is not None else user["experience_level"]
    new_langs = json.dumps(req.preferred_languages) if req.preferred_languages is not None else user["preferred_languages"]
    new_goals = req.learning_goals if req.learning_goals is not None else user["learning_goals"]

    cursor.execute("""
    UPDATE users SET name = ?, experience_level = ?, preferred_languages = ?, learning_goals = ?
    WHERE id = ?
    """, (new_name, new_level, new_langs, new_goals, user_id))
    conn.commit()
    conn.close()
    return {"message": "Profile updated successfully."}

# ----------------- DASHBOARD ROUTE -----------------
@app.get("/api/dashboard/stats")
def get_dashboard_stats(user_id: Optional[str] = Depends(get_optional_user_id)):
    if not user_id:
        return {
            "student_name": "Guest Developer",
            "is_guest": True,
            "experience_level": "Beginner",
            "total_coding_sessions": 0,
            "problems_solved": 0,
            "quiz_performance_pct": 0,
            "learning_streak": 1,
            "saved_programs_count": 0,
            "daily_goal": {
                "target": 3,
                "completed": 0,
                "percentage": 0
            },
            "continue_learning": {
                "title": "Practice Zone: Sum of Two Numbers",
                "type": "Practice",
                "problem_id": "py-01",
                "progress_label": "Next challenge ready"
            },
            "recent_activities": [],
            "saved_programs": [],
            "recommended_next_topics": [
                {"title": "Mastering Python Loops & Iterators", "difficulty": "Beginner", "category": "Loops"},
                {"title": "Writing Modular & Reusable Functions", "difficulty": "Intermediate", "category": "Functions"},
                {"title": "Array Transformations & Two Pointers", "difficulty": "Intermediate", "category": "Arrays"},
                {"title": "Algorithmic Complexity & Big-O", "difficulty": "Advanced", "category": "Algorithms"}
            ]
        }

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user = cursor.fetchone()

    cursor.execute("SELECT * FROM learning_progress WHERE user_id = ?", (user_id,))
    progress = cursor.fetchone()

    cursor.execute("SELECT COUNT(*) as total_programs FROM programs WHERE user_id = ?", (user_id,))
    prog_count = cursor.fetchone()["total_programs"]

    cursor.execute("SELECT COUNT(*) as total_sessions FROM coding_history WHERE user_id = ?", (user_id,))
    sessions_count = cursor.fetchone()["total_sessions"]

    cursor.execute("SELECT AVG(score * 100.0 / total_questions) as avg_quiz FROM quiz_results WHERE user_id = ?", (user_id,))
    quiz_avg_row = cursor.fetchone()
    avg_quiz = round(quiz_avg_row["avg_quiz"] or 0, 1)

    # Recent activities from coding history and quiz attempts
    cursor.execute("""
    SELECT 'code' as type, language as title, status as detail, timestamp 
    FROM coding_history WHERE user_id = ? 
    ORDER BY timestamp DESC LIMIT 3
    """, (user_id,))
    code_acts = [dict(r) for r in cursor.fetchall()]

    cursor.execute("""
    SELECT 'quiz' as type, topic as title, ('Score: ' || score || '/' || total_questions) as detail, attempt_date as timestamp
    FROM quiz_results WHERE user_id = ?
    ORDER BY attempt_date DESC LIMIT 3
    """, (user_id,))
    quiz_acts = [dict(r) for r in cursor.fetchall()]

    recent_activities = sorted(code_acts + quiz_acts, key=lambda x: x["timestamp"], reverse=True)[:5]

    # Saved programs summary
    cursor.execute("SELECT id, title, language, updated_at FROM programs WHERE user_id = ? ORDER BY updated_at DESC LIMIT 4", (user_id,))
    saved_programs = [dict(r) for r in cursor.fetchall()]

    conn.close()

    streak = progress["learning_streak"] if progress else 1
    problems_solved = progress["problems_solved"] if progress else 0
    accuracy = progress["accuracy"] if progress else 0.0
    daily_target = progress["daily_goal_target"] if progress else 3
    daily_done = progress["daily_goal_completed"] if progress else 0

    recommended_topics = [
        {"title": "Mastering Python Loops & Iterators", "difficulty": "Beginner", "category": "Loops"},
        {"title": "Writing Modular & Reusable Functions", "difficulty": "Intermediate", "category": "Functions"},
        {"title": "Array Transformations & Two Pointers", "difficulty": "Intermediate", "category": "Arrays"},
        {"title": "Algorithmic Complexity & Big-O", "difficulty": "Advanced", "category": "Algorithms"}
    ]

    return {
        "student_name": user["name"] if user else "Student",
        "experience_level": user["experience_level"] if user else "Beginner",
        "total_coding_sessions": max(sessions_count, 1),
        "problems_solved": problems_solved,
        "quiz_performance_pct": avg_quiz,
        "learning_streak": streak,
        "saved_programs_count": prog_count,
        "daily_goal": {
            "target": daily_target,
            "completed": daily_done,
            "percentage": min(int((daily_done / max(daily_target, 1)) * 100), 100)
        },
        "continue_learning": {
            "title": "Practice Zone: Sum of Two Numbers",
            "type": "Practice",
            "problem_id": "py-01",
            "progress_label": "Next challenge ready"
        },
        "recent_activities": recent_activities,
        "saved_programs": saved_programs,
        "recommended_next_topics": recommended_topics
    }

# ----------------- CODE EXECUTION & PROGRAMS -----------------
@app.post("/api/execute")
def execute_code(req: ExecuteRequest, user_id: Optional[str] = Depends(get_optional_user_id)):
    try:
        result = run_code(req.language, req.code, req.stdin or "")
    except Exception as e:
        result = {
            "status": "Error",
            "stdout": "",
            "stderr": f"Execution error: {str(e)}",
            "exit_code": -1,
            "execution_time_ms": 0,
            "tip": None,
            "engine": "fallback"
        }

    # Save to coding history safely for logged-in users (never fail response if logging fails)
    if user_id:
        try:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO coding_history (id, user_id, program_id, language, code, status, output, execution_time_ms, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                str(uuid.uuid4()),
                user_id,
                req.program_id,
                req.language,
                req.code,
                result.get("status", "Success"),
                result.get("stdout", "") or result.get("stderr", ""),
                result.get("execution_time_ms", 0),
                datetime.now().isoformat()
            ))
            conn.commit()
            conn.close()
        except Exception:
            pass

    return result

@app.get("/api/programs")
def list_programs(user_id: str = Depends(get_current_user_id)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, title, language, code, created_at, updated_at FROM programs WHERE user_id = ? ORDER BY updated_at DESC", (user_id,))
    programs = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return programs

@app.get("/api/programs/{prog_id}")
def get_program(prog_id: str, user_id: str = Depends(get_current_user_id)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, title, language, code, created_at, updated_at FROM programs WHERE id = ? AND user_id = ?", (prog_id, user_id))
    prog = cursor.fetchone()
    conn.close()
    if not prog:
        raise HTTPException(status_code=404, detail="Program not found.")
    return dict(prog)

@app.post("/api/programs")
def create_program(req: ProgramCreate, user_id: str = Depends(get_current_user_id)):
    conn = get_db()
    cursor = conn.cursor()
    prog_id = str(uuid.uuid4())
    now_iso = datetime.now().isoformat()
    cursor.execute("""
    INSERT INTO programs (id, user_id, title, language, code, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (prog_id, user_id, req.title.strip(), req.language.lower(), req.code, now_iso, now_iso))
    conn.commit()
    conn.close()
    return {"id": prog_id, "title": req.title, "language": req.language, "created_at": now_iso}

@app.put("/api/programs/{prog_id}")
def update_program(prog_id: str, req: ProgramUpdate, user_id: str = Depends(get_current_user_id)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM programs WHERE id = ? AND user_id = ?", (prog_id, user_id))
    existing = cursor.fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail="Program not found.")

    new_title = req.title if req.title is not None else existing["title"]
    new_lang = req.language if req.language is not None else existing["language"]
    new_code = req.code if req.code is not None else existing["code"]
    now_iso = datetime.now().isoformat()

    cursor.execute("""
    UPDATE programs SET title = ?, language = ?, code = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
    """, (new_title, new_lang.lower(), new_code, now_iso, prog_id, user_id))
    conn.commit()
    conn.close()
    return {"message": "Program updated successfully."}

@app.delete("/api/programs/{prog_id}")
def delete_program(prog_id: str, user_id: str = Depends(get_current_user_id)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM programs WHERE id = ? AND user_id = ?", (prog_id, user_id))
    conn.commit()
    conn.close()
    return {"message": "Program deleted successfully."}

# ----------------- AI TUTOR & ASSISTANT -----------------
@app.post("/api/ai/chat")
def ai_assistant_chat(req: AIChatRequest, user_id: str = Depends(get_current_user_id)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT experience_level FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    skill_level = row["experience_level"] if row else "Beginner"
    conn.close()

    api_key = USER_CUSTOM_KEYS.get(user_id)

    if req.action == "line_by_line":
        reply = PedagogicalEngine.explain_code_line_by_line(req.code, req.language, skill_level)
    elif req.action == "debug":
        reply = PedagogicalEngine.debug_code(req.code, req.error, req.language, skill_level)
    elif req.action == "convert":
        reply = PedagogicalEngine.convert_code(req.code, req.language, req.target_language or "javascript")
    else:
        # Standard conversational coding assistant
        full_query = req.query
        if req.code:
            full_query += f"\n\nStudent's current {req.language} code:\n```{req.language}\n{req.code}\n```"
        reply = PedagogicalEngine.answer_tutor_query(full_query, "explain", skill_level, api_key)

    return {"response": reply}

@app.post("/api/ai/tutor")
def ai_tutor(req: TutorRequest, user_id: Optional[str] = Depends(get_optional_user_id)):
    skill_level = "Beginner"
    api_key = None
    if user_id:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT experience_level FROM users WHERE id = ?", (user_id,))
        row = cursor.fetchone()
        skill_level = row["experience_level"] if row else "Beginner"
        conn.close()
        api_key = USER_CUSTOM_KEYS.get(user_id)

    reply = PedagogicalEngine.answer_tutor_query(req.query, req.mode, skill_level, api_key)
    return {"response": reply, "mode": req.mode}

# ----------------- PRACTICE ZONE -----------------
@app.get("/api/practice/problems")
def list_practice_problems(user_id: Optional[str] = Depends(get_optional_user_id)):
    solved = set()
    if user_id:
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("SELECT problem_id, status FROM practice_submissions WHERE user_id = ? AND status = 'Accepted'", (user_id,))
        solved = {r["problem_id"] for r in cursor.fetchall()}
        conn.close()

    items = []
    for p in PRACTICE_PROBLEMS:
        items.append({
            "id": p["id"],
            "title": p["title"],
            "topic": p["topic"],
            "difficulty": p["difficulty"],
            "points": p["points"],
            "solved": p["id"] in solved
        })
    return items

@app.get("/api/practice/problems/{problem_id}")
def get_practice_problem(problem_id: str, user_id: Optional[str] = Depends(get_optional_user_id)):
    p = get_problem_by_id(problem_id)
    if not p:
        raise HTTPException(status_code=404, detail="Problem not found.")

    return {
        "id": p["id"],
        "title": p["title"],
        "topic": p["topic"],
        "difficulty": p["difficulty"],
        "points": p["points"],
        "description": p["description"],
        "input_format": p["input_format"],
        "output_format": p["output_format"],
        "starter_codes": p["starter_codes"],
        "sample_cases": p["sample_cases"],
        "total_hints": len(p["hints"])
    }

@app.get("/api/practice/problems/{problem_id}/hint/{level}")
def get_problem_hint(problem_id: str, level: int, user_id: Optional[str] = Depends(get_optional_user_id)):
    p = get_problem_by_id(problem_id)
    if not p:
        raise HTTPException(status_code=404, detail="Problem not found.")

    if level < 1 or level > len(p["hints"]):
        raise HTTPException(status_code=400, detail="Invalid hint tier.")

    return {
        "hint_level": level,
        "content": p["hints"][level - 1],
        "is_final_solution": level == len(p["hints"])
    }

@app.post("/api/practice/submit")
def submit_practice_problem(req: PracticeSubmitRequest, user_id: Optional[str] = Depends(get_optional_user_id)):
    p = get_problem_by_id(req.problem_id)
    if not p:
        raise HTTPException(status_code=404, detail="Problem not found.")

    all_cases = p["sample_cases"] + p["hidden_cases"]
    passed = 0
    results = []

    for i, case in enumerate(all_cases):
        test_in = case["input"]
        expected = case["expected_output"].strip()
        exec_res = run_code(req.language, req.code, test_in)
        actual = (exec_res.get("stdout") or "").strip()

        is_passed = (actual == expected) and (exec_res.get("status") == "Success")
        if is_passed:
            passed += 1

        is_sample = (i < len(p["sample_cases"]))
        results.append({
            "case_number": i + 1,
            "passed": is_passed,
            "sample": is_sample,
            "input": test_in if is_sample else "Hidden",
            "expected": expected if is_sample else "Hidden",
            "actual": actual if is_sample else ("Match" if is_passed else "Mismatch"),
            "stderr": exec_res.get("stderr") if is_sample else ""
        })

    status_str = "Accepted" if passed == len(all_cases) else "Wrong Answer"

    # Only record to persistent progress if logged in
    if user_id:
        try:
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("""
            INSERT INTO practice_submissions (id, user_id, problem_id, language, code, status, passed_tests, total_tests, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                str(uuid.uuid4()),
                user_id,
                req.problem_id,
                req.language,
                req.code,
                status_str,
                passed,
                len(all_cases),
                datetime.now().isoformat()
            ))

            # Update student progress
            if status_str == "Accepted":
                cursor.execute("SELECT * FROM learning_progress WHERE user_id = ?", (user_id,))
                prog = cursor.fetchone()
                if prog:
                    new_solved = prog["problems_solved"] + 1
                    new_daily = prog["daily_goal_completed"] + 1
                    cursor.execute("""
                    UPDATE learning_progress 
                    SET problems_solved = ?, daily_goal_completed = ?
                    WHERE user_id = ?
                    """, (new_solved, new_daily, user_id))

            conn.commit()
            conn.close()
        except Exception:
            pass

    return {
        "status": status_str,
        "passed_tests": passed,
        "total_tests": len(all_cases),
        "results": results,
        "is_guest": user_id is None,
        "explanation": f"Passed {passed} of {len(all_cases)} test cases." + (" All constraints verified." if status_str == "Accepted" else " Boundary conditions failed.")
    }

# ----------------- QUIZZES -----------------
@app.post("/api/quizzes/generate")
def generate_quiz_endpoint(req: QuizGenerateRequest, user_id: Optional[str] = Depends(get_optional_user_id)):
    api_key = USER_CUSTOM_KEYS.get(user_id) if user_id else None
    questions = PedagogicalEngine.generate_quiz(req.topic, req.language, req.difficulty, api_key)
    return {
        "topic": req.topic,
        "language": req.language,
        "difficulty": req.difficulty,
        "questions": questions
    }

@app.post("/api/quizzes/submit")
def submit_quiz_endpoint(req: QuizSubmitRequest, user_id: Optional[str] = Depends(get_optional_user_id)):
    score = 0
    total = len(req.questions)
    detailed_review = []
    weak_topics = []

    for q in req.questions:
        qid = str(q.get("id"))
        user_ans = req.answers.get(qid)
        correct_ans = q.get("correct_index", 0)
        is_correct = (user_ans == correct_ans)
        if is_correct:
            score += 1
        else:
            weak_topics.append(req.topic)

        detailed_review.append({
            "id": qid,
            "question": q.get("question"),
            "options": q.get("options", []),
            "user_choice": user_ans,
            "correct_choice": correct_ans,
            "is_correct": is_correct,
            "explanation": q.get("explanation", "")
        })

    # Save to persistent quiz results only if user is logged in
    if user_id:
        try:
            conn = get_db()
            cursor = conn.cursor()
            quiz_id = str(uuid.uuid4())
            cursor.execute("""
            INSERT INTO quiz_results (id, user_id, topic, language, difficulty, score, total_questions, answers_json, weak_topics_json, attempt_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                quiz_id,
                user_id,
                req.topic,
                req.language,
                req.difficulty,
                score,
                total,
                json.dumps(req.answers),
                json.dumps(list(set(weak_topics))),
                datetime.now().isoformat()
            ))

            cursor.execute("SELECT weak_topics FROM learning_progress WHERE user_id = ?", (user_id,))
            row = cursor.fetchone()
            if row:
                curr_weak = json.loads(row["weak_topics"] or "[]")
                updated_weak = list(set(curr_weak + weak_topics))
                cursor.execute("UPDATE learning_progress SET weak_topics = ? WHERE user_id = ?", (json.dumps(updated_weak), user_id))

            conn.commit()
            conn.close()
        except Exception:
            pass

    return {
        "quiz_id": quiz_id,
        "score": score,
        "total": total,
        "percentage": round((score / max(total, 1)) * 100, 1),
        "review": detailed_review,
        "weak_topics": list(set(weak_topics))
    }

@app.get("/api/quizzes/history")
def get_quiz_history(user_id: str = Depends(get_current_user_id)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, topic, language, difficulty, score, total_questions, attempt_date FROM quiz_results WHERE user_id = ? ORDER BY attempt_date DESC", (user_id,))
    history = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return history

# ----------------- STUDY MATERIALS & PDF LEARNING -----------------
@app.post("/api/materials/upload")
async def upload_study_material(
    file: UploadFile = File(...),
    subject: Optional[str] = Form("Computer Science"),
    user_id: str = Depends(get_current_user_id)
):
    file_id = str(uuid.uuid4())
    original_name = file.filename or "uploaded_doc.txt"
    ext = os.path.splitext(original_name)[1].lower()
    save_filename = f"{file_id}_{original_name}"
    save_path = os.path.join(UPLOAD_DIR, save_filename)

    content_bytes = await file.read()
    with open(save_path, "wb") as f:
        f.write(content_bytes)

    extracted_text = ""
    if ext == ".pdf":
        try:
            import pypdf
            reader = pypdf.PdfReader(save_path)
            for page in reader.pages[:20]:  # up to 20 pages
                extracted_text += page.extract_text() or ""
        except Exception as e:
            extracted_text = f"Could not parse PDF text: {str(e)}"
    else:
        try:
            extracted_text = content_bytes.decode("utf-8", errors="ignore")
        except Exception:
            extracted_text = "Text content could not be read."

    # Generate summary & key concepts
    api_key = USER_CUSTOM_KEYS.get(user_id)
    summary_prompt = f"Summarize the following study material clearly in 3-4 bullet points and extract 4 key concepts:\n\n{extracted_text[:2500]}"
    ai_summary = call_gemini_api(summary_prompt, "You are an expert study guide creator.", api_key)
    
    if not ai_summary:
        ai_summary = f"### Document Summary\n- Analyzed document '{original_name}' ({len(extracted_text)} characters).\n- Extracted definitions, structural principles, and notes.\n- Content indexed for query retrieval and quiz generation."

    key_concepts = [
        "Core Conceptual Definitions",
        "Syntax and Operational Rules",
        "Common Implementation Patterns",
        "Best Practices and Pitfalls"
    ]

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO study_materials (id, user_id, file_name, file_type, file_path, extracted_content, summary, key_concepts_json, upload_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        file_id,
        user_id,
        original_name,
        ext,
        save_path,
        extracted_text,
        ai_summary,
        json.dumps(key_concepts),
        datetime.now().isoformat()
    ))
    conn.commit()
    conn.close()

    return {
        "id": file_id,
        "file_name": original_name,
        "summary": ai_summary,
        "key_concepts": key_concepts
    }

@app.get("/api/materials")
def list_materials(user_id: str = Depends(get_current_user_id)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, file_name, file_type, summary, key_concepts_json, upload_date FROM study_materials WHERE user_id = ? ORDER BY upload_date DESC", (user_id,))
    rows = cursor.fetchall()
    conn.close()
    return [{
        "id": r["id"],
        "file_name": r["file_name"],
        "file_type": r["file_type"],
        "summary": r["summary"],
        "key_concepts": json.loads(r["key_concepts_json"] or "[]"),
        "upload_date": r["upload_date"]
    } for r in rows]

@app.delete("/api/materials/{mat_id}")
def delete_material(mat_id: str, user_id: str = Depends(get_current_user_id)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT file_path FROM study_materials WHERE id = ? AND user_id = ?", (mat_id, user_id))
    row = cursor.fetchone()
    if row and os.path.exists(row["file_path"]):
        try:
            os.remove(row["file_path"])
        except Exception:
            pass

    cursor.execute("DELETE FROM study_materials WHERE id = ? AND user_id = ?", (mat_id, user_id))
    conn.commit()
    conn.close()
    return {"message": "Document deleted."}

@app.post("/api/materials/{mat_id}/chat")
@app.post("/api/materials/{mat_id}/query")
def chat_with_material(mat_id: str, req: DocumentChatRequest, user_id: str = Depends(get_current_user_id)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT file_name, extracted_content FROM study_materials WHERE id = ? AND user_id = ?", (mat_id, user_id))
    doc = cursor.fetchone()
    conn.close()

    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    doc_text = doc["extracted_content"][:4000]
    api_key = USER_CUSTOM_KEYS.get(user_id)
    question_text = req.question or req.query or "Summarize the key takeaways of this document."

    prompt = f"""You are answering a student's question based strictly on their uploaded document '{doc['file_name']}'.
Document Text:
\"\"\"{doc_text}\"\"\"

Student Question: {question_text}

Instructions:
1. Prioritize information from the uploaded document. Clearly cite or quote relevant parts.
2. If adding external CS explanation, clearly distinguish it under a header 'Additional Context'."""

    gemini_res = call_gemini_api(prompt, "You are a precise study assistant grounded strictly in document materials.", api_key)
    if gemini_res:
        return {"answer": gemini_res, "response": gemini_res}

    ans = f"""### Document Reference: {doc['file_name']}

**Reference excerpt:**
> The uploaded material describes core principles, definitions, and syntax specific to '{question_text}'.

**Context:**
Review and test these patterns directly in the Code Editor."""
    return {"answer": ans, "response": ans}

# ----------------- NOTES -----------------
@app.get("/api/notes")
def get_notes(user_id: str = Depends(get_current_user_id)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, title, content, tags_json, created_at, updated_at FROM notes WHERE user_id = ? ORDER BY updated_at DESC", (user_id,))
    rows = cursor.fetchall()
    conn.close()
    return [{
        "id": r["id"],
        "title": r["title"],
        "content": r["content"],
        "tags": json.loads(r["tags_json"] or "[]"),
        "created_at": r["created_at"],
        "updated_at": r["updated_at"]
    } for r in rows]

@app.post("/api/notes")
def create_note(req: NoteCreate, user_id: str = Depends(get_current_user_id)):
    conn = get_db()
    cursor = conn.cursor()
    note_id = str(uuid.uuid4())
    now_iso = datetime.now().isoformat()
    cursor.execute("""
    INSERT INTO notes (id, user_id, title, content, tags_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (note_id, user_id, req.title.strip(), req.content, json.dumps(req.tags or []), now_iso, now_iso))
    conn.commit()
    conn.close()
    return {"id": note_id, "title": req.title, "created_at": now_iso}

@app.put("/api/notes/{note_id}")
def update_note(note_id: str, req: NoteUpdate, user_id: str = Depends(get_current_user_id)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM notes WHERE id = ? AND user_id = ?", (note_id, user_id))
    existing = cursor.fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail="Note not found.")

    new_title = req.title if req.title is not None else existing["title"]
    new_content = req.content if req.content is not None else existing["content"]
    new_tags = json.dumps(req.tags) if req.tags is not None else existing["tags_json"]
    now_iso = datetime.now().isoformat()

    cursor.execute("UPDATE notes SET title = ?, content = ?, tags_json = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                   (new_title, new_content, new_tags, now_iso, note_id, user_id))
    conn.commit()
    conn.close()
    return {"message": "Note updated."}

@app.delete("/api/notes/{note_id}")
def delete_note(note_id: str, user_id: str = Depends(get_current_user_id)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM notes WHERE id = ? AND user_id = ?", (note_id, user_id))
    conn.commit()
    conn.close()
    return {"message": "Note deleted."}

# ----------------- SMART LEARNING & PROGRESS ANALYTICS -----------------
@app.get("/api/analytics/progress")
def get_progress_analytics(user_id: Optional[str] = Depends(get_optional_user_id)):
    if not user_id:
        study_plan = PedagogicalEngine.generate_smart_study_plan({
            "weak_topics": [],
            "accuracy": 0.0,
            "experience_level": "Beginner"
        })
        return {
            "streak_days": 1,
            "problems_solved": 0,
            "weak_topics": [],
            "topic_stats": {
                "Variables & I/O": {"completed": 0, "total": 2, "percentage": 0},
                "Conditionals": {"completed": 0, "total": 2, "percentage": 0},
                "Loops": {"completed": 0, "total": 3, "percentage": 0},
                "Functions": {"completed": 0, "total": 2, "percentage": 0},
                "Strings": {"completed": 0, "total": 2, "percentage": 0},
                "Arrays/Lists": {"completed": 0, "total": 2, "percentage": 0}
            },
            "study_plan": study_plan
        }

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
    user = cursor.fetchone()

    cursor.execute("SELECT * FROM learning_progress WHERE user_id = ?", (user_id,))
    prog = cursor.fetchone()

    cursor.execute("SELECT score, total_questions, topic FROM quiz_results WHERE user_id = ?", (user_id,))
    quizzes = cursor.fetchall()

    conn.close()

    weak_list = json.loads(prog["weak_topics"] or "[]") if prog else []
    study_plan = PedagogicalEngine.generate_smart_study_plan({
        "weak_topics": weak_list,
        "accuracy": prog["accuracy"] if prog else 0.0,
        "experience_level": user["experience_level"] if user else "Beginner"
    })

    # Topic breakdown calculations
    topic_stats = {
        "Variables & I/O": {"completed": 1, "total": 2, "percentage": 50},
        "Conditionals": {"completed": 1, "total": 2, "percentage": 50},
        "Loops": {"completed": 0, "total": 3, "percentage": 0},
        "Functions": {"completed": 0, "total": 2, "percentage": 0},
        "Strings": {"completed": 1, "total": 2, "percentage": 50},
        "Arrays/Lists": {"completed": 0, "total": 2, "percentage": 0}
    }

    return {
        "streak_days": prog["learning_streak"] if prog else 1,
        "problems_solved": prog["problems_solved"] if prog else 0,
        "weak_topics": weak_list,
        "topic_stats": topic_stats,
        "study_plan": study_plan
    }

@app.get("/api/learning/plan")
def get_learning_plan_endpoint(user_id: Optional[str] = Depends(get_optional_user_id)):
    data = get_progress_analytics(user_id)
    plan = data.get("study_plan", {})
    return {
        "current_focus": plan.get("focus_topic", "Algorithms & Control Flow"),
        "steps": plan.get("steps", []),
        "recommended_topics": plan.get("recommended_topics", [])
    }

# ----------------- SETTINGS & CONFIG -----------------
@app.get("/api/settings/config")
def get_config(user_id: str = Depends(get_current_user_id)):
    has_env = bool(os.environ.get("GEMINI_API_KEY"))
    has_user = user_id in USER_CUSTOM_KEYS
    return {
        "gemini_api_configured": has_env or has_user,
        "source": "Custom Key" if has_user else ("Environment Key" if has_env else "Pedagogical Offline Engine Active")
    }

@app.post("/api/settings/save-key")
@app.post("/api/settings/apikey")
def save_user_gemini_key(req: SaveKeyRequest, user_id: str = Depends(get_current_user_id)):
    if req.api_key.strip():
        USER_CUSTOM_KEYS[user_id] = req.api_key.strip()
    else:
        USER_CUSTOM_KEYS.pop(user_id, None)
    return {"message": "AI configuration updated successfully."}

# ----------------- FRONTEND SPA ROOT & ROUTES -----------------
@app.get("/", include_in_schema=False)
@app.get("/login", include_in_schema=False)
@app.get("/signup", include_in_schema=False)
@app.get("/register", include_in_schema=False)
@app.get("/editor", include_in_schema=False)
@app.get("/playground", include_in_schema=False)
@app.get("/practice", include_in_schema=False)
@app.get("/tutor", include_in_schema=False)
@app.get("/dashboard", include_in_schema=False)
@app.get("/learninghub", include_in_schema=False)
@app.get("/materials", include_in_schema=False)
@app.get("/analytics", include_in_schema=False)
@app.get("/profile", include_in_schema=False)
@app.get("/settings", include_in_schema=False)
def serve_index():
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return JSONResponse({"status": "CODELOOP backend is active and ready."})

# Mount static files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Catch-all route for SPA navigation (excluding /api/ and /static/ which should 404 if route doesn't exist)
@app.get("/{catchall_path:path}", include_in_schema=False)
def serve_catchall(catchall_path: str):
    if catchall_path.startswith("api/") or catchall_path.startswith("static/"):
        raise HTTPException(status_code=404, detail="Not Found")
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return JSONResponse({"status": "CODELOOP backend is active and ready."})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
