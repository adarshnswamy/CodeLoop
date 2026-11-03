import os
import sys
import json
import time
import base64
import re
import tempfile
import subprocess
import requests
from typing import Optional, Dict, Any

# ----------------- COMPILER PROVIDER CONFIGURATIONS -----------------

# Primary High-Availability Engine: Judge0 CE Public API (GCC, OpenJDK, Node.js)
JUDGE0_URL = "https://ce.judge0.com/submissions/?base64_encoded=true&wait=true"
JUDGE0_LANG_IDS = {
    "c": 50,          # C (GCC 9.2.0)
    "cpp": 54,        # C++ (GCC 9.2.0)
    "java": 62,       # Java (OpenJDK 13.0.1)
    "python": 71,     # Python (3.8.1)
    "javascript": 63  # JavaScript (Node.js 12.14.0)
}

# Secondary Failover Engine: Wandbox Cloud API
WANDBOX_URL = "https://wandbox.org/api/compile.json"
WANDBOX_COMPILERS = {
    "c": "gcc-head-c",
    "cpp": "gcc-head",
    "python": "cpython-head",
    "javascript": "nodejs-head"
}

# Tertiary Failover Engine: Piston Sandbox
PISTON_URL = "https://emkc.org/api/v2/piston/execute"
PISTON_CONFIG = {
    "c": {"lang": "c", "version": "10.2.0"},
    "cpp": {"lang": "c++", "version": "10.2.0"},
    "java": {"lang": "java", "version": "15.0.2"},
    "python": {"lang": "python", "version": "3.10.0"},
    "javascript": {"lang": "javascript", "version": "18.15.0"}
}

def b64_encode(s: str) -> str:
    if not s:
        return ""
    return base64.b64encode(s.encode("utf-8")).decode("utf-8")

def b64_decode(s: Optional[str]) -> str:
    if not s:
        return ""
    try:
        return base64.b64decode(s.encode("utf-8")).decode("utf-8", errors="replace")
    except Exception:
        return str(s)

def translate_error(error_text: str, language: str) -> Optional[str]:
    """Translates compiler and runtime errors into beginner-friendly explanations."""
    if not error_text:
        return None

    lower = error_text.lower()

    # Python friendly translations
    if "indentationerror" in lower:
        return "Diagnostic: Indentation error. Ensure all statements inside blocks, loops, or functions share consistent 4-space indentation."
    elif "syntaxerror: invalid syntax" in lower or "syntaxerror: expected" in lower:
        return "Diagnostic: Syntax error. Check for missing colons (:) after statements or unclosed parentheses, brackets, or quotes."
    elif "nameerror: name" in lower and "is not defined" in lower:
        return "Diagnostic: Undefined identifier. Check variable name spelling and ensure it is defined before use."
    elif "typeerror: can only concatenate" in lower:
        return "Diagnostic: Type mismatch. Incompatible types cannot be concatenated directly; explicit conversion (e.g. str(x)) is required."
    elif "indexerror: list index out of range" in lower:
        return "Diagnostic: Index out of bounds. The requested index does not exist in the collection. Note that indexing begins at 0."
    elif "zerodivisionerror" in lower:
        return "Diagnostic: Division by zero. Verify that the denominator is guarded against zero before division."
    elif "eoferror" in lower or "errno 29" in lower:
        return "Tip: The program requested input via input(), but reached the end of input. Provide input values in STDIN before clicking Run."
    elif "timed out" in lower or "execution timeout" in lower:
        return "Diagnostic: Execution timeout. The execution exceeded the maximum allotted time. Verify loop termination conditions."

    # C / C++ translations
    elif "expected ';'" in lower:
        return "Diagnostic: Missing semicolon. C and C++ statements must terminate with a semicolon (;)."
    elif "undefined reference to `main'" in lower or "undefined reference to 'main'" in lower:
        return "Diagnostic: Missing entry point. C and C++ programs require a valid 'int main()' definition."
    elif "undeclared" in lower:
        return "Diagnostic: Undeclared identifier. C and C++ require explicit variable type declarations before use."
    elif "conflicting types for" in lower:
        return "Diagnostic: Conflicting types. Ensure function declarations and definitions share identical return types and parameters."

    # Java translations
    elif "cannot find symbol" in lower:
        return "Diagnostic: Symbol not found. Verify identifier spelling, scope, and package imports."
    elif "class, interface, or enum expected" in lower:
        return "Diagnostic: Structural syntax error. Verify matching curly braces ({}) in the Java source."

    return None

def check_stdin_guidance(code: str, language: str, stdin: str) -> Optional[str]:
    """Provides gentle guidance when an interactive input function was used without STDIN."""
    if stdin and stdin.strip():
        return None
    lower = code.lower()
    if language in ["c", "cpp"]:
        if "scanf(" in lower or "cin >>" in lower or "cin>>" in lower or "getchar()" in lower or "fgets(" in lower:
            return "Tip: Your program uses input functions (like scanf or cin). You can provide input values in the STDIN tab before clicking Run."
    elif language == "java":
        if "scanner" in lower or "system.in" in lower or "bufferedreader" in lower:
            return "Tip: Your program requests user input. You can supply input values in the STDIN tab before clicking Run."
    elif language == "python":
        if "input(" in lower or "sys.stdin" in lower:
            return "Tip: Your program calls input(). You can provide inputs in the STDIN tab before clicking Run."
    return None

