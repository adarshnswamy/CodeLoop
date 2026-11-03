const { useState, useEffect, useRef, useMemo } = React;

// ----------------- API CLIENT -----------------
const API_BASE = "";

function getAuthHeader() {
  const token = localStorage.getItem("codeloop_token");
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

// Global Pyodide WASM instance for instant in-browser execution
let pyodideReadyPromise = null;
function getPyodideInstance() {
  if (!pyodideReadyPromise) {
    if (typeof loadPyodide !== "undefined") {
      pyodideReadyPromise = loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/"
      }).catch(err => {
        console.warn("Pyodide async load notice:", err);
        return null;
      });
    } else {
      pyodideReadyPromise = Promise.resolve(null);
    }
  }
  return pyodideReadyPromise;
}

if (typeof window !== "undefined") {
  window.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      if (typeof loadPyodide !== "undefined") {
        getPyodideInstance();
      }
    }, 1500);
  });
}

async function apiRequest(endpoint, method = "GET", body = null) {
  const headers = {
    ...getAuthHeader(),
    ...(body instanceof FormData ? {} : { "Content-Type": "application/json" })
  };

  const config = {
    method,
    headers,
    body: body ? (body instanceof FormData ? body : JSON.stringify(body)) : undefined
  };

  const res = await fetch(`${API_BASE}${endpoint}`, config);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Session expired or invalid. Please log in again.");
    }
    const msg = data.detail || data.message || `Server responded with status ${res.status}`;
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data;
}

// ----------------- MARKDOWN & CODE HIGHLIGHTING -----------------
function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(text).replace(/[&<>"']/g, m => map[m]);
}

function renderMarkdownWithPrism(content) {
  if (!content) return "";
  if (!window.marked) return escapeHtml(content);

  const renderer = new window.marked.Renderer();

  renderer.code = function(code, language) {
    const rawCode = (code || "").trim();
    const lang = (language || "text").toLowerCase().trim();
    
    let highlighted = "";
    if (window.Prism && window.Prism.languages[lang]) {
      try {
        highlighted = window.Prism.highlight(rawCode, window.Prism.languages[lang], lang);
      } catch (e) {
        highlighted = escapeHtml(rawCode);
      }
    } else if (window.Prism && (lang === "c" || lang === "cpp" || lang === "c++") && window.Prism.languages.clike) {
      try {
        highlighted = window.Prism.highlight(rawCode, window.Prism.languages.clike, lang);
      } catch (e) {
        highlighted = escapeHtml(rawCode);
      }
    } else {
      highlighted = escapeHtml(rawCode);
    }

    const encodedCode = encodeURIComponent(rawCode);
    const supportedLangs = ["python", "py", "javascript", "js", "c", "cpp", "c++", "java"];
    const isPlaygroundLang = supportedLangs.includes(lang);
    const targetLang = (lang === "py" ? "python" : (lang === "js" ? "javascript" : (lang === "c++" ? "cpp" : lang)));

    return `<div class="code-block-wrapper my-3.5 rounded-lg overflow-hidden border border-[#27272a] bg-[#0c0c0e] text-zinc-100 font-mono text-xs shadow-sm">
      <div class="code-block-header flex items-center justify-between px-3.5 py-1.5 bg-[#141418] border-b border-[#27272a] text-zinc-400 text-[11px] font-mono select-none">
        <span class="flex items-center gap-1.5 uppercase font-medium tracking-wide text-zinc-300">
          <svg class="w-3.5 h-3.5 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
          ${lang || "CODE"}
        </span>
        <div class="flex items-center gap-2">
          ${isPlaygroundLang ? `
          <button type="button" class="open-in-playground-btn inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium text-emerald-300 hover:text-white bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-800/60 transition cursor-pointer" data-code="${encodedCode}" data-lang="${targetLang}" title="Load and run in Code Playground">
            <svg class="w-3 h-3 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            Run in Editor
          </button>` : ''}
          <button type="button" class="copy-code-btn inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/60 transition cursor-pointer" data-code="${encodedCode}" title="Copy code to clipboard">
            <svg class="w-3 h-3 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copy</span>
          </button>
        </div>
      </div>
      <div class="p-3.5 overflow-x-auto text-[12.5px] leading-relaxed font-mono">
        <pre><code class="language-${lang}">${highlighted}</code></pre>
      </div>
    </div>`;
  };

  try {
    return window.marked.parse(content, { renderer, breaks: true, gfm: true });
  } catch (err) {
    console.error("Marked render error:", err);
    return escapeHtml(content);
  }
}

// ----------------- MONACO EDITOR -----------------
function MonacoEditor({ code, language, onChange, height = "440px", theme = "dark" }) {
  const editorRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    let editorInstance = null;
    let isCancelled = false;

    window.MonacoLoaded.then((monaco) => {
      if (isCancelled || !containerRef.current) return;
      containerRef.current.innerHTML = "";

      const monacoLang = language === "c" ? "c" : language === "cpp" ? "cpp" : language;

      editorInstance = monaco.editor.create(containerRef.current, {
        value: code,
        language: monacoLang,
        theme: theme === "dark" ? "vs-dark" : "vs",
        automaticLayout: true,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        padding: { top: 10, bottom: 10 },
        tabSize: 4,
        lineNumbers: "on",
        renderLineHighlight: "line",
      });

      editorRef.current = editorInstance;

      editorInstance.onDidChangeModelContent(() => {
        if (onChange) {
          onChange(editorInstance.getValue());
        }
      });
    });

    return () => {
      isCancelled = true;
      if (editorInstance) {
        editorInstance.dispose();
      }
    };
  }, []);

  useEffect(() => {
    if (editorRef.current && window.monaco) {
      const monacoLang = language === "c" ? "c" : language === "cpp" ? "cpp" : language;
      const model = editorRef.current.getModel();
      if (model) {
        window.monaco.editor.setModelLanguage(model, monacoLang);
      }
    }
  }, [language]);

  useEffect(() => {
    if (editorRef.current && editorRef.current.getValue() !== code) {
      editorRef.current.setValue(code);
    }
  }, [code]);

  useEffect(() => {
    if (window.monaco) {
      window.monaco.editor.setTheme(theme === "dark" ? "vs-dark" : "vs");
    }
  }, [theme]);

  return <div ref={containerRef} style={{ height, width: "100%" }} />;
}

