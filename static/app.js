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
  const [token, setToken] = useState(localStorage.getItem("codeloop_token") || "");
  const [currentUser, setCurrentUser] = useState(null);
  const [theme, setTheme] = useState(localStorage.getItem("codeloop_theme") || "dark");
  const [activeTab, setActiveTab] = useState("dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [toast, setToast] = useState(null);
  const [editorInitialCode, setEditorInitialCode] = useState(null);
  const [editorInitialLanguage, setEditorInitialLanguage] = useState(null);

  const openInEditor = (code, language = "python") => {
    setEditorInitialCode(code);
    setEditorInitialLanguage(language);
    setActiveTab("editor");
    showToast("Loaded snippet into Code Editor!", "info");
  };

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
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
        <div className={`fixed top-4 right-4 z-50 px-3.5 py-2 rounded text-xs font-medium border ${
          toast.type === "error" 
            ? "bg-red-950/90 text-red-200 border-red-800" 
            : toast.type === "info"
            ? "bg-zinc-900 text-zinc-200 border-zinc-700"
            : "bg-emerald-950/90 text-emerald-200 border-emerald-800"
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
          {activeTab === "dashboard" && <DashboardView currentUser={currentUser} setActiveTab={setActiveTab} showToast={showToast} theme={theme} />}
          {activeTab === "tutor" && <AITutorView currentUser={currentUser} theme={theme} voiceEnabled={voiceEnabled} showToast={showToast} openInEditor={openInEditor} />}
          {activeTab === "editor" && <CodeEditorView currentUser={currentUser} theme={theme} showToast={showToast} initialCode={editorInitialCode} initialLanguage={editorInitialLanguage} />}
          {activeTab === "practice" && <PracticeZoneView currentUser={currentUser} theme={theme} showToast={showToast} />}
          {activeTab === "mylearning" && <MyLearningView currentUser={currentUser} theme={theme} showToast={showToast} />}
          {activeTab === "materials" && <StudyMaterialsView currentUser={currentUser} theme={theme} showToast={showToast} />}
          {activeTab === "quizzes" && <QuizzesView currentUser={currentUser} theme={theme} showToast={showToast} />}
          {activeTab === "analytics" && <ProgressAnalyticsView currentUser={currentUser} theme={theme} showToast={showToast} />}
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
        <svg className="w-4 h-4 mr-2.5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      )
    },
    { 
      id: "editor", 
      label: "Code Editor",
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
      `}>
        {/* Brand Header */}
        <div className="h-14 px-4 flex items-center justify-between border-b border-[#27272a]">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setActiveTab("dashboard")}>
            <div className="w-5 h-5 bg-blue-600 rounded flex items-center justify-center text-white text-xs font-mono font-bold">
              C
            </div>
            <span className="font-semibold text-sm tracking-tight text-white">
              CodeLoop
            </span>
          </div>
          <button 
            className="lg:hidden text-zinc-400 hover:text-white"
            onClick={() => setMobileMenuOpen(false)}
          >
            Close
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center px-3 py-1.5 rounded text-xs font-medium text-left ${
                  isActive
                    ? theme === "dark"
                      ? "bg-zinc-800 text-white border border-zinc-700"
                      : "bg-slate-100 text-slate-900 border border-slate-300"
                    : theme === "dark"
                      ? "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                      : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
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
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-zinc-200 truncate">{currentUser.name}</span>
            <span className="text-[10px] text-zinc-400 font-mono">{currentUser.experience_level || "Beginner"}</span>
          </div>

          <button
            onClick={logout}
            className="w-full text-left text-[11px] text-red-400 hover:text-red-300 py-1"
          >
            Log out
          </button>
        </div>
      </aside>
    </>
  );
}

// ----------------- HEADER -----------------
function Header({ activeTab, currentUser, theme, toggleTheme, voiceEnabled, setVoiceEnabled, setMobileMenuOpen }) {
  const titles = {
    dashboard: "Dashboard",
    tutor: "AI Tutor",
    editor: "Code Editor",
    practice: "Practice Zone",
    mylearning: "My Learning",
    materials: "Study Materials",
    quizzes: "Quizzes",
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
          className="lg:hidden text-xs text-zinc-400 hover:text-white"
        >
          Menu
        </button>
        <span className="text-sm font-semibold text-zinc-100">
          {titles[activeTab] || "CodeLoop"}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setVoiceEnabled(!voiceEnabled)}
          className={`px-2.5 py-1 rounded text-[11px] font-mono border ${
            voiceEnabled 
              ? "bg-zinc-800 border-zinc-600 text-blue-400" 
              : "bg-transparent border-zinc-800 text-zinc-400 hover:text-zinc-300"
          }`}
        >
          {voiceEnabled ? "Voice: Active" : "Voice: Off"}
        </button>

        <button
          onClick={toggleTheme}
          className="px-2.5 py-1 rounded text-[11px] font-mono border border-zinc-800 text-zinc-400 hover:text-zinc-200"
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>

        <div className="text-xs font-mono text-zinc-400 pl-2 border-l border-zinc-800">
          {currentUser.email}
        </div>
      </div>
    </header>
  );
}

