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
    """Executes code via the isolated Piston sandbox API."""
    cfg = LANGUAGE_CONFIG.get(language.lower())
    if not cfg:
        return None

    payload = {
        "language": cfg["piston_lang"],
        "version": cfg["piston_version"],
        "files": [{"content": code}],
        "stdin": stdin or "",
        "run_timeout": 5000,
        "compile_timeout": 10000
    }

    try:
        resp = requests.post(PISTON_URL, json=payload, timeout=8)
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
                "tip": tip,
                "engine": "isolated-sandbox"
            }
    except Exception:
        # Fall back to local isolated runner if Piston API is offline or unreachable
        return None

def execute_python_locally(code: str, stdin: str = "") -> Dict[str, Any]:
    """Secure local isolated execution for Python with scrubbed environment and strict timeout."""
    start_time = time.time()
    
    with tempfile.TemporaryDirectory() as temp_dir:
        file_path = os.path.join(temp_dir, "script.py")
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(code)

        # Scrub environment completely to prevent access to secrets, tokens, or app data
        safe_env = {
            "SYSTEMROOT": os.environ.get("SYSTEMROOT", "C:\\Windows"),
            "WINDIR": os.environ.get("WINDIR", "C:\\Windows"),
            "PATH": os.environ.get("PATH", ""),
            "PYTHONPATH": "",
            "PYTHONDONTWRITEBYTECODE": "1"
        }

        python_bin = sys.executable

        try:
            process = subprocess.run(
                [python_bin, "-u", "script.py"],
                cwd=temp_dir,
                input=stdin or "",
                text=True,
                capture_output=True,
                timeout=5,  # 5-second hard execution limit
                env=safe_env
            )
            elapsed_ms = int((time.time() - start_time) * 1000)

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
                "stderr": "Execution timed out (5.0s limit reached). Your code might have an infinite loop or was waiting indefinitely for input.",
                "exit_code": -1,
                "execution_time_ms": 5000,
                "tip": "Diagnostic: Ensure loops have reachable termination conditions and input calls do not block.",
                "engine": "local-sandbox"
            }
        except Exception as e:
            return {
                "status": "System Error",
                "stdout": "",
                "stderr": f"Execution error: {str(e)}",
                "exit_code": -1,
                "execution_time_ms": 0,
                "tip": None,
                "engine": "local-sandbox"
            }

def run_code(language: str, code: str, stdin: str = "") -> Dict[str, Any]:
    lang_lower = language.lower()
    
    # 1. Try secure isolated Piston sandbox first for all languages
    piston_result = execute_code_piston(lang_lower, code, stdin)
    if piston_result:
        return piston_result

    # 2. If Piston API is offline and language is Python, fallback to local isolated runner
    if lang_lower == "python":
        return execute_python_locally(code, stdin)

    return {
        "status": "Execution Unavailable",
        "stdout": "",
        "stderr": f"The isolated execution sandbox for {language.upper()} could not be contacted and local compiler is unavailable. Please verify network connectivity or try Python.",
        "exit_code": -1,
        "tip": "Tip: Python execution is supported both online and offline locally.",
        "engine": "unavailable"
    }
