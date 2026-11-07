import sys
import os

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

sys.path.append(os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

def test_routes_and_auth():
    print("=== TESTING CODELOOP ROUTING & AUTHENTICATION ===")

    # Scenario 1 & 2: Root URL (/) serves index.html without redirects
    print("\n[Scenario 1 & 2] Testing Root URL (/)")
    res_root = client.get("/")
    assert res_root.status_code == 200, f"Expected 200 on /, got {res_root.status_code}"
    assert "CODELOOP" in res_root.text
    assert "<div id=\"root\"></div>" in res_root.text
    print("  -> Passed: Root URL (/) serves SPA index.html with HTTP 200.")

    # Scenario 3: Public /editor route serves index.html without redirects
    print("\n[Scenario 3] Testing /editor Route")
    res_editor = client.get("/editor")
    assert res_editor.status_code == 200, f"Expected 200 on /editor, got {res_editor.status_code}"
    assert "<div id=\"root\"></div>" in res_editor.text
    print("  -> Passed: /editor serves SPA index.html with HTTP 200.")

    # Scenario 4: /login and /signup routes serve index.html without 404
    print("\n[Scenario 4] Testing /login and /signup Routes")
    res_login = client.get("/login")
    assert res_login.status_code == 200, f"Expected 200 on /login, got {res_login.status_code}"
    res_signup = client.get("/signup")
    assert res_signup.status_code == 200, f"Expected 200 on /signup, got {res_signup.status_code}"
    print("  -> Passed: /login and /signup serve SPA index.html with HTTP 200.")

    # Other public routes: /practice, /tutor, /learninghub
    print("\n[Scenario 5] Testing Other Public Routes")
    for r in ["/practice", "/tutor", "/learninghub", "/materials", "/analytics"]:
        res = client.get(r)
        assert res.status_code == 200, f"Expected 200 on {r}, got {res.status_code}"
    print("  -> Passed: All workspace deep links serve SPA index.html with HTTP 200.")

    # Scenario 6: Non-existent API route returns 404 (not masked by SPA catchall)
    print("\n[Scenario 6] Testing API 404 Isolation")
    res_api = client.get("/api/unknown_route_xyz")
    assert res_api.status_code == 404
    print("  -> Passed: Unmatched API routes return 404 Not Found.")

    # Scenario 7: Guest Code Execution
    print("\n[Scenario 7] Testing Guest Code Execution on /api/execute")
    exec_res = client.post("/api/execute", json={
        "language": "python",
        "code": "print(10 + 25)",
        "stdin": ""
    })
    assert exec_res.status_code == 200
    assert "35" in exec_res.json()["stdout"]
    print("  -> Passed: Guest code executed without login.")

    # Scenario 8: Account-dependent endpoint rejection
    print("\n[Scenario 8] Testing Account-Dependent Endpoint Protection")
    save_res = client.post("/api/programs", json={
        "title": "Guest Save Attempt",
        "code": "print(1)",
        "language": "python"
    })
    assert save_res.status_code in (401, 403)
    print("  -> Passed: Protected cloud save endpoint rejected unauthenticated request.")

    print("\n==========================================================")
    print("ALL ROUTING & AUTHENTICATION TESTS PASSED 100%!")
    print("==========================================================")

if __name__ == "__main__":
    test_routes_and_auth()