// ----------------- DASHBOARD VIEW -----------------
function DashboardView({ currentUser, setActiveTab, showToast, theme }) {
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
    return <div className="p-8 text-xs font-mono text-zinc-500">Loading metrics...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Overview Status Bar */}
      <div className={`p-5 rounded-lg border ${theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"}`}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-100">
              Workspace Overview: {stats?.student_name}
            </h2>
            <p className="text-xs text-zinc-400 font-mono mt-0.5">
              Level: {stats?.experience_level} | Streak: {stats?.learning_streak} days | Daily Goal: {stats?.daily_goal?.completed}/{stats?.daily_goal?.target} completed
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab("editor")}
              className="px-3.5 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium"
            >
              Open Editor
            </button>
            <button
              onClick={() => setActiveTab("tutor")}
              className="px-3.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700"
            >
              Ask AI Tutor
            </button>
          </div>
        </div>
      </div>

      {/* Metrics Row (Plain Data Grid, No Icon Boxes) */}
      <div className={`grid grid-cols-2 md:grid-cols-4 border divide-x divide-y md:divide-y-0 rounded-lg overflow-hidden ${
        theme === "dark" ? "bg-[#121215] border-[#27272a] divide-[#27272a]" : "bg-white border-slate-200 divide-slate-200"
      }`}>
        <div className="p-4">
          <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 block mb-1">Coding Sessions</span>
          <span className="text-2xl font-bold font-mono text-zinc-100">{stats?.total_coding_sessions || 0}</span>
          <span className="text-[10px] text-zinc-400 block mt-1 font-mono">Recorded runs</span>
        </div>

        <div className="p-4">
          <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 block mb-1">Problems Solved</span>
          <span className="text-2xl font-bold font-mono text-zinc-100">{stats?.problems_solved || 0}</span>
          <span className="text-[10px] text-zinc-400 block mt-1 font-mono">Practice challenges</span>
        </div>

        <div className="p-4">
          <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 block mb-1">Quiz Average</span>
          <span className="text-2xl font-bold font-mono text-zinc-100">{stats?.quiz_performance_pct || 0}%</span>
          <span className="text-[10px] text-zinc-400 block mt-1 font-mono">Accuracy score</span>
        </div>

        <div className="p-4">
          <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 block mb-1">Active Streak</span>
          <span className="text-2xl font-bold font-mono text-zinc-100">{stats?.learning_streak || 1}d</span>
          <span className="text-[10px] text-zinc-400 block mt-1 font-mono">Consecutive activity</span>
        </div>
      </div>

      {/* Two Column Layout: Unfinished Work & Saved Code */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Next Activity */}
        <div className={`p-4 rounded-lg border ${theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"}`}>
          <div className="flex items-center justify-between pb-3 border-b border-[#27272a] mb-3">
            <h3 className="font-semibold text-xs text-zinc-100 uppercase tracking-wider font-mono">Next Recommended Task</h3>
            <span className="text-[10px] font-mono text-blue-400">Queue item #1</span>
          </div>
          <div className="p-3 rounded border border-[#27272a] bg-[#18181b] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-200">{stats?.continue_learning?.title}</span>
              <button
                onClick={() => setActiveTab("practice")}
                className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px]"
              >
                Start
              </button>
            </div>
            <p className="text-[11px] text-zinc-400">Variable initialization and arithmetic summation via standard input parsing.</p>
          </div>
        </div>

        {/* Saved Programs List */}
        <div className={`p-4 rounded-lg border ${theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"}`}>
          <div className="flex items-center justify-between pb-3 border-b border-[#27272a] mb-3">
            <h3 className="font-semibold text-xs text-zinc-100 uppercase tracking-wider font-mono">Saved Programs</h3>
            <button onClick={() => setActiveTab("editor")} className="text-[10px] font-mono text-zinc-400 hover:text-white">
              View all
            </button>
          </div>
          <div className="space-y-1.5">
            {stats?.saved_programs?.length > 0 ? (
              stats.saved_programs.map(p => (
                <div
                  key={p.id}
                  onClick={() => setActiveTab("editor")}
                  className="p-2 rounded border border-[#27272a] bg-[#18181b] hover:bg-zinc-800 cursor-pointer flex items-center justify-between text-xs"
                >
                  <span className="text-zinc-200 font-mono">{p.title}</span>
                  <span className="text-[10px] text-zinc-400 uppercase font-mono">{p.language}</span>
                </div>
              ))
            ) : (
              <p className="text-xs text-zinc-500 py-2">No programs saved yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* Curriculum Topics */}
      <div className={`p-4 rounded-lg border ${theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"}`}>
        <h3 className="font-semibold text-xs text-zinc-100 uppercase tracking-wider font-mono mb-3">Curriculum Progress</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {stats?.recommended_next_topics?.map((topic, i) => (
            <div
              key={i}
              onClick={() => setActiveTab("practice")}
              className="p-3 rounded border border-[#27272a] bg-[#18181b] hover:bg-zinc-800 cursor-pointer text-xs space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase text-zinc-400">{topic.category}</span>
                <span className="text-[10px] text-zinc-400">{topic.difficulty}</span>
              </div>
              <p className="font-medium text-zinc-200">{topic.title}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ----------------- AI TUTOR VIEW -----------------
function AITutorView({ currentUser, theme, voiceEnabled, showToast, openInEditor }) {
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
      <div className="p-3 border-b border-[#27272a] dark:border-[#27272a] light:border-slate-200">
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
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-[#18181b] dark:bg-[#18181b] light:bg-white border border-[#27272a] dark:border-[#27272a] light:border-slate-300 text-zinc-200 light:text-slate-900 placeholder-zinc-500 focus:outline-none focus:border-blue-500 transition"
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
      <div className="p-3 border-t border-[#27272a] dark:border-[#27272a] light:border-slate-200 text-[11px] text-zinc-500 flex items-center justify-between">
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

            <span className="font-semibold truncate max-w-[200px] md:max-w-xs text-zinc-100 light:text-slate-900">
              {activeConvo?.title}
            </span>

            <span className="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-zinc-800 text-zinc-300 border border-zinc-700">
              {mode}
            </span>
          </div>

          {/* Right: Learning Mode Switcher + Clear Chat */}
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-zinc-900 dark:bg-zinc-900 light:bg-slate-100 border border-[#27272a] dark:border-[#27272a] light:border-slate-300 rounded p-0.5">
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
                      : "text-zinc-400 light:text-slate-600 hover:text-white"
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

              <h2 className="text-xl md:text-2xl font-bold tracking-tight text-zinc-100 light:text-slate-900 mb-2">
                What would you like to learn today?
              </h2>
              <p className="text-sm text-zinc-400 light:text-slate-600 max-w-lg mx-auto mb-8 leading-relaxed">
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
                    <div className="font-semibold text-xs text-zinc-100 light:text-slate-900 mb-1">
                      {p.title}
                    </div>
                    <div className="text-[11px] text-zinc-400 light:text-slate-500 line-clamp-2">
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
                        <div className="w-full mt-3.5 pt-3 border-t border-[#27272a]/60 dark:border-[#27272a]/60 light:border-slate-200">
                          <div className="text-[11px] font-medium text-zinc-400 light:text-slate-500 mb-2">
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
                className="w-full bg-transparent resize-none text-sm leading-relaxed text-zinc-100 light:text-slate-900 placeholder-zinc-500 focus:outline-none min-h-[44px] max-h-[180px] p-1 font-sans"
              />

              {/* Composer Controls */}
              <div className="flex items-center justify-between pt-2 border-t border-[#27272a]/60 dark:border-[#27272a]/60 light:border-slate-100">
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
                            ? "bg-zinc-800 dark:bg-zinc-800 light:bg-slate-200 text-blue-400 font-medium"
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

            <div className="text-[11px] text-zinc-500 dark:text-zinc-500 light:text-slate-500 text-center mt-2">
              Press <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono text-[10px]">Enter</kbd> to send, <kbd className="px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono text-[10px]">Shift+Enter</kbd> for newline • CodeLoop AI Tutor
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------- CODE EDITOR VIEW -----------------
function CodeEditorView({ currentUser, theme, showToast, initialCode, initialLanguage }) {
  const [language, setLanguage] = useState(initialLanguage || "python");
  const [code, setCode] = useState(initialCode || `# CodeLoop Workspace\ndef solution():\n    numbers = [1, 2, 3, 4, 5]\n    print("Total:", sum(numbers))\n\nsolution()\n`);

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
  const [activeBottomTab, setActiveBottomTab] = useState("output");
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiResponse, setAiResponse] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [programTitle, setProgramTitle] = useState("main");
  const [savedPrograms, setSavedPrograms] = useState([]);
  const [showLoadModal, setShowLoadModal] = useState(false);

  const defaultSnippets = {
    python: `# Python 3\ndef main():\n    print("Hello from Python")\n\nif __name__ == "__main__":\n    main()\n`,
    javascript: `// JavaScript\nfunction main() {\n    console.log("Hello from JavaScript");\n}\nmain();\n`,
    c: `// C\n#include <stdio.h>\n\nint main() {\n    printf("Hello from C\\n");\n    return 0;\n}\n`,
    cpp: `// C++\n#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello from C++" << endl;\n    return 0;\n}\n`,
    java: `// Java\npublic class Solution {\n    public static void main(String[] args) {\n        System.out.println("Hello from Java");\n    }\n}\n`
  };

  const handleLanguageChange = (newLang) => {
    setLanguage(newLang);
    setCode(defaultSnippets[newLang] || "");
  };

  const runCode = async () => {
    setIsExecuting(true);
    setActiveBottomTab("output");
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

          try {
            await py.runPythonAsync(code);
            const elapsed = Math.max(Math.round(performance.now() - startTime), 1);
            setOutput({
              status: "Success",
              stdout: stdoutText || (stderrText ? "" : "Program completed with no output."),
              stderr: stderrText,
              exit_code: 0,
              execution_time_ms: elapsed,
              engine: "in-browser-wasm"
            });
            // Background sync with learning history
            apiRequest("/api/execute", "POST", { language, code, stdin }).catch(() => {});
            setIsExecuting(false);
            return;
          } catch (pyErr) {
            const elapsed = Math.max(Math.round(performance.now() - startTime), 1);
            setOutput({
              status: "Runtime Error",
              stdout: stdoutText,
              stderr: pyErr.message || String(pyErr),
              exit_code: 1,
              execution_time_ms: elapsed,
              tip: "Diagnostic: Check syntax and variable names in your Python script.",
              engine: "in-browser-wasm"
            });
            setIsExecuting(false);
            return;
          }
        }
      } catch (e) {
        console.warn("Pyodide execution skipped, falling back to server:", e);
      }
    }

    // 2. In-browser JavaScript execution
    if (language === "javascript") {
      try {
        let logs = [];
        const customConsole = {
          log: (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
          warn: (...args) => logs.push("[warn] " + args.join(' ')),
          error: (...args) => logs.push("[error] " + args.join(' ')),
          info: (...args) => logs.push(args.join(' ')),
        };
        const runFn = new Function('console', code);
        runFn(customConsole);
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

    // 3. Server-side Execution via API
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
      showToast("Program saved.", "success");
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
  };

  const runAiAssistant = async (action, targetLang = null) => {
    setAiPanelOpen(true);
    setAiLoading(true);
    try {
      const res = await apiRequest("/api/ai/chat", "POST", {
        query: `Analyze code`,
        code,
        language,
        action,
        target_language: targetLang || "javascript",
        error: output?.stderr || ""
      });
      setAiResponse(res.response);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Action Bar */}
      <div className={`p-2.5 rounded-lg border flex flex-wrap items-center justify-between gap-2 ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={programTitle}
            onChange={(e) => setProgramTitle(e.target.value)}
            className="bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1 text-xs font-mono text-zinc-100 focus:outline-none focus:border-zinc-500 w-36"
          />

          <select
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className="bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-500"
          >
            <option value="python">Python 3</option>
            <option value="javascript">JavaScript</option>
            <option value="c">C</option>
            <option value="cpp">C++</option>
            <option value="java">Java</option>
          </select>

          <button
            onClick={saveProgram}
            className="px-2.5 py-1 rounded bg-[#18181b] hover:bg-zinc-800 text-zinc-200 text-xs font-mono border border-[#27272a]"
          >
            Save
          </button>

          <button
            onClick={openLoadModal}
            className="px-2.5 py-1 rounded bg-[#18181b] hover:bg-zinc-800 text-zinc-200 text-xs font-mono border border-[#27272a]"
          >
            Load
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAiPanelOpen(!aiPanelOpen)}
            className={`px-3 py-1 rounded text-xs font-mono border ${
              aiPanelOpen 
                ? "bg-zinc-800 border-zinc-600 text-white" 
                : "bg-transparent border-[#27272a] text-zinc-400 hover:text-white"
            }`}
          >
            Assistant
          </button>

          <button
            onClick={runCode}
            disabled={isExecuting}
            className="px-4 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium font-mono disabled:opacity-50"
          >
            {isExecuting ? "Executing..." : "Run"}
          </button>
        </div>
      </div>

      {/* Editor & Side Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className={`rounded-lg border overflow-hidden ${
          aiPanelOpen ? "lg:col-span-2" : "lg:col-span-3"
        } ${theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"}`}>
          <MonacoEditor
            code={code}
            language={language}
            onChange={setCode}
            height="460px"
            theme={theme}
          />
        </div>

        {aiPanelOpen && (
          <div className={`p-3 rounded-lg border flex flex-col h-[460px] ${
            theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
          }`}>
            <div className="flex items-center justify-between pb-2 border-b border-[#27272a]">
              <span className="font-mono text-xs font-semibold text-zinc-200 uppercase">Analysis Tools</span>
              <button onClick={() => setAiPanelOpen(false)} className="text-zinc-500 hover:text-white text-xs">
                Close
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5 my-2">
              <button
                onClick={() => runAiAssistant("line_by_line")}
                className="p-1.5 rounded bg-[#18181b] hover:bg-zinc-800 text-[11px] font-mono text-zinc-300 border border-[#27272a] text-left"
              >
                Line-by-line
              </button>
              <button
                onClick={() => runAiAssistant("debug")}
                className="p-1.5 rounded bg-[#18181b] hover:bg-zinc-800 text-[11px] font-mono text-zinc-300 border border-[#27272a] text-left"
              >
                Debug
              </button>
              <button
                onClick={() => runAiAssistant("convert", language === "python" ? "javascript" : "python")}
                className="p-1.5 rounded bg-[#18181b] hover:bg-zinc-800 text-[11px] font-mono text-zinc-300 border border-[#27272a] text-left"
              >
                Convert
              </button>
              <button
                onClick={() => runAiAssistant("chat")}
                className="p-1.5 rounded bg-[#18181b] hover:bg-zinc-800 text-[11px] font-mono text-zinc-300 border border-[#27272a] text-left"
              >
                Explain
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 rounded bg-[#09090b] border border-[#27272a] text-xs">
              {aiLoading ? (
                <div className="text-zinc-500 font-mono text-xs">Generating analysis...</div>
              ) : aiResponse ? (
                <div className="prose-dark" dangerouslySetInnerHTML={{ __html: window.marked ? window.marked.parse(aiResponse) : aiResponse }} />
              ) : (
                <p className="text-zinc-500 font-mono text-xs">Select an analysis tool above.</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Unified Terminal & Output Console */}
      <div className={`rounded-lg border overflow-hidden ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <div className="px-3 py-1.5 border-b border-[#27272a] flex items-center justify-between bg-[#141417]">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>Terminal & Console</span>
            </span>
          </div>

          <div className="flex items-center gap-2">
            {output && (
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded ${
                output.status === "Success" ? "bg-emerald-950 text-emerald-300 border border-emerald-800" : "bg-red-950 text-red-300 border border-red-800"
              }`}>
                {output.status} ({output.execution_time_ms || 0}ms)
              </span>
            )}
            <button
              onClick={() => { setOutput(null); setStdin(""); }}
              className="text-[11px] font-mono text-zinc-500 hover:text-zinc-300"
              title="Clear input and console output"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="p-3 font-mono text-xs min-h-[140px] bg-[#09090b] flex flex-col gap-2.5">
          {/* Integrated Input Slot (Always visible, single unified slot) */}
          <div className="flex items-center gap-2 pb-2.5 border-b border-[#27272a]/70">
            <span className="text-zinc-400 font-mono text-xs select-none whitespace-nowrap">Input:</span>
            <input
              type="text"
              value={stdin}
              onChange={(e) => setStdin(e.target.value)}
              placeholder="Type program input here (e.g. 10 20 for scanf or input)... passed automatically on Run"
              className="flex-1 bg-[#141417] border border-[#27272a] rounded px-2.5 py-1 text-xs font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-blue-500"
            />
          </div>

          {/* Integrated Output Slot */}
          <div className="flex-1 overflow-y-auto">
            {output ? (
              <div className="space-y-2">
                {output.stdout && (
                  <pre className="text-zinc-200 whitespace-pre-wrap">{output.stdout}</pre>
                )}
                {output.stderr && (
                  <pre className="text-red-400 whitespace-pre-wrap">{output.stderr}</pre>
                )}
                {output.tip && (
                  <div className="p-2 border border-zinc-800 bg-zinc-900/60 text-zinc-300 text-xs rounded">
                    {output.tip}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-zinc-600">Console ready. Click Run to execute.</p>
            )}
          </div>
        </div>
      </div>

      {/* Program Loader Modal */}
      {showLoadModal && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-[#121215] border border-[#27272a] rounded-lg w-full max-w-md p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-[#27272a] pb-2">
              <span className="font-mono text-xs font-semibold text-zinc-200 uppercase">Load Saved Program</span>
              <button onClick={() => setShowLoadModal(false)} className="text-zinc-500 hover:text-white text-xs">
                Cancel
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto space-y-1">
              {savedPrograms.map(p => (
                <div
                  key={p.id}
                  onClick={() => loadSelectedProgram(p)}
                  className="p-2 rounded border border-[#27272a] bg-[#18181b] hover:bg-zinc-800 cursor-pointer flex items-center justify-between text-xs"
                >
                  <span className="text-zinc-200 font-mono">{p.title}</span>
                  <span className="text-[10px] text-zinc-400 uppercase font-mono">{p.language}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------- PRACTICE ZONE VIEW -----------------
function PracticeZoneView({ currentUser, theme, showToast }) {
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
      {/* Problem Directory */}
      <div className={`lg:col-span-4 rounded-lg border p-3 flex flex-col h-[700px] ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <div className="flex items-center justify-between pb-2 border-b border-[#27272a]">
          <span className="font-mono text-xs font-semibold text-zinc-100 uppercase">Challenges</span>
          <span className="text-[11px] font-mono text-zinc-400">
            {problems.filter(p => p.solved).length}/{problems.length} Solved
          </span>
        </div>

        <div className="flex gap-1 my-2">
          {["all", "beginner", "intermediate", "advanced"].map(d => (
            <button
              key={d}
              onClick={() => setFilterDifficulty(d)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono capitalize ${
                filterDifficulty === d 
                  ? "bg-zinc-800 text-white" 
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-1">
          {filteredProblems.map(p => {
            const isSelected = selectedProblem?.id === p.id;
            return (
              <div
                key={p.id}
                onClick={() => loadProblem(p.id)}
                className={`p-2.5 rounded border cursor-pointer text-xs ${
                  isSelected
                    ? "bg-zinc-800 border-zinc-600 text-white"
                    : "bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-zinc-800/60"
                }`}
              >
                <div className="flex items-center justify-between font-mono text-[10px] text-zinc-400 mb-0.5">
                  <span>{p.difficulty}</span>
                  {p.solved && <span className="text-emerald-400">PASSED</span>}
                </div>
                <div className="font-medium truncate">{p.title}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Workspace */}
      <div className="lg:col-span-8 space-y-3">
        {selectedProblem && (
          <>
            <div className={`p-4 rounded-lg border space-y-3 ${
              theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
            }`}>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-semibold text-zinc-100">{selectedProblem.title}</h3>
                <span className="text-xs font-mono text-zinc-400">{selectedProblem.topic}</span>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">{selectedProblem.description}</p>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2 rounded bg-[#09090b] border border-[#27272a]">
                  <span className="text-zinc-500 block text-[10px] uppercase">Input</span>
                  <span className="text-zinc-300">{selectedProblem.input_format}</span>
                </div>
                <div className="p-2 rounded bg-[#09090b] border border-[#27272a]">
                  <span className="text-zinc-500 block text-[10px] uppercase">Output</span>
                  <span className="text-zinc-300">{selectedProblem.output_format}</span>
                </div>
              </div>
            </div>

            {/* Hint System */}
            <div className={`p-3 rounded-lg border ${theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"}`}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-zinc-400 uppercase">
                  Hint Tier: {currentHintLevel}/{selectedProblem.total_hints}
                </span>
                <button
                  onClick={requestNextHint}
                  disabled={currentHintLevel >= selectedProblem.total_hints}
                  className="px-2.5 py-1 rounded bg-[#18181b] hover:bg-zinc-800 text-zinc-300 text-xs font-mono border border-[#27272a] disabled:opacity-40"
                >
                  {currentHintLevel === 0 ? "Request Hint 1" : currentHintLevel === selectedProblem.total_hints - 1 ? "Show Solution" : "Next Hint"}
                </button>
              </div>

              {Object.keys(revealedHints).length > 0 && (
                <div className="space-y-1.5 pt-2 border-t border-[#27272a]">
                  {Object.entries(revealedHints).map(([lvl, text]) => (
                    <div key={lvl} className="p-2 rounded bg-[#09090b] border border-[#27272a] text-xs font-mono text-zinc-300 whitespace-pre-wrap">
                      {text}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Editor Container */}
            <div className={`rounded-lg border overflow-hidden ${
              theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
            }`}>
              <div className="p-2 border-b border-[#27272a] flex items-center justify-between bg-[#141417]">
                <select
                  value={language}
                  onChange={(e) => {
                    setLanguage(e.target.value);
                    if (selectedProblem.starter_codes?.[e.target.value]) {
                      setCode(selectedProblem.starter_codes[e.target.value]);
                    }
                  }}
                  className="bg-[#18181b] border border-[#27272a] rounded px-2 py-1 text-xs font-mono text-zinc-300"
                >
                  <option value="python">Python 3</option>
                  <option value="javascript">JavaScript</option>
                  <option value="c">C</option>
                  <option value="cpp">C++</option>
                  <option value="java">Java</option>
                </select>

                <button
                  onClick={submitSolution}
                  disabled={submitting}
                  className="px-4 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium font-mono disabled:opacity-50"
                >
                  {submitting ? "Testing..." : "Submit Solution"}
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

            {/* Verification Result */}
            {submissionResult && (
              <div className={`p-4 rounded-lg border text-xs font-mono space-y-2 ${
                submissionResult.status === "Accepted"
                  ? "bg-emerald-950/40 border-emerald-800 text-emerald-200"
                  : "bg-red-950/40 border-red-800 text-red-200"
              }`}>
                <div className="flex items-center justify-between">
                  <span className="font-bold">
                    Result: {submissionResult.status} ({submissionResult.passed_tests}/{submissionResult.total_tests} test cases passed)
                  </span>
                </div>
                <p className="text-zinc-400">{submissionResult.explanation}</p>
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
    <div className="max-w-2xl mx-auto space-y-4">
      {quizState === "idle" && (
        <div className={`p-5 rounded-lg border space-y-4 ${
          theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
        }`}>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100 font-mono uppercase">Assessment Generator</h3>
            <p className="text-xs text-zinc-400 mt-1">Generate evaluation tests based on parameter bounds.</p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-mono text-zinc-400 block mb-1">Topic</label>
              <select
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="w-full bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1.5 text-xs text-zinc-200"
              >
                <option value="Python Basics">Python Basics</option>
                <option value="Loops & Iteration">Loops & Iteration</option>
                <option value="Functions & Scope">Functions & Scope</option>
                <option value="Arrays & Lists">Arrays & Lists</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-mono text-zinc-400 block mb-1">Language</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1.5 text-xs text-zinc-200"
              >
                <option value="Python">Python</option>
                <option value="JavaScript">JavaScript</option>
                <option value="C++">C++</option>
                <option value="Java">Java</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-mono text-zinc-400 block mb-1">Difficulty</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                className="w-full bg-[#18181b] border border-[#27272a] rounded px-2.5 py-1.5 text-xs text-zinc-200"
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
            className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium font-mono disabled:opacity-50"
          >
            {loading ? "Generating questions..." : "Generate Assessment"}
          </button>
        </div>
      )}

      {quizState === "running" && questions.length > 0 && (
        <div className={`p-5 rounded-lg border space-y-4 ${
          theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
        }`}>
          <div className="flex items-center justify-between text-xs font-mono text-zinc-400 pb-2 border-b border-[#27272a]">
            <span>Question {currentQIndex + 1} of {questions.length}</span>
            <span>{topic} / {difficulty}</span>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium text-zinc-100">{questions[currentQIndex].question}</h4>

            {questions[currentQIndex].code_snippet && (
              <pre className="p-2.5 rounded bg-[#09090b] border border-[#27272a] font-mono text-xs text-zinc-200">
                {questions[currentQIndex].code_snippet}
              </pre>
            )}

            <div className="space-y-1.5">
              {questions[currentQIndex].options?.map((opt, oIdx) => {
                const qid = String(questions[currentQIndex].id);
                const isSelected = selectedAnswers[qid] === oIdx;
                return (
                  <div
                    key={oIdx}
                    onClick={() => handleSelectOption(oIdx)}
                    className={`p-2.5 rounded border cursor-pointer text-xs flex items-center justify-between ${
                      isSelected
                        ? "bg-zinc-800 border-zinc-600 text-white"
                        : "bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-zinc-850"
                    }`}
                  >
                    <span>{opt}</span>
                    <span className="font-mono text-[10px] text-zinc-500">[{oIdx + 1}]</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-[#27272a]">
            <button
              onClick={() => setCurrentQIndex(prev => Math.max(0, prev - 1))}
              disabled={currentQIndex === 0}
              className="px-3 py-1 rounded bg-[#18181b] text-zinc-300 text-xs font-mono border border-[#27272a] disabled:opacity-40"
            >
              Previous
            </button>

            {currentQIndex < questions.length - 1 ? (
              <button
                onClick={() => setCurrentQIndex(prev => prev + 1)}
                className="px-4 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono"
              >
                Next
              </button>
            ) : (
              <button
                onClick={submitQuiz}
                disabled={loading}
                className="px-4 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono"
              >
                Submit
              </button>
            )}
          </div>
        </div>
      )}

      {quizState === "result" && quizResult && (
        <div className={`p-5 rounded-lg border space-y-4 ${
          theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
        }`}>
          <div className="border-b border-[#27272a] pb-3">
            <h3 className="text-base font-semibold text-zinc-100 font-mono">Assessment Summary</h3>
            <p className="text-xs font-mono text-zinc-400 mt-1">
              Score: {quizResult.score}/{quizResult.total} ({quizResult.percentage}%)
            </p>
          </div>

          <div className="space-y-3">
            {quizResult.review?.map((r, i) => (
              <div key={i} className="p-3 rounded border border-[#27272a] bg-[#18181b] text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-zinc-200">{r.question}</span>
                  <span className={`font-mono text-[10px] ${r.is_correct ? "text-emerald-400" : "text-red-400"}`}>
                    {r.is_correct ? "PASSED" : "FAILED"}
                  </span>
                </div>
                <div className="text-[11px] text-zinc-400 font-mono">
                  Correct answer: {r.options[r.correct_choice]}
                </div>
                <p className="text-zinc-500 text-[11px] pt-1">{r.explanation}</p>
              </div>
            ))}
          </div>

          <button
            onClick={() => setQuizState("idle")}
            className="w-full py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-mono border border-zinc-700"
          >
            Start New Assessment
          </button>
        </div>
      )}
    </div>
  );
}

// ----------------- STUDY MATERIALS & RAG VIEW -----------------
function StudyMaterialsView({ currentUser, theme, showToast }) {
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
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);
    formData.append("subject", "Computer Science");

    setUploading(true);
    try {
      const res = await apiRequest("/api/materials/upload", "POST", formData);
      fetchMaterials();
      setSelectedDoc(res);
      showToast("Document indexed.", "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const deleteMaterial = async (id) => {
    try {
      await apiRequest(`/api/materials/${id}`, "DELETE");
      fetchMaterials();
      if (selectedDoc?.id === id) setSelectedDoc(null);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const askDocumentQuestion = async () => {
    if (!selectedDoc || !docQuestion.trim() || asking) return;
    setAsking(true);
    setDocAnswer("");
    try {
      const res = await apiRequest(`/api/materials/${selectedDoc.id}/chat`, "POST", {
        question: docQuestion
      });
      setDocAnswer(res.answer);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setAsking(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Document Explorer */}
      <div className={`lg:col-span-4 p-3 rounded-lg border space-y-3 ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <div className="flex items-center justify-between pb-2 border-b border-[#27272a]">
          <span className="font-mono text-xs font-semibold text-zinc-100 uppercase">Documents</span>
          <label className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono cursor-pointer">
            <input type="file" accept=".pdf,.txt,.md" onChange={handleFileUpload} className="hidden" disabled={uploading} />
            {uploading ? "Parsing..." : "Upload"}
          </label>
        </div>

        <div className="space-y-1 max-h-[500px] overflow-y-auto">
          {materials.map(m => (
            <div
              key={m.id}
              onClick={() => setSelectedDoc(m)}
              className={`p-2 rounded border cursor-pointer flex items-center justify-between text-xs ${
                selectedDoc?.id === m.id
                  ? "bg-zinc-800 border-zinc-600 text-white"
                  : "bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-zinc-850"
              }`}
            >
              <span className="truncate font-mono">{m.file_name}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteMaterial(m.id); }}
                className="text-zinc-500 hover:text-red-400 text-[10px] font-mono ml-2"
              >
                Del
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* RAG Context & Q&A */}
      <div className={`lg:col-span-8 p-4 rounded-lg border space-y-4 ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        {selectedDoc ? (
          <>
            <div>
              <span className="font-mono text-xs text-zinc-400 uppercase block mb-1">Indexed Source</span>
              <h3 className="text-sm font-semibold text-zinc-100 font-mono">{selectedDoc.file_name}</h3>
              <div className="mt-2 p-3 rounded bg-[#09090b] border border-[#27272a] text-xs text-zinc-300">
                <div className="prose-dark" dangerouslySetInnerHTML={{ __html: window.marked ? window.marked.parse(selectedDoc.summary || "") : selectedDoc.summary }} />
              </div>
            </div>

            <div className="pt-3 border-t border-[#27272a] space-y-2">
              <span className="font-mono text-xs text-zinc-400 uppercase block">Context Query</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={docQuestion}
                  onChange={(e) => setDocQuestion(e.target.value)}
                  placeholder="Query document content..."
                  className="flex-1 bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-zinc-500"
                />
                <button
                  onClick={askDocumentQuestion}
                  disabled={asking || !docQuestion.trim()}
                  className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono disabled:opacity-50"
                >
                  {asking ? "Querying..." : "Execute"}
                </button>
              </div>

              {docAnswer && (
                <div className="p-3 rounded bg-[#09090b] border border-[#27272a] text-xs font-mono text-zinc-300">
                  <div className="prose-dark" dangerouslySetInnerHTML={{ __html: window.marked ? window.marked.parse(docAnswer) : docAnswer }} />
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-xs font-mono text-zinc-500">
            Select or upload a document to begin analysis.
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------- MY LEARNING & NOTES VIEW -----------------
function MyLearningView({ currentUser, theme, showToast }) {
  const [notes, setNotes] = useState([]);
  const [selectedNote, setSelectedNote] = useState(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");

  useEffect(() => {
    fetchNotes();
  }, []);

  const fetchNotes = async () => {
    try {
      const data = await apiRequest("/api/notes");
      setNotes(data);
      if (data.length > 0 && !selectedNote) {
        selectNote(data[0]);
      }
    } catch (err) {}
  };

  const selectNote = (n) => {
    setSelectedNote(n);
    setNoteTitle(n.title);
    setNoteContent(n.content);
  };

  const createNewNote = () => {
    setSelectedNote(null);
    setNoteTitle("New Note");
    setNoteContent("# Notes\n");
  };

  const saveNote = async () => {
    try {
      if (selectedNote) {
        await apiRequest(`/api/notes/${selectedNote.id}`, "PUT", {
          title: noteTitle,
          content: noteContent
        });
      } else {
        await apiRequest("/api/notes", "POST", {
          title: noteTitle,
          content: noteContent
        });
      }
      showToast("Note saved.", "success");
      fetchNotes();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const deleteNote = async (id) => {
    try {
      await apiRequest(`/api/notes/${id}`, "DELETE");
      fetchNotes();
      setSelectedNote(null);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      <div className={`lg:col-span-4 p-3 rounded-lg border space-y-2 ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <div className="flex items-center justify-between pb-2 border-b border-[#27272a]">
          <span className="font-mono text-xs font-semibold text-zinc-100 uppercase">Notes Index</span>
          <button
            onClick={createNewNote}
            className="px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono"
          >
            + Add
          </button>
        </div>

        <div className="space-y-1 max-h-96 overflow-y-auto">
          {notes.map(n => (
            <div
              key={n.id}
              onClick={() => selectNote(n)}
              className={`p-2 rounded border cursor-pointer flex items-center justify-between text-xs ${
                selectedNote?.id === n.id
                  ? "bg-zinc-800 border-zinc-600 text-white"
                  : "bg-[#18181b] border-[#27272a] text-zinc-300 hover:bg-zinc-850"
              }`}
            >
              <span className="truncate font-mono">{n.title}</span>
              <button
                onClick={(e) => { e.stopPropagation(); deleteNote(n.id); }}
                className="text-zinc-500 hover:text-red-400 text-[10px] font-mono ml-2"
              >
                Del
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className={`lg:col-span-8 p-4 rounded-lg border space-y-3 ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <div className="flex items-center justify-between border-b border-[#27272a] pb-2">
          <input
            type="text"
            value={noteTitle}
            onChange={(e) => setNoteTitle(e.target.value)}
            className="bg-transparent text-sm font-semibold text-zinc-100 font-mono focus:outline-none w-full mr-4"
          />
          <button
            onClick={saveNote}
            className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-mono"
          >
            Save
          </button>
        </div>

        <textarea
          value={noteContent}
          onChange={(e) => setNoteContent(e.target.value)}
          rows={14}
          className="w-full bg-[#09090b] border border-[#27272a] rounded p-3 text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-500"
          placeholder="Markdown text..."
        />
      </div>
    </div>
  );
}

// ----------------- PROGRESS & ANALYTICS VIEW -----------------
function ProgressAnalyticsView({ currentUser, theme, showToast }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const res = await apiRequest("/api/analytics/progress");
      setData(res);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-xs font-mono text-zinc-500">Loading metrics...</div>;
  }

  const plan = data?.study_plan;

  return (
    <div className="space-y-4">
      {/* Diagnostic Header */}
      <div className={`p-4 rounded-lg border ${theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"}`}>
        <span className="text-[10px] font-mono uppercase text-zinc-400 block mb-1">Adaptive Learning Diagnostics</span>
        <h3 className="text-base font-semibold text-zinc-100 font-mono">
          Focus Domain: {plan?.focus_topic}
        </h3>
        <p className="text-xs text-zinc-400 font-mono mt-1">
          {plan?.diagnosis}
        </p>
      </div>

      {/* Remediation Plan */}
      <div className={`p-4 rounded-lg border space-y-2 ${theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"}`}>
        <span className="text-xs font-mono text-zinc-400 uppercase block mb-2">Recommended Sequence</span>
        {plan?.steps?.map((step) => (
          <div
            key={step.step}
            className="p-3 rounded border border-[#27272a] bg-[#18181b] flex items-center justify-between text-xs font-mono"
          >
            <div className="flex items-center gap-3">
              <span className="text-zinc-500">0{step.step}</span>
              <div>
                <span className="font-medium text-zinc-200 block">{step.title}</span>
                <span className="text-zinc-400 text-[11px]">{step.action}</span>
              </div>
            </div>
            <span className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded ${
              step.status === "ready" ? "bg-zinc-800 text-blue-400 border border-zinc-700" : "text-zinc-600"
            }`}>
              {step.status}
            </span>
          </div>
        ))}
      </div>

      {/* Topic Breakdown */}
      <div className={`p-4 rounded-lg border ${theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"}`}>
        <span className="text-xs font-mono text-zinc-400 uppercase block mb-3">Topic Progression</span>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {Object.entries(data?.topic_stats || {}).map(([topName, stats]) => (
            <div key={topName} className="p-3 rounded border border-[#27272a] bg-[#18181b] space-y-1 font-mono text-xs">
              <div className="flex items-center justify-between">
                <span className="text-zinc-200">{topName}</span>
                <span className="text-zinc-400">{stats.percentage}%</span>
              </div>
              <div className="w-full bg-[#09090b] rounded h-1 overflow-hidden">
                <div className="bg-blue-600 h-1" style={{ width: `${stats.percentage}%` }}></div>
              </div>
              <span className="text-[10px] text-zinc-500 block">{stats.completed}/{stats.total} complete</span>
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
  const [experienceLevel, setExperienceLevel] = useState(currentUser.experience_level || "Beginner");
  const [learningGoals, setLearningGoals] = useState(currentUser.learning_goals || "");
  const [geminiKey, setGeminiKey] = useState("");
  const [configInfo, setConfigInfo] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const data = await apiRequest("/api/settings/config");
      setConfigInfo(data);
    } catch (err) {}
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      await apiRequest("/api/auth/profile", "PUT", {
        name,
        experience_level: experienceLevel,
        learning_goals: learningGoals
      });
      showToast("Profile updated.", "success");
      refreshProfile();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveGeminiKey = async () => {
    try {
      await apiRequest("/api/settings/save-key", "POST", { api_key: geminiKey });
      showToast("Key configuration saved.", "success");
      setGeminiKey("");
      fetchConfig();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  return (
    <div className="max-w-2xl space-y-4 font-mono text-xs">
      <div className={`p-4 rounded-lg border space-y-3 ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <span className="font-semibold text-zinc-200 uppercase block">Account Configuration</span>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-zinc-400 block mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100"
            />
          </div>
          <div>
            <label className="text-zinc-400 block mb-1">Level</label>
            <select
              value={experienceLevel}
              onChange={(e) => setExperienceLevel(e.target.value)}
              className="w-full bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-200"
            >
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-zinc-400 block mb-1">Goals</label>
          <input
            type="text"
            value={learningGoals}
            onChange={(e) => setLearningGoals(e.target.value)}
            className="w-full bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100"
          />
        </div>

        <button
          onClick={handleSaveProfile}
          disabled={saving}
          className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium"
        >
          {saving ? "Saving..." : "Save Profile"}
        </button>
      </div>

      <div className={`p-4 rounded-lg border space-y-3 ${
        theme === "dark" ? "bg-[#121215] border-[#27272a]" : "bg-white border-slate-200"
      }`}>
        <div className="flex items-center justify-between">
          <span className="font-semibold text-zinc-200 uppercase block">Gemini API Connection</span>
          <span className="text-[10px] text-zinc-400">
            {configInfo?.gemini_api_configured ? "CONNECTED" : "OFFLINE ENGINE"}
          </span>
        </div>

        <p className="text-zinc-400 text-[11px]">
          Enter Google Gemini API key to update generative engine credentials:
        </p>

        <div className="flex gap-2">
          <input
            type="password"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            placeholder="AIzaSy..."
            className="flex-1 bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100"
          />
          <button
            onClick={handleSaveGeminiKey}
            className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700"
          >
            Update Key
          </button>
        </div>
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
  const [learningGoals, setLearningGoals] = useState("General programming");
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
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#09090b] text-[#f4f4f5]">
      <div className="w-full max-w-sm p-6 rounded-lg border border-[#27272a] bg-[#121215] space-y-4 font-mono text-xs">
        <div className="border-b border-[#27272a] pb-3 flex items-center justify-between">
          <span className="font-semibold text-sm text-zinc-100">CodeLoop</span>
          <span className="text-[10px] text-zinc-500 uppercase">{mode}</span>
        </div>

        {error && (
          <div className="p-2 rounded bg-red-950/60 border border-red-800 text-red-200 text-[11px]">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === "register" && (
            <div>
              <label className="text-zinc-400 block mb-1">Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-500"
              />
            </div>
          )}

          <div>
            <label className="text-zinc-400 block mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-500"
            />
          </div>

          <div>
            <label className="text-zinc-400 block mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-100 focus:outline-none focus:border-zinc-500"
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="text-zinc-400 block mb-1">Experience Level</label>
              <select
                value={experienceLevel}
                onChange={(e) => setExperienceLevel(e.target.value)}
                className="w-full bg-[#18181b] border border-[#27272a] rounded px-3 py-1.5 text-zinc-200"
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
            className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50 mt-2"
          >
            {loading ? "Processing..." : mode === "login" ? "Sign In" : "Register"}
          </button>
        </form>

        <div className="pt-2 border-t border-[#27272a] text-center">
          <button
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="text-zinc-400 hover:text-white text-[11px]"
          >
            {mode === "login" ? "Need an account? Register" : "Have an account? Sign In"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Mount React Root
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
