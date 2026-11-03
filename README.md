# CodeLoop
> Programming workspace with an AI tutor, interactive code editor, isolated execution, and adaptive assessment tools.

---

## Features

- **Interactive Code Editor:** Embedded Monaco Editor supporting Python, JavaScript, C, C++, and Java with syntax highlighting, code execution, and terminal output.
- **AI Tutor:** Conversational learning mentor powered by Google Gemini API providing clear concept explanations, code debugging, and line-by-line analysis.
- **Practice Zone:** Graded challenges with automated test runner and tiered hint ladders.
- **AI Quiz Generator:** Dynamic multi-format assessments with instant scoring and explanations.
- **Study Materials & RAG:** Upload PDFs and text notes for automated summarization and document Q&A.
- **Progress Tracking:** Solved challenges, activity streak, and adaptive topic diagnostics.

---

## Tech Stack

- **Frontend:** React 18, Tailwind CSS, Monaco Editor, Marked.
- **Backend:** Python FastAPI, SQLite, Pydantic, Requests.
- **AI Integration:** Google Gemini API (`GEMINI_API_KEY`).
- **Deployment:** Vercel (Serverless Python functions + Static assets).

---

## Local Development

1. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

2. **Run locally:**
   ```bash
   uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
   ```
   Or on Windows, double-click `run_codeloop.bat`.

3. **Open browser:**
   Navigate to https://code-loop-green.vercel.app

---

## Vercel Deployment

1. Import the repository in [Vercel](https://vercel.com).
2. Set the Environment Variable in Vercel project settings:
   - `GEMINI_API_KEY`: Your Gemini API key.
3. Deploy! Vercel will automatically build the static assets and deploy the backend serverless function.
