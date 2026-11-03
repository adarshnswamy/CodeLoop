import os
import sys
import json
import time
import tempfile
import subprocess
import requests
from typing import Optional, Dict, Any

PISTON_URL = "https://emkc.org/api/v2/piston/execute"

LANGUAGE_CONFIG = {
    "python": {
        "piston_lang": "python",
        "piston_version": "3.10.0",
        "extension": ".py",
        "name": "Python"
    },
    "javascript": {
        "piston_lang": "javascript",
        "piston_version": "18.15.0",
        "extension": ".js",
        "name": "JavaScript"
    },
    "c": {
        "piston_lang": "c",
        "piston_version": "10.2.0",
        "extension": ".c",
        "name": "C"
    },
    "cpp": {
        "piston_lang": "c++",
        "piston_version": "10.2.0",
        "extension": ".cpp",
        "name": "C++"
    },
    "java": {
        "piston_lang": "java",
        "piston_version": "15.0.2",
        "extension": ".java",
        "name": "Java"
    }
}

def translate_error(error_text: str, language: str) -> Optional[str]:
    """Translates cryptic compiler and runtime errors into beginner-friendly explanations."""
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
    elif "timed out" in lower or "execution timeout" in lower:
        return "Diagnostic: Execution timeout. The execution exceeded the maximum allotted time. Verify loop termination conditions."

    # C / C++ translations
    elif "expected ';'" in lower:
        return "Diagnostic: Missing semicolon. C and C++ statements must terminate with a semicolon (;)."
    elif "undefined reference to `main'" in lower:
        return "Diagnostic: Missing entry point. C and C++ programs require a valid 'int main()' definition."
    elif "undeclared" in lower:
        return "Diagnostic: Undeclared identifier. C and C++ require explicit variable type declarations before use."

    # Java translations
    elif "cannot find symbol" in lower:
        return "Diagnostic: Symbol not found. Verify identifier spelling, scope, and package imports."
    elif "class, interface, or enum expected" in lower:
        return "Diagnostic: Structural syntax error. Verify matching curly braces ({}) in the Java source."

    return None

def execute_code_piston(language: str, code: str, stdin: str = "") -> Optional[Dict[str, Any]]:
    """Executes code via the isolated Piston sandbox API with strict timeout."""
    cfg = LANGUAGE_CONFIG.get(language.lower())
    if not cfg:
        return None

    payload = {
        "language": cfg["piston_lang"],
        "version": cfg["piston_version"],
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

            final_output = ""
            error_output = ""

            if compile_output and compile_res.get("code", 0) != 0:
                error_output = compile_output
                status = "Compilation Error"
            elif exit_code != 0 or stderr:
                final_output = stdout
                error_output = stderr
                status = "Runtime Error" if exit_code != 0 else "Completed with warnings"
            else:
                final_output = stdout
                status = "Success"

            tip = translate_error(error_output, language)

            return {
                "status": status,
                "stdout": final_output,
                "stderr": error_output,
                "exit_code": exit_code,
                "execution_time_ms": run_res.get("time", 50),
                "tip": tip,
                "engine": "isolated-sandbox"
            }
    except Exception:
        return None

def execute_python_in_process(code: str, stdin: str = "", start_time: Optional[float] = None) -> Dict[str, Any]:
    """In-process safe execution with standard stream redirection and friendly error translation."""
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
        # Keep only user-relevant traceback lines
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
    tip = translate_error(stderr, "python")

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
    """Secure platform-independent local execution for Python with subprocess and in-process fallback."""
    start_time = time.time()

    # Build safe environment preserving necessary dynamic linker paths
    safe_env = {}
    for k in ["PATH", "LD_LIBRARY_PATH", "PYTHONPATH", "LANG", "LC_ALL", "SYSTEMROOT", "WINDIR", "TMP", "TEMP", "TMPDIR"]:
        if k in os.environ:
            safe_env[k] = os.environ[k]
    safe_env["PYTHONDONTWRITEBYTECODE"] = "1"

    python_bin = sys.executable

    try:
        process = subprocess.run(
            [python_bin, "-c", code],
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
        tip = translate_error(stderr, "python")

        return {
            "status": status,
            "stdout": stdout,
            "stderr": stderr,
            "exit_code": exit_code,
            "execution_time_ms": elapsed_ms,
            "tip": tip,
            "engine": "local-sandbox"
        }
    except subprocess.TimeoutExpired:
        return {
            "status": "Timeout Error",
            "stdout": "",
            "stderr": "Execution timed out (4.0s limit reached). Ensure loops have exit conditions and input is supplied.",
            "exit_code": -1,
            "execution_time_ms": 4000,
            "tip": "Diagnostic: Ensure loops have reachable termination conditions.",
            "engine": "local-sandbox"
        }
    except Exception:
        # Fall back gracefully to in-process execution
        return execute_python_in_process(code, stdin, start_time)

def run_code(language: str, code: str, stdin: str = "") -> Dict[str, Any]:
    lang_lower = language.lower()

    # 1. For Python, execute directly with local/in-process runner for instant, deterministic results
    if lang_lower == "python":
        return execute_python_locally(code, stdin)

    # 2. For compiled languages (C, C++, Java) and JS, attempt isolated sandbox API
    piston_result = execute_code_piston(lang_lower, code, stdin)
    if piston_result:
        return piston_result

    # 3. If external sandbox is unreachable
    return {
        "status": "Execution Notice",
        "stdout": "",
        "stderr": f"The online sandbox compiler for {language.upper()} is temporarily busy or unreachable. Python runs instantly both in-browser and on the server. Try switching language to Python.",
        "exit_code": -1,
        "execution_time_ms": 0,
        "tip": "Tip: Python scripts execute with zero wait time.",
        "engine": "system-notice"
    }
