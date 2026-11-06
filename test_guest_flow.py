import sys
import os

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_guest_and_progressive_auth():
    print("=== TESTING SECTION 17: GUEST ACCESS & PROGRESSIVE AUTHENTICATION ===")

    # 1. Guest Dashboard
    print("\n[1] Testing Guest Dashboard Stats...")
    res = client.get("/api/dashboard/stats")
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    data = res.json()
    assert data.get("is_guest") is True, "Should have is_guest=True"
    assert "Guest Developer" in data.get("student_name", "")
    print("  -> Passed: Guest dashboard rendered with guest stats and name.")

    # 2. Guest Code Execution
    print("\n[2] Testing Guest Code Execution (Python)...")
    exec_payload = {
        "language": "python",
        "code": "print('Hello from Guest sandbox!')",
        "stdin": ""
    }
    res = client.post("/api/execute", json=exec_payload)
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    exec_data = res.json()
    assert exec_data["status"] == "Success"
    assert "Hello from Guest sandbox!" in exec_data["stdout"]
    print("  -> Passed: Guest code executed cleanly without requiring login.")

    # 3. Guest AI Tutor Query
    print("\n[3] Testing Guest AI Tutor Query...")
    tutor_payload = {
        "query": "What is recursion?",
        "mode": "explain"
    }
    res = client.post("/api/ai/tutor", json=tutor_payload)
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    tutor_data = res.json()
    assert "response" in tutor_data and len(tutor_data["response"]) > 10
    print("  -> Passed: Guest AI mentor response received.")

    # 4. Guest Practice Zone Access & Submission
    print("\n[4] Testing Guest Practice Zone...")
    res = client.get("/api/practice/problems")
    assert res.status_code == 200
    problems = res.json()
    assert len(problems) > 0
    print(f"  -> Guest can browse {len(problems)} practice problems.")

    res_hint = client.get("/api/practice/problems/py-01/hint/1")
    assert res_hint.status_code == 200
    print("  -> Guest can access hints.")

    py_sub = {
        "problem_id": "py-01",
        "language": "python",
        "code": "import sys\nline = sys.stdin.read().strip()\nif line:\n    a, b = map(int, line.split())\n    print(a + b)"
    }
    sub_res = client.post("/api/practice/submit", json=py_sub)
    assert sub_res.status_code == 200
    sub_data = sub_res.json()
    assert sub_data.get("is_guest") is True
    assert sub_data["status"] == "Accepted"
    print("  -> Passed: Guest code evaluated against test cases with is_guest=True.")

    # 5. Protected Endpoints MUST Reject Guests with 401
    print("\n[5] Testing Security Isolation: Protected Endpoints...")
    protected_endpoints = [
        ("GET", "/api/auth/profile", None),
        ("POST", "/api/programs", {"title": "Test", "language": "python", "code": "print(1)"}),
        ("GET", "/api/programs", None),
        ("POST", "/api/notes", {"title": "Test", "content": "Content"}),
        ("GET", "/api/notes", None),
        ("POST", "/api/settings/save-key", {"gemini_api_key": "test_key"}),
    ]
    for method, path, body in protected_endpoints:
        if method == "GET":
            r = client.get(path)
        else:
            r = client.post(path, json=body)
        assert r.status_code in (401, 403), f"Expected 401/403 on {path}, got {r.status_code}"
        print(f"  -> Protected: {method} {path} correctly rejected unauthenticated request ({r.status_code}).")

    # 6. Progressive Auth: Account Conversion
    print("\n[6] Testing Progressive Auth: Registration & Transition to Authenticated User...")
    import uuid
    uid = uuid.uuid4().hex[:6]
    reg_payload = {
        "name": f"Converted User {uid}",
        "email": f"guest_converted_{uid}@codeloop.test",
        "password": "StrongPassword999!",
        "experience_level": "Beginner",
        "preferred_languages": ["Python"],
        "learning_goals": "Master algorithms"
    }
    reg_res = client.post("/api/auth/register", json=reg_payload)
    assert reg_res.status_code == 200
    token = reg_res.json()["token"]
    auth_headers = {"Authorization": f"Bearer {token}"}

    # Now the converted user can save the program
    prog_payload = {
        "title": "My Migrated Guest Draft",
        "language": "python",
        "code": "print('Migrated from guest draft!')",
        "description": "Preserved guest work"
    }
    prog_res = client.post("/api/programs", json=prog_payload, headers=auth_headers)
    assert prog_res.status_code == 200
    saved_prog = prog_res.json()
    assert saved_prog["title"] == "My Migrated Guest Draft"
    print(f"  -> Successfully migrated draft to account: ID {saved_prog['id']}")

    print("\n=======================================================")
    print("ALL GUEST ACCESS & PROGRESSIVE AUTH TESTS PASSED 100%!")
    print("=======================================================")

if __name__ == "__main__":
    test_guest_and_progressive_auth()
