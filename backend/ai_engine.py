import os
import json
import re
import requests
from typing import Optional, List, Dict, Any

# Load .env file if present
ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
if os.path.exists(ENV_PATH):
    with open(ENV_PATH, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())

SUPPORTED_GEMINI_MODELS = [
    "gemini-3.5-flash",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
    "gemini-flash-latest"
]

_session = requests.Session()
_session.headers.update({
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
})

def get_gemini_api_key(custom_key: Optional[str] = None) -> Optional[str]:
    return custom_key or os.environ.get("GEMINI_API_KEY")

def call_gemini_api(prompt: str, system_instruction: str = "", api_key: Optional[str] = None) -> Optional[str]:
    key = get_gemini_api_key(api_key)
    if not key:
        return None

    payload = {
        "contents": [
            {
                "parts": [{"text": prompt}]
            }
        ],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 2048
        }
    }

    if system_instruction:
        payload["systemInstruction"] = {
            "parts": [{"text": system_instruction}]
        }

    for model_name in SUPPORTED_GEMINI_MODELS:
        try:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={key}"
            res = _session.post(url, json=payload, timeout=20)
            if res.status_code == 200:
                data = res.json()
                candidates = data.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    if parts:
                        return parts[0].get("text", "")
            elif res.status_code in (404, 503):
                continue
        except Exception:
            continue

    return None