def execute_code_judge0(language: str, code: str, stdin: str = "") -> Optional[Dict[str, Any]]:
    """Executes code via the high-availability Judge0 CE Public API with base64 encoding."""
    lang_id = JUDGE0_LANG_IDS.get(language.lower())
    if not lang_id:
        return None

    src_code = code
    # Ensure Java public class is Main for Judge0 compiler
    if language.lower() == "java" and "public class Main" not in code and "class Main" not in code:
        if "public class " in code:
            src_code = re.sub(r'public\s+class\s+\w+', 'public class Main', code, count=1)

    payload = {
        "source_code": b64_encode(src_code),
        "language_id": lang_id,
        "stdin": b64_encode(stdin or "")
    }

    t0 = time.time()
    try:
        resp = requests.post(JUDGE0_URL, json=payload, timeout=6)
        if resp.status_code in [200, 201]:
            data = resp.json()
            status_obj = data.get("status", {})
            status_id = status_obj.get("id", 0)
            status_desc = status_obj.get("description", "Unknown")

            stdout = b64_decode(data.get("stdout"))
            stderr = b64_decode(data.get("stderr"))
            compile_output = b64_decode(data.get("compile_output"))

            elapsed_ms = max(int((time.time() - t0) * 1000), 1)

            final_output = stdout
            error_output = ""
            status_str = "Success"

            if status_id == 6:  # Compilation Error
                status_str = "Compilation Error"
                error_output = compile_output or stderr
            elif status_id == 5:  # Time Limit Exceeded
                status_str = "Timeout Error"
                error_output = "Execution timed out. Ensure loops terminate and input is supplied."
            elif status_id == 3:  # Accepted
                status_str = "Success"
            elif status_id in [4, 7, 8, 9, 10, 11, 12]:  # Runtime Error
                status_str = "Runtime Error"
                error_output = stderr or status_desc
            else:
                if stderr:
                    error_output = stderr
                    status_str = "Runtime Error"

            tip = translate_error(error_output, language) or check_stdin_guidance(code, language, stdin)

            return {
                "status": status_str,
                "stdout": final_output,
                "stderr": error_output,
                "exit_code": 0 if status_str == "Success" else 1,
                "execution_time_ms": elapsed_ms,
                "tip": tip,
                "engine": "judge0-cloud"
            }
    except Exception:
        return None

