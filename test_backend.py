import sys
import os
import time

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_full_pipeline():
    print("--- 1. Testing Registration ---")
    import uuid
    uid = uuid.uuid4().hex[:6]
    reg_payload = {
        "name": f"Alex Mercer {uid}",
        "email": f"alex_{uid}@codeloop.test",
        "password": "SecretPassword123!",
        "experience_level": "Beginner",
        "preferred_languages": ["Python", "JavaScript"],
        "learning_goals": "Learn programming and data structures"
    }
    reg_res = client.post("/api/auth/register", json=reg_payload)
    print("Registration response code:", reg_res.status_code)
    assert reg_res.status_code == 200, f"Registration failed: {reg_res.text}"
    token = reg_res.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("Token received successfully.")

    print("\n--- 2. Testing Dashboard Stats ---")
    dash_res = client.get("/api/dashboard/stats", headers=headers)
    assert dash_res.status_code == 200
    dash_data = dash_res.json()
    print("Welcome name:", dash_data["student_name"])
    print("Streak:", dash_data["learning_streak"])
    print("Saved programs count:", dash_data["saved_programs_count"])

    print("\n--- 3. Testing Python Code Execution ---")
    exec_payload = {
        "language": "python",
        "code": "a = 25\nb = 17\nprint('Computed sum:', a + b)",
        "stdin": ""
    }
    exec_res = client.post("/api/execute", json=exec_payload, headers=headers)
    assert exec_res.status_code == 200
    exec_data = exec_res.json()
    print("Execution status:", exec_data["status"])
    print("Stdout:", exec_data["stdout"].strip())
    assert "Computed sum: 42" in exec_data["stdout"]

    print("\n--- 4. Testing AI Tutor ---")
    tutor_payload = {
        "query": "Explain for loops to a beginner with an example",
        "mode": "explain"
    }
    tutor_res = client.post("/api/ai/tutor", json=tutor_payload, headers=headers)
    assert tutor_res.status_code == 200
    print("Tutor response preview:", tutor_res.json()["response"][:120], "...")

    print("\n--- 5. Testing Practice Zone List & Submission ---")
    probs_res = client.get("/api/practice/problems", headers=headers)
    assert probs_res.status_code == 200
    problems = probs_res.json()
    print(f"Loaded {len(problems)} practice problems.")
    
    # Submit solution for py-01 (Sum of Two Numbers)
    py01_sub = {
        "problem_id": "py-01",
        "language": "python",
        "code": "import sys\nline = sys.stdin.read().strip()\nif line:\n    a, b = map(int, line.split())\n    print(a + b)"
    }
    sub_res = client.post("/api/practice/submit", json=py01_sub, headers=headers)
    assert sub_res.status_code == 200
    sub_data = sub_res.json()
    print(f"Practice submission: {sub_data['status']} ({sub_data['passed_tests']}/{sub_data['total_tests']} tests passed)")
    assert sub_data["status"] == "Accepted"

    print("\n--- 6. Testing AI Quiz Generator & Submission ---")
    quiz_gen_payload = {
        "topic": "Loops & Iteration",
        "language": "Python",
        "difficulty": "Beginner"
    }
    quiz_res = client.post("/api/quizzes/generate", json=quiz_gen_payload, headers=headers)
    assert quiz_res.status_code == 200
    quiz_data = quiz_res.json()
    print(f"Generated quiz with {len(quiz_data['questions'])} questions.")

    # Submit quiz answers
    answers = {str(q["id"]): q["correct_index"] for q in quiz_data["questions"]}
    submit_quiz_payload = {
        "topic": "Loops & Iteration",
        "language": "Python",
        "difficulty": "Beginner",
        "questions": quiz_data["questions"],
        "answers": answers
    }
    quiz_sub_res = client.post("/api/quizzes/submit", json=submit_quiz_payload, headers=headers)
    assert quiz_sub_res.status_code == 200
    quiz_sub_data = quiz_sub_res.json()
    print(f"Quiz submitted: Score {quiz_sub_data['score']}/{quiz_sub_data['total']} ({quiz_sub_data['percentage']}%)")

    print("\n--- 7. Testing Notes CRUD ---")
    note_payload = {
        "title": "Python Dictionary Cheatsheet",
        "content": "- Dict keys must be immutable\n- Access values with dict[key] or dict.get(key)",
        "tags": ["python", "cheatsheet"]
    }
    note_res = client.post("/api/notes", json=note_payload, headers=headers)
    assert note_res.status_code == 200
    print("Note created with id:", note_res.json()["id"])

    print("\n--- 8. Testing Smart Learning & Analytics ---")
    analytics_res = client.get("/api/analytics/progress", headers=headers)
    assert analytics_res.status_code == 200
    analytics_data = analytics_res.json()
    print("Analytics Streak:", analytics_data["streak_days"])
    print("Adaptive Plan Focus:", analytics_data["study_plan"]["focus_topic"])
    print(f"Plan Steps: {len(analytics_data['study_plan']['steps'])} steps ready.")

    print("\n==========================================")
    print("ALL TESTS PASSED! FULL PIPELINE VERIFIED!")
    print("==========================================")

if __name__ == "__main__":
    test_full_pipeline()