class PedagogicalEngine:
    """
    Intelligent tutor engine.
    Adapts explanations according to student skill level without emoji decoration or buzzwords.
    """

    @staticmethod
    def explain_code_line_by_line(code: str, language: str, skill_level: str) -> str:
        lines = [line for line in code.strip().split("\n") if line.strip()]
        if not lines:
            return "No code provided to analyze."

        explanation = f"### Line-by-Line Analysis ({language.capitalize()} / {skill_level})\n\n"
        for i, line in enumerate(lines, 1):
            s = line.strip()
            comment = ""
            if s.startswith("#") or s.startswith("//"):
                comment = "Comment ignored by interpreter/compiler."
            elif "def " in s or "function " in s or ("void " in s and "(" in s) or ("int " in s and "(" in s):
                comment = "Function definition with formal parameters."
            elif "if " in s:
                comment = "Conditional branch evaluating a boolean condition."
            elif "else" in s:
                comment = "Fallback branch executed when the condition evaluates to false."
            elif "for " in s:
                comment = "Count-controlled or sequence iteration loop."
            elif "while " in s:
                comment = "Conditional loop repeating while predicate holds true."
            elif "return " in s:
                comment = "Yields computed value to caller and exits current execution frame."
            elif "print(" in s or "console.log(" in s or "printf(" in s or "System.out.println(" in s:
                comment = "Standard output stream operation."
            elif "=" in s and not "==" in s:
                comment = "Variable assignment evaluating right-hand expression into left-hand identifier."
            elif "import " in s or "#include" in s:
                comment = "Module or header inclusion for external symbols."
            else:
                comment = "Sequential execution statement."

            explanation += f"- **Line {i}** `{s}`: {comment}\n"

        return explanation

    @staticmethod
    def debug_code(code: str, error: str, language: str, skill_level: str) -> str:
        res = "### Error Diagnostics & Static Analysis\n\n"
        if error:
            res += f"**Reported Output:**\n```\n{error}\n```\n\n"
            
        lower_err = (error or "").lower()

        if "syntaxerror" in lower_err or "expected" in lower_err:
            res += "#### Diagnosis\nThe compiler or interpreter reached an unexpected token sequence.\n\n"
            res += "#### Verification Steps\n- Check balancing of parentheses (), brackets [], and braces {}.\n- Verify terminal semicolons (C/C++/Java) or header colons (Python).\n- Check for unclosed string literal delimiters.\n"
        elif "indentation" in lower_err:
            res += "#### Diagnosis\nInconsistent indentation block level.\n\n"
            res += "#### Verification Steps\n- Ensure uniform 4-space indentation across the block.\n- Ensure tabs and spaces are not mixed.\n"
        elif "nameerror" in lower_err or "undeclared" in lower_err:
            res += "#### Diagnosis\nIdentifier referenced prior to declaration or initialization.\n\n"
            res += "#### Verification Steps\n- Check identifier spelling for typographical errors.\n- Verify declaration order and scope boundary.\n"
        else:
            res += "#### Diagnosis\nRuntime logic check required.\n\n"
            res += "#### Verification Steps\n- Trace variable values at loop entry and branch conditions.\n- Verify termination conditions on all iterative paths.\n- Inspect operand types to prevent silent coercion errors.\n"

        return res

    @staticmethod
    def convert_code(code: str, from_lang: str, to_lang: str) -> str:
        prompt = f"Convert this {from_lang} code into idiomatic {to_lang}. Output only the converted code and concise bullet points on structural language differences. Do not use emojis or marketing filler.\n\n```{from_lang}\n{code}\n```"
        gemini_res = call_gemini_api(prompt, "You are a precise technical compiler and code translator. Provide direct, clean code and factual syntax mappings.")
        if gemini_res:
            return gemini_res

        return f"""### Code Translation: {from_lang.capitalize()} to {to_lang.capitalize()}

#### Syntax Mappings
1. **Input and Output:** In Python use `print()` and `input()`. In JavaScript use `console.log()`. In C/C++ use `printf`/`cout` and `scanf`/`cin`. In Java use `System.out.println()`.
2. **Type System:** Dynamic typing in Python/JS vs static explicit type declarations in C, C++, and Java.
3. **Block Delimiters:** Indentation in Python vs curly braces in C, C++, Java, and JavaScript.

```
// Converted template for {to_lang.capitalize()}
```"""

    @staticmethod
    def answer_tutor_query(query: str, mode: str, skill_level: str, api_key: Optional[str] = None) -> str:
        sys_prompt = f"""You are an expert AI Tutor, programming mentor, and academic learning assistant teaching a {skill_level} student.
Your primary responsibility is to help students understand concepts naturally, just like an experienced human teacher.

Style and Communication Rules:
1. Always communicate in simple, natural, conversational, human-readable language as if teaching a beginner.
2. Avoid robotic, overly formal, or machine-generated-sounding responses.
3. Avoid excessive markdown: do not use unnecessary headings (###), horizontal lines, decorative blockquotes, or symbols.
4. Do not use emojis or decorative icons.
5. Use bullet points (pointers) whenever listing items, steps, components, or related points.
6. Use numbered lists only when presenting chronological sequential steps.
7. Use bold only when highlighting an important technical term.
8. When explaining concepts, provide a simple explanation first, then properly formatted code blocks with language identifiers, and explain key lines.
9. Follow this response structure when appropriate:
- Start with a direct answer.
- Explain the concept in simple language.
- Provide a practical real-world example or code snippet.
- Finish with a short takeaway.
10. Ensure educational clarity and natural flow."""

        if mode == "explain":
            sys_prompt += "\nMode: Explain mode. Focus on clear concept explanations with bullet pointers."
        elif mode == "practice":
            sys_prompt += "\nMode: Practice mode. Guide the student step by step with questions or hints rather than giving away full answers immediately."
        elif mode == "smart":
            sys_prompt += "\nMode: Smart Learning mode. Review where they need improvement and list recommended next practice steps using pointers."

        gemini_res = call_gemini_api(query, sys_prompt, api_key)
        if gemini_res:
            return gemini_res

        q_lower = query.lower()
        if "loop" in q_lower or "for" in q_lower or "while" in q_lower:
            return """A loop is a way to tell your computer to repeat a task multiple times so you do not have to write the same line of code repeatedly.

Think of it like setting an alarm on your phone for weekdays. Instead of manually turning on the alarm every night, you set a rule: repeat this alarm every Monday through Friday.

In Python, there are two common kinds of loops:

- For loops: You use these when you know how many times you want to repeat something, or when going through a collection like a list.
- While loops: You use these when you want to repeat something as long as a condition stays true.

Here is a simple example of a for loop:

```python
for count in range(1, 4):
    print(f"Step {count}")
```

Expected output:
```text
Step 1
Step 2
Step 3
```

Takeaway: Use a loop whenever you catch yourself writing repetitive code statements."""

        elif "function" in q_lower or "method" in q_lower:
            return """A function is a named, reusable block of code that carries out a specific task whenever you call it.

Think of it like a recipe on a card. You write down the instructions once, name it, and whenever you want that dish, you follow the recipe by name rather than rewriting the instructions every time.

Here is an example in Python:

```python
def greet_student(name):
    return f"Welcome, {name}!"

message = greet_student("Sarah")
print(message)
```

Expected output:
```text
Welcome, Sarah!
```

Key points about functions:
- def tells Python that you are defining a function.
- The name inside the parentheses is the input parameter.
- return passes the result back to the code that called it.

Takeaway: Functions keep your code clean, modular, and easy to reuse."""

        elif "array" in q_lower or "list" in q_lower:
            return """A list or array is an ordered collection that lets you store multiple values under a single variable name.

Think of it like an egg carton or an ice cube tray where each slot is numbered in order. In programming, numbering starts at zero.

Here is an example of creating and using a list in Python:

```python
fruits = ["apple", "banana", "orange"]

# Reading the first and last elements
print("First item:", fruits[0])
print("Last item:", fruits[-1])
```

Expected output:
```text
First item: apple
Last item: orange
```

Key points about lists:
- Square brackets [] are used to create lists.
- Indices start at 0, meaning fruits[0] is the first element.
- Negative indices like -1 let you access elements from the end.

Takeaway: Use lists whenever you have a group of related items that belong together in a sequence."""

        else:
            return f"""Here is a straightforward way to approach {query}:

Programming problems generally break down into three simple steps:
- Input: What data your code receives.
- Processing: What calculation or transformation needs to happen.
- Output: What result you want to display or return.

Takeaway: Before writing code, write out the steps in plain sentences first."""

    @staticmethod
    def generate_quiz(topic: str, language: str, difficulty: str, api_key: Optional[str] = None) -> List[Dict[str, Any]]:
        prompt = f"""Generate 5 technical {difficulty} assessment questions on {topic} in {language}.
Include multiple_choice, true_false, predict_output, find_error formats. No emojis.
Return strictly valid JSON matching this schema:
[
  {{
    "id": 1,
    "type": "multiple_choice",
    "question": "question text",
    "code_snippet": "optional code snippet or empty string",
    "options": ["A", "B", "C", "D"],
    "correct_index": 0,
    "explanation": "concise technical rationale"
  }}
]"""
        raw = call_gemini_api(prompt, "You are a CS professor generating rigorous technical assessments. Return valid JSON only. Do not use emojis.", api_key)
        if raw:
            try:
                clean = re.sub(r'```json\s*', '', raw)
                clean = re.sub(r'```', '', clean).strip()
                data = json.loads(clean)
                if isinstance(data, list) and len(data) > 0:
                    return data
            except Exception:
                pass

        return [
            {
                "id": 1,
                "type": "multiple_choice",
                "question": f"In {language.capitalize()}, what is the base index of an array or indexed sequence?",
                "code_snippet": "",
                "options": ["-1", "0", "1", "Determined by array length"],
                "correct_index": 1,
                "explanation": "Zero-based indexing is standardized across modern procedural and object-oriented languages."
            },
            {
                "id": 2,
                "type": "predict_output",
                "question": "What is the evaluated output of this code snippet?",
                "code_snippet": "x = 5\ny = x * 2\nprint(y + 3)",
                "options": ["10", "13", "15", "Runtime Error"],
                "correct_index": 1,
                "explanation": "x evaluates to 5. y evaluates to 10. The sum 10 + 3 evaluates to 13."
            },
            {
                "id": 3,
                "type": "true_false",
                "question": "In Python, a while loop executes its statement block at least once regardless of the initial predicate condition.",
                "code_snippet": "",
                "options": ["True", "False"],
                "correct_index": 1,
                "explanation": "A while loop evaluates the predicate prior to entry; if false on first check, zero iterations occur."
            },
            {
                "id": 4,
                "type": "find_error",
                "question": "Identify the syntax error in the following snippet.",
                "code_snippet": "1: for i in range(5)\n2:     print(i)",
                "options": ["Line 1: Missing colon (:) at end of header", "Line 2: Invalid indentation", "Line 1: range() parameter error", "No error"],
                "correct_index": 0,
                "explanation": "Compound statement headers in Python must terminate with a colon character."
            },
            {
                "id": 5,
                "type": "multiple_choice",
                "question": "What is the primary architectural purpose of pure functions?",
                "code_snippet": "",
                "options": ["Preventing memory allocation", "Deterministic output without observable side effects", "Automatic compiler parallelization", "Circumventing type checking"],
                "correct_index": 1,
                "explanation": "Pure functions produce deterministic output solely dependent on arguments without mutating external state."
            }
        ]

    @staticmethod
    def generate_smart_study_plan(user_data: Dict[str, Any]) -> Dict[str, Any]:
        weak_topics = user_data.get("weak_topics", [])
        accuracy = user_data.get("accuracy", 0.0)
        level = user_data.get("experience_level", "Beginner")

        focus_topic = weak_topics[0] if weak_topics else "Loops & Iteration"

        return {
            "focus_topic": focus_topic,
            "current_mastery_level": level,
            "accuracy_rating": f"{accuracy:.1f}%",
            "diagnosis": f"Analysis indicates review of '{focus_topic}' is recommended based on submission history.",
            "steps": [
                {
                    "step": 1,
                    "title": "Concept Review",
                    "action": f"Review technical overview of {focus_topic}.",
                    "type": "theory",
                    "status": "ready"
                },
                {
                    "step": 2,
                    "title": "Code Examples",
                    "action": f"Inspect implementation patterns for {focus_topic}.",
                    "type": "examples",
                    "status": "pending"
                },
                {
                    "step": 3,
                    "title": "Targeted Exercises",
                    "action": f"Complete 3 practice problems tagged with {focus_topic}.",
                    "type": "practice",
                    "status": "pending"
                },
                {
                    "step": 4,
                    "title": "Diagnostic Assessment",
                    "action": f"Execute 5-question evaluation on {focus_topic}.",
                    "type": "quiz",
                    "status": "pending"
                },
                {
                    "step": 5,
                    "title": "Verification",
                    "action": "Verify accuracy metric progression in analytics.",
                    "type": "review",
                    "status": "pending"
                }
            ],
            "recommended_next_topics": [
                "Nested Loops and 2D Arrays",
                "Recursive Decomposition",
                "Time Complexity Analysis"
            ]
        }