// ----------------- ROOT COMPONENT -----------------
function App() {
  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const initialToken = (urlParams && urlParams.get("token")) || localStorage.getItem("codeloop_token") || "";
  const initialTab = (urlParams && urlParams.get("tab")) || "dashboard";
  const initialTheme = (urlParams && urlParams.get("theme")) || localStorage.getItem("codeloop_theme") || "dark";

  const [token, setToken] = useState(initialToken);
  const [currentUser, setCurrentUser] = useState(null);
  const [theme, setTheme] = useState(initialTheme);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [toast, setToast] = useState(null);

  // Cross-feature deep integrations
  const [editorInitialCode, setEditorInitialCode] = useState(null);
  const [editorInitialLanguage, setEditorInitialLanguage] = useState(null);
  const [tutorInitialPrompt, setTutorInitialPrompt] = useState(null);

  useEffect(() => {
    if (initialToken) {
      localStorage.setItem("codeloop_token", initialToken);
    }
  }, [initialToken]);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const openInEditor = (code, language = "python") => {
    setEditorInitialCode(code);
    setEditorInitialLanguage(language);
    setActiveTab("editor");
    showToast("Code snippet loaded into Playground", "info");
  };

  const askTutor = (prompt, mode = "explain") => {
    setTutorInitialPrompt({ prompt, mode, timestamp: Date.now() });
    setActiveTab("tutor");
    showToast("Opened query in AI Tutor", "info");
  };

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("codeloop_theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => prev === "dark" ? "light" : "dark");
  };

  useEffect(() => {
    if (token) {
      apiProfile();
    }
  }, [token]);

  const apiProfile = async () => {
    try {
      const data = await apiRequest("/api/auth/profile");
      setCurrentUser(data);
    } catch (err) {
      logout();
    }
  };

  const logout = () => {
    localStorage.removeItem("codeloop_token");
    setToken("");
    setCurrentUser(null);
    setActiveTab("dashboard");
  };

  if (!token || !currentUser) {
    return <AuthScreen setToken={setToken} setCurrentUser={setCurrentUser} theme={theme} toggleTheme={toggleTheme} />;
  }

  return (
    <div className={`min-h-screen flex ${theme === "dark" ? "bg-[#09090b] text-[#f4f4f5]" : "bg-[#f8fafc] text-[#0f172a]"}`}>
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-3.5 py-2 rounded-md text-xs font-medium border shadow-lg transition-all ${
          toast.type === "error" 
            ? "bg-red-950/95 text-red-200 border-red-800" 
            : toast.type === "info"
            ? "bg-zinc-900 text-zinc-100 border-zinc-700"
            : "bg-emerald-950/95 text-emerald-200 border-emerald-800"
        }`}>
          {toast.message}
        </div>
      )}

      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        currentUser={currentUser} 
        logout={logout}
        theme={theme}
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
      />

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        <Header 
          activeTab={activeTab} 
          currentUser={currentUser} 
          theme={theme} 
          toggleTheme={toggleTheme}
          voiceEnabled={voiceEnabled}
          setVoiceEnabled={setVoiceEnabled}
          setMobileMenuOpen={setMobileMenuOpen}
        />

        <main className={`flex-1 w-full ${activeTab === "tutor" ? "p-0 h-[calc(100vh-3.5rem)] overflow-hidden" : "p-4 md:p-6 max-w-7xl mx-auto"}`}>
          {activeTab === "dashboard" && <DashboardView currentUser={currentUser} setActiveTab={setActiveTab} showToast={showToast} theme={theme} openInEditor={openInEditor} askTutor={askTutor} />}
          {activeTab === "tutor" && <AITutorView currentUser={currentUser} theme={theme} voiceEnabled={voiceEnabled} showToast={showToast} openInEditor={openInEditor} tutorInitialPrompt={tutorInitialPrompt} onClearInitialPrompt={() => setTutorInitialPrompt(null)} />}
          {activeTab === "editor" && <CodeEditorView currentUser={currentUser} theme={theme} showToast={showToast} initialCode={editorInitialCode} initialLanguage={editorInitialLanguage} askTutor={askTutor} />}
          {activeTab === "practice" && <PracticeZoneView currentUser={currentUser} theme={theme} showToast={showToast} askTutor={askTutor} />}
          {activeTab === "mylearning" && <MyLearningView currentUser={currentUser} theme={theme} showToast={showToast} askTutor={askTutor} />}
          {activeTab === "materials" && <StudyMaterialsView currentUser={currentUser} theme={theme} showToast={showToast} askTutor={askTutor} />}
          {activeTab === "quizzes" && <QuizzesView currentUser={currentUser} theme={theme} showToast={showToast} />}
          {activeTab === "analytics" && <ProgressAnalyticsView currentUser={currentUser} theme={theme} showToast={showToast} askTutor={askTutor} />}
          {activeTab === "settings" && <SettingsView currentUser={currentUser} refreshProfile={apiProfile} theme={theme} toggleTheme={toggleTheme} showToast={showToast} />}
        </main>
      </div>
    </div>
  );
}

// ----------------- SIDEBAR -----------------
function Sidebar({ activeTab, setActiveTab, currentUser, logout, theme, mobileMenuOpen, setMobileMenuOpen }) {
  const navItems = [
    { 
      id: "dashboard", 
      label: "Dashboard",
      icon: (
        <svg className="w-4 h-4 mr-2.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7"></rect>
          <rect x="14" y="3" width="7" height="7"></rect>
          <rect x="14" y="14" width="7" height="7"></rect>
          <rect x="3" y="14" width="7" height="7"></rect>
        </svg>
      )
    },
    { 
      id: "tutor", 
      label: "AI Tutor",
      icon: (
        <svg className="w-4 h-4 mr-2.5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      )
    },
    { 
      id: "editor", 
      label: "Code Playground",
      icon: (
        <svg className="w-4 h-4 mr-2.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6"></polyline>
          <polyline points="8 6 2 12 8 18"></polyline>
        </svg>
      )
    },
    { 
      id: "practice", 
      label: "Practice Zone",
      icon: (
        <svg className="w-4 h-4 mr-2.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <circle cx="12" cy="12" r="6"></circle>
          <circle cx="12" cy="12" r="2"></circle>
        </svg>
      )
    },
    { 
      id: "mylearning", 
      label: "My Learning",
      icon: (
        <svg className="w-4 h-4 mr-2.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
        </svg>
      )
    },
    { 
      id: "materials", 
      label: "Study Materials",
      icon: (
        <svg className="w-4 h-4 mr-2.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
      )
    },
    { 
      id: "quizzes", 
      label: "Quizzes",
      icon: (
        <svg className="w-4 h-4 mr-2.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
      )
    },
    { 
      id: "analytics", 
      label: "Progress & Analytics",
      icon: (
        <svg className="w-4 h-4 mr-2.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="18" y1="20" x2="18" y2="10"></line>
          <line x1="12" y1="20" x2="12" y2="4"></line>
          <line x1="6" y1="20" x2="6" y2="14"></line>
        </svg>
      )
    },
    { 
      id: "settings", 
      label: "Settings",
      icon: (
        <svg className="w-4 h-4 mr-2.5 opacity-80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      )
    },
  ];

  return (
    <>
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside className={`
        fixed lg:static inset-y-0 left-0 z-40 w-56 flex flex-col
        ${theme === "dark" ? "bg-[#121215] border-r border-[#27272a]" : "bg-white border-r border-slate-200"}
        ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        transition-transform duration-200 ease-in-out
      `}>
        {/* Brand Header */}
        <div className={`h-14 px-4 flex items-center justify-between border-b ${
          theme === "dark" ? "border-[#27272a]" : "border-slate-200"
        }`}>
          <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => setActiveTab("dashboard")}>
            <div className="w-6 h-6 bg-blue-600 rounded-md flex items-center justify-center text-white text-xs font-bold shadow-sm">
              C
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`font-bold text-sm tracking-tight ${theme === "dark" ? "text-white" : "text-slate-900"}`}>
                CodeLoop
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">
                STUDIO
              </span>
            </div>
          </div>
          <button 
            className="lg:hidden text-zinc-400 hover:text-zinc-600 dark:hover:text-white"
            onClick={() => setMobileMenuOpen(false)}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-2.5 py-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center px-3 py-2 rounded-md text-xs font-medium text-left transition-all ${
                  isActive
                    ? theme === "dark"
                      ? "bg-zinc-800 text-white border border-zinc-700 shadow-sm"
                      : "bg-blue-50 text-blue-700 border border-blue-200 font-semibold shadow-sm"
                    : theme === "dark"
                      ? "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* User Info & Logout */}
        <div className={`p-3 border-t text-xs ${theme === "dark" ? "border-[#27272a] bg-[#141417]" : "border-slate-200 bg-slate-50"}`}>
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-8 h-8 rounded-full bg-blue-600/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400 flex items-center justify-center font-bold text-xs shrink-0 border border-blue-500/20">
              {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : "U"}
            </div>
            <div className="flex-1 min-w-0">
              <div className={`font-semibold truncate text-xs ${theme === "dark" ? "text-zinc-100" : "text-slate-900"}`}>
                {currentUser.name}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-200 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300">
                  {currentUser.experience_level || "Beginner"}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={logout}
            className="w-full flex items-center gap-1.5 text-left text-[11px] text-red-500 dark:text-red-400 hover:underline py-1 transition"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            <span>Log out</span>
          </button>
        </div>
      </aside>
    </>
  );
}

// ----------------- HEADER -----------------
function Header({ activeTab, currentUser, theme, toggleTheme, voiceEnabled, setVoiceEnabled, setMobileMenuOpen }) {
  const titles = {
    dashboard: "Workspace Dashboard",
    tutor: "AI Tutor Workspace",
    editor: "Code Playground",
    practice: "Practice Zone",
    mylearning: "My Learning",
    materials: "Study Materials",
    quizzes: "Assessments & Quizzes",
    analytics: "Progress & Analytics",
    settings: "Settings"
  };

  return (
    <header className={`h-14 px-4 md:px-6 flex items-center justify-between border-b ${
      theme === "dark" ? "bg-[#09090b] border-[#27272a]" : "bg-white border-slate-200"
    } sticky top-0 z-20`}>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="lg:hidden p-1.5 rounded text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-white"
          title="Open Navigation"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>

        <div className="flex items-center gap-1.5 text-xs font-mono text-zinc-400 hidden sm:flex">
          <span>CodeLoop</span>
          <span>/</span>
        </div>

        <span className={`text-sm font-semibold tracking-tight ${
          theme === "dark" ? "text-zinc-100" : "text-slate-900"
        }`}>
          {titles[activeTab] || "CodeLoop"}
        </span>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {/* Voice Toggle */}
        <button
          onClick={() => setVoiceEnabled(!voiceEnabled)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono border transition ${
            voiceEnabled 
              ? "bg-blue-50 border-blue-300 text-blue-600 dark:bg-blue-950/80 dark:border-blue-800 dark:text-blue-300 font-semibold" 
              : "bg-transparent border-slate-200 dark:border-zinc-800 text-slate-600 dark:text-zinc-400 hover:bg-slate-50 dark:hover:bg-zinc-800"
          }`}
          title="Toggle text-to-speech voice"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
          <span className="hidden sm:inline">{voiceEnabled ? "Voice: On" : "Voice: Off"}</span>
        </button>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-mono border transition ${
            theme === "dark"
              ? "bg-zinc-800/80 border-zinc-700 text-zinc-200 hover:bg-zinc-700"
              : "bg-slate-100 border-slate-300 text-slate-700 hover:bg-slate-200"
          }`}
          title="Toggle Light/Dark Theme"
        >
          {theme === "dark" ? (
            <>
              <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
              <span className="hidden sm:inline">Light</span>
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
              </svg>
              <span className="hidden sm:inline">Dark</span>
            </>
          )}
        </button>

        {/* User Account Info */}
        <div className="hidden md:flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-zinc-800 text-xs font-mono text-slate-600 dark:text-zinc-400">
          <span className="truncate max-w-[160px]">{currentUser.email}</span>
        </div>
      </div>
    </header>
  );
}

// ----------------- DASHBOARD VIEW -----------------
function DashboardView({ currentUser, setActiveTab, showToast, theme, openInEditor, askTutor }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    try {
      setLoading(true);
      const data = await apiRequest("/api/dashboard/stats");
      setStats(data);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-xs font-mono text-slate-500 dark:text-zinc-500 flex items-center justify-center gap-2">
        <svg className="w-4 h-4 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20"></circle></svg>
        <span>Loading workspace metrics...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overview Status Banner */}
      <div className={`p-5 rounded-xl border shadow-sm ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">
                ACTIVE WORKSPACE
              </span>
            </div>
            <h2 className={`text-xl font-bold tracking-tight ${theme === "dark" ? "text-zinc-100" : "text-slate-900"}`}>
              Welcome back, {stats?.student_name || currentUser.name}!
            </h2>
            <p className={`text-xs font-mono mt-1 ${theme === "dark" ? "text-zinc-400" : "text-slate-600"}`}>
              Experience: <span className="font-semibold">{stats?.experience_level}</span> • Learning Streak: <span className="font-semibold text-amber-500">{stats?.learning_streak} days</span> • Daily Goal: <span className="font-semibold text-emerald-500">{stats?.daily_goal?.completed || 0}/{stats?.daily_goal?.target || 3} tasks</span>
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setActiveTab("editor")}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-sm transition active:scale-[0.99]"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
              <span>Open Playground</span>
            </button>
            <button
              onClick={() => setActiveTab("tutor")}
              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-md text-xs font-medium border shadow-sm transition ${
                theme === "dark"
                  ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700"
                  : "bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300"
              }`}
            >
              <svg className="w-3.5 h-3.5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
              <span>Ask AI Tutor</span>
            </button>
          </div>
        </div>
      </div>

      {/* Metrics Row (High Contrast Data Grid) */}
      <div className={`grid grid-cols-2 lg:grid-cols-4 border divide-x divide-y sm:divide-y-0 rounded-xl overflow-hidden shadow-sm ${
        theme === "dark" ? "bg-[#121215] border-[#27272a] divide-[#27272a]" : "bg-white border-slate-200 divide-slate-200"
      }`}>
        <div className="p-4 sm:p-5">
          <span className={`text-[11px] font-mono uppercase tracking-wider block mb-1 font-medium ${
            theme === "dark" ? "text-zinc-400" : "text-slate-500"
          }`}>
            Coding Sessions
          </span>
          <span className={`text-2xl sm:text-3xl font-bold font-mono block ${
            theme === "dark" ? "text-zinc-100" : "text-slate-900"
          }`}>
            {stats?.total_coding_sessions || 0}
          </span>
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400 block mt-1 font-mono">Recorded code runs</span>
        </div>

        <div className="p-4 sm:p-5">
          <span className={`text-[11px] font-mono uppercase tracking-wider block mb-1 font-medium ${
            theme === "dark" ? "text-zinc-400" : "text-slate-500"
          }`}>
            Problems Solved
          </span>
          <span className={`text-2xl sm:text-3xl font-bold font-mono block text-emerald-600 dark:text-emerald-400`}>
            {stats?.problems_solved || 0}
          </span>
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400 block mt-1 font-mono">Practice challenges</span>
        </div>

        <div className="p-4 sm:p-5">
          <span className={`text-[11px] font-mono uppercase tracking-wider block mb-1 font-medium ${
            theme === "dark" ? "text-zinc-400" : "text-slate-500"
          }`}>
            Quiz Average
          </span>
          <span className={`text-2xl sm:text-3xl font-bold font-mono block text-blue-600 dark:text-blue-400`}>
            {stats?.quiz_performance_pct || 0}%
          </span>
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400 block mt-1 font-mono">Accuracy score</span>
        </div>

        <div className="p-4 sm:p-5">
          <span className={`text-[11px] font-mono uppercase tracking-wider block mb-1 font-medium ${
            theme === "dark" ? "text-zinc-400" : "text-slate-500"
          }`}>
            Active Streak
          </span>
          <span className={`text-2xl sm:text-3xl font-bold font-mono block text-amber-500 dark:text-amber-400`}>
            {stats?.learning_streak || 1}d
          </span>
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400 block mt-1 font-mono">Consecutive days active</span>
        </div>
      </div>

      {/* Two Column Layout: Next Activity & Saved Programs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Next Recommended Task */}
        <div className={`p-4 rounded-xl border shadow-sm ${
          theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
        }`}>
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#27272a] mb-3">
            <h3 className={`font-semibold text-xs uppercase tracking-wider font-mono ${
              theme === "dark" ? "text-zinc-100" : "text-slate-900"
            }`}>
              Next Recommended Task
            </h3>
            <span className="text-[10px] font-mono text-blue-600 dark:text-blue-400 font-semibold">Ready to start</span>
          </div>

          <div className={`p-3.5 rounded-lg border transition ${
            theme === "dark" 
              ? "bg-[#18181b] border-[#27272a] text-zinc-200" 
              : "bg-slate-50 border-slate-200 text-slate-800"
          }`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-semibold text-xs text-blue-600 dark:text-blue-400">
                {stats?.continue_learning?.title || "Practice Zone: Algorithm Fundamentals"}
              </span>
              <button
                onClick={() => setActiveTab("practice")}
                className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium"
              >
                Start
              </button>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-zinc-400 leading-relaxed">
              Step through structured programming exercises, execute test cases, and strengthen fundamental problem-solving patterns.
            </p>
          </div>
        </div>

        {/* Saved Work & Programs */}
        <div className={`p-4 rounded-xl border shadow-sm ${
          theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
        }`}>
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#27272a] mb-3">
            <h3 className={`font-semibold text-xs uppercase tracking-wider font-mono ${
              theme === "dark" ? "text-zinc-100" : "text-slate-900"
            }`}>
              Recent Saved Code
            </h3>
            <button
              onClick={() => setActiveTab("editor")}
              className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline font-mono"
            >
              Open Editor
            </button>
          </div>

          {stats?.recent_programs?.length > 0 ? (
            <div className="space-y-2">
              {stats.recent_programs.slice(0, 3).map((prog) => (
                <div
                  key={prog.id}
                  onClick={() => openInEditor(prog.code, prog.language)}
                  className={`p-2.5 rounded-lg border flex items-center justify-between cursor-pointer transition ${
                    theme === "dark"
                      ? "bg-[#18181b] border-[#27272a] hover:bg-zinc-800 text-zinc-200"
                      : "bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-800"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                    <span className="font-mono text-xs font-medium">{prog.title}</span>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded uppercase bg-slate-200 dark:bg-zinc-800 text-slate-700 dark:text-zinc-400 font-semibold">
                    {prog.language}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className={`p-4 rounded-lg border text-center text-xs text-slate-500 dark:text-zinc-500 ${
              theme === "dark" ? "bg-[#18181b] border-[#27272a]" : "bg-slate-50 border-slate-200"
            }`}>
              No saved programs yet. Create a new program in the Code Playground!
            </div>
          )}
        </div>
      </div>

      {/* Curriculum Roadmaps Grid */}
      <div className={`p-4 rounded-xl border shadow-sm ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-[#27272a] mb-3">
          <h3 className={`font-semibold text-xs uppercase tracking-wider font-mono ${
            theme === "dark" ? "text-zinc-100" : "text-slate-900"
          }`}>
            Curriculum Progression
          </h3>
          <span className="text-[10px] font-mono text-slate-500 dark:text-zinc-400">Adaptive Tracks</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { topic: "Python Basics & Control Flow", level: "Beginner", progress: 80, color: "bg-blue-600" },
            { topic: "Functions & Modular Architecture", level: "Intermediate", progress: 65, color: "bg-indigo-600" },
            { topic: "Data Structures & Two Pointers", level: "Intermediate", progress: 40, color: "bg-emerald-600" },
            { topic: "Algorithms & Complexity (Big-O)", level: "Advanced", progress: 20, color: "bg-amber-600" }
          ].map((item, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-lg border flex flex-col justify-between ${
                theme === "dark" ? "bg-[#18181b] border-[#27272a]" : "bg-slate-50 border-slate-200"
              }`}
            >
              <div>
                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 mb-1">
                  <span>{item.level}</span>
                  <span className="font-semibold text-slate-700 dark:text-zinc-300">{item.progress}%</span>
                </div>
                <div className={`font-semibold text-xs mb-3 ${theme === "dark" ? "text-zinc-100" : "text-slate-900"}`}>
                  {item.topic}
                </div>
              </div>
              <div className="w-full bg-slate-200 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                <div className={`${item.color} h-full rounded-full transition-all`} style={{ width: `${item.progress}%` }}></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ----------------- AI TUTOR VIEW -----------------