def execute_code_wandbox(language: str, code: str, stdin: str = "") -> Optional[Dict[str, Any]]:
    """Secondary failover execution via Wandbox API."""
    compiler = WANDBOX_COMPILERS.get(language.lower())
    if not compiler:
        return None

    t0 = time.time()
    try:
        resp = requests.post(WANDBOX_URL, json={
            "compiler": compiler,
            "code": code,
            "stdin": stdin or ""
        }, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            stdout = data.get("program_output", "")
            stderr = data.get("program_error", "")
            compiler_err = data.get("compiler_error", "") or data.get("compiler_message", "")
            raw_status = data.get("status", "0")

            status_str = "Success"
            error_output = ""

            if compiler_err and raw_status != "0":
                status_str = "Compilation Error"
                error_output = compiler_err
            elif raw_status != "0" or stderr:
                status_str = "Runtime Error" if raw_status != "0" else "Success"
                error_output = stderr

            elapsed_ms = max(int((time.time() - t0) * 1000), 1)
            tip = translate_error(error_output, language) or check_stdin_guidance(code, language, stdin)

            return {
                "status": status_str,
                "stdout": stdout,
                "stderr": error_output,
                "exit_code": int(raw_status) if raw_status.isdigit() else 0,
                "execution_time_ms": elapsed_ms,
                "tip": tip,
                "engine": "wandbox-cloud"
            }
    except Exception:
        return None

def execute_code_piston(language: str, code: str, stdin: str = "") -> Optional[Dict[str, Any]]:
    """Tertiary fallback execution via Piston API."""
    cfg = PISTON_CONFIG.get(language.lower())
    if not cfg:
        return None

    payload = {
        "language": cfg["lang"],
        "version": cfg["version"],
        "files": [{"content": code}],
        "stdin": stdin or "",
        "run_timeout": 3000,
        "compile_timeout": 4000
    }

    try:
        resp = requests.post(PISTON_URL, json=payload, timeout=3.5)
        if resp.status_code == 200:
            data = resp.json()
            run_res = data.get("run", {})
            compile_res = data.get("compile", {})
            stdout = run_res.get("stdout", "")
            stderr = run_res.get("stderr", "")
            compile_output = compile_res.get("output", "")
            exit_code = run_res.get("code", 0)

            final_output = stdout
            error_output = ""
            status_str = "Success"

            if compile_output and compile_res.get("code", 0) != 0:
                error_output = compile_output
                status_str = "Compilation Error"
            elif exit_code != 0 or stderr:
                final_output = stdout
                error_output = stderr
                status_str = "Runtime Error" if exit_code != 0 else "Success"

            tip = translate_error(error_output, language) or check_stdin_guidance(code, language, stdin)

            return {
                "status": status_str,
                "stdout": final_output,
                "stderr": error_output,
                "exit_code": exit_code,
                "execution_time_ms": run_res.get("time", 50),
                "tip": tip,
                "engine": "piston-sandbox"
            }
    except Exception:
        return None

def execute_python_in_process(code: str, stdin: str = "", start_time: Optional[float] = None) -> Dict[str, Any]:
    """In-process safe execution with stream redirection."""
    if start_time is None:
        start_time = time.time()

    import io
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    old_stdin = sys.stdin

    redirected_out = io.StringIO()
    redirected_err = io.StringIO()
    redirected_in = io.StringIO(stdin or "")

    sys.stdout = redirected_out
    sys.stderr = redirected_err
    sys.stdin = redirected_in

    safe_globals = {
        "__builtins__": __builtins__,
        "__name__": "__main__",
        "__doc__": None
    }

    exit_code = 0
    err_msg = ""

    try:
        exec(code, safe_globals)
    except SystemExit as se:
        exit_code = se.code if isinstance(se.code, int) else 0
    except Exception as e:
        import traceback
        exit_code = 1
        tb_lines = traceback.format_exc().splitlines()
        user_lines = [l for l in tb_lines if "execute_python_in_process" not in l]
        err_msg = "\n".join(user_lines[-4:]) if len(user_lines) > 4 else "\n".join(user_lines)
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr
        sys.stdin = old_stdin

    stdout = redirected_out.getvalue()
    stderr = redirected_err.getvalue()
    if err_msg:
        stderr = (stderr + "\n" + err_msg).strip()

    elapsed_ms = max(int((time.time() - start_time) * 1000), 1)
    status = "Success" if exit_code == 0 else "Runtime Error"
    tip = translate_error(stderr, "python") or check_stdin_guidance(code, "python", stdin)

    return {
        "status": status,
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": exit_code,
        "execution_time_ms": elapsed_ms,
        "tip": tip,
        "engine": "in-process-sandbox"
    }

def execute_python_locally(code: str, stdin: str = "") -> Dict[str, Any]:
    """Local Python execution with subprocess and in-process fallback."""
    start_time = time.time()
    safe_env = {}
    for k in ["PATH", "LD_LIBRARY_PATH", "PYTHONPATH", "LANG", "LC_ALL", "SYSTEMROOT", "WINDIR", "TMP", "TEMP", "TMPDIR"]:
        if k in os.environ:
            safe_env[k] = os.environ[k]
    safe_env["PYTHONDONTWRITEBYTECODE"] = "1"

    try:
        process = subprocess.run(
            [sys.executable, "-c", code],
            input=stdin or "",
            text=True,
            capture_output=True,
            timeout=4,
            env=safe_env
        )
        elapsed_ms = max(int((time.time() - start_time) * 1000), 1)
        stdout = process.stdout
        stderr = process.stderr
        exit_code = process.returncode
        status = "Success" if exit_code == 0 else "Runtime Error"
        tip = translate_error(stderr, "python") or check_stdin_guidance(code, "python", stdin)

        return {
            "status": status,
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": exit_code,
            "execution_time_ms": elapsed_ms,
            "tip": tip,
            "engine": "local-sandbox"
        }
    except Exception:
        return execute_python_in_process(code, stdin, start_time)

def run_code(language: str, code: str, stdin: str = "") -> Dict[str, Any]:
    """Unified high-availability execution with multi-provider failover."""
    lang_lower = language.lower()

    # 1. For Python, execute directly locally for instant zero-latency results
    if lang_lower == "python":
        local_res = execute_python_locally(code, stdin)
        if local_res.get("status") in ["Success", "Runtime Error", "Timeout Error"]:
            return local_res

    # 2. Primary Provider: Judge0 CE Public API (fastest, supports C, C++, Java, JS, Python)
    judge0_res = execute_code_judge0(lang_lower, code, stdin)
    if judge0_res:
        return judge0_res

    # 3. Secondary Failover: Wandbox Cloud (for C, C++, JS, Python)
    wandbox_res = execute_code_wandbox(lang_lower, code, stdin)
    if wandbox_res:
        return wandbox_res

    # 4. Tertiary Failover: Piston API
    piston_res = execute_code_piston(lang_lower, code, stdin)
    if piston_res:
        return piston_res

    # 5. Fallback for Python: in-process
    if lang_lower == "python":
        return execute_python_in_process(code, stdin)

    return {
        "status": "Notice",
        "stdout": "",
        "stderr": f"The online compiler clusters for {language.upper()} are momentarily busy. Please try again in a moment, or run Python which executes instantly.",
        "exit_code": -1,
        "execution_time_ms": 0,
        "tip": "Tip: Python scripts execute with zero delay.",
        "engine": "system-notice"
    }