function AITutorView({ currentUser, theme, voiceEnabled, showToast, openInEditor, tutorInitialPrompt, onClearInitialPrompt }) {
  const STORAGE_KEY = "codeloop_ai_tutor_convos_v5";

  // 1. Initial State & Storage Persistence
  const [conversations, setConversations] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [
      {
        id: "convo_default",
        title: "Getting Started with Python & Coding",
        mode: "explain",
        createdAt: new Date().toISOString(),
        messages: [
          {
            id: "msg_init",
            role: "assistant",
            content: `Hello ${currentUser?.name || "there"}! I am your personal AI programming tutor.\n\nWhether you are writing your first lines of code, debugging tricky errors, or exploring data structures and algorithms, I am here to guide you step by step with clear explanations and practical examples.\n\nWhat would you like to explore or practice today?`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]
      }
    ];
  });

  const [activeConvoId, setActiveConvoId] = useState(() => {
    const savedId = localStorage.getItem("codeloop_active_convo_id_v5");
    return (savedId && conversations.some(c => c.id === savedId))
      ? savedId
      : (conversations[0]?.id || "convo_default");
  });

  // UI state
  const [searchQuery, setSearchQuery] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // Inline rename & delete confirmation state
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  // Active chat state
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("explain");
  const [loading, setLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState(null);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const chatContainerRef = useRef(null);

  // Persist conversations
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    } catch (e) {}
  }, [conversations]);

  // Persist active ID
  useEffect(() => {
    if (activeConvoId) {
      localStorage.setItem("codeloop_active_convo_id_v5", activeConvoId);
    }
  }, [activeConvoId]);

  // Lookup active conversation
  const activeConvo = useMemo(() => {
    return conversations.find(c => c.id === activeConvoId) || conversations[0] || {
      id: "fallback",
      title: "New Conversation",
      mode: "explain",
      messages: []
    };
  }, [conversations, activeConvoId]);

  // Sync mode with active conversation
  useEffect(() => {
    if (activeConvo && activeConvo.mode) {
      setMode(activeConvo.mode);
    }
  }, [activeConvo?.id]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConvo?.messages?.length, loading]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 180) + "px";
    }
  }, [input]);

  // Event Delegation for Code Block "Copy" and "Run in Editor" buttons
  useEffect(() => {
    const handleContainerClick = (e) => {
      const copyBtn = e.target.closest('.copy-code-btn');
      if (copyBtn) {
        e.stopPropagation();
        const code = decodeURIComponent(copyBtn.getAttribute('data-code') || '');
        if (code && navigator.clipboard) {
          navigator.clipboard.writeText(code);
          const span = copyBtn.querySelector('span');
          if (span) {
            const original = span.textContent;
            span.textContent = 'Copied!';
            copyBtn.classList.add('text-emerald-300');
            setTimeout(() => {
              span.textContent = original;
              copyBtn.classList.remove('text-emerald-300');
            }, 2000);
          }
        }
        return;
      }

      const runBtn = e.target.closest('.open-in-playground-btn');
      if (runBtn) {
        e.stopPropagation();
        const code = decodeURIComponent(runBtn.getAttribute('data-code') || '');
        const lang = runBtn.getAttribute('data-lang') || 'python';
        if (openInEditor) {
          openInEditor(code, lang);
        }
        return;
      }
    };

    const container = chatContainerRef.current;
    if (container) {
      container.addEventListener('click', handleContainerClick);
      return () => container.removeEventListener('click', handleContainerClick);
    }
  }, [openInEditor]);

  // Text-To-Speech
  const speakText = (text) => {
    if (!voiceEnabled || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const cleanText = text.replace(/```[\s\S]*?```/g, 'Code block omitted.')
                            .replace(/[#*`_>~]/g, '')
                            .slice(0, 300);
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (e) {}
  };

  // Speech Recognition (Mic)
  const startVoiceInput = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast("Speech Recognition not supported in this browser.", "error");
      return;
    }
    try {
      const recognition = new SpeechRecognition();
      recognition.lang = "en-US";
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.onstart = () => setIsRecording(true);
      recognition.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        setInput(prev => (prev ? prev + " " + transcript : transcript));
        setIsRecording(false);
      };
      recognition.onerror = () => setIsRecording(false);
      recognition.onend = () => setIsRecording(false);
      recognition.start();
    } catch (err) {
      setIsRecording(false);
    }
  };

  // Conversation Management Handlers
  const handleNewChat = () => {
    const newId = "convo_" + Date.now();
    const newConvo = {
      id: newId,
      title: "New Conversation",
      mode: mode,
      createdAt: new Date().toISOString(),
      messages: []
    };
    setConversations(prev => [newConvo, ...prev]);
    setActiveConvoId(newId);
    setInput("");
    setMobileDrawerOpen(false);
  };

  const startRename = (convo, e) => {
    e.stopPropagation();
    setEditingId(convo.id);
    setEditingTitle(convo.title);
  };

  const saveRename = (e) => {
    if (e) e.stopPropagation();
    if (!editingTitle.trim()) {
      setEditingId(null);
      return;
    }
    setConversations(prev => prev.map(c => 
      c.id === editingId ? { ...c, title: editingTitle.trim() } : c
    ));
    setEditingId(null);
  };

  const startDelete = (convoId, e) => {
    e.stopPropagation();
    setDeletingId(convoId);
  };

  const confirmDelete = (convoId, e) => {
    e.stopPropagation();
    const remaining = conversations.filter(c => c.id !== convoId);
    if (remaining.length === 0) {
      const fresh = {
        id: "convo_" + Date.now(),
        title: "New Conversation",
        mode: "explain",
        createdAt: new Date().toISOString(),
        messages: []
      };
      setConversations([fresh]);
      setActiveConvoId(fresh.id);
    } else {
      setConversations(remaining);
      if (activeConvoId === convoId) {
        setActiveConvoId(remaining[0].id);
      }
    }
    setDeletingId(null);
    showToast("Conversation deleted", "info");
  };

  const cancelDelete = (e) => {
    e.stopPropagation();
    setDeletingId(null);
  };

  // Clear all messages in current chat
  const handleClearChat = () => {
    if (!activeConvo?.messages?.length) return;
    if (window.confirm("Are you sure you want to clear messages in this chat?")) {
      setConversations(prev => prev.map(c => 
        c.id === activeConvo.id ? { ...c, messages: [] } : c
      ));
      showToast("Chat cleared", "info");
    }
  };

  // Copy full response
  const copyFullResponse = (msgId, content) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(content);
      setCopiedMsgId(msgId);
      setTimeout(() => setCopiedMsgId(null), 2000);
      showToast("Copied full response to clipboard", "info");
    }
  };

  // Send message
  const handleSend = async (queryText = null) => {
    const textToSend = (queryText !== null ? queryText : input).trim();
    if (!textToSend || loading) return;

    const userMsg = {
      id: "msg_" + Date.now() + "_u",
      role: "user",
      content: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    const currentList = activeConvo?.messages || [];
    const updatedMessages = [...currentList, userMsg];

    // Auto title if new
    let updatedTitle = activeConvo?.title;
    if (activeConvo?.title === "New Conversation" || currentList.length === 0) {
      const clean = textToSend.replace(/^[^a-zA-Z0-9]+/, '').slice(0, 36);
      if (clean) {
        updatedTitle = clean.charAt(0).toUpperCase() + clean.slice(1);
      }
    }

    setConversations(prev => prev.map(c => 
      c.id === activeConvo.id 
        ? { ...c, title: updatedTitle, mode: mode, messages: updatedMessages, updatedAt: new Date().toISOString() } 
        : c
    ));

    setInput("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    setLoading(true);

    try {
      const res = await apiRequest("/api/ai/tutor", "POST", {
        query: textToSend,
        mode: mode
      });

      const assistantMsg = {
        id: "msg_" + Date.now() + "_a",
        role: "assistant",
        content: res.response,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setConversations(prev => prev.map(c => 
        c.id === activeConvo.id 
          ? { ...c, messages: [...updatedMessages, assistantMsg], updatedAt: new Date().toISOString() } 
          : c
      ));

      speakText(res.response);
    } catch (err) {
      showToast(err.message || "Failed to reach AI Tutor", "error");
    } finally {
      setLoading(false);
    }
  };

  // Handle incoming deep-linked prompt from Playground or Practice Zone
  const lastProcessedPromptRef = useRef(null);
  useEffect(() => {
    if (tutorInitialPrompt && tutorInitialPrompt.prompt && tutorInitialPrompt.timestamp !== lastProcessedPromptRef.current) {
      lastProcessedPromptRef.current = tutorInitialPrompt.timestamp;
      if (tutorInitialPrompt.mode) {
        setMode(tutorInitialPrompt.mode);
      }
      handleSend(tutorInitialPrompt.prompt);
      if (onClearInitialPrompt) {
        onClearInitialPrompt();
      }
    }
  }, [tutorInitialPrompt]);

  // Regenerate Response
  const handleRegenerate = async () => {
    if (loading || !activeConvo?.messages?.length) return;
    const msgs = [...activeConvo.messages];
    const lastUserMsg = msgs.reverse().find(m => m.role === "user");
    if (!lastUserMsg) return;

    // Pop off last assistant message
    const lastUserIdx = activeConvo.messages.lastIndexOf(lastUserMsg);
    const trimmed = activeConvo.messages.slice(0, lastUserIdx + 1);

    setConversations(prev => prev.map(c => 
      c.id === activeConvo.id ? { ...c, messages: trimmed } : c
    ));

    setLoading(true);
    try {
      const res = await apiRequest("/api/ai/tutor", "POST", {
        query: lastUserMsg.content,
        mode: mode
      });

      const newAssistantMsg = {
        id: "msg_" + Date.now() + "_a",
        role: "assistant",
        content: res.response,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setConversations(prev => prev.map(c => 
        c.id === activeConvo.id 
          ? { ...c, messages: [...trimmed, newAssistantMsg] } 
          : c
      ));
      speakText(res.response);
    } catch (err) {
      showToast(err.message || "Failed to regenerate response", "error");
    } finally {
      setLoading(false);
    }
  };

  // Keyboard shortcut: Enter sends, Shift+Enter newlines
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Filtered conversations
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(c => 
      c.title.toLowerCase().includes(q) || 
      (c.messages && c.messages.some(m => m.content.toLowerCase().includes(q)))
    );
  }, [conversations, searchQuery]);

  // Suggested Prompts
  const SUGGESTED_PROMPTS = [
    {
      title: "Explain Concepts",
      badge: "Fundamentals",
      desc: "Recursion & call stacks with visual explanation",
      prompt: "Explain how recursion works with a visual call stack example and when to use it over iteration."
    },
    {
      title: "Help Me Debug",
      badge: "Troubleshooting",
      desc: "Trace and fix list index out of range",
      prompt: "I am getting an IndexError: list index out of range in Python. How do I trace and prevent it?"
    },
    {
      title: "Create Study Plan",
      badge: "Roadmap",
      desc: "2-week structured roadmap for DSA",
      prompt: "Create a 2-week structured roadmap to master Python data structures and algorithms from scratch."
    },
    {
      title: "Teach Me a Topic",
      badge: "Deep Dive",
      desc: "Object-Oriented Programming from scratch",
      prompt: "Teach me Object-Oriented Programming (classes, objects, and inheritance) in simple terms with code."
    }
  ];

  // Quick Action Chips
  const QUICK_ACTION_CHIPS = [
    { label: "Explain Further", prompt: "Could you explain this concept in more depth, highlighting internal mechanics and nuances?" },
    { label: "Give an Example", prompt: "Can you provide a clear, practical code example that illustrates this?" },
    { label: "Simplify This", prompt: "Can you explain this in simpler, beginner-friendly terms with an everyday analogy?" },
    { label: "Test My Understanding", prompt: "Ask me a conceptual question or puzzle to check if I understood this correctly." },
    { label: "Practice Questions", prompt: "Generate 2 practice coding challenges on this topic with clear problem descriptions." }
  ];

  // Render Sidebar Content (shared between desktop & mobile drawer)
  const renderSidebarContent = () => (
    <div className="flex flex-col h-full select-none">
      {/* Top Action Bar */}
      <div className="p-3 border-b border-slate-200 dark:border-[#27272a]">
        <button
          onClick={handleNewChat}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-sm transition active:scale-[0.99]"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span>New Chat</span>
        </button>

        {/* Search Input */}
        <div className="relative mt-2.5">
          <svg className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-white dark:bg-[#18181b] border border-slate-300 dark:border-[#27272a] text-slate-900 dark:text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-300 text-xs"
            >
              x
            </button>
          )}
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredConversations.length === 0 ? (
          <div className="p-4 text-center text-xs text-zinc-500">
            No chats found
          </div>
        ) : (
          filteredConversations.map((convo) => {
            const isActive = convo.id === activeConvoId;
            const isEditing = editingId === convo.id;
            const isDeleting = deletingId === convo.id;

            return (
              <div
                key={convo.id}
                onClick={() => {
                  setActiveConvoId(convo.id);
                  setMobileDrawerOpen(false);
                }}
                className={`group relative flex items-center justify-between px-2.5 py-2 rounded-md text-xs cursor-pointer transition ${
                  isActive
                    ? theme === "dark"
                      ? "bg-[#18181b] border border-[#3f3f46] text-white shadow-sm"
                      : "bg-white border border-slate-300 text-slate-900 shadow-sm"
                    : theme === "dark"
                      ? "text-zinc-400 hover:text-zinc-200 hover:bg-[#141417]"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                }`}
              >
                {isEditing ? (
                  <div className="flex items-center gap-1.5 w-full" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="text"
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveRename(e);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      autoFocus
                      className="flex-1 px-2 py-0.5 text-xs rounded bg-zinc-900 border border-blue-500 text-white focus:outline-none"
                    />
                    <button
                      onClick={saveRename}
                      className="p-1 text-emerald-400 hover:text-emerald-300"
                      title="Save"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="p-1 text-zinc-400 hover:text-zinc-200"
                      title="Cancel"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  </div>
                ) : isDeleting ? (
                  <div className="flex items-center justify-between w-full" onClick={(e) => e.stopPropagation()}>
                    <span className="text-[11px] text-red-400 font-medium">Delete chat?</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => confirmDelete(convo.id, e)}
                        className="px-2 py-0.5 rounded text-[10px] bg-red-600 hover:bg-red-500 text-white font-medium"
                      >
                        Yes
                      </button>
                      <button
                        onClick={cancelDelete}
                        className="px-2 py-0.5 rounded text-[10px] bg-zinc-700 hover:bg-zinc-600 text-zinc-200"
                      >
                        No
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2 min-w-0 pr-1">
                      <svg className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-blue-400" : "text-zinc-500"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                      </svg>
                      <span className="truncate font-medium">{convo.title}</span>
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={(e) => startRename(convo, e)}
                        className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50"
                        title="Rename"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
                      </button>
                      <button
                        onClick={(e) => startDelete(convo.id, e)}
                        className="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-700/50"
                        title="Delete"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Sidebar Footer Info */}
      <div className="p-3 border-t border-slate-200 dark:border-[#27272a] text-[11px] text-zinc-500 flex items-center justify-between">
        <span>{conversations.length} conversation{conversations.length !== 1 ? 's' : ''}</span>
        <span className="capitalize font-mono">{mode} Mode</span>
      </div>
    </div>
  );

  return (
    <div className={`h-full flex overflow-hidden ${
      theme === "dark" ? "bg-[#09090b] text-[#f4f4f5]" : "bg-[#ffffff] text-[#0f172a]"
    }`}>
      {/* Mobile Drawer Overlay */}
      {mobileDrawerOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-30 md:hidden"
          onClick={() => setMobileDrawerOpen(false)}
        />
      )}

      {/* Mobile Drawer */}
      <div className={`
        fixed inset-y-0 left-0 z-40 w-72 md:hidden transform transition-transform duration-200 ease-in-out
        ${theme === "dark" ? "bg-[#121215] border-r border-[#27272a]" : "bg-[#f8fafc] border-r border-slate-200"}
        ${mobileDrawerOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        {renderSidebarContent()}
      </div>

      {/* Desktop Collapsible Conversation Sidebar */}
      {!sidebarCollapsed && (
        <div className={`
          hidden md:flex flex-col w-64 lg:w-72 shrink-0 border-r
          ${theme === "dark" ? "bg-[#0e0e11] border-[#27272a]" : "bg-[#f8fafc] border-slate-200"}
        `}>
          {renderSidebarContent()}
        </div>
      )}

      {/* Main AI Tutor Workspace */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative">
        {/* Workspace Sub-header */}
        <div className={`
          h-12 px-4 shrink-0 flex items-center justify-between border-b text-xs
          ${theme === "dark" ? "bg-[#0c0c0e] border-[#27272a]" : "bg-white border-slate-200"}
        `}>
          {/* Left: Sidebar toggle + Active chat title */}
          <div className="flex items-center gap-2.5 min-w-0">
            {/* Mobile drawer toggle */}
            <button
              onClick={() => setMobileDrawerOpen(true)}
              className="md:hidden p-1.5 rounded text-zinc-400 hover:text-white hover:bg-zinc-800"
              title="Conversations"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
            </button>

            {/* Desktop collapse toggle */}
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="hidden md:flex p-1.5 rounded text-zinc-400 hover:text-white hover:bg-zinc-800"
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="9" y1="3" x2="9" y2="21"></line>
              </svg>
            </button>

            <span className="font-semibold truncate max-w-[200px] md:max-w-xs text-slate-900 dark:text-zinc-100">
              {activeConvo?.title}
            </span>

            <span className="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300 border border-slate-300 dark:border-zinc-700">
              {mode}
            </span>
          </div>

          {/* Right: Learning Mode Switcher + Clear Chat */}
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-100 dark:bg-zinc-900 border border-slate-300 dark:border-[#27272a] rounded p-0.5">
              {[
                { id: "explain", label: "Explain" },
                { id: "practice", label: "Practice" },
                { id: "smart", label: "Smart" }
              ].map(m => (
                <button
                  key={m.id}
                  onClick={() => setMode(m.id)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium transition capitalize ${
                    mode === m.id
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white"
                  }`}
                  title={`${m.label} mode`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <button
              onClick={handleClearChat}
              className="p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
              title="Clear messages in chat"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>

        {/* Conversation Stream */}
        <div ref={chatContainerRef} className="flex-1 overflow-y-auto px-4 py-6">
          {(!activeConvo?.messages || activeConvo.messages.length === 0) ? (
            /* Claude / ChatGPT inspired Welcome Screen */
            <div className="max-w-2xl mx-auto py-10 md:py-16 text-center select-none">
              <div className="w-12 h-12 rounded-xl bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-500 mb-4 mx-auto">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path>
                </svg>
              </div>

              <h2 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900 dark:text-zinc-100 mb-2">
                What would you like to learn today?
              </h2>
              <p className="text-sm text-slate-600 dark:text-zinc-400 max-w-lg mx-auto mb-8 leading-relaxed">
                I am your CodeLoop AI Tutor. Ask any programming question, trace a bug in your code, or choose a topic below to begin.
              </p>

              {/* 4 Suggested Prompt Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
                {SUGGESTED_PROMPTS.map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSend(p.prompt)}
                    className={`p-3.5 rounded-lg border text-left transition group ${
                      theme === "dark"
                        ? "bg-[#121215] border-[#27272a] hover:border-blue-500/50 hover:bg-[#18181b]"
                        : "bg-white border-slate-200 hover:border-blue-400 hover:bg-slate-50 shadow-sm"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-blue-400 font-medium">
                        {p.badge}
                      </span>
                      <svg className="w-3.5 h-3.5 text-zinc-500 group-hover:text-blue-400 group-hover:translate-x-0.5 transition-all" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </div>
                    <div className="font-semibold text-xs text-slate-900 dark:text-zinc-100 mb-1">
                      {p.title}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-zinc-400 line-clamp-2">
                      {p.desc}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Message Feed */
            <div className="max-w-3xl mx-auto w-full space-y-6">
              {activeConvo.messages.map((m, idx) => {
                const isUser = m.role === "user";
                const isLastAssistant = !isUser && idx === activeConvo.messages.length - 1;

                return (
                  <div key={m.id || idx} className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
                    {/* Tutor Avatar */}
                    {!isUser && (
                      <div className="w-8 h-8 rounded-lg bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0 mt-0.5">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="16 18 22 12 16 6"></polyline>
                          <polyline points="8 6 2 12 8 18"></polyline>
                        </svg>
                      </div>
                    )}

                    <div className={`flex flex-col min-w-0 ${isUser ? "items-end max-w-xl" : "items-start max-w-2xl flex-1"}`}>
                      {/* Name & Timestamp */}
                      <div className="flex items-center gap-2 mb-1.5 text-[11px] text-zinc-500 font-mono">
                        <span>{isUser ? (currentUser?.name || "You") : "CodeLoop Tutor"}</span>
                        <span>•</span>
                        <span>{m.timestamp}</span>
                      </div>

                      {/* Message Content */}
                      <div className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
                        isUser
                          ? "bg-blue-600 text-white font-sans whitespace-pre-wrap shadow-sm"
                          : theme === "dark"
                            ? "bg-[#121215] border border-[#27272a] text-zinc-200 prose-dark w-full"
                            : "bg-slate-50 border border-slate-200 text-slate-900 prose-light w-full"
                      }`}>
                        {isUser ? (
                          m.content
                        ) : (
                          <div dangerouslySetInnerHTML={{ __html: renderMarkdownWithPrism(m.content) }} />
                        )}
                      </div>

                      {/* Assistant Bottom Toolbar */}
                      {!isUser && (
                        <div className="flex items-center gap-2 mt-2 select-none">
                          <button
                            onClick={() => copyFullResponse(m.id, m.content)}
                            className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
                            title="Copy full response markdown"
                          >
                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                            <span>{copiedMsgId === m.id ? "Copied!" : "Copy"}</span>
                          </button>

                          {isLastAssistant && !loading && (
                            <button
                              onClick={handleRegenerate}
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
                              title="Regenerate response"
                            >
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="23 4 23 10 17 10"></polyline>
                                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                              </svg>
                              <span>Regenerate</span>
                            </button>
                          )}

                          {voiceEnabled && (
                            <button
                              onClick={() => speakText(m.content)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
                              title="Read aloud"
                            >
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                              </svg>
                              <span>Listen</span>
                            </button>
                          )}
                        </div>
                      )}

                      {/* Educational Quick Action Chips on Latest Assistant Message */}
                      {isLastAssistant && !loading && (
                        <div className="w-full mt-3.5 pt-3 border-t border-slate-200 dark:border-[#27272a]/60">
                          <div className="text-[11px] font-medium text-slate-500 dark:text-zinc-400 mb-2">
                            Explore further with CodeLoop AI:
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {QUICK_ACTION_CHIPS.map((chip, cIdx) => (
                              <button
                                key={cIdx}
                                onClick={() => handleSend(chip.prompt)}
                                className={`px-2.5 py-1 rounded-full text-xs font-medium border transition active:scale-[0.98] ${
                                  theme === "dark"
                                    ? "bg-[#18181b] border-[#27272a] text-zinc-300 hover:border-blue-500/60 hover:text-white hover:bg-zinc-800"
                                    : "bg-white border-slate-200 text-slate-700 hover:border-blue-400 hover:text-blue-600 hover:bg-slate-50"
                                }`}
                              >
                                {chip.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* User Avatar */}
                    {isUser && (
                      <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-xs font-semibold text-zinc-200 shrink-0 mt-0.5">
                        {currentUser?.name ? currentUser.name.charAt(0).toUpperCase() : "U"}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Loading Indicator */}
              {loading && (
                <div className="flex gap-3 items-start">
                  <div className="w-8 h-8 rounded-lg bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-400 shrink-0 mt-0.5">
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeDasharray="60" strokeDashoffset="20"></circle>
                    </svg>
                  </div>
                  <div className={`rounded-xl px-4 py-3 text-xs font-mono border ${
                    theme === "dark" ? "bg-[#121215] border-[#27272a] text-zinc-400" : "bg-slate-50 border-slate-200 text-slate-600"
                  }`}>
                    <span className="inline-flex items-center gap-1.5">
                      <span>CodeLoop Tutor is thinking</span>
                      <span className="inline-flex gap-0.5">
                        <span className="animate-bounce">.</span>
                        <span className="animate-bounce" style={{ animationDelay: '0.2s' }}>.</span>
                        <span className="animate-bounce" style={{ animationDelay: '0.4s' }}>.</span>
                      </span>
                    </span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Message Composer (Bottom Anchored) */}
        <div className={`p-4 shrink-0 border-t ${
          theme === "dark" 
            ? "bg-[#09090b]/90 border-[#27272a] backdrop-blur" 
            : "bg-white/95 border-slate-200 backdrop-blur"
        }`}>
          <div className="max-w-3xl mx-auto w-full">
            <div className={`rounded-xl border transition-colors focus-within:border-blue-500 p-2.5 ${
              theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-300 shadow-sm"
            }`}>
              {/* Auto-expanding Textarea */}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a coding question, paste code to debug, or request practice problems..."
                rows="1"
                className="w-full bg-transparent resize-none text-sm leading-relaxed text-slate-900 dark:text-zinc-100 placeholder-zinc-500 focus:outline-none min-h-[44px] max-h-[180px] p-1 font-sans"
              />

              {/* Composer Controls */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-[#27272a]/60">
                {/* Left: Mode Pills & Voice Mic */}
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    {["explain", "practice", "smart"].map(m => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        className={`px-2 py-0.5 rounded text-[11px] font-mono capitalize transition ${
                          mode === m
                            ? "bg-slate-200 dark:bg-zinc-800 text-blue-600 dark:text-blue-400 font-medium"
                            : "text-zinc-500 hover:text-zinc-300"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>

                  <span className="text-zinc-600">|</span>

                  <button
                    type="button"
                    onClick={startVoiceInput}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono transition ${
                      isRecording
                        ? "bg-red-950 text-red-300 border border-red-700 animate-pulse"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                    }`}
                    title="Voice speech-to-text"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                      <line x1="12" y1="19" x2="12" y2="23"></line>
                      <line x1="8" y1="23" x2="16" y2="23"></line>
                    </svg>
                    <span>{isRecording ? "Listening..." : "Voice"}</span>
                  </button>
                </div>

                {/* Right: Send Button */}
                <button
                  type="button"
                  onClick={() => handleSend()}
                  disabled={!input.trim() || loading}
                  className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white transition active:scale-95 shadow-sm"
                  title="Send message (Enter)"
                >
                  {loading ? (
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeDasharray="60" strokeDashoffset="20"></circle>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="19" x2="12" y2="5"></line>
                      <polyline points="5 12 12 5 19 12"></polyline>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="text-[11px] text-slate-500 dark:text-zinc-500 text-center mt-2">
              Press <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono text-[10px]">Enter</kbd> to send, <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono text-[10px]">Shift+Enter</kbd> for newline • CodeLoop AI Tutor
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------- CODE EDITOR VIEW -----------------
function CodeEditorView({ currentUser, theme, showToast, initialCode, initialLanguage, askTutor }) {
  const [language, setLanguage] = useState(initialLanguage || "python");
  const [code, setCode] = useState(initialCode || `# CodeLoop Workspace\ndef solution():\n    numbers = [1, 2, 3, 4, 5]\n    print("Total sum:", sum(numbers))\n\nsolution()\n`);

  useEffect(() => {
    if (initialCode !== undefined && initialCode !== null) {
      setCode(initialCode);
    }
    if (initialLanguage) {
      setLanguage(initialLanguage);
    }
  }, [initialCode, initialLanguage]);

  const [stdin, setStdin] = useState("");
  const [output, setOutput] = useState(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [programTitle, setProgramTitle] = useState("main");
  const [savedPrograms, setSavedPrograms] = useState([]);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [splitLayout, setSplitLayout] = useState(() => {
    return localStorage.getItem("codeloop_editor_split") !== "false";
  });

  const toggleLayout = () => {
    setSplitLayout(prev => {
      const next = !prev;
      localStorage.setItem("codeloop_editor_split", String(next));
      return next;
    });
  };

  const defaultSnippets = {
    python: `# Python 3 Workspace\ndef main():\n    print("Hello from Python 3!")\n\nif __name__ == "__main__":\n    main()\n`,
    javascript: `// JavaScript Workspace\nfunction main() {\n    console.log("Hello from JavaScript!");\n}\nmain();\n`,
    c: `// C Workspace\n#include <stdio.h>\n\nint main() {\n    printf("Hello from C\\n");\n    return 0;\n}\n`,
    cpp: `// C++ Workspace\n#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello from C++" << endl;\n    return 0;\n}\n`,
    java: `// Java Workspace\npublic class Solution {\n    public static void main(String[] args) {\n        System.out.println("Hello from Java!");\n    }\n}\n`
  };

  const handleLanguageChange = (newLang) => {
    setLanguage(newLang);
    setCode(defaultSnippets[newLang] || "");
  };

  const runCode = async () => {
    setIsExecuting(true);
    const startTime = performance.now();

    // 1. In-browser Python runner with Pyodide (instant zero-latency execution)
    if (language === "python" && typeof loadPyodide !== "undefined") {
      try {
        const py = await getPyodideInstance();
        if (py) {
          let stdoutText = "";
          let stderrText = "";
          py.setStdout({ batched: (msg) => { stdoutText += (stdoutText ? "\n" : "") + msg; } });
          py.setStderr({ batched: (msg) => { stderrText += (stderrText ? "\n" : "") + msg; } });

          // Support interactive & buffered STDIN input for input() calls
          let stdinQueue = (stdin && stdin.trim()) ? stdin.split(/\r?\n/) : [];
          let stdinIdx = 0;

          if (typeof py.setStdin === "function") {
            py.setStdin({
              stdin: () => {
                // Pre-filled inputs from the STDIN field
                if (stdinIdx < stdinQueue.length) {
                  const val = stdinQueue[stdinIdx++];
                  stdoutText += (stdoutText ? "\n" : "") + val;
                  return val + "\n";
                }

                // Interactive browser prompt for interactive code like chatbots
                if (typeof window !== "undefined" && window.prompt) {
                  const recentPrompt = stdoutText.split("\n").filter(Boolean).slice(-2).join("\n") || "Input required";
                  const inputVal = window.prompt(`Program requests input:\n${recentPrompt}\n\n(Enter your response, or click Cancel to finish):`);
                  if (inputVal !== null) {
                    stdoutText += (stdoutText ? "\n" : "") + inputVal;
                    return inputVal + "\n";
                  }
                }

                return null; // EOF
              }
            });
          }

          try {
            await py.runPythonAsync(code);
            const elapsed = Math.max(Math.round(performance.now() - startTime), 1);
            setOutput({
              status: "Success",
              stdout: stdoutText || (stderrText ? "" : "Program completed with no output."),
              stderr: stderrText,
              exit_code: 0,
              execution_time_ms: elapsed,
              engine: "pyodide-wasm"
            });
            apiRequest("/api/execute", "POST", { language, code, stdin }).catch(() => {});
            setIsExecuting(false);
            return;
          } catch (pyErr) {
            const elapsed = Math.max(Math.round(performance.now() - startTime), 1);
            const errStr = pyErr.toString();
            const isInputEnded = errStr.includes("EOFError") || errStr.includes("Errno 29") || errStr.includes("I/O error");

            if (isInputEnded) {
              setOutput({
                status: stdoutText ? "Completed" : "Success",
                stdout: stdoutText ? (stdoutText + "\n\n[Program finished: End of user input]") : "Program completed with no input.",
                stderr: "",
                exit_code: 0,
                execution_time_ms: elapsed,
                tip: "Tip: Program finished when user input was completed. You can provide inputs interactively or pre-fill them in STDIN.",
                engine: "pyodide-wasm"
              });
              apiRequest("/api/execute", "POST", { language, code, stdin }).catch(() => {});
              setIsExecuting(false);
              return;
            }

            // Specific educational diagnostic
            let friendlyTip = "Diagnostic: Check your syntax, indentation, and variable bindings.";
            const lowerErr = errStr.toLowerCase();
            if (lowerErr.includes("indentationerror")) {
              friendlyTip = "Diagnostic: Indentation error. Ensure consistent 4-space indentation across all code blocks.";
            } else if (lowerErr.includes("syntaxerror")) {
              friendlyTip = "Diagnostic: Syntax error. Check for missing colons (:), unclosed quotes, brackets, or parentheses.";
            } else if (lowerErr.includes("nameerror")) {
              friendlyTip = "Diagnostic: Undefined variable or function. Make sure identifiers are spelled correctly and declared before use.";
            } else if (lowerErr.includes("typeerror")) {
              friendlyTip = "Diagnostic: Type mismatch. Incompatible types cannot be combined directly; convert with str(), int(), etc.";
            } else if (lowerErr.includes("indexerror")) {
              friendlyTip = "Diagnostic: List index out of range. Check list boundaries (remember indices start at 0).";
            } else if (lowerErr.includes("zerodivisionerror")) {
              friendlyTip = "Diagnostic: Division by zero. Ensure your divisor is guarded against zero.";
            }

            setOutput({
              status: "Runtime Error",
              stdout: stdoutText,
              stderr: errStr,
              exit_code: 1,
              execution_time_ms: elapsed,
              tip: friendlyTip,
              engine: "pyodide-wasm"
            });
            setIsExecuting(false);
            return;
          }
        }
      } catch (err) {
        // Fallback to server execution
      }
    }

    // 2. In-browser JavaScript Runner
    if (language === "javascript") {
      try {
        const logs = [];
        const originalLog = console.log;
        console.log = (...args) => {
          logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
          originalLog.apply(console, args);
        };

        const fn = new Function(code);
        fn();
        console.log = originalLog;

        const elapsed = Math.max(Math.round(performance.now() - startTime), 1);
        setOutput({
          status: "Success",
          stdout: logs.join('\n') || "Program completed with no output.",
          stderr: "",
          exit_code: 0,
          execution_time_ms: elapsed,
          engine: "in-browser-js"
        });
        apiRequest("/api/execute", "POST", { language, code, stdin }).catch(() => {});
        setIsExecuting(false);
        return;
      } catch (err) {
        const elapsed = Math.max(Math.round(performance.now() - startTime), 1);
        setOutput({
          status: "Runtime Error",
          stdout: "",
          stderr: err.toString(),
          exit_code: 1,
          execution_time_ms: elapsed,
          tip: "Diagnostic: Check syntax and expressions in your JavaScript code.",
          engine: "in-browser-js"
        });
        setIsExecuting(false);
        return;
      }
    }

    // 3. Server-side Multi-Tier Compiler Execution (Judge0 CE -> Wandbox -> Piston)
    try {
      const res = await apiRequest("/api/execute", "POST", {
        language,
        code,
        stdin
      });
      setOutput(res);
    } catch (err) {
      setOutput({
        status: "Error",
        stdout: "",
        stderr: err.message,
        exit_code: -1,
        execution_time_ms: Math.round(performance.now() - startTime)
      });
    } finally {
      setIsExecuting(false);
    }
  };

  const saveProgram = async () => {
    try {
      await apiRequest("/api/programs", "POST", {
        title: programTitle.trim() || "untitled",
        language,
        code
      });
      showToast("Program successfully saved", "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const openLoadModal = async () => {
    try {
      const progs = await apiRequest("/api/programs");
      setSavedPrograms(progs);
      setShowLoadModal(true);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const loadSelectedProgram = (p) => {
    setProgramTitle(p.title);
    setLanguage(p.language);
    setCode(p.code);
    setShowLoadModal(false);
    showToast(`Loaded ${p.title}`, "info");
  };

  const askTutorAboutEditorCode = () => {
    if (!askTutor) return;
    const prompt = `Here is my current ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\`\n\nCould you review this code, explain its logic step by step, and suggest any optimizations or edge cases I should consider?`;
    askTutor(prompt, "explain");
  };

  const askTutorToFixError = () => {
    if (!askTutor || !output) return;
    const prompt = `My ${language} code generated the following execution error:\n\n\`\`\`\n${output.stderr || output.stdout || "Execution failed"}\n\`\`\`\n\nHere is my source code:\n\n\`\`\`${language}\n${code}\n\`\`\`\n\nPlease explain why this error happened and how I can fix it step by step.`;
    askTutor(prompt, "explain");
  };

  return (
    <div className="space-y-3">
      {/* Top Action Toolbar */}
      <div className={`p-3 rounded-xl border shadow-sm flex flex-wrap items-center justify-between gap-3 ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        {/* Left: Program Title, Language Selector, File Management */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <svg className="w-4 h-4 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
            <input
              type="text"
              value={programTitle}
              onChange={(e) => setProgramTitle(e.target.value)}
              placeholder="Filename"
              className={`border rounded-md px-2.5 py-1 text-xs font-mono w-36 focus:outline-none focus:border-blue-500 transition ${
                theme === "dark" 
                  ? "bg-[#18181b] border-[#27272a] text-zinc-100" 
                  : "bg-slate-50 border-slate-300 text-slate-900"
              }`}
            />
          </div>

          <select
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className={`border rounded-md px-2.5 py-1 text-xs font-mono focus:outline-none focus:border-blue-500 transition ${
              theme === "dark" 
                ? "bg-[#18181b] border-[#27272a] text-zinc-200" 
                : "bg-slate-50 border-slate-300 text-slate-900"
            }`}
          >
            <option value="python">Python 3</option>
            <option value="javascript">JavaScript</option>
            <option value="c">C (GCC)</option>
            <option value="cpp">C++ (G++)</option>
            <option value="java">Java (OpenJDK)</option>
          </select>

          <div className="flex items-center gap-1">
            <button
              onClick={saveProgram}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono border transition ${
                theme === "dark"
                  ? "bg-[#18181b] hover:bg-zinc-800 text-zinc-200 border-[#27272a]"
                  : "bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-300"
              }`}
              title="Save program"
            >
              <svg className="w-3.5 h-3.5 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
              <span>Save</span>
            </button>

            <button
              onClick={openLoadModal}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono border transition ${
                theme === "dark"
                  ? "bg-[#18181b] hover:bg-zinc-800 text-zinc-200 border-[#27272a]"
                  : "bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-300"
              }`}
              title="Load saved programs"
            >
              <svg className="w-3.5 h-3.5 text-zinc-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
              <span>Load</span>
            </button>
          </div>
        </div>

        {/* Right: Layout Toggle, Ask AI Tutor, Run Button */}
        <div className="flex items-center gap-2">
          {/* Split/Stack layout switcher (desktop) */}
          <button
            onClick={toggleLayout}
            className={`hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono border transition ${
              theme === "dark"
                ? "bg-[#18181b] hover:bg-zinc-800 text-zinc-300 border-[#27272a]"
                : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-300"
            }`}
            title="Toggle Split / Stack View Layout"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              {splitLayout ? (
                <>
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="12" y1="3" x2="12" y2="21"></line>
                </>
              ) : (
                <>
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="3" y1="12" x2="21" y2="12"></line>
                </>
              )}
            </svg>
            <span>{splitLayout ? "Split View" : "Stack View"}</span>
          </button>

          {/* Ask AI Tutor */}
          <button
            onClick={askTutorAboutEditorCode}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium border transition ${
              theme === "dark"
                ? "bg-blue-950/40 hover:bg-blue-900/60 text-blue-300 border-blue-800/60"
                : "bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200"
            }`}
            title="Ask AI Tutor to review or explain this code"
          >
            <svg className="w-3.5 h-3.5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>
            <span>Ask Tutor</span>
          </button>

          {/* Primary Run Button */}
          <button
            onClick={runCode}
            disabled={isExecuting}
            className="flex items-center gap-1.5 px-4 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition active:scale-[0.98]"
            title="Execute Code (Ctrl + Enter)"
          >
            {isExecuting ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20"></circle></svg>
                <span>Executing...</span>
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <span>Run</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Editor & Console Area (Split or Stack layout) */}
      <div className={`grid gap-3 ${splitLayout ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1"}`}>
        {/* Editor Box */}
        <div className={`rounded-xl border overflow-hidden shadow-sm flex flex-col ${
          theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
        }`}>
          {/* Editor Header Tab */}
          <div className={`px-3 py-1.5 border-b flex items-center justify-between text-xs font-mono ${
            theme === "dark" ? "bg-[#141418] border-[#27272a] text-zinc-400" : "bg-slate-100 border-slate-200 text-slate-600"
          }`}>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span>
              <span className={`font-semibold ${theme === "dark" ? "text-zinc-200" : "text-slate-800"}`}>
                {programTitle ? `${programTitle}.${language === "python" ? "py" : language === "javascript" ? "js" : language}` : "main"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-zinc-500">
              <span className="uppercase">{language}</span>
              <span>•</span>
              <span>UTF-8</span>
            </div>
          </div>

          <MonacoEditor
            code={code}
            language={language}
            onChange={setCode}
            height={splitLayout ? "540px" : "440px"}
            theme={theme}
          />
        </div>

        {/* Output Console Box */}
        <div className={`rounded-xl border overflow-hidden shadow-sm flex flex-col ${
          theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
        }`}>
          {/* Console Header */}
          <div className={`px-3.5 py-1.5 border-b flex items-center justify-between text-xs font-mono ${
            theme === "dark" ? "bg-[#141418] border-[#27272a]" : "bg-slate-100 border-slate-200"
          }`}>
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className={`font-semibold ${theme === "dark" ? "text-zinc-200" : "text-slate-800"}`}>
                Console & Terminal
              </span>
            </div>

            <div className="flex items-center gap-2">
              {output && (
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-medium ${
                  output.status === "Success" 
                    ? "bg-emerald-950/80 text-emerald-300 border border-emerald-800" 
                    : "bg-red-950/80 text-red-300 border border-red-800"
                }`}>
                  {output.status} ({output.execution_time_ms || 0}ms)
                </span>
              )}
              <button
                onClick={() => { setOutput(null); setStdin(""); }}
                className="text-[11px] font-mono text-zinc-500 hover:text-zinc-300 transition"
                title="Clear console"
              >
                Clear
              </button>
            </div>
          </div>

          <div className={`p-3 font-mono text-xs flex flex-col flex-1 ${
            splitLayout ? "min-h-[480px]" : "min-h-[160px]"
          } ${theme === "dark" ? "bg-[#0c0c0e] text-zinc-100" : "bg-slate-900 text-slate-100"}`}>
            {/* Integrated STDIN Input bar */}
            <div className="flex items-center gap-2 pb-2.5 border-b border-zinc-800/80 mb-2.5">
              <span className="text-zinc-400 font-mono text-xs select-none">STDIN:</span>
              <input
                type="text"
                value={stdin}
                onChange={(e) => setStdin(e.target.value)}
                placeholder="Optional inputs for program (e.g. 10 20)... or enter interactively when prompted"
                className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500 transition"
              />
            </div>

            {/* Terminal Stream */}
            <div className="flex-1 overflow-y-auto space-y-2">
              {output ? (
                <div>
                  {output.stdout && (
                    <pre className="text-emerald-400 whitespace-pre-wrap leading-relaxed">{output.stdout}</pre>
                  )}
                  {output.stderr && (
                    <div className="mt-2 p-2.5 rounded bg-red-950/50 border border-red-800/80 text-red-300">
                      <pre className="whitespace-pre-wrap">{output.stderr}</pre>
                    </div>
                  )}
                  {output.tip && (
                    <div className="mt-2 p-2 border border-blue-900/50 bg-blue-950/30 text-blue-200 text-xs rounded">
                      {output.tip}
                    </div>
                  )}

                  {/* Deep Integration: Explain & Fix Error with AI Tutor */}
                  {output.stderr && (
                    <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3 select-none">
                      <div className="flex items-center gap-2 text-xs text-amber-300">
                        <svg className="w-4 h-4 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                        <span>Need help understanding this error? Ask the AI Tutor.</span>
                      </div>
                      <button
                        onClick={askTutorToFixError}
                        className="px-3 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium shrink-0 flex items-center gap-1.5 shadow-sm transition active:scale-95"
                      >
                        <span>Diagnose Error</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-zinc-500 select-none py-2">
                  Console ready. Click "Run" or press Ctrl+Enter to compile and execute.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Program Loader Modal */}
      {showLoadModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className={`border rounded-xl w-full max-w-md p-4 space-y-3 shadow-xl ${
            theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
          }`}>
            <div className="flex items-center justify-between border-b pb-2">
              <span className={`font-semibold text-xs font-mono uppercase ${theme === "dark" ? "text-zinc-200" : "text-slate-800"}`}>
                Load Saved Program
              </span>
              <button onClick={() => setShowLoadModal(false)} className="text-zinc-500 hover:text-zinc-700 text-xs">
                Cancel
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {savedPrograms.length === 0 ? (
                <p className="p-4 text-center text-xs text-zinc-500">No saved programs found.</p>
              ) : (
                savedPrograms.map(p => (
                  <div
                    key={p.id}
                    onClick={() => loadSelectedProgram(p)}
                    className={`p-2.5 rounded-lg border cursor-pointer flex items-center justify-between text-xs transition ${
                      theme === "dark"
                        ? "bg-[#18181b] border-[#27272a] hover:bg-zinc-800 text-zinc-200"
                        : "bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-800"
                    }`}
                  >
                    <span className="font-mono font-medium">{p.title}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded uppercase bg-slate-200 dark:bg-zinc-800 text-slate-700 dark:text-zinc-400 font-semibold">
                      {p.language}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------- PRACTICE ZONE VIEW -----------------
function PracticeZoneView({ currentUser, theme, showToast, askTutor }) {
  const [problems, setProblems] = useState([]);
  const [selectedProblem, setSelectedProblem] = useState(null);
  const [filterDifficulty, setFilterDifficulty] = useState("all");
  const [language, setLanguage] = useState("python");
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submissionResult, setSubmissionResult] = useState(null);
  const [currentHintLevel, setCurrentHintLevel] = useState(0);
  const [revealedHints, setRevealedHints] = useState({});

  useEffect(() => {
    fetchProblems();
  }, []);

  const fetchProblems = async () => {
    try {
      const data = await apiRequest("/api/practice/problems");
      setProblems(data);
      if (data.length > 0) {
        loadProblem(data[0].id);
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const loadProblem = async (problemId) => {
    try {
      const data = await apiRequest(`/api/practice/problems/${problemId}`);
      setSelectedProblem(data);
      const starter = data.starter_codes?.[language] || data.starter_codes?.python || "";
      setCode(starter);
      setSubmissionResult(null);
      setCurrentHintLevel(0);
      setRevealedHints({});
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const requestNextHint = async () => {
    if (!selectedProblem) return;
    const nextLevel = currentHintLevel + 1;
    if (nextLevel > selectedProblem.total_hints) return;

    try {
      const res = await apiRequest(`/api/practice/problems/${selectedProblem.id}/hint/${nextLevel}`);
      setRevealedHints(prev => ({ ...prev, [nextLevel]: res.content }));
      setCurrentHintLevel(nextLevel);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const askTutorForConceptualHint = () => {
    if (!askTutor || !selectedProblem) return;
    const prompt = `I am practicing the coding problem "${selectedProblem.title}" in Python:\n\n${selectedProblem.description}\n\nCould you give me a conceptual hint or mental model on how to solve this, without giving away the full code solution?`;
    askTutor(prompt, "practice");
  };

  const submitSolution = async () => {
    if (!selectedProblem || submitting) return;
    setSubmitting(true);
    setSubmissionResult(null);
    try {
      const res = await apiRequest("/api/practice/submit", "POST", {
        problem_id: selectedProblem.id,
        language,
        code
      });
      setSubmissionResult(res);
      if (res.status === "Accepted") {
        setProblems(prev => prev.map(p => p.id === selectedProblem.id ? { ...p, solved: true } : p));
        showToast("Problem Solved! Accepted.", "success");
      }
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredProblems = useMemo(() => {
    if (filterDifficulty === "all") return problems;
    return problems.filter(p => p.difficulty.toLowerCase() === filterDifficulty.toLowerCase());
  }, [problems, filterDifficulty]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Problem Directory Sidebar */}
      <div className={`lg:col-span-4 rounded-xl border p-3 flex flex-col h-[740px] shadow-sm ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <div className={`flex items-center justify-between pb-2 border-b ${
          theme === "dark" ? "border-[#27272a]" : "border-slate-200"
        }`}>
          <span className={`font-mono text-xs font-semibold uppercase ${
            theme === "dark" ? "text-zinc-100" : "text-slate-900"
          }`}>
            Challenges
          </span>
          <span className="text-[11px] font-mono text-emerald-500 font-semibold">
            {problems.filter(p => p.solved).length}/{problems.length} Solved
          </span>
        </div>

        {/* Difficulty Filter Pills */}
        <div className="flex gap-1 my-2.5">
          {["all", "beginner", "intermediate", "advanced"].map(d => (
            <button
              key={d}
              onClick={() => setFilterDifficulty(d)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono capitalize transition ${
                filterDifficulty === d 
                  ? "bg-blue-600 text-white font-medium shadow-sm" 
                  : theme === "dark"
                  ? "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        {/* Problem List */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {filteredProblems.map(p => {
            const isSelected = selectedProblem?.id === p.id;
            return (
              <div
                key={p.id}
                onClick={() => loadProblem(p.id)}
                className={`p-3 rounded-lg border cursor-pointer text-xs transition ${
                  isSelected
                    ? theme === "dark"
                      ? "bg-zinc-800/90 border-blue-500/60 text-white shadow-sm"
                      : "bg-blue-50/80 border-blue-300 text-blue-950 font-medium shadow-sm"
                    : theme === "dark"
                      ? "bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-zinc-800/60"
                      : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between font-mono text-[10px] text-zinc-500 mb-1">
                  <span className="uppercase font-semibold tracking-wider">{p.difficulty}</span>
                  {p.solved ? (
                    <span className="text-emerald-500 font-bold flex items-center gap-1">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      SOLVED
                    </span>
                  ) : (
                    <span className="text-zinc-400 font-mono">10 pts</span>
                  )}
                </div>
                <div className="font-semibold truncate text-xs">{p.title}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Problem Workspace */}
      <div className="lg:col-span-8 space-y-3">
        {selectedProblem && (
          <>
            {/* Description Card */}
            <div className={`p-4 rounded-xl border space-y-3 shadow-sm ${
              theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className={`text-base font-bold tracking-tight ${
                  theme === "dark" ? "text-zinc-100" : "text-slate-900"
                }`}>
                  {selectedProblem.title}
                </h3>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">
                    {selectedProblem.topic}
                  </span>
                  <button
                    onClick={askTutorForConceptualHint}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border transition ${
                      theme === "dark"
                        ? "bg-blue-950/40 text-blue-300 border-blue-800 hover:bg-blue-900/60"
                        : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                    }`}
                    title="Ask AI Tutor for a guided hint"
                  >
                    <svg className="w-3.5 h-3.5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    <span>Ask Tutor Hint</span>
                  </button>
                </div>
              </div>

              <p className={`text-xs leading-relaxed ${
                theme === "dark" ? "text-zinc-300" : "text-slate-700"
              }`}>
                {selectedProblem.description}
              </p>

              {/* Input / Output Format Specifications */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs font-mono">
                <div className={`p-2.5 rounded-lg border ${
                  theme === "dark" ? "bg-[#18181b] border-[#27272a]" : "bg-slate-50 border-slate-200"
                }`}>
                  <span className="text-zinc-500 dark:text-zinc-400 block text-[10px] uppercase font-semibold mb-0.5">Input Format</span>
                  <span className={theme === "dark" ? "text-zinc-200" : "text-slate-800"}>{selectedProblem.input_format}</span>
                </div>
                <div className={`p-2.5 rounded-lg border ${
                  theme === "dark" ? "bg-[#18181b] border-[#27272a]" : "bg-slate-50 border-slate-200"
                }`}>
                  <span className="text-zinc-500 dark:text-zinc-400 block text-[10px] uppercase font-semibold mb-0.5">Output Format</span>
                  <span className={theme === "dark" ? "text-zinc-200" : "text-slate-800"}>{selectedProblem.output_format}</span>
                </div>
              </div>
            </div>

            {/* Hint System */}
            <div className={`p-3.5 rounded-xl border shadow-sm ${
              theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
            }`}>
              <div className="flex items-center justify-between">
                <span className={`text-xs font-mono font-medium ${
                  theme === "dark" ? "text-zinc-400" : "text-slate-600"
                }`}>
                  Hint Tier: {currentHintLevel}/{selectedProblem.total_hints}
                </span>
                <button
                  onClick={requestNextHint}
                  disabled={currentHintLevel >= selectedProblem.total_hints}
                  className={`px-3 py-1 rounded-md text-xs font-mono border transition disabled:opacity-40 ${
                    theme === "dark"
                      ? "bg-[#18181b] hover:bg-zinc-800 text-zinc-300 border-[#27272a]"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300"
                  }`}
                >
                  {currentHintLevel === 0 ? "Unlock Hint 1" : currentHintLevel === selectedProblem.total_hints - 1 ? "Show Full Solution" : "Unlock Next Hint"}
                </button>
              </div>

              {Object.keys(revealedHints).length > 0 && (
                <div className={`space-y-1.5 pt-2.5 mt-2.5 border-t ${theme === "dark" ? "border-[#27272a]" : "border-slate-200"}`}>
                  {Object.entries(revealedHints).map(([lvl, text]) => (
                    <div key={lvl} className={`p-2.5 rounded-lg border text-xs font-mono leading-relaxed whitespace-pre-wrap ${
                      theme === "dark" ? "bg-[#09090b] border-[#27272a] text-zinc-300" : "bg-slate-50 border-slate-200 text-slate-800"
                    }`}>
                      <span className="text-blue-500 font-bold block mb-0.5">Hint {lvl}:</span>
                      {text}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Submission Code Editor */}
            <div className={`rounded-xl border overflow-hidden shadow-sm ${
              theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
            }`}>
              <div className={`p-2.5 border-b flex items-center justify-between ${
                theme === "dark" ? "bg-[#141418] border-[#27272a]" : "bg-slate-100 border-slate-200"
              }`}>
                <div className="flex items-center gap-2">
                  <select
                    value={language}
                    onChange={(e) => {
                      setLanguage(e.target.value);
                      if (selectedProblem.starter_codes?.[e.target.value]) {
                        setCode(selectedProblem.starter_codes[e.target.value]);
                      }
                    }}
                    className={`border rounded-md px-2.5 py-1 text-xs font-mono ${
                      theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-200" : "bg-white border-slate-300 text-slate-900"
                    }`}
                  >
                    <option value="python">Python 3</option>
                    <option value="javascript">JavaScript</option>
                    <option value="c">C</option>
                    <option value="cpp">C++</option>
                    <option value="java">Java</option>
                  </select>
                </div>

                <button
                  onClick={submitSolution}
                  disabled={submitting}
                  className="px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition active:scale-[0.98]"
                >
                  {submitting ? "Evaluating..." : "Submit Solution"}
                </button>
              </div>

              <MonacoEditor
                code={code}
                language={language}
                onChange={setCode}
                height="320px"
                theme={theme}
              />
            </div>

            {/* Submission Evaluation Result */}
            {submissionResult && (
              <div className={`p-4 rounded-xl border text-xs font-mono shadow-sm ${
                submissionResult.status === "Accepted"
                  ? "bg-emerald-950/40 border-emerald-800 text-emerald-200"
                  : "bg-red-950/40 border-red-800 text-red-200"
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm">
                    {submissionResult.status === "Accepted" ? "Verdict: Accepted (All Tests Passed!)" : "Verdict: Failed Test Cases"}
                  </span>
                  <span>{submissionResult.passed_tests}/{submissionResult.total_tests} Tests Passed</span>
                </div>
                {submissionResult.explanation && (
                  <p className="text-xs opacity-90">{submissionResult.explanation}</p>
                )}
                {submissionResult.error && (
                  <pre className="mt-2 p-2 rounded bg-red-950/60 text-red-300 whitespace-pre-wrap">{submissionResult.error}</pre>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ----------------- QUIZZES VIEW -----------------
function QuizzesView({ currentUser, theme, showToast }) {
  const [topic, setTopic] = useState("Python Basics");
  const [language, setLanguage] = useState("Python");
  const [difficulty, setDifficulty] = useState("Beginner");
  const [quizState, setQuizState] = useState("idle");
  const [questions, setQuestions] = useState([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [quizResult, setQuizResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const startQuiz = async () => {
    setLoading(true);
    try {
      const data = await apiRequest("/api/quizzes/generate", "POST", {
        topic,
        language,
        difficulty
      });
      setQuestions(data.questions);
      setSelectedAnswers({});
      setCurrentQIndex(0);
      setQuizState("running");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectOption = (optIndex) => {
    const qid = String(questions[currentQIndex].id);
    setSelectedAnswers(prev => ({ ...prev, [qid]: optIndex }));
  };

  const submitQuiz = async () => {
    setLoading(true);
    try {
      const res = await apiRequest("/api/quizzes/submit", "POST", {
        topic,
        language,
        difficulty,
        questions,
        answers: selectedAnswers
      });
      setQuizResult(res);
      setQuizState("result");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {quizState === "idle" && (
        <div className={`p-6 rounded-xl border shadow-sm space-y-4 ${
          theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
        }`}>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">
                ASSESSMENT GENERATOR
              </span>
            </div>
            <h3 className={`text-base font-bold tracking-tight ${theme === "dark" ? "text-zinc-100" : "text-slate-900"}`}>
              Custom Interactive Knowledge Quiz
            </h3>
            <p className={`text-xs mt-1 ${theme === "dark" ? "text-zinc-400" : "text-slate-600"}`}>
              Generate dynamic programming multiple-choice evaluation tests based on parameter bounds.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={`text-xs font-medium block mb-1 ${theme === "dark" ? "text-zinc-400" : "text-slate-700"}`}>Topic</label>
              <select
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className={`w-full border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500 transition ${
                  theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-200" : "bg-slate-50 border-slate-300 text-slate-900"
                }`}
              >
                <option value="Python Basics">Python Basics</option>
                <option value="Loops & Iteration">Loops & Iteration</option>
                <option value="Functions & Scope">Functions & Scope</option>
                <option value="Arrays & Lists">Arrays & Lists</option>
              </select>
            </div>

            <div>
              <label className={`text-xs font-medium block mb-1 ${theme === "dark" ? "text-zinc-400" : "text-slate-700"}`}>Language</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className={`w-full border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500 transition ${
                  theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-200" : "bg-slate-50 border-slate-300 text-slate-900"
                }`}
              >
                <option value="Python">Python</option>
                <option value="JavaScript">JavaScript</option>
                <option value="C++">C++</option>
                <option value="Java">Java</option>
              </select>
            </div>

            <div>
              <label className={`text-xs font-medium block mb-1 ${theme === "dark" ? "text-zinc-400" : "text-slate-700"}`}>Difficulty</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className={`w-full border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500 transition ${
                  theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-200" : "bg-slate-50 border-slate-300 text-slate-900"
                }`}
              >
                <option value="Beginner">Beginner</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Advanced">Advanced</option>
              </select>
            </div>
          </div>

          <button
            onClick={startQuiz}
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition active:scale-[0.99] flex items-center justify-center gap-2"
          >
            {loading ? "Generating Questions..." : "Generate Assessment"}
          </button>
        </div>
      )}

      {quizState === "running" && questions.length > 0 && (
        <div className={`p-6 rounded-xl border shadow-sm space-y-4 ${
          theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
        }`}>
          <div className={`flex items-center justify-between text-xs font-mono pb-3 border-b ${
            theme === "dark" ? "border-[#27272a] text-zinc-400" : "border-slate-200 text-slate-600"
          }`}>
            <span>Question {currentQIndex + 1} of {questions.length}</span>
            <span className="font-semibold text-blue-600 dark:text-blue-400">{topic} • {difficulty}</span>
          </div>

          <div className="py-2">
            <h4 className={`text-base font-semibold leading-relaxed ${
              theme === "dark" ? "text-zinc-100" : "text-slate-900"
            }`}>
              {questions[currentQIndex]?.question}
            </h4>
          </div>

          <div className="space-y-2 pt-1">
            {questions[currentQIndex]?.options?.map((opt, optIdx) => {
              const qid = String(questions[currentQIndex].id);
              const isSelected = selectedAnswers[qid] === optIdx;

              return (
                <div
                  key={optIdx}
                  onClick={() => handleSelectOption(optIdx)}
                  className={`p-3.5 rounded-lg border cursor-pointer text-xs transition flex items-center gap-3 ${
                    isSelected
                      ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                      : theme === "dark"
                      ? "bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-zinc-800"
                      : "bg-slate-50 border-slate-200 text-slate-800 hover:bg-slate-100"
                  }`}
                >
                  <span className={`w-5 h-5 rounded-full border flex items-center justify-center text-[10px] font-mono shrink-0 ${
                    isSelected ? "border-white bg-white text-blue-600 font-bold" : "border-zinc-400"
                  }`}>
                    {String.fromCharCode(65 + optIdx)}
                  </span>
                  <span className="font-medium leading-relaxed">{opt}</span>
                </div>
              );
            })}
          </div>

          <div className={`flex items-center justify-between pt-4 border-t ${
            theme === "dark" ? "border-[#27272a]" : "border-slate-200"
          }`}>
            <button
              onClick={() => setCurrentQIndex(prev => Math.max(0, prev - 1))}
              disabled={currentQIndex === 0}
              className={`px-3.5 py-1.5 rounded-md text-xs font-mono border transition disabled:opacity-30 ${
                theme === "dark"
                  ? "bg-[#18181b] text-zinc-300 border-[#27272a] hover:bg-zinc-800"
                  : "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200"
              }`}
            >
              Previous
            </button>

            {currentQIndex < questions.length - 1 ? (
              <button
                onClick={() => setCurrentQIndex(prev => prev + 1)}
                className="px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition"
              >
                Next Question
              </button>
            ) : (
              <button
                onClick={submitQuiz}
                disabled={loading}
                className="px-5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-sm transition"
              >
                Submit Answers
              </button>
            )}
          </div>
        </div>
      )}

      {quizState === "result" && quizResult && (
        <div className={`p-6 rounded-xl border space-y-4 shadow-sm ${
          theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
        }`}>
          <div className={`pb-3 border-b flex items-center justify-between ${
            theme === "dark" ? "border-[#27272a]" : "border-slate-200"
          }`}>
            <div>
              <h3 className={`text-lg font-bold ${theme === "dark" ? "text-zinc-100" : "text-slate-900"}`}>
                Assessment Summary
              </h3>
              <p className="text-xs font-mono text-emerald-500 font-semibold mt-0.5">
                Score: {quizResult.score}/{quizResult.total} ({quizResult.percentage}%)
              </p>
            </div>
            <button
              onClick={() => setQuizState("idle")}
              className="px-3.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium"
            >
              New Quiz
            </button>
          </div>

          <div className="space-y-2.5">
            {quizResult.review?.map((r, i) => (
              <div
                key={i}
                className={`p-3.5 rounded-lg border text-xs space-y-1.5 ${
                  theme === "dark" ? "bg-[#18181b] border-[#27272a]" : "bg-slate-50 border-slate-200"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`font-semibold ${theme === "dark" ? "text-zinc-200" : "text-slate-900"}`}>{r.question}</span>
                  <span className={`font-mono text-[10px] font-bold ${r.is_correct ? "text-emerald-500" : "text-red-500"}`}>
                    {r.is_correct ? "PASSED" : "INCORRECT"}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-500 font-mono">
                  Correct answer: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{r.options[r.correct_choice]}</span>
                </div>
                <p className="text-slate-600 dark:text-zinc-400 text-[11px] leading-relaxed pt-1">{r.explanation}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------- STUDY MATERIALS & RAG VIEW -----------------
function StudyMaterialsView({ currentUser, theme, showToast, askTutor }) {
  const [materials, setMaterials] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [docQuestion, setDocQuestion] = useState("");
  const [docAnswer, setDocAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    fetchMaterials();
  }, []);

  const fetchMaterials = async () => {
    try {
      const data = await apiRequest("/api/materials");
      setMaterials(data);
      if (data.length > 0 && !selectedDoc) {
        setSelectedDoc(data[0]);
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    setUploading(true);
    try {
      const res = await apiRequest("/api/materials/upload", "POST", formData);
      showToast("Document indexed and vectorized successfully.", "success");
      fetchMaterials();
      setSelectedDoc(res);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setUploading(false);
    }
  };

  const queryDocument = async () => {
    if (!selectedDoc || !docQuestion.trim() || asking) return;
    setAsking(true);
    try {
      const res = await apiRequest(`/api/materials/${selectedDoc.id}/query`, "POST", {
        query: docQuestion
      });
      setDocAnswer(res.response);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setAsking(false);
    }
  };

  const askTutorAboutDocument = () => {
    if (!askTutor || !selectedDoc) return;
    const prompt = `I am studying from the document "${selectedDoc.filename}". Here is a summary/excerpt of what it covers:\n\n${(selectedDoc.text_content || "").slice(0, 500)}\n\nCould you create a structured 5-point study guide on this topic with key concepts and practice problems?`;
    askTutor(prompt, "explain");
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Document Library Column */}
      <div className={`lg:col-span-4 rounded-xl border p-3 flex flex-col h-[740px] shadow-sm ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <div className={`flex items-center justify-between pb-2 border-b ${
          theme === "dark" ? "border-[#27272a]" : "border-slate-200"
        }`}>
          <span className={`font-mono text-xs font-semibold uppercase ${
            theme === "dark" ? "text-zinc-100" : "text-slate-900"
          }`}>
            Study Documents
          </span>
          <span className="text-[11px] font-mono text-zinc-400">{materials.length} Files</span>
        </div>

        {/* Upload Dropzone */}
        <div className="my-3">
          <label className={`flex flex-col items-center justify-center p-4 border border-dashed rounded-lg cursor-pointer transition ${
            theme === "dark"
              ? "border-[#27272a] hover:border-zinc-500 bg-[#18181b]/50 text-zinc-400"
              : "border-slate-300 hover:border-blue-400 bg-slate-50 text-slate-600"
          }`}>
            <svg className="w-5 h-5 text-blue-500 mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            <span className="text-xs font-medium">Upload PDF or Text Notes</span>
            <span className="text-[10px] text-zinc-500 mt-0.5">Vector RAG extraction</span>
            <input type="file" onChange={handleFileUpload} accept=".pdf,.txt,.md" className="hidden" />
          </label>
        </div>

        {/* Document List */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {materials.map(doc => {
            const isSelected = selectedDoc?.id === doc.id;
            return (
              <div
                key={doc.id}
                onClick={() => { setSelectedDoc(doc); setDocAnswer(""); }}
                className={`p-3 rounded-lg border cursor-pointer text-xs transition ${
                  isSelected
                    ? theme === "dark"
                      ? "bg-zinc-800 border-zinc-600 text-white"
                      : "bg-blue-50 border-blue-300 text-blue-950 font-medium"
                    : theme === "dark"
                      ? "bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-zinc-800"
                      : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <svg className="w-3.5 h-3.5 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                  <span className="font-semibold truncate">{doc.filename}</span>
                </div>
                <div className="text-[10px] text-zinc-500 font-mono flex items-center justify-between">
                  <span>{doc.total_chunks || 1} Chunks</span>
                  <span>{new Date(doc.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* RAG Query & AI Understanding Workspace */}
      <div className="lg:col-span-8 space-y-3">
        {selectedDoc ? (
          <>
            {/* Document Header & AI Action */}
            <div className={`p-4 rounded-xl border flex flex-wrap items-center justify-between gap-3 shadow-sm ${
              theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
            }`}>
              <div>
                <h3 className={`text-base font-bold ${theme === "dark" ? "text-zinc-100" : "text-slate-900"}`}>
                  {selectedDoc.filename}
                </h3>
                <span className="text-[11px] font-mono text-zinc-500">
                  Total vectors: {selectedDoc.total_chunks || 1} • Knowledge base ready
                </span>
              </div>

              <button
                onClick={askTutorAboutDocument}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium shadow-sm transition active:scale-[0.98]"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>
                <span>Study with AI Tutor</span>
              </button>
            </div>

            {/* Document Excerpt Preview */}
            <div className={`p-4 rounded-xl border shadow-sm max-h-48 overflow-y-auto font-mono text-xs leading-relaxed ${
              theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-300" : "bg-slate-50 border-slate-200 text-slate-800"
            }`}>
              <div className="text-[10px] text-zinc-500 uppercase font-bold mb-1">Extracted Document Text Preview</div>
              {selectedDoc.text_content ? selectedDoc.text_content.slice(0, 1000) : "No text excerpt available."}
            </div>

            {/* Natural Language RAG Q&A */}
            <div className={`p-4 rounded-xl border space-y-3 shadow-sm ${
              theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
            }`}>
              <h4 className={`text-xs font-semibold uppercase tracking-wider font-mono ${
                theme === "dark" ? "text-zinc-200" : "text-slate-800"
              }`}>
                Ask Questions on this Material
              </h4>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={docQuestion}
                  onChange={(e) => setDocQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && queryDocument()}
                  placeholder="e.g. Summarize the key algorithm explained on page 2..."
                  className={`flex-1 border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 transition ${
                    theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-100" : "bg-slate-50 border-slate-300 text-slate-900"
                  }`}
                />
                <button
                  onClick={queryDocument}
                  disabled={!docQuestion.trim() || asking}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition"
                >
                  {asking ? "Searching..." : "Ask PDF"}
                </button>
              </div>

              {docAnswer && (
                <div className={`p-4 rounded-lg border text-xs leading-relaxed ${
                  theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-200" : "bg-slate-50 border-slate-200 text-slate-800"
                }`}>
                  <div dangerouslySetInnerHTML={{ __html: renderMarkdownWithPrism(docAnswer) }} />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className={`p-12 rounded-xl border text-center text-xs ${
            theme === "dark" ? "bg-[#121215] border-[#27272a] text-zinc-500" : "bg-white border-slate-200 text-slate-500"
          }`}>
            Upload a syllabus or reference material to start semantic study sessions.
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------- MY LEARNING & NOTES VIEW -----------------
function MyLearningView({ currentUser, theme, showToast, askTutor }) {
  const [notes, setNotes] = useState([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchNotes();
  }, []);

  const fetchNotes = async () => {
    try {
      const data = await apiRequest("/api/notes");
      setNotes(data);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleCreateNote = async (e) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;

    setLoading(true);
    try {
      await apiRequest("/api/notes", "POST", {
        title,
        content,
        tags: tags.split(",").map(t => t.trim()).filter(Boolean)
      });
      setTitle("");
      setContent("");
      setTags("");
      fetchNotes();
      showToast("Note successfully recorded.", "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteNote = async (noteId) => {
    try {
      await apiRequest(`/api/notes/${noteId}`, "DELETE");
      setNotes(prev => prev.filter(n => n.id !== noteId));
      showToast("Note deleted.", "info");
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const askTutorAboutNote = (note) => {
    if (!askTutor) return;
    const prompt = `Here are my study notes on "${note.title}":\n\n${note.content}\n\nCould you create 3 interactive practice quiz questions to test my retention on this topic?`;
    askTutor(prompt, "practice");
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Create Note Card */}
      <div className={`p-5 rounded-xl border shadow-sm ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">
            STUDENT REVISION JOURNAL
          </span>
        </div>
        <h3 className={`text-base font-bold mb-1 ${theme === "dark" ? "text-zinc-100" : "text-slate-900"}`}>
          Capture Concept Notes
        </h3>
        <p className={`text-xs mb-4 ${theme === "dark" ? "text-zinc-400" : "text-slate-600"}`}>
          Record insights, code patterns, and revision notes during your study sessions.
        </p>

        <form onSubmit={handleCreateNote} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title (e.g. Dynamic Programming Memoization Tips)"
              className={`border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 transition ${
                theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-100" : "bg-slate-50 border-slate-300 text-slate-900"
              }`}
              required
            />
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Tags (e.g. python, dsa, recursion)"
              className={`border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500 transition ${
                theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-100" : "bg-slate-50 border-slate-300 text-slate-900"
              }`}
            />
          </div>

          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write explanations, formulas, or code patterns..."
            rows="3"
            className={`w-full border rounded-lg p-3 text-xs leading-relaxed focus:outline-none focus:border-blue-500 transition ${
              theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-100" : "bg-slate-50 border-slate-300 text-slate-900"
            }`}
            required
          />

          <button
            type="submit"
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-sm transition active:scale-[0.99]"
          >
            Save Note
          </button>
        </form>
      </div>

      {/* Notes Gallery */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs font-mono text-zinc-500 px-1">
          <span>Saved Revision Notes ({notes.length})</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {notes.map(note => (
            <div
              key={note.id}
              className={`p-4 rounded-xl border shadow-sm flex flex-col justify-between transition ${
                theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
              }`}
            >
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h4 className={`text-sm font-bold ${theme === "dark" ? "text-zinc-100" : "text-slate-900"}`}>
                    {note.title}
                  </h4>
                  <button
                    onClick={() => handleDeleteNote(note.id)}
                    className="text-zinc-400 hover:text-red-500 transition p-1"
                    title="Delete Note"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  </button>
                </div>

                <p className={`text-xs leading-relaxed whitespace-pre-wrap mb-3 ${
                  theme === "dark" ? "text-zinc-300" : "text-slate-700"
                }`}>
                  {note.content}
                </p>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-[#27272a] text-[10px] font-mono text-zinc-500">
                <div className="flex gap-1 flex-wrap">
                  {note.tags?.map((t, idx) => (
                    <span key={idx} className="px-1.5 py-0.2 rounded bg-blue-500/10 text-blue-500 font-semibold">
                      #{t}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => askTutorAboutNote(note)}
                  className="text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 font-semibold"
                >
                  <span>Quiz Me</span>
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ----------------- PROGRESS & ANALYTICS VIEW -----------------
function ProgressAnalyticsView({ currentUser, theme, showToast, askTutor }) {
  const [stats, setStats] = useState(null);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [statsData, planData] = await Promise.all([
        apiRequest("/api/dashboard/stats"),
        apiRequest("/api/learning/plan")
      ]);
      setStats(statsData);
      setPlan(planData);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Diagnostics Banner */}
      <div className={`p-5 rounded-xl border shadow-sm ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">
            ADAPTIVE LEARNING DIAGNOSTICS
          </span>
        </div>
        <h3 className={`text-base font-bold mb-1 ${theme === "dark" ? "text-zinc-100" : "text-slate-900"}`}>
          Target Learning Focus: {plan?.current_focus || "Algorithms & Iteration"}
        </h3>
        <p className={`text-xs ${theme === "dark" ? "text-zinc-400" : "text-slate-600"}`}>
          Analysis of your submission telemetry indicates optimal growth in modular structure and recursion.
        </p>
      </div>

      {/* Recommended Sequence Tracks */}
      <div className={`p-5 rounded-xl border shadow-sm ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <h4 className={`text-xs font-semibold uppercase tracking-wider font-mono mb-3 ${
          theme === "dark" ? "text-zinc-200" : "text-slate-800"
        }`}>
          Personalized Growth Trajectory
        </h4>

        <div className="space-y-2">
          {plan?.steps?.map((step, idx) => (
            <div
              key={idx}
              className={`p-3.5 rounded-lg border flex items-center justify-between transition ${
                step.status === "Ready"
                  ? theme === "dark"
                    ? "bg-[#18181b] border-blue-500/50 text-white"
                    : "bg-blue-50/70 border-blue-300 text-blue-950 font-medium"
                  : theme === "dark"
                    ? "bg-[#141417] border-[#27272a] text-zinc-400"
                    : "bg-slate-50 border-slate-200 text-slate-600"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs font-bold w-6 text-zinc-500">0{idx + 1}</span>
                <div>
                  <div className="font-semibold text-xs">{step.name}</div>
                  <div className="text-[11px] text-zinc-500">{step.description}</div>
                </div>
              </div>
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase font-semibold ${
                step.status === "Ready" ? "bg-blue-600 text-white" : "bg-slate-200 dark:bg-zinc-800 text-slate-600 dark:text-zinc-400"
              }`}>
                {step.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Topic Mastery Telemetry */}
      <div className={`p-5 rounded-xl border shadow-sm ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <h4 className={`text-xs font-semibold uppercase tracking-wider font-mono mb-3 ${
          theme === "dark" ? "text-zinc-200" : "text-slate-800"
        }`}>
          Skill Mastery Telemetry
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { topic: "Variables & Standard I/O", progress: 90 },
            { topic: "Conditionals & Logic", progress: 85 },
            { topic: "Loops & Iterators", progress: 75 },
            { topic: "Functions & Scope", progress: 60 },
            { topic: "Arrays & Strings", progress: 45 },
            { topic: "Algorithmic Complexity", progress: 30 },
          ].map((item, idx) => (
            <div
              key={idx}
              className={`p-3 rounded-lg border ${
                theme === "dark" ? "bg-[#18181b] border-[#27272a]" : "bg-slate-50 border-slate-200"
              }`}
            >
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className={`font-semibold ${theme === "dark" ? "text-zinc-200" : "text-slate-800"}`}>{item.topic}</span>
                <span className="font-mono text-[11px] text-blue-500 font-bold">{item.progress}%</span>
              </div>
              <div className="w-full bg-slate-200 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
                <div className="bg-blue-600 h-full rounded-full transition-all" style={{ width: `${item.progress}%` }}></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ----------------- SETTINGS VIEW -----------------
function SettingsView({ currentUser, refreshProfile, theme, toggleTheme, showToast }) {
  const [name, setName] = useState(currentUser.name || "");
  const [learningGoals, setLearningGoals] = useState(currentUser.learning_goals || "");
  const [expLevel, setExpLevel] = useState(currentUser.experience_level || "Beginner");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiRequest("/api/settings/profile", "PUT", {
        name,
        learning_goals: learningGoals,
        experience_level: expLevel
      });
      refreshProfile();
      showToast("Profile settings updated.", "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveApiKey = async (e) => {
    e.preventDefault();
    try {
      await apiRequest("/api/settings/apikey", "POST", { api_key: apiKey.trim() });
      showToast("Custom Gemini API Key saved.", "success");
      setApiKey("");
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Student Profile Settings */}
      <div className={`p-6 rounded-xl border shadow-sm ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 font-semibold">
            ACCOUNT PREFERENCES
          </span>
        </div>
        <h3 className={`text-base font-bold mb-4 ${theme === "dark" ? "text-zinc-100" : "text-slate-900"}`}>
          Student Profile
        </h3>

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <label className={`block text-xs font-medium mb-1 ${theme === "dark" ? "text-zinc-300" : "text-slate-700"}`}>Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 transition ${
                theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-100" : "bg-slate-50 border-slate-300 text-slate-900"
              }`}
            />
          </div>

          <div>
            <label className={`block text-xs font-medium mb-1 ${theme === "dark" ? "text-zinc-300" : "text-slate-700"}`}>Programming Experience</label>
            <select
              value={expLevel}
              onChange={(e) => setExpLevel(e.target.value)}
              className={`w-full border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500 transition ${
                theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-200" : "bg-slate-50 border-slate-300 text-slate-900"
              }`}
            >
              <option value="Beginner">Beginner (New to coding)</option>
              <option value="Intermediate">Intermediate (Familiar with syntax & algorithms)</option>
              <option value="Advanced">Advanced (System architecture & performance)</option>
            </select>
          </div>

          <div>
            <label className={`block text-xs font-medium mb-1 ${theme === "dark" ? "text-zinc-300" : "text-slate-700"}`}>Primary Learning Goals</label>
            <textarea
              value={learningGoals}
              onChange={(e) => setLearningGoals(e.target.value)}
              rows="2"
              className={`w-full border rounded-lg p-3 text-xs leading-relaxed focus:outline-none focus:border-blue-500 transition ${
                theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-100" : "bg-slate-50 border-slate-300 text-slate-900"
              }`}
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition"
          >
            {saving ? "Saving..." : "Save Profile"}
          </button>
        </form>
      </div>

      {/* Custom AI Provider Key */}
      <div className={`p-6 rounded-xl border shadow-sm ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <h3 className={`text-base font-bold mb-1 ${theme === "dark" ? "text-zinc-100" : "text-slate-900"}`}>
          Custom AI Provider Key (Optional)
        </h3>
        <p className={`text-xs mb-4 leading-relaxed ${theme === "dark" ? "text-zinc-400" : "text-slate-600"}`}>
          Provide your own Google Gemini API key to override the built-in system key for higher rate limits.
        </p>

        <form onSubmit={handleSaveApiKey} className="flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="AIzaSy... (Gemini API Key)"
            className={`flex-1 border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500 transition ${
              theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-100" : "bg-slate-50 border-slate-300 text-slate-900"
            }`}
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-medium border border-zinc-700 transition"
          >
            Save Key
          </button>
        </form>
      </div>
    </div>
  );
}

// ----------------- AUTH SCREEN -----------------
function AuthScreen({ setToken, setCurrentUser, theme, toggleTheme }) {
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [experienceLevel, setExperienceLevel] = useState("Beginner");
  const [preferredLangs, setPreferredLangs] = useState(["Python"]);
  const [learningGoals, setLearningGoals] = useState("Master algorithms and learn programming");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "login") {
        const res = await apiRequest("/api/auth/login", "POST", { email, password });
        localStorage.setItem("codeloop_token", res.token);
        setToken(res.token);
        setCurrentUser(res.user);
      } else if (mode === "register") {
        const res = await apiRequest("/api/auth/register", "POST", {
          name,
          email,
          password,
          experience_level: experienceLevel,
          preferred_languages: preferredLangs,
          learning_goals: learningGoals
        });
        localStorage.setItem("codeloop_token", res.token);
        setToken(res.token);
        setCurrentUser(res.user);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex items-center justify-center p-4 transition-colors ${
      theme === "dark" ? "bg-[#09090b] text-[#f4f4f5]" : "bg-[#f8fafc] text-[#0f172a]"
    }`}>
      <div className={`w-full max-w-sm p-6 rounded-2xl border shadow-xl space-y-4 text-xs transition ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        {/* Brand Header */}
        <div className="flex items-center justify-between border-b pb-4 border-slate-200 dark:border-[#27272a]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-blue-600 rounded-md flex items-center justify-center text-white text-xs font-bold shadow-sm">
              C
            </div>
            <div>
              <span className={`font-bold text-base tracking-tight ${theme === "dark" ? "text-white" : "text-slate-900"}`}>
                CodeLoop
              </span>
              <span className="block text-[10px] text-zinc-500 font-mono">STUDENT WORKSPACE</span>
            </div>
          </div>
          <button
            onClick={toggleTheme}
            className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 text-xs"
            title="Toggle Theme"
          >
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-950/40 border border-red-800 text-red-300 text-xs leading-relaxed">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3 pt-1">
          {mode === "register" && (
            <div>
              <label className={`block text-xs font-medium mb-1 ${theme === "dark" ? "text-zinc-300" : "text-slate-700"}`}>
                Full Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Mercer"
                className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 transition ${
                  theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-100" : "bg-slate-50 border-slate-300 text-slate-900"
                }`}
              />
            </div>
          )}

          <div>
            <label className={`block text-xs font-medium mb-1 ${theme === "dark" ? "text-zinc-300" : "text-slate-700"}`}>
              Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@example.com"
              className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 transition ${
                theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-100" : "bg-slate-50 border-slate-300 text-slate-900"
              }`}
            />
          </div>

          <div>
            <label className={`block text-xs font-medium mb-1 ${theme === "dark" ? "text-zinc-300" : "text-slate-700"}`}>
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={`w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 transition ${
                theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-100" : "bg-slate-50 border-slate-300 text-slate-900"
              }`}
            />
          </div>

          {mode === "register" && (
            <div>
              <label className={`block text-xs font-medium mb-1 ${theme === "dark" ? "text-zinc-300" : "text-slate-700"}`}>
                Current Experience
              </label>
              <select
                value={experienceLevel}
                onChange={(e) => setExperienceLevel(e.target.value)}
                className={`w-full border rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:border-blue-500 transition ${
                  theme === "dark" ? "bg-[#18181b] border-[#27272a] text-zinc-200" : "bg-slate-50 border-slate-300 text-slate-900"
                }`}
              >
                <option value="Beginner">Beginner</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Advanced">Advanced</option>
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-xs shadow-sm transition active:scale-[0.99] mt-2"
          >
            {loading ? "Processing..." : mode === "login" ? "Sign In to CodeLoop" : "Create Account"}
          </button>
        </form>

        <div className="pt-2 border-t border-slate-200 dark:border-[#27272a] text-center">
          <button
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            {mode === "login" ? "Need an account? Register" : "Already have an account? Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Mount React Root
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
