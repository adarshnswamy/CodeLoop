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

    return `<div class="code-block-wrapper my-3 rounded-lg overflow-hidden border border-[#1E293B] bg-[#0E1118] text-[#F1F5F9] font-mono text-xs shadow-sm">
      <div class="code-block-header flex items-center justify-between px-3.5 py-1.5 bg-[#141923] border-b border-[#1E293B] text-[#94A3B8] text-[11px] font-mono select-none">
        <span class="flex items-center gap-1.5 uppercase font-medium tracking-wide text-[#CBD5E1]">
          <svg class="w-3.5 h-3.5 text-[#3B82F6]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
          ${lang || "CODE"}
        </span>
        <div class="flex items-center gap-2">
          ${isPlaygroundLang ? `
          <button type="button" class="open-in-playground-btn inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium text-blue-300 hover:text-white bg-blue-950/60 hover:bg-blue-900 border border-blue-800/60 transition cursor-pointer" data-code="${encodedCode}" data-lang="${targetLang}" title="Run in Code Playground">
            <svg class="w-3 h-3 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            Run in Playground
          </button>` : ''}
          <button type="button" class="copy-code-btn inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-[#94A3B8] hover:text-[#F1F5F9] bg-[#1B2230] hover:bg-[#283347] border border-[#283347] transition cursor-pointer" data-code="${encodedCode}" title="Copy code">
            <svg class="w-3 h-3 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
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

// ----------------- MONACO EDITOR COMPONENT -----------------
function MonacoEditor({ code, language, onChange, height = "460px" }) {
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
        theme: "codeloop-dark",
        automaticLayout: true,
        fontSize: 13.5,
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        padding: { top: 12, bottom: 12 },
        tabSize: 4,
        lineNumbers: "on",
        renderLineHighlight: "line",
        smoothScrolling: true,
        cursorBlinking: "smooth",
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

  return <div ref={containerRef} style={{ height, width: "100%" }} className="rounded-b-lg overflow-hidden" />;
}

// ----------------- ROOT COMPONENT (APP) -----------------
function App() {
  const urlParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const initialToken = (urlParams && urlParams.get("token")) || localStorage.getItem("codeloop_token") || "";
  const initialTab = (urlParams && urlParams.get("tab")) || "dashboard";

  // Guest-friendly user defaults: No forced auth wall on entry
  const GUEST_USER = {
    name: "Guest Developer",
    email: "",
    experience_level: "Beginner",
    learning_goals: "Explore CodeLoop & master programming fundamentals",
    isGuest: true
  };

  const [token, setToken] = useState(initialToken);
  const [currentUser, setCurrentUser] = useState(GUEST_USER);
  const [activeTab, setActiveTab] = useState(initialTab);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem("codeloop_sidebar_collapsed") === "true";
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [toast, setToast] = useState(null);

  // Progressive Contextual Auth Modal State
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalReason, setAuthModalReason] = useState("");
  const [pendingPostAuthAction, setPendingPostAuthAction] = useState(null);

  // Cross-feature deep integrations
  const [editorInitialCode, setEditorInitialCode] = useState(null);
  const [editorInitialLanguage, setEditorInitialLanguage] = useState(null);
  const [tutorInitialPrompt, setTutorInitialPrompt] = useState(null);

  useEffect(() => {
    if (token) {
      apiProfile();
    } else {
      setCurrentUser(GUEST_USER);
    }
  }, [token]);

  const apiProfile = async () => {
    try {
      const data = await apiRequest("/api/auth/profile");
      setCurrentUser({ ...data, isGuest: false });
    } catch (err) {
      // Invalidate expired token and fallback to guest
      localStorage.removeItem("codeloop_token");
      setToken("");
      setCurrentUser(GUEST_USER);
    }
  };

  const toggleSidebarCollapse = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem("codeloop_sidebar_collapsed", String(next));
      return next;
    });
  };

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const openInEditor = (code, language = "python") => {
    setEditorInitialCode(code);
    setEditorInitialLanguage(language);
    setActiveTab("editor");
    showToast("Code loaded into Playground", "info");
  };

  const askTutor = (prompt, mode = "explain") => {
    setTutorInitialPrompt({ prompt, mode, timestamp: Date.now() });
    setActiveTab("tutor");
    showToast("Query sent to AI Tutor", "info");
  };

  // Progressive Authentication Trigger
  const requireAuth = (reason = "Enjoying CODELOOP? Create a free account to save your work and track your learning journey.", onSuccessAction = null) => {
    if (token && currentUser && !currentUser.isGuest) {
      if (onSuccessAction) onSuccessAction();
      return true;
    }
    setAuthModalReason(reason);
    setPendingPostAuthAction(() => onSuccessAction);
    setAuthModalOpen(true);
    return false;
  };

  const handleAuthSuccess = (newToken, user) => {
    localStorage.setItem("codeloop_token", newToken);
    setToken(newToken);
    setCurrentUser({ ...user, isGuest: false });
    setAuthModalOpen(false);
    showToast(`Welcome, ${user.name}! Account active.`, "success");

    // Execute deferred action (e.g. save drafted program)
    if (pendingPostAuthAction) {
      setTimeout(() => {
        try {
          pendingPostAuthAction();
        } catch (e) {}
        setPendingPostAuthAction(null);
      }, 300);
    }
  };

  const logout = () => {
    localStorage.removeItem("codeloop_token");
    setToken("");
    setCurrentUser(GUEST_USER);
    showToast("Signed out. Switched to Guest mode.", "info");
  };

  return (
    <div className="min-h-screen flex bg-[#090B10] text-[#F1F5F9] font-sans selection:bg-blue-500/20 selection:text-white">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-3.5 py-2.5 rounded-lg text-xs font-medium border shadow-xl backdrop-blur-md transition-all ${
          toast.type === "error" 
            ? "bg-[#1B2230]/95 text-red-300 border-red-500/40" 
            : toast.type === "info"
            ? "bg-[#1B2230]/95 text-blue-300 border-blue-500/40"
            : "bg-[#1B2230]/95 text-emerald-300 border-emerald-500/40"
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            toast.type === "error" ? "bg-red-400" : toast.type === "info" ? "bg-blue-400" : "bg-emerald-400"
          }`}></span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Contextual Progressive Auth Modal */}
      {authModalOpen && (
        <AuthModal 
          reason={authModalReason}
          onSuccess={handleAuthSuccess}
          onClose={() => { setAuthModalOpen(false); setPendingPostAuthAction(null); }}
        />
      )}

      {/* Global Collapsible Sidebar */}
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        currentUser={currentUser} 
        logout={logout}
        requireAuth={requireAuth}
        collapsed={sidebarCollapsed}
        toggleCollapse={toggleSidebarCollapse}
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        <Header 
          activeTab={activeTab} 
          currentUser={currentUser} 
          collapsed={sidebarCollapsed}
          toggleCollapse={toggleSidebarCollapse}
          voiceEnabled={voiceEnabled}
          setVoiceEnabled={setVoiceEnabled}
          setMobileMenuOpen={setMobileMenuOpen}
          requireAuth={requireAuth}
        />

        <main className={`flex-1 w-full ${activeTab === "tutor" ? "p-0 h-[calc(100vh-3.5rem)] overflow-hidden" : "p-4 md:p-6 max-w-7xl mx-auto"}`}>
          {activeTab === "dashboard" && <DashboardView currentUser={currentUser} setActiveTab={setActiveTab} showToast={showToast} openInEditor={openInEditor} askTutor={askTutor} requireAuth={requireAuth} />}
          {activeTab === "editor" && <CodeEditorView currentUser={currentUser} showToast={showToast} initialCode={editorInitialCode} initialLanguage={editorInitialLanguage} askTutor={askTutor} requireAuth={requireAuth} />}
          {activeTab === "tutor" && <AITutorView currentUser={currentUser} voiceEnabled={voiceEnabled} showToast={showToast} openInEditor={openInEditor} tutorInitialPrompt={tutorInitialPrompt} onClearInitialPrompt={() => setTutorInitialPrompt(null)} />}
          {activeTab === "practice" && <PracticeZoneView currentUser={currentUser} showToast={showToast} askTutor={askTutor} requireAuth={requireAuth} />}
          {activeTab === "learninghub" && <LearningHubView currentUser={currentUser} showToast={showToast} openInEditor={openInEditor} askTutor={askTutor} requireAuth={requireAuth} />}
          {activeTab === "materials" && <StudyMaterialsView currentUser={currentUser} showToast={showToast} askTutor={askTutor} requireAuth={requireAuth} />}
          {activeTab === "analytics" && <ProgressAnalyticsView currentUser={currentUser} showToast={showToast} askTutor={askTutor} requireAuth={requireAuth} />}
          {activeTab === "profile" && <ProfileView currentUser={currentUser} refreshProfile={apiProfile} showToast={showToast} requireAuth={requireAuth} />}
          {activeTab === "settings" && <SettingsView currentUser={currentUser} refreshProfile={apiProfile} showToast={showToast} logout={logout} requireAuth={requireAuth} />}
        </main>
      </div>
    </div>
  );
}

// ----------------- CONTEXTUAL AUTHENTICATION MODAL -----------------
function AuthModal({ reason, onSuccess, onClose }) {
  const [mode, setMode] = useState("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [experienceLevel, setExperienceLevel] = useState("Beginner");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (mode === "login") {
        const res = await apiRequest("/api/auth/login", "POST", { email, password });
        onSuccess(res.token, res.user);
      } else {
        const res = await apiRequest("/api/auth/register", "POST", {
          name,
          email,
          password,
          experience_level: experienceLevel,
          preferred_languages: ["Python"],
          learning_goals: "Master programming fundamentals"
        });
        onSuccess(res.token, res.user);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div 
        className="fixed inset-0"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm p-6 rounded-2xl cd-card border border-[#1E293B] bg-[#11151D] shadow-2xl space-y-4 text-xs z-10">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-md hover:bg-[#1B2230] transition"
          title="Close modal"
        >
          ✕
        </button>

        {/* Brand Header */}
        <div className="text-center pb-2 border-b border-[#1E293B]">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-md shadow-blue-500/20 mx-auto mb-2">
            C
          </div>
          <h2 className="text-base font-bold text-white tracking-tight">
            {mode === "register" ? "Create Free Account" : "Sign In to Workspace"}
          </h2>
          <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
            {reason || "Enjoying CODELOOP? Create a free account to save your work and track your learning journey."}
          </p>
        </div>

        {error && (
          <div className="p-2.5 rounded-lg bg-red-950/40 border border-red-800 text-red-300 text-xs">
            {error}
          </div>
        )}

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="space-y-3 pt-1">
          {mode === "register" && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Mercer"
                className="w-full cd-input rounded-lg px-3 py-2 text-xs focus:border-blue-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="alex@example.com"
              className="w-full cd-input rounded-lg px-3 py-2 text-xs focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full cd-input rounded-lg px-3 py-2 text-xs focus:border-blue-500"
            />
          </div>

          {mode === "register" && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Experience Level</label>
              <select
                value={experienceLevel}
                onChange={(e) => setExperienceLevel(e.target.value)}
                className="w-full cd-input rounded-lg px-3 py-2 text-xs font-mono focus:border-blue-500 cursor-pointer"
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
            className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-xs shadow-md shadow-blue-500/20 transition active:scale-[0.99] mt-2"
          >
            {loading ? "Processing..." : mode === "login" ? "Sign In & Continue" : "Create Account & Sync Work"}
          </button>
        </form>

        {/* Mode Toggle & Continue as Guest */}
        <div className="pt-2 border-t border-[#1E293B] flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setMode(mode === "login" ? "register" : "login")}
            className="text-xs text-blue-400 hover:underline"
          >
            {mode === "login" ? "Need an account? Register free" : "Already have an account? Sign In"}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-slate-500 hover:text-slate-300 font-mono transition"
          >
            Dismiss and Continue as Guest
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------- GLOBAL SIDEBAR COMPONENT -----------------
function Sidebar({ activeTab, setActiveTab, currentUser, logout, requireAuth, collapsed, toggleCollapse, mobileMenuOpen, setMobileMenuOpen }) {
  const isGuest = currentUser?.isGuest;

  const navSections = [
    {
      group: "WORKSPACE",
      items: [
        { 
          id: "dashboard", 
          label: "Dashboard",
          icon: (
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="7" height="7"></rect>
              <rect x="14" y="3" width="7" height="7"></rect>
              <rect x="14" y="14" width="7" height="7"></rect>
              <rect x="3" y="14" width="7" height="7"></rect>
            </svg>
          )
        },
        { 
          id: "editor", 
          label: "Code Playground",
          icon: (
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6"></polyline>
              <polyline points="8 6 2 12 8 18"></polyline>
            </svg>
          )
        },
        { 
          id: "tutor", 
          label: "AI Tutor",
          icon: (
            <svg className="w-4 h-4 shrink-0 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          )
        },
        { 
          id: "practice", 
          label: "Practice Zone",
          icon: (
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <circle cx="12" cy="12" r="6"></circle>
              <circle cx="12" cy="12" r="2"></circle>
            </svg>
          )
        },
      ]
    },
    {
      group: "LEARNING",
      items: [
        { 
          id: "learninghub", 
          label: "Learning Hub",
          icon: (
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
          )
        },
        { 
          id: "materials", 
          label: "Study Materials",
          icon: (
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
            </svg>
          )
        },
        { 
          id: "analytics", 
          label: "Analytics",
          icon: (
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"></line>
              <line x1="12" y1="20" x2="12" y2="4"></line>
              <line x1="6" y1="20" x2="6" y2="14"></line>
            </svg>
          )
        },
      ]
    },
    {
      group: "ACCOUNT",
      items: [
        { 
          id: "profile", 
          label: "Profile",
          icon: (
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          )
        },
        { 
          id: "settings", 
          label: "Settings",
          icon: (
            <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
          )
        },
      ]
    }
  ];

  return (
    <>
      {mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/70 backdrop-blur-sm z-30 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside className={`
        fixed lg:static inset-y-0 left-0 z-40 flex flex-col bg-[#0E1118] border-r border-[#1E293B]
        ${collapsed ? "w-16" : "w-60"}
        ${mobileMenuOpen ? "translate-x-0 w-60" : "-translate-x-full lg:translate-x-0"}
        transition-all duration-200 ease-in-out shrink-0 select-none
      `}>
        {/* Brand Header */}
        <div className="h-14 px-3.5 flex items-center justify-between border-b border-[#1E293B]">
          <div 
            className="flex items-center gap-2.5 cursor-pointer overflow-hidden" 
            onClick={() => { setActiveTab("dashboard"); setMobileMenuOpen(false); }}
            title="CODELOOP Home"
          >
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center text-white text-xs font-bold shadow-md shadow-blue-500/20 shrink-0">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="16 18 22 12 16 6"></polyline>
                <polyline points="8 6 2 12 8 18"></polyline>
              </svg>
            </div>
            {(!collapsed || mobileMenuOpen) && (
              <div className="flex flex-col">
                <span className="font-bold text-sm tracking-tight text-white leading-tight">
                  CODELOOP
                </span>
                <span className="text-[9.5px] font-mono uppercase tracking-widest text-blue-400 font-semibold">
                  {isGuest ? "GUEST MODE" : "STUDENT IDE"}
                </span>
              </div>
            )}
          </div>

          <button 
            onClick={toggleCollapse}
            className="hidden lg:flex items-center justify-center w-6 h-6 rounded-md text-slate-400 hover:text-white hover:bg-[#1B2230] transition"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <svg className={`w-3.5 h-3.5 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
          </button>

          <button 
            className="lg:hidden text-slate-400 hover:text-white p-1"
            onClick={() => setMobileMenuOpen(false)}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-2 py-3 space-y-4 overflow-y-auto">
          {navSections.map((sec) => (
            <div key={sec.group} className="space-y-1">
              {(!collapsed || mobileMenuOpen) && (
                <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold">
                  {sec.group}
                </div>
              )}
              {sec.items.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    title={collapsed && !mobileMenuOpen ? item.label : undefined}
                    className={`w-full flex items-center ${collapsed && !mobileMenuOpen ? "justify-center px-0 py-2.5" : "gap-2.5 px-3 py-2"} rounded-lg text-xs font-medium text-left transition-all ${
                      isActive
                        ? "bg-[#1B2230] text-white border border-[#283347] shadow-sm font-semibold text-blue-400"
                        : "text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-[#141923]"
                    }`}
                  >
                    <span className={`${isActive ? "text-blue-400" : "text-slate-400"}`}>
                      {item.icon}
                    </span>
                    {(!collapsed || mobileMenuOpen) && (
                      <span className="truncate">{item.label}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Bottom Section: User Status & Login/Register Option */}
        <div className="p-3 border-t border-[#1E293B] bg-[#0A0D13]">
          {isGuest ? (
            <div className="space-y-2">
              {(!collapsed || mobileMenuOpen) ? (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] font-mono text-slate-400 uppercase">Guest Session</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="Unsaved Guest Session"></span>
                  </div>
                  <button
                    onClick={() => requireAuth("Create a free account or sign in to save your code and track your learning progress.")}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-500/20 transition active:scale-[0.99]"
                  >
                    <span>Sign In / Register</span>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => requireAuth()}
                  className="w-full flex items-center justify-center p-2 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600 hover:text-white transition"
                  title="Sign In / Register"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line></svg>
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-bold text-xs shrink-0">
                {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : "U"}
              </div>
              {(!collapsed || mobileMenuOpen) && (
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate text-xs text-white">
                    {currentUser.name}
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono truncate">
                    {currentUser.experience_level || "Beginner"}
                  </div>
                </div>
              )}
              {(!collapsed || mobileMenuOpen) && (
                <button
                  onClick={logout}
                  className="text-slate-400 hover:text-red-400 p-1 rounded hover:bg-[#1B2230] transition shrink-0"
                  title="Log out"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                  </svg>
                </button>
              )}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

// ----------------- GLOBAL HEADER COMPONENT -----------------
function Header({ activeTab, currentUser, collapsed, toggleCollapse, voiceEnabled, setVoiceEnabled, setMobileMenuOpen, requireAuth }) {
  const isGuest = currentUser?.isGuest;

  const titles = {
    dashboard: "Workspace Dashboard",
    editor: "Code Playground",
    tutor: "AI Tutor Workspace",
    practice: "Practice Zone",
    learninghub: "Learning Hub",
    materials: "Study Materials",
    analytics: "Progress & Analytics",
    profile: "Student Profile",
    settings: "Settings & Configuration"
  };

  return (
    <header className="h-14 px-4 md:px-6 flex items-center justify-between border-b border-[#1E293B] bg-[#090B10] sticky top-0 z-20">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="lg:hidden p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-[#1B2230]"
          title="Open Navigation"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>

        <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
          <span className="text-slate-500 hidden sm:inline">CODELOOP</span>
          <span className="text-slate-600 hidden sm:inline">/</span>
          <span className="text-white font-medium">{titles[activeTab] || "Workspace"}</span>
          {isGuest && (
            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold hidden sm:inline">
              Guest
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        {/* Core Philosophy Motto Badge */}
        <span className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono bg-[#11151D] border border-[#1E293B] text-slate-400">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
          <span>Learn • Code • Build • Repeat</span>
        </span>

        {/* Voice Narration Toggle */}
        <button
          onClick={() => setVoiceEnabled(!voiceEnabled)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono border transition ${
            voiceEnabled 
              ? "bg-blue-950/70 border-blue-600 text-blue-300 font-semibold" 
              : "bg-[#11151D] border-[#1E293B] text-slate-400 hover:text-white hover:bg-[#1B2230]"
          }`}
          title="Toggle AI Voice speech"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
            <line x1="12" y1="19" x2="12" y2="23"></line>
            <line x1="8" y1="23" x2="16" y2="23"></line>
          </svg>
          <span className="hidden sm:inline">{voiceEnabled ? "Voice On" : "Voice Off"}</span>
        </button>

        {/* Contextual Sign In or User Badge */}
        {isGuest ? (
          <button
            onClick={() => requireAuth("Create an account or sign in to save your programs, track learning progress, and unlock all features.")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-500/20 transition active:scale-[0.98]"
          >
            <span>Sign In</span>
          </button>
        ) : (
          <div className="flex items-center gap-2 pl-2 border-l border-[#1E293B]">
            <div className="w-7 h-7 rounded-full bg-[#1B2230] border border-[#283347] flex items-center justify-center text-xs font-semibold text-blue-400">
              {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : "U"}
            </div>
            <span className="text-xs font-medium text-slate-300 hidden md:inline truncate max-w-[120px]">
              {currentUser.name}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}

// ----------------- DASHBOARD VIEW -----------------
function DashboardView({ currentUser, setActiveTab, showToast, openInEditor, askTutor, requireAuth }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const isGuest = currentUser?.isGuest;

  useEffect(() => {
    fetchStats();
  }, [currentUser]);

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

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  if (loading) {
    return (
      <div className="py-20 text-center text-xs font-mono text-slate-400 flex flex-col items-center justify-center gap-3">
        <svg className="w-5 h-5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20"></circle></svg>
        <span>Loading workspace telemetry...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome & Philosophy Banner */}
      <div className="p-6 rounded-xl cd-card border border-[#1E293B] relative overflow-hidden bg-gradient-to-r from-[#11151D] via-[#11151D] to-[#141923]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded font-semibold ${
                isGuest ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
              }`}>
                {isGuest ? "GUEST EXPLORER" : "ACTIVE WORKSPACE"}
              </span>
              <span className="text-xs text-slate-500 font-mono">
                {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
              </span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">
              {getGreeting()}, {stats?.student_name || currentUser.name}!
            </h2>
            <p className="text-xs text-[#94A3B8] font-normal leading-relaxed max-w-2xl">
              {isGuest 
                ? "You have full access to explore the Code Playground, run programs, and ask the AI Tutor without logging in. Create an account whenever you want to permanently save your work." 
                : `Goal: ${currentUser.learning_goals || "Master programming fundamentals"} • Target: ${stats?.daily_goal?.completed || 0}/${stats?.daily_goal?.target || 3} tasks today`}
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={() => setActiveTab("editor")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-500/20 transition active:scale-[0.99]"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
              <span>Start Coding Now</span>
            </button>
            <button
              onClick={() => setActiveTab("tutor")}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#1B2230] hover:bg-[#283347] text-white text-xs font-semibold border border-[#283347] transition"
            >
              <svg className="w-3.5 h-3.5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
              <span>Ask AI Tutor</span>
            </button>
          </div>
        </div>
      </div>

      {/* Guest Invitation Callout (if unauthenticated) */}
      {isGuest && (
        <div className="p-4 rounded-xl bg-blue-950/20 border border-blue-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-bold text-sm shrink-0">
              ⚡
            </div>
            <div>
              <div className="text-xs font-semibold text-white">No registration required to code!</div>
              <div className="text-[11px] text-slate-400">Write, edit, and execute Python, JS, C, C++, and Java right away in the Playground.</div>
            </div>
          </div>
          <button
            onClick={() => requireAuth("Create a free account to sync your saved programs across devices and track streaks.")}
            className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shrink-0 transition"
          >
            Create Free Account
          </button>
        </div>
      )}

      {/* Key Metrics Row (4 Data Cards) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl cd-card border border-[#1E293B]">
          <div className="flex items-center justify-between text-[#94A3B8] mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider font-medium">Learning Streak</span>
            <span className="text-amber-400">⚡</span>
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-mono text-amber-400">
            {stats?.learning_streak || 1}d
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-1">Consistent daily coding</div>
        </div>

        <div className="p-4 rounded-xl cd-card border border-[#1E293B]">
          <div className="flex items-center justify-between text-[#94A3B8] mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider font-medium">Problems Solved</span>
            <span className="text-emerald-400">✓</span>
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-mono text-emerald-400">
            {stats?.problems_solved || 0}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-1">Verified practice challenges</div>
        </div>

        <div className="p-4 rounded-xl cd-card border border-[#1E293B]">
          <div className="flex items-center justify-between text-[#94A3B8] mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider font-medium">Coding Sessions</span>
            <span className="text-blue-400">&gt;_</span>
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-mono text-white">
            {stats?.total_coding_sessions || 0}
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-1">Sandbox script executions</div>
        </div>

        <div className="p-4 rounded-xl cd-card border border-[#1E293B]">
          <div className="flex items-center justify-between text-[#94A3B8] mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider font-medium">Quiz Performance</span>
            <span className="text-purple-400">★</span>
          </div>
          <div className="text-2xl sm:text-3xl font-bold font-mono text-purple-400">
            {stats?.quiz_performance_pct || 0}%
          </div>
          <div className="text-[10px] text-slate-500 font-mono mt-1">Assessment accuracy score</div>
        </div>
      </div>

      {/* Quick Action Navigation Buttons */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Code Playground", desc: "Browser multi-language IDE", tab: "editor", color: "hover:border-blue-500/50" },
          { label: "AI Tutor Mentor", desc: "Line-by-line debugging", tab: "tutor", color: "hover:border-purple-500/50" },
          { label: "Practice Zone", desc: "Algorithmic challenges", tab: "practice", color: "hover:border-emerald-500/50" },
          { label: "Study Materials", desc: "Document Q&A & Notes", tab: "materials", color: "hover:border-amber-500/50" }
        ].map((action, i) => (
          <button
            key={i}
            onClick={() => setActiveTab(action.tab)}
            className={`p-3.5 rounded-xl cd-card border border-[#1E293B] text-left transition ${action.color} group`}
          >
            <div className="font-semibold text-xs text-white group-hover:text-blue-400 transition flex items-center justify-between">
              <span>{action.label}</span>
              <span className="text-slate-500 group-hover:translate-x-0.5 transition-transform">→</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">{action.desc}</div>
          </button>
        ))}
      </div>

      {/* Two Column Section: Continue Learning & Saved Programs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 space-y-4">
          <div className="p-5 rounded-xl cd-card border border-[#1E293B]">
            <div className="flex items-center justify-between pb-3 border-b border-[#1E293B] mb-3">
              <h3 className="font-semibold text-xs uppercase tracking-wider font-mono text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span>Continue Learning</span>
              </h3>
              <span className="text-[10px] font-mono text-emerald-400 font-semibold">Ready to test</span>
            </div>

            <div className="p-4 rounded-lg bg-[#0E1118] border border-[#1E293B] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="font-semibold text-xs text-white">
                  {stats?.continue_learning?.title || "Practice Challenge: Sum of Two Numbers"}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Write a function that receives inputs and computes outputs under standard runtime limits.
                </p>
              </div>
              <button
                onClick={() => setActiveTab("practice")}
                className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shrink-0 transition"
              >
                Start Challenge
              </button>
            </div>

            {/* Recommended Next Topics */}
            <div className="mt-4">
              <div className="text-[11px] font-mono uppercase text-slate-500 mb-2">Curated Next Steps</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { title: "Python Loops & Range", level: "Beginner", category: "Control Flow" },
                  { title: "Modular Functions", level: "Intermediate", category: "Functions" },
                  { title: "Array Two Pointers", level: "Intermediate", category: "Data Structures" },
                  { title: "Algorithmic Big-O", level: "Advanced", category: "Complexity" },
                ].map((top, idx) => (
                  <div
                    key={idx}
                    onClick={() => askTutor(`Could you explain ${top.title} with beginner-friendly code examples?`, "explain")}
                    className="p-2.5 rounded-lg bg-[#0E1118] border border-[#1E293B] hover:border-blue-500/40 cursor-pointer transition flex items-center justify-between group"
                  >
                    <div>
                      <div className="text-xs font-medium text-slate-300 group-hover:text-blue-300 transition">
                        {top.title}
                      </div>
                      <div className="text-[10px] text-slate-500 font-mono">{top.category}</div>
                    </div>
                    <span className="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-[#1B2230] text-slate-400">
                      {top.level}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Saved Code & Recent Activities */}
        <div className="lg:col-span-5 space-y-4">
          <div className="p-5 rounded-xl cd-card border border-[#1E293B]">
            <div className="flex items-center justify-between pb-3 border-b border-[#1E293B] mb-3">
              <h3 className="font-semibold text-xs uppercase tracking-wider font-mono text-white flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                <span>Saved Programs</span>
              </h3>
              <button
                onClick={() => setActiveTab("editor")}
                className="text-[11px] font-mono text-blue-400 hover:underline"
              >
                Open Playground →
              </button>
            </div>

            {stats?.saved_programs?.length > 0 ? (
              <div className="space-y-2">
                {stats.saved_programs.slice(0, 4).map((prog) => (
                  <div
                    key={prog.id}
                    onClick={() => openInEditor(prog.code || "", prog.language || "python")}
                    className="p-2.5 rounded-lg bg-[#0E1118] border border-[#1E293B] hover:border-blue-500/40 flex items-center justify-between cursor-pointer transition group"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <svg className="w-3.5 h-3.5 text-slate-500 group-hover:text-blue-400 transition" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                      <span className="font-mono text-xs font-medium text-slate-300 group-hover:text-white truncate">{prog.title}</span>
                    </div>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded uppercase bg-[#1B2230] text-blue-400 font-semibold shrink-0">
                      {prog.language}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-lg bg-[#0E1118] border border-[#1E293B] text-center text-xs text-slate-500">
                {isGuest 
                  ? "You are in guest mode. Code in Playground is kept in your browser. Create an account to permanently sync programs to the cloud." 
                  : "No saved programs yet. Create a new program in the Code Playground!"}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------- CODE PLAYGROUND VIEW -----------------
function CodeEditorView({ currentUser, showToast, initialCode, initialLanguage, askTutor, requireAuth }) {
  const isGuest = currentUser?.isGuest;

  const defaultSnippets = {
    python: `# Python 3 Workspace\ndef main():\n    print("Hello from Python 3!")\n\nif __name__ == "__main__":\n    main()\n`,
    javascript: `// JavaScript Workspace\nfunction main() {\n    console.log("Hello from JavaScript!");\n}\nmain();\n`,
    c: `// C Workspace\n#include <stdio.h>\n\nint main() {\n    printf("Hello from C\\n");\n    return 0;\n}\n`,
    cpp: `// C++ Workspace\n#include <iostream>\nusing namespace std;\n\nint main() {\n    cout << "Hello from C++" << endl;\n    return 0;\n}\n`,
    java: `// Java Workspace\npublic class Solution {\n    public static void main(String[] args) {\n        System.out.println("Hello from Java!");\n    }\n}\n`
  };

  const [language, setLanguage] = useState(() => {
    return initialLanguage || localStorage.getItem("codeloop_draft_lang") || "python";
  });

  const [code, setCode] = useState(() => {
    if (initialCode !== undefined && initialCode !== null) return initialCode;
    const savedDraft = localStorage.getItem("codeloop_draft_code");
    return savedDraft || defaultSnippets.python;
  });

  useEffect(() => {
    if (initialCode !== undefined && initialCode !== null) {
      setCode(initialCode);
    }
    if (initialLanguage) {
      setLanguage(initialLanguage);
    }
  }, [initialCode, initialLanguage]);

  // Preserve unsaved draft in browser storage so guest never loses code
  const handleCodeChange = (newCode) => {
    setCode(newCode);
    try {
      localStorage.setItem("codeloop_draft_code", newCode);
      localStorage.setItem("codeloop_draft_lang", language);
    } catch (e) {}
  };

  const [stdin, setStdin] = useState("");
  const [output, setOutput] = useState(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [programTitle, setProgramTitle] = useState(() => {
    return localStorage.getItem("codeloop_draft_title") || "main";
  });
  const [savedPrograms, setSavedPrograms] = useState([]);
  const [fileDrawerOpen, setFileDrawerOpen] = useState(false);
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

  const handleLanguageChange = (newLang) => {
    setLanguage(newLang);
    const snip = defaultSnippets[newLang] || "";
    handleCodeChange(snip);
  };

  useEffect(() => {
    if (!isGuest) {
      loadSavedProgramsList();
    }
  }, [isGuest]);

  const loadSavedProgramsList = async () => {
    try {
      const progs = await apiRequest("/api/programs");
      setSavedPrograms(progs);
    } catch (err) {}
  };

  // Secure Multi-Engine Code Execution for Guests & Registered Users
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

          let stdinQueue = (stdin && stdin.trim()) ? stdin.split(/\r?\n/) : [];
          let stdinIdx = 0;

          if (typeof py.setStdin === "function") {
            py.setStdin({
              stdin: () => {
                if (stdinIdx < stdinQueue.length) {
                  const val = stdinQueue[stdinIdx++];
                  stdoutText += (stdoutText ? "\n" : "") + val;
                  return val + "\n";
                }
                if (typeof window !== "undefined" && window.prompt) {
                  const recentPrompt = stdoutText.split("\n").filter(Boolean).slice(-2).join("\n") || "Input required";
                  const inputVal = window.prompt(`Program requests input:\n${recentPrompt}\n\n(Enter your response, or click Cancel to finish):`);
                  if (inputVal !== null) {
                    stdoutText += (stdoutText ? "\n" : "") + inputVal;
                    return inputVal + "\n";
                  }
                }
                return null;
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
      } catch (err) {}
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

    // 3. Server-side Execution (Works for guests and authenticated users alike)
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

  const handleSaveAttempt = () => {
    if (isGuest) {
      requireAuth(
        "Enjoying CODELOOP? Create a free account or sign in to permanently save your programs across devices.",
        async () => {
          await doSaveProgram();
        }
      );
      return;
    }
    doSaveProgram();
  };

  const doSaveProgram = async () => {
    try {
      await apiRequest("/api/programs", "POST", {
        title: programTitle.trim() || "untitled",
        language,
        code
      });
      showToast("Program successfully saved to cloud", "success");
      loadSavedProgramsList();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const loadSelectedProgram = (p) => {
    setProgramTitle(p.title);
    setLanguage(p.language);
    handleCodeChange(p.code);
    setFileDrawerOpen(false);
    showToast(`Loaded ${p.title}`, "info");
  };

  const askTutorAboutEditorCode = () => {
    if (!askTutor) return;
    const prompt = `Here is my current ${language} code:\n\n\`\`\`${language}\n${code}\n\`\`\`\n\nPlease review this code, explain its logic step by step, and suggest any optimizations or edge cases.`;
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
      <div className="p-3 rounded-xl cd-card border border-[#1E293B] flex flex-wrap items-center justify-between gap-3">
        {/* Left: Program Title, Language Selector, File Drawer Toggle */}
        <div className="flex flex-wrap items-center gap-2">
          {/* File Explorer Toggle */}
          <button
            onClick={() => {
              if (isGuest && savedPrograms.length === 0) {
                requireAuth("Sign in to view and manage cloud programs across your devices.");
                return;
              }
              setFileDrawerOpen(!fileDrawerOpen);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-mono border transition ${
              fileDrawerOpen ? "bg-[#1B2230] border-blue-500/50 text-blue-300" : "bg-[#0E1118] border-[#1E293B] text-slate-400 hover:text-white"
            }`}
            title="Saved Files"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            <span>Files {isGuest ? "(Guest)" : `(${savedPrograms.length})`}</span>
          </button>

          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={programTitle}
              onChange={(e) => {
                setProgramTitle(e.target.value);
                localStorage.setItem("codeloop_draft_title", e.target.value);
              }}
              placeholder="Filename"
              className="cd-input rounded-lg px-2.5 py-1 text-xs font-mono w-32 md:w-40 focus:border-blue-500"
            />
          </div>

          <select
            value={language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className="cd-input rounded-lg px-2.5 py-1 text-xs font-mono focus:border-blue-500 cursor-pointer"
          >
            <option value="python">Python 3 (WASM / Local)</option>
            <option value="javascript">JavaScript (V8 / Node)</option>
            <option value="c">C (GCC 9.2)</option>
            <option value="cpp">C++ (G++ 9.2)</option>
            <option value="java">Java (OpenJDK 13)</option>
          </select>

          <button
            onClick={handleSaveAttempt}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-mono bg-[#1B2230] hover:bg-[#283347] text-slate-200 border border-[#283347] transition"
            title={isGuest ? "Sign in to save permanently" : "Save program to cloud"}
          >
            <svg className="w-3.5 h-3.5 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
            <span>Save</span>
          </button>
        </div>

        {/* Right: Layout Toggle, AI Review, Run Button */}
        <div className="flex items-center gap-2">
          {/* Split / Stack layout toggle */}
          <button
            onClick={toggleLayout}
            className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono bg-[#1B2230] hover:bg-[#283347] text-slate-300 border border-[#283347] transition"
            title="Toggle Split / Stack View"
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
            <span>{splitLayout ? "Split" : "Stack"}</span>
          </button>

          {/* Ask AI Tutor */}
          <button
            onClick={askTutorAboutEditorCode}
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-blue-950/50 hover:bg-blue-900/60 text-blue-300 border border-blue-800/60 transition"
            title="Review code with AI Tutor"
          >
            <svg className="w-3.5 h-3.5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"></path></svg>
            <span>Ask Tutor</span>
          </button>

          {/* Run Button (Works for everyone) */}
          <button
            onClick={runCode}
            disabled={isExecuting}
            className="flex items-center gap-1.5 px-4 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-emerald-600/20 transition active:scale-[0.98]"
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

      {/* Optional Left File Explorer Drawer */}
      {fileDrawerOpen && (
        <div className="p-3.5 rounded-xl cd-card border border-[#1E293B] bg-[#0E1118]">
          <div className="flex items-center justify-between pb-2 border-b border-[#1E293B] mb-2.5">
            <span className="text-xs font-mono font-semibold text-slate-300 uppercase">Saved Programs in Cloud</span>
            <button onClick={() => setFileDrawerOpen(false)} className="text-slate-500 hover:text-white text-xs">✕ Close</button>
          </div>
          {savedPrograms.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
              {savedPrograms.map(p => (
                <div
                  key={p.id}
                  onClick={() => loadSelectedProgram(p)}
                  className="p-2 rounded-lg bg-[#11151D] border border-[#1E293B] hover:border-blue-500/50 cursor-pointer transition flex items-center justify-between"
                >
                  <div className="truncate">
                    <div className="text-xs font-mono font-medium text-white truncate">{p.title}</div>
                    <div className="text-[10px] text-slate-500 font-mono uppercase">{p.language}</div>
                  </div>
                  <span className="text-[10px] font-mono text-blue-400">Load</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-slate-500 font-mono py-2">
              {isGuest ? "Sign in to access your cloud-saved scripts across devices." : "No saved scripts found. Click 'Save' in the toolbar to save the current code."}
            </div>
          )}
        </div>
      )}

      {/* Editor & Console Area (Split or Stack layout) */}
      <div className={`grid gap-3 ${splitLayout ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1"}`}>
        {/* Editor Box */}
        <div className="rounded-xl cd-card border border-[#1E293B] overflow-hidden flex flex-col">
          {/* Editor Header Tab */}
          <div className="px-3.5 py-1.5 border-b border-[#1E293B] bg-[#141923] flex items-center justify-between text-xs font-mono text-slate-400 select-none">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span>
              <span className="font-semibold text-white">
                {programTitle ? `${programTitle}.${language === "python" ? "py" : language === "javascript" ? "js" : language}` : "main"}
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span className="uppercase">{language}</span>
              <span>•</span>
              <span>UTF-8</span>
            </div>
          </div>

          <MonacoEditor
            code={code}
            language={language}
            onChange={handleCodeChange}
            height={splitLayout ? "540px" : "440px"}
          />
        </div>

        {/* Output Console Box */}
        <div className="rounded-xl cd-card border border-[#1E293B] overflow-hidden flex flex-col">
          {/* Console Header */}
          <div className="px-3.5 py-1.5 border-b border-[#1E293B] bg-[#141923] flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              <span className="font-semibold text-white">
                Console & Terminal Output
              </span>
            </div>

            <div className="flex items-center gap-2">
              {output && (
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-medium ${
                  output.status === "Success" 
                    ? "bg-emerald-950/80 text-emerald-300 border border-emerald-800/80" 
                    : "bg-red-950/80 text-red-300 border border-red-800/80"
                }`}>
                  {output.status} ({output.execution_time_ms || 0}ms)
                </span>
              )}
              <button
                onClick={() => { setOutput(null); setStdin(""); }}
                className="text-[11px] font-mono text-slate-500 hover:text-slate-300 transition"
                title="Clear console"
              >
                Clear
              </button>
            </div>
          </div>

          <div className={`p-3.5 font-mono text-xs flex flex-col flex-1 bg-[#090B10] text-[#F1F5F9] ${
            splitLayout ? "min-h-[480px]" : "min-h-[170px]"
          }`}>
            {/* Integrated STDIN Input bar */}
            <div className="flex items-center gap-2 pb-2.5 border-b border-[#1E293B] mb-2.5">
              <span className="text-slate-400 font-mono text-xs select-none">STDIN:</span>
              <input
                type="text"
                value={stdin}
                onChange={(e) => setStdin(e.target.value)}
                placeholder="Optional inputs passed to program (e.g. 10 20)... or enter interactively on prompt"
                className="flex-1 cd-input rounded-lg px-2.5 py-1 text-xs font-mono text-[#F1F5F9] placeholder-slate-600 focus:border-blue-500"
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
                    <div className="mt-2 p-3 rounded-lg bg-red-950/40 border border-red-900/60 text-red-300">
                      <pre className="whitespace-pre-wrap leading-relaxed">{output.stderr}</pre>
                    </div>
                  )}
                  {output.tip && (
                    <div className="mt-2 p-2.5 rounded-lg bg-blue-950/40 border border-blue-900/60 text-blue-300 text-xs">
                      {output.tip}
                    </div>
                  )}
                  {output.stderr && (
                    <div className="mt-3">
                      <button
                        onClick={askTutorToFixError}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-medium transition"
                      >
                        <svg className="w-3.5 h-3.5 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                        <span>Ask AI Tutor to Fix This Error</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-slate-600 font-mono text-xs flex items-center gap-2 pt-2">
                  <span>Terminal ready. Click Run or press Ctrl+Enter to execute.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------- AI TUTOR VIEW -----------------
function AITutorView({ currentUser, voiceEnabled, showToast, openInEditor, tutorInitialPrompt, onClearInitialPrompt }) {
  const STORAGE_KEY = "codeloop_ai_tutor_convos_v6";

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
            content: `Hello ${currentUser?.name || "there"}! I am your personal AI programming tutor.\n\nWhether you are writing your first lines of code, debugging tricky compiler errors, or exploring data structures and algorithms, I am here to guide you step by step with clear explanations, practical code examples, and intuitive analogies.\n\nWhat would you like to explore or practice today?`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          }
        ]
      }
    ];
  });

  const [activeConvoId, setActiveConvoId] = useState(() => {
    const savedId = localStorage.getItem("codeloop_active_convo_id_v6");
    return (savedId && conversations.some(c => c.id === savedId))
      ? savedId
      : (conversations[0]?.id || "convo_default");
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("explain");
  const [loading, setLoading] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState(null);

  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const chatContainerRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    } catch (e) {}
  }, [conversations]);

  useEffect(() => {
    if (activeConvoId) {
      localStorage.setItem("codeloop_active_convo_id_v6", activeConvoId);
    }
  }, [activeConvoId]);

  const activeConvo = useMemo(() => {
    return conversations.find(c => c.id === activeConvoId) || conversations[0] || {
      id: "fallback",
      title: "New Conversation",
      mode: "explain",
      messages: []
    };
  }, [conversations, activeConvoId]);

  useEffect(() => {
    if (activeConvo && activeConvo.mode) {
      setMode(activeConvo.mode);
    }
  }, [activeConvo?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConvo?.messages?.length, loading]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 180) + "px";
    }
  }, [input]);

  // Event Delegation for Code Block "Copy" and "Run in Playground" buttons
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
            copyBtn.classList.add('text-emerald-400');
            setTimeout(() => {
              span.textContent = original;
              copyBtn.classList.remove('text-emerald-400');
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
  }, [activeConvo?.messages, openInEditor]);

  const speakText = (text) => {
    if (!voiceEnabled || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const plain = text.replace(/```[\s\S]*?```/g, " [code snippet] ").replace(/[#*`_\[\]()]/g, " ");
      const utterance = new SpeechSynthesisUtterance(plain.slice(0, 300));
      utterance.rate = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (e) {}
  };

  const createNewChat = () => {
    const newChat = {
      id: "convo_" + Date.now(),
      title: "New Conversation",
      mode: mode,
      createdAt: new Date().toISOString(),
      messages: [
        {
          id: "msg_init_" + Date.now(),
          role: "assistant",
          content: `Hello! I'm ready for our new study session. Ask any programming question, share code to debug, or request a concept walkthrough.`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      ]
    };
    setConversations(prev => [newChat, ...prev]);
    setActiveConvoId(newChat.id);
  };

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

    let updatedTitle = activeConvo?.title;
    if (activeConvo?.title === "New Conversation" || currentList.length <= 1) {
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

  const lastProcessedRef = useRef(null);
  useEffect(() => {
    if (tutorInitialPrompt && tutorInitialPrompt.prompt && tutorInitialPrompt.timestamp !== lastProcessedRef.current) {
      lastProcessedRef.current = tutorInitialPrompt.timestamp;
      if (tutorInitialPrompt.mode) {
        setMode(tutorInitialPrompt.mode);
      }
      handleSend(tutorInitialPrompt.prompt);
      if (onClearInitialPrompt) onClearInitialPrompt();
    }
  }, [tutorInitialPrompt]);

  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(c => c.title.toLowerCase().includes(q));
  }, [conversations, searchQuery]);

  return (
    <div className="flex h-full bg-[#090B10] text-[#F1F5F9] overflow-hidden">
      {/* Left Chat History Rail */}
      <div className="w-64 border-r border-[#1E293B] bg-[#0E1118] flex flex-col shrink-0 hidden md:flex">
        <div className="p-3 border-b border-[#1E293B]">
          <button
            onClick={createNewChat}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-md shadow-blue-500/20 transition"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            <span>New Study Session</span>
          </button>
        </div>

        <div className="p-2 border-b border-[#1E293B]">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="w-full cd-input rounded-lg px-2.5 py-1.5 text-xs text-[#F1F5F9] placeholder-slate-600 focus:border-blue-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredConversations.map(c => {
            const isActive = c.id === activeConvoId;
            return (
              <div
                key={c.id}
                onClick={() => setActiveConvoId(c.id)}
                className={`group px-2.5 py-2 rounded-lg text-xs cursor-pointer flex items-center justify-between transition ${
                  isActive ? "bg-[#1B2230] text-white border border-[#283347]" : "text-slate-400 hover:text-white hover:bg-[#141923]"
                }`}
              >
                <div className="truncate flex-1 pr-2">
                  <div className="font-medium truncate">{c.title}</div>
                  <div className="text-[10px] text-slate-500 font-mono capitalize">{c.mode || "explain"}</div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm("Delete conversation?")) {
                      setConversations(prev => prev.filter(item => item.id !== c.id));
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-1"
                  title="Delete chat"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Conversational Workspace */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#090B10]">
        <div className="h-12 px-4 border-b border-[#1E293B] bg-[#0E1118] flex items-center justify-between gap-3">
          <div className="flex items-center gap-1 overflow-x-auto">
            <span className="text-[11px] font-mono uppercase text-slate-500 mr-2 hidden sm:inline">Tutoring Mode:</span>
            {[
              { id: "explain", label: "Explain Concept" },
              { id: "debug", label: "Debug Code" },
              { id: "practice", label: "Hint Ladder" },
              { id: "quiz", label: "Socratic Check" }
            ].map(m => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono transition ${
                  mode === m.id
                    ? "bg-[#1B2230] text-blue-400 border border-[#283347] font-semibold"
                    : "text-slate-400 hover:text-white hover:bg-[#141923]"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              if (window.confirm("Clear all messages in this session?")) {
                setConversations(prev => prev.map(c => c.id === activeConvoId ? { ...c, messages: [] } : c));
              }
            }}
            className="text-[11px] font-mono text-slate-500 hover:text-slate-300 transition"
          >
            Clear Messages
          </button>
        </div>

        {/* Message Thread */}
        <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 max-w-4xl w-full mx-auto">
          {activeConvo?.messages?.map(msg => (
            <div
              key={msg.id}
              className={`flex gap-3.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="w-7 h-7 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-bold text-xs shrink-0 mt-1">
                  AI
                </div>
              )}

              <div className={`max-w-[85%] rounded-xl p-4 text-xs ${
                msg.role === "user" 
                  ? "bg-[#1B2230] border border-[#283347] text-white" 
                  : "cd-card border border-[#1E293B] text-slate-200"
              }`}>
                {msg.role === "assistant" ? (
                  <div 
                    className="prose-dark" 
                    dangerouslySetInnerHTML={{ __html: renderMarkdownWithPrism(msg.content) }} 
                  />
                ) : (
                  <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
                )}
                <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono mt-2 pt-1 border-t border-slate-800/60">
                  <span>{msg.timestamp}</span>
                  {msg.role === "assistant" && (
                    <button
                      onClick={() => {
                        if (navigator.clipboard) {
                          navigator.clipboard.writeText(msg.content);
                          setCopiedMsgId(msg.id);
                          setTimeout(() => setCopiedMsgId(null), 2000);
                        }
                      }}
                      className="hover:text-blue-400 transition"
                    >
                      {copiedMsgId === msg.id ? "Copied!" : "Copy Full Text"}
                    </button>
                  )}
                </div>
              </div>

              {msg.role === "user" && (
                <div className="w-7 h-7 rounded-lg bg-[#1B2230] border border-[#283347] text-slate-300 flex items-center justify-center font-bold text-xs shrink-0 mt-1">
                  {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : "U"}
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-3.5 justify-start">
              <div className="w-7 h-7 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-bold text-xs shrink-0 animate-subtle-pulse">
                AI
              </div>
              <div className="p-4 rounded-xl cd-card border border-[#1E293B] flex items-center gap-2 text-xs font-mono text-slate-400">
                <svg className="w-3.5 h-3.5 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20"></circle></svg>
                <span>AI Tutor is formulating an educational explanation...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Bottom Input Area */}
        <div className="p-4 border-t border-[#1E293B] bg-[#0E1118]">
          <div className="max-w-4xl mx-auto space-y-2">
            <div className="flex gap-2">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder="Ask about a coding concept, paste code to debug, or ask for a hint..."
                rows="1"
                className="flex-1 cd-input rounded-xl p-3 text-xs leading-relaxed focus:border-blue-500 resize-none max-h-40"
              />
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || loading}
                className="px-4 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold shadow-md shadow-blue-500/20 transition active:scale-[0.98] shrink-0"
              >
                Send
              </button>
            </div>
            <div className="text-[10px] text-slate-500 font-mono text-center">
              Press Enter to send • Shift + Enter for new lines
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------- PRACTICE ZONE VIEW -----------------
function PracticeZoneView({ currentUser, showToast, askTutor, requireAuth }) {
  const isGuest = currentUser?.isGuest;
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
  }, [currentUser]);

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
    if (nextLevel > (selectedProblem.total_hints || 3)) return;

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
        showToast("Challenge Accepted! All test cases passed.", "success");
      } else {
        showToast(`Evaluation: ${res.status}`, "info");
      }
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const askTutorForConceptualHint = () => {
    if (!askTutor || !selectedProblem) return;
    const prompt = `I am practicing the problem "${selectedProblem.title}":\n\n${selectedProblem.description}\n\nCould you give me a conceptual hint on how to design this algorithm without giving away the full code solution?`;
    askTutor(prompt, "practice");
  };

  const filteredProblems = useMemo(() => {
    if (filterDifficulty === "all") return problems;
    return problems.filter(p => p.difficulty.toLowerCase() === filterDifficulty.toLowerCase());
  }, [problems, filterDifficulty]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
      {/* Problem Directory Sidebar */}
      <div className="lg:col-span-4 rounded-xl cd-card border border-[#1E293B] p-3.5 flex flex-col h-[740px]">
        <div className="flex items-center justify-between pb-2.5 border-b border-[#1E293B]">
          <span className="font-mono text-xs font-semibold uppercase text-white">Coding Challenges</span>
          <span className="text-[11px] font-mono text-emerald-400 font-semibold">
            {problems.filter(p => p.solved).length}/{problems.length} Solved
          </span>
        </div>

        {/* Filter Pills */}
        <div className="flex gap-1 my-2.5">
          {["all", "beginner", "intermediate", "advanced"].map(d => (
            <button
              key={d}
              onClick={() => setFilterDifficulty(d)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono capitalize transition ${
                filterDifficulty === d 
                  ? "bg-blue-600 text-white font-semibold" 
                  : "text-slate-400 hover:text-white hover:bg-[#1B2230]"
              }`}
            >
              {d}
            </button>
          ))}
        </div>

        {/* Problems List */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {filteredProblems.map(p => {
            const isSelected = selectedProblem?.id === p.id;
            return (
              <div
                key={p.id}
                onClick={() => loadProblem(p.id)}
                className={`p-2.5 rounded-lg border cursor-pointer transition ${
                  isSelected 
                    ? "bg-[#1B2230] border-blue-500/50 text-white" 
                    : "bg-[#0E1118] border-[#1E293B] hover:border-slate-700 text-slate-300"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-xs truncate">{p.title}</span>
                  {p.solved && <span className="text-emerald-400 text-xs">✓</span>}
                </div>
                <div className="flex items-center gap-2 mt-1 text-[10px] font-mono text-slate-500">
                  <span className="capitalize">{p.difficulty}</span>
                  <span>•</span>
                  <span>{p.topic}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Problem Specification & Monaco Test Runner */}
      <div className="lg:col-span-8 space-y-3">
        {selectedProblem && (
          <>
            <div className="p-3.5 rounded-xl cd-card border border-[#1E293B] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-white">{selectedProblem.title}</span>
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded uppercase font-semibold ${
                  selectedProblem.difficulty === "Beginner" ? "bg-emerald-950/70 text-emerald-300 border border-emerald-800" :
                  selectedProblem.difficulty === "Intermediate" ? "bg-blue-950/70 text-blue-300 border border-blue-800" :
                  "bg-amber-950/70 text-amber-300 border border-amber-800"
                }`}>
                  {selectedProblem.difficulty}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={askTutorForConceptualHint}
                  className="px-2.5 py-1 rounded-lg text-xs font-mono bg-blue-950/50 hover:bg-blue-900/60 text-blue-300 border border-blue-800/60 transition"
                >
                  Ask Tutor
                </button>
                <button
                  onClick={submitSolution}
                  disabled={submitting}
                  className="px-4 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-emerald-600/20 transition active:scale-[0.98]"
                >
                  {submitting ? "Evaluating..." : "Run & Submit"}
                </button>
              </div>
            </div>

            {/* Description & Hint Ladder */}
            <div className="p-4 rounded-xl cd-card border border-[#1E293B] space-y-3">
              <div className="text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                {selectedProblem.description}
              </div>

              {/* Progressive Hint Ladder */}
              <div className="pt-2 border-t border-[#1E293B] flex items-center justify-between">
                <div className="text-[11px] font-mono text-slate-400">
                  Hints: {currentHintLevel}/{selectedProblem.total_hints || 3} revealed
                </div>
                {currentHintLevel < (selectedProblem.total_hints || 3) && (
                  <button
                    onClick={requestNextHint}
                    className="text-xs font-mono text-blue-400 hover:underline"
                  >
                    Reveal Next Hint →
                  </button>
                )}
              </div>

              {Object.keys(revealedHints).length > 0 && (
                <div className="space-y-1.5">
                  {Object.entries(revealedHints).map(([lvl, text]) => (
                    <div key={lvl} className="p-2.5 rounded-lg bg-[#0E1118] border border-[#1E293B] text-xs text-blue-300">
                      <span className="font-mono font-semibold">Hint {lvl}:</span> {text}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Monaco Code Editor */}
            <div className="rounded-xl cd-card border border-[#1E293B] overflow-hidden">
              <div className="px-3.5 py-1.5 border-b border-[#1E293B] bg-[#141923] flex items-center justify-between text-xs font-mono text-slate-400">
                <span className="text-white font-semibold">Solution Implementation</span>
                <span className="uppercase text-blue-400 font-semibold">{language}</span>
              </div>
              <MonacoEditor
                code={code}
                language={language}
                onChange={setCode}
                height="340px"
              />
            </div>

            {/* Test Case Evaluation Results */}
            {submissionResult && (
              <div className={`p-4 rounded-xl border ${
                submissionResult.status === "Accepted"
                  ? "bg-emerald-950/20 border-emerald-800/60 text-emerald-200"
                  : "bg-red-950/20 border-red-800/60 text-red-200"
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm">{submissionResult.status}</span>
                  <span className="text-xs font-mono font-semibold">
                    Passed {submissionResult.passed_tests}/{submissionResult.total_tests} Tests
                  </span>
                </div>
                <div className="text-xs text-slate-300 font-mono">
                  {submissionResult.explanation}
                </div>

                {/* Contextual Signup Callout when Guest Solves a Challenge */}
                {isGuest && submissionResult.status === "Accepted" && (
                  <div className="mt-3 pt-3 border-t border-emerald-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <span className="text-[11px] text-emerald-300">
                      Challenge accepted! Create a free account to permanently record this challenge on your profile and build your learning streak.
                    </span>
                    <button
                      onClick={() => requireAuth("Create an account to save your solved challenges and build your learning streak.")}
                      className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shrink-0"
                    >
                      Claim Solved Badge →
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ----------------- LEARNING HUB VIEW -----------------
function LearningHubView({ currentUser, showToast, openInEditor, askTutor, requireAuth }) {
  const isGuest = currentUser?.isGuest;
  const [hubTab, setHubTab] = useState("courses");

  // Quizzes State
  const [topic, setTopic] = useState("Python Basics");
  const [language, setLanguage] = useState("Python");
  const [difficulty, setDifficulty] = useState("Beginner");
  const [quizState, setQuizState] = useState("idle");
  const [questions, setQuestions] = useState([]);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState({});
  const [quizResult, setQuizResult] = useState(null);
  const [loadingQuiz, setLoadingQuiz] = useState(false);

  const courses = [
    {
      id: "py_basics",
      title: "Python 3 Programming Fundamentals",
      category: "Foundation",
      level: "Beginner",
      duration: "4 weeks • 16 lessons",
      progress: isGuest ? 0 : 65,
      description: "Master variables, data types, logic operators, loops, and reusable functions.",
      modules: [
        { title: "Module 1: Syntax & Variables", status: isGuest ? "Ready" : "Completed" },
        { title: "Module 2: Conditionals & Control Flow", status: isGuest ? "Ready" : "Completed" },
        { title: "Module 3: Loops & Iterators", status: isGuest ? "Ready" : "In Progress" },
        { title: "Module 4: Functions & Scope", status: "Ready" }
      ]
    },
    {
      id: "dsa_core",
      title: "Data Structures & Two-Pointer Algorithms",
      category: "Algorithms",
      level: "Intermediate",
      duration: "6 weeks • 24 lessons",
      progress: isGuest ? 0 : 35,
      description: "Implement arrays, hash maps, queues, stacks, and analyze Big-O complexity.",
      modules: [
        { title: "Module 1: Arrays & Memory Models", status: "Ready" },
        { title: "Module 2: Two-Pointer Technique", status: "Ready" },
        { title: "Module 3: Hash Tables & Sets", status: "Ready" },
        { title: "Module 4: Recursion & Sorting", status: "Ready" }
      ]
    },
    {
      id: "c_systems",
      title: "C & Systems Programming Foundations",
      category: "Systems",
      level: "Intermediate",
      duration: "5 weeks • 20 lessons",
      progress: isGuest ? 0 : 15,
      description: "Direct memory management, pointer arithmetic, struct memory layout, and standard POSIX I/O.",
      modules: [
        { title: "Module 1: C Syntax & Compilers (GCC)", status: "Ready" },
        { title: "Module 2: Pointers & Addresses", status: "Ready" },
        { title: "Module 3: Dynamic Memory (malloc/free)", status: "Ready" }
      ]
    },
    {
      id: "js_web",
      title: "Modern JavaScript & Async Execution",
      category: "Web & Engine",
      level: "Beginner",
      duration: "3 weeks • 12 lessons",
      progress: isGuest ? 0 : 50,
      description: "Understand the Event Loop, Promises, Async/Await, closures, and modular JS.",
      modules: [
        { title: "Module 1: ES6+ Syntax & Scope", status: "Ready" },
        { title: "Module 2: Array High-Order Methods", status: "Ready" },
        { title: "Module 3: Async/Await & Fetch", status: "Ready" }
      ]
    }
  ];

  const startQuiz = async () => {
    setLoadingQuiz(true);
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
      setLoadingQuiz(false);
    }
  };

  const handleSelectOption = (optIndex) => {
    const qid = String(questions[currentQIndex].id);
    setSelectedAnswers(prev => ({ ...prev, [qid]: optIndex }));
  };

  const submitQuiz = async () => {
    setLoadingQuiz(true);
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
      setLoadingQuiz(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-[#1E293B] gap-3">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Structured Learning Hub</h2>
          <p className="text-xs text-slate-400 font-mono mt-0.5">
            Curated curriculum tracks, progressive modules, and interactive assessments.
          </p>
        </div>

        <div className="flex items-center gap-1.5 bg-[#0E1118] p-1 rounded-lg border border-[#1E293B] shrink-0">
          <button
            onClick={() => setHubTab("courses")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${
              hubTab === "courses" ? "bg-[#1B2230] text-blue-400 font-semibold shadow-sm" : "text-slate-400 hover:text-white"
            }`}
          >
            Learning Paths
          </button>
          <button
            onClick={() => setHubTab("quizzes")}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${
              hubTab === "quizzes" ? "bg-[#1B2230] text-blue-400 font-semibold shadow-sm" : "text-slate-400 hover:text-white"
            }`}
          >
            Knowledge Assessments
          </button>
        </div>
      </div>

      {hubTab === "courses" ? (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {courses.map(course => (
              <div
                key={course.id}
                className="p-5 rounded-xl cd-card border border-[#1E293B] flex flex-col justify-between hover:border-blue-500/40 transition group"
              >
                <div>
                  <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 mb-2">
                    <span className="uppercase tracking-wider px-2 py-0.5 rounded bg-[#1B2230] text-blue-400 font-semibold">
                      {course.category}
                    </span>
                    <span>{course.duration}</span>
                  </div>

                  <h3 className="font-bold text-base text-white group-hover:text-blue-300 transition">
                    {course.title}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    {course.description}
                  </p>

                  <div className="mt-4 space-y-1.5">
                    {course.modules.map((m, idx) => (
                      <div key={idx} className="flex items-center justify-between text-xs py-1 border-t border-[#1E293B]">
                        <span className="text-slate-300">{m.title}</span>
                        <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-semibold ${
                          m.status === "Completed" ? "text-emerald-400" : m.status === "In Progress" ? "text-blue-400" : "text-slate-400"
                        }`}>
                          {m.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-[#1E293B] flex items-center justify-between">
                  <div className="w-1/2">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 mb-1">
                      <span>Progress</span>
                      <span className="text-white font-semibold">{course.progress}%</span>
                    </div>
                    <div className="w-full bg-[#1B2230] h-1.5 rounded-full overflow-hidden">
                      <div className="bg-blue-600 h-full rounded-full" style={{ width: `${course.progress}%` }}></div>
                    </div>
                  </div>

                  <button
                    onClick={() => askTutor(`I want to study ${course.title}. Can you guide me through ${course.modules[0].title}?`, "explain")}
                    className="px-3 py-1.5 rounded-lg bg-[#1B2230] hover:bg-[#283347] text-white text-xs font-semibold border border-[#283347] transition"
                  >
                    Study with Tutor →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Dynamic Assessment / Quiz Generator */
        <div className="max-w-3xl mx-auto space-y-4">
          {quizState === "idle" && (
            <div className="p-6 rounded-xl cd-card border border-[#1E293B] space-y-4">
              <div>
                <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 font-semibold border border-blue-500/20">
                  ASSESSMENT GENERATOR
                </span>
                <h3 className="text-lg font-bold text-white tracking-tight mt-1.5">
                  Interactive Programming Knowledge Assessment
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Test your comprehension with adaptive multiple-choice questions. Open to all students & guests.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">Topic</label>
                  <select
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    className="w-full cd-input rounded-lg px-3 py-2 text-xs font-mono"
                  >
                    <option value="Python Basics">Python Basics</option>
                    <option value="Loops & Iteration">Loops & Iteration</option>
                    <option value="Functions & Scope">Functions & Scope</option>
                    <option value="Arrays & Lists">Arrays & Lists</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">Language</label>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-full cd-input rounded-lg px-3 py-2 text-xs font-mono"
                  >
                    <option value="Python">Python</option>
                    <option value="JavaScript">JavaScript</option>
                    <option value="C++">C++</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-300 block mb-1">Difficulty</label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value)}
                    className="w-full cd-input rounded-lg px-3 py-2 text-xs font-mono"
                  >
                    <option value="Beginner">Beginner</option>
                    <option value="Intermediate">Intermediate</option>
                    <option value="Advanced">Advanced</option>
                  </select>
                </div>
              </div>

              <button
                onClick={startQuiz}
                disabled={loadingQuiz}
                className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-xs shadow-md shadow-blue-500/20 transition active:scale-[0.99]"
              >
                {loadingQuiz ? "Generating Assessment Questions..." : "Generate & Start Quiz"}
              </button>
            </div>
          )}

          {quizState === "running" && questions.length > 0 && (
            <div className="p-6 rounded-xl cd-card border border-[#1E293B] space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-[#1E293B]">
                <span className="text-xs font-mono text-slate-400">
                  Question {currentQIndex + 1} of {questions.length}
                </span>
                <span className="text-xs font-mono text-blue-400 font-semibold">{topic}</span>
              </div>

              <div className="text-sm font-medium text-white leading-relaxed">
                {questions[currentQIndex]?.question}
              </div>

              {questions[currentQIndex]?.code_snippet && (
                <div className="p-3 rounded-lg bg-[#0E1118] border border-[#1E293B] font-mono text-xs text-blue-300">
                  <pre>{questions[currentQIndex].code_snippet}</pre>
                </div>
              )}

              {/* Options */}
              <div className="space-y-2">
                {questions[currentQIndex]?.options?.map((opt, idx) => {
                  const qid = String(questions[currentQIndex].id);
                  const isSelected = selectedAnswers[qid] === idx;
                  return (
                    <div
                      key={idx}
                      onClick={() => handleSelectOption(idx)}
                      className={`p-3 rounded-lg border text-xs cursor-pointer transition flex items-center justify-between ${
                        isSelected 
                          ? "bg-[#1B2230] border-blue-500 text-white font-medium" 
                          : "bg-[#0E1118] border-[#1E293B] hover:border-slate-700 text-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="w-5 h-5 rounded-full bg-[#1B2230] border border-[#283347] flex items-center justify-center text-[10px] font-mono font-bold">
                          {String.fromCharCode(65 + idx)}
                        </span>
                        <span>{opt}</span>
                      </div>
                      {isSelected && <span className="text-blue-400">●</span>}
                    </div>
                  );
                })}
              </div>

              {/* Quiz Navigation */}
              <div className="flex items-center justify-between pt-3 border-t border-[#1E293B]">
                <button
                  onClick={() => setCurrentQIndex(prev => Math.max(prev - 1, 0))}
                  disabled={currentQIndex === 0}
                  className="px-3 py-1.5 rounded-lg bg-[#1B2230] hover:bg-[#283347] disabled:opacity-40 text-xs text-slate-300"
                >
                  Previous
                </button>

                {currentQIndex < questions.length - 1 ? (
                  <button
                    onClick={() => setCurrentQIndex(prev => prev + 1)}
                    className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
                  >
                    Next Question →
                  </button>
                ) : (
                  <button
                    onClick={submitQuiz}
                    disabled={loadingQuiz}
                    className="px-5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold"
                  >
                    {loadingQuiz ? "Scoring..." : "Submit Answers"}
                  </button>
                )}
              </div>
            </div>
          )}

          {quizState === "result" && quizResult && (
            <div className="p-6 rounded-xl cd-card border border-[#1E293B] space-y-4">
              <div className="text-center py-4 space-y-2">
                <span className="text-3xl font-bold font-mono text-emerald-400">
                  {quizResult.score} / {quizResult.total}
                </span>
                <div className="text-sm font-semibold text-white">
                  Score: {quizResult.percentage}% Accuracy
                </div>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  {quizResult.percentage >= 80 ? "Outstanding performance! You have strong conceptual understanding of this topic." : "Good effort! Review the detailed question explanations below to solidify edge cases."}
                </p>
                {isGuest && (
                  <div className="pt-2">
                    <button
                      onClick={() => requireAuth("Sign up to save quiz scores and monitor your learning retention over time.")}
                      className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow"
                    >
                      Save Scores to Free Account →
                    </button>
                  </div>
                )}
              </div>

              {/* Explanations Breakdown */}
              <div className="space-y-3 pt-3 border-t border-[#1E293B]">
                {quizResult.results?.map((res, i) => (
                  <div key={i} className={`p-3.5 rounded-lg border text-xs space-y-1.5 ${
                    res.is_correct ? "bg-emerald-950/20 border-emerald-900/60" : "bg-red-950/20 border-red-900/60"
                  }`}>
                    <div className="flex items-center justify-between font-semibold">
                      <span className="text-white">Q{i + 1}: {res.question}</span>
                      <span className={res.is_correct ? "text-emerald-400" : "text-red-400"}>
                        {res.is_correct ? "Correct (+1)" : "Incorrect"}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Correct Answer: <span className="text-white font-medium">{res.correct_answer}</span>
                    </div>
                    {res.explanation && (
                      <div className="text-[11px] text-slate-300 pt-1 border-t border-slate-800">
                        {res.explanation}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <button
                onClick={() => setQuizState("idle")}
                className="w-full py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition"
              >
                Take Another Assessment
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ----------------- STUDY MATERIALS VIEW -----------------
function StudyMaterialsView({ currentUser, showToast, askTutor, requireAuth }) {
  const isGuest = currentUser?.isGuest;
  const [materials, setMaterials] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [docQuestion, setDocQuestion] = useState("");
  const [docAnswer, setDocAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  // Personal Revision Notes
  const [notes, setNotes] = useState([]);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [noteTags, setNoteTags] = useState("");

  useEffect(() => {
    if (!isGuest) {
      fetchMaterials();
      fetchNotes();
    } else {
      setMaterials([
        {
          id: "demo_doc_1",
          file_name: "Python_Algorithms_Guide.pdf",
          upload_date: new Date().toISOString(),
          summary: "Comprehensive guide covering Big-O notation, binary search, recursive backtracking, and two-pointer strategies in Python."
        }
      ]);
      setSelectedDoc({
        id: "demo_doc_1",
        file_name: "Python_Algorithms_Guide.pdf",
        upload_date: new Date().toISOString(),
        summary: "Comprehensive guide covering Big-O notation, binary search, recursive backtracking, and two-pointer strategies in Python."
      });
    }
  }, [isGuest]);

  const fetchMaterials = async () => {
    try {
      const data = await apiRequest("/api/materials");
      setMaterials(data);
      if (data.length > 0 && !selectedDoc) {
        setSelectedDoc(data[0]);
      }
    } catch (err) {}
  };

  const fetchNotes = async () => {
    try {
      const data = await apiRequest("/api/notes");
      setNotes(data);
    } catch (err) {}
  };

  const handleFileUpload = async (e) => {
    if (isGuest) {
      requireAuth("Create a free account to upload, index, and query personal study documents.");
      return;
    }

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
      if (isGuest) {
        // Safe offline pedagogical demo for guests
        setTimeout(() => {
          setDocAnswer(`Sample Grounded Answer for "${docQuestion}":\n\nThe uploaded document explains that algorithmic efficiency is evaluated using worst-case Big-O bounds. For linear scans, runtime is O(N); for balanced search trees, runtime is O(log N).`);
          setAsking(false);
        }, 500);
        return;
      }

      const res = await apiRequest(`/api/materials/${selectedDoc.id}/chat`, "POST", {
        question: docQuestion
      });
      setDocAnswer(res.answer || res.response || "No response generated.");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setAsking(false);
    }
  };

  const handleCreateNote = async (e) => {
    e.preventDefault();
    if (!noteTitle.trim() || !noteContent.trim()) return;

    if (isGuest) {
      requireAuth("Create an account to save personal revision notes across sessions.", () => {
        doSaveNote();
      });
      return;
    }
    doSaveNote();
  };

  const doSaveNote = async () => {
    try {
      await apiRequest("/api/notes", "POST", {
        title: noteTitle,
        content: noteContent,
        tags: noteTags.split(",").map(t => t.trim()).filter(Boolean)
      });
      setNoteTitle("");
      setNoteContent("");
      setNoteTags("");
      fetchNotes();
      showToast("Note recorded.", "success");
    } catch (err) {
      showToast(err.message, "error");
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

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Document Library */}
        <div className="lg:col-span-4 rounded-xl cd-card border border-[#1E293B] p-4 flex flex-col h-[700px]">
          <div className="flex items-center justify-between pb-2.5 border-b border-[#1E293B]">
            <span className="font-mono text-xs font-semibold uppercase text-white">Study Documents</span>
            <span className="text-[11px] font-mono text-slate-400">{materials.length} Files</span>
          </div>

          {/* Upload Dropzone */}
          <div className="my-3">
            <label className="flex flex-col items-center justify-center p-4 border border-dashed border-[#1E293B] hover:border-blue-500/50 rounded-xl cursor-pointer bg-[#0E1118] transition group">
              <svg className="w-5 h-5 text-slate-500 group-hover:text-blue-400 mb-1.5 transition" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              <span className="text-xs font-medium text-slate-300 group-hover:text-white">
                {uploading ? "Indexing PDF Document..." : "Upload PDF or Notes"}
              </span>
              <span className="text-[10px] text-slate-500 font-mono mt-0.5">Supports .pdf, .txt</span>
              <input type="file" accept=".pdf,.txt" onChange={handleFileUpload} className="hidden" disabled={uploading} />
            </label>
          </div>

          {/* Documents List */}
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {materials.map(doc => {
              const isSelected = selectedDoc?.id === doc.id;
              return (
                <div
                  key={doc.id}
                  onClick={() => { setSelectedDoc(doc); setDocAnswer(""); }}
                  className={`p-3 rounded-lg border cursor-pointer transition ${
                    isSelected ? "bg-[#1B2230] border-blue-500/50 text-white" : "bg-[#0E1118] border-[#1E293B] text-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-red-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                    <span className="font-medium text-xs truncate">{doc.file_name}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 font-mono mt-1">
                    Uploaded {new Date(doc.upload_date).toLocaleDateString()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Document Inspection & AI Q&A */}
        <div className="lg:col-span-8 space-y-4">
          {selectedDoc && (
            <div className="p-5 rounded-xl cd-card border border-[#1E293B] space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#1E293B]">
                <div>
                  <h3 className="font-bold text-base text-white">{selectedDoc.file_name}</h3>
                  <div className="text-[10px] font-mono text-slate-400">Semantic Document RAG Active</div>
                </div>
                <button
                  onClick={() => {
                    askTutor(`Here is an excerpt from my study material "${selectedDoc.file_name}":\n\n${(selectedDoc.summary || "").slice(0, 400)}\n\nPlease give me a structured summary with 3 key questions to test myself on.`, "explain");
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[#1B2230] hover:bg-[#283347] text-xs font-mono text-blue-300 border border-[#283347]"
                >
                  Ask Tutor to Summarize
                </button>
              </div>

              {selectedDoc.summary && (
                <div className="p-3.5 rounded-lg bg-[#0E1118] border border-[#1E293B]">
                  <div className="text-[11px] font-mono uppercase text-blue-400 font-semibold mb-1">Document Summary</div>
                  <div className="text-xs text-slate-300 leading-relaxed">{selectedDoc.summary}</div>
                </div>
              )}

              <div className="space-y-2 pt-2">
                <div className="text-xs font-semibold text-white">Ask Questions Grounded in Document</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={docQuestion}
                    onChange={(e) => setDocQuestion(e.target.value)}
                    placeholder="Ask anything covered in this document..."
                    className="flex-1 cd-input rounded-lg px-3 py-2 text-xs focus:border-blue-500"
                    onKeyDown={(e) => e.key === "Enter" && queryDocument()}
                  />
                  <button
                    onClick={queryDocument}
                    disabled={asking || !docQuestion.trim()}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold"
                  >
                    {asking ? "Querying..." : "Ask"}
                  </button>
                </div>

                {docAnswer && (
                  <div className="p-4 rounded-lg bg-[#0E1118] border border-[#1E293B] text-xs text-slate-200 mt-3 whitespace-pre-wrap leading-relaxed">
                    {docAnswer}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Student Revision Journal */}
          <div className="p-5 rounded-xl cd-card border border-[#1E293B] space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-[#1E293B]">
              <h3 className="font-bold text-sm text-white">Personal Revision Notes</h3>
              <span className="text-[10px] font-mono text-slate-400">{notes.length} Recorded Notes</span>
            </div>

            <form onSubmit={handleCreateNote} className="space-y-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <input
                  type="text"
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="Note Title (e.g. Recursion Base Cases)"
                  className="cd-input rounded-lg px-3 py-2 text-xs focus:border-blue-500"
                  required
                />
                <input
                  type="text"
                  value={noteTags}
                  onChange={(e) => setNoteTags(e.target.value)}
                  placeholder="Tags (e.g. python, dsa)"
                  className="cd-input rounded-lg px-3 py-2 text-xs font-mono focus:border-blue-500"
                />
              </div>
              <textarea
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                placeholder="Write key code patterns, rules, or formulas..."
                rows="2"
                className="w-full cd-input rounded-lg p-3 text-xs leading-relaxed focus:border-blue-500"
                required
              />
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold"
              >
                Save Revision Note
              </button>
            </form>

            {notes.length > 0 && (
              <div className="space-y-2 pt-2">
                {notes.map(n => (
                  <div key={n.id} className="p-3 rounded-lg bg-[#0E1118] border border-[#1E293B] text-xs space-y-1">
                    <div className="flex items-center justify-between font-semibold text-white">
                      <span>{n.title}</span>
                      <button onClick={() => handleDeleteNote(n.id)} className="text-slate-500 hover:text-red-400 text-xs">✕</button>
                    </div>
                    <p className="text-slate-400 text-[11px] whitespace-pre-wrap">{n.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ----------------- ANALYTICS VIEW -----------------
function ProgressAnalyticsView({ currentUser, showToast, askTutor, requireAuth }) {
  const isGuest = currentUser?.isGuest;
  const [stats, setStats] = useState(null);
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, [currentUser]);

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

  if (loading) {
    return (
      <div className="py-20 text-center text-xs font-mono text-slate-400 flex flex-col items-center justify-center gap-3">
        <svg className="w-5 h-5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="60" strokeDashoffset="20"></circle></svg>
        <span>Loading telemetry analytics...</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Diagnostics Banner */}
      <div className="p-6 rounded-xl cd-card border border-[#1E293B] space-y-2">
        <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold">
          ADAPTIVE TELEMETRY
        </span>
        <h3 className="text-lg font-bold text-white tracking-tight">
          Current Learning Focus: {plan?.current_focus || "Algorithmic Control Flow"}
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Based on your code execution patterns and problem submissions, your growth path emphasizes structured iteration and modular function boundaries.
        </p>

        {isGuest && (
          <div className="pt-2">
            <button
              onClick={() => requireAuth("Create an account to track your real-time skill telemetry and daily streaks.")}
              className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow"
            >
              Sign Up to Track Real Telemetry →
            </button>
          </div>
        )}
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <div className="p-4 rounded-xl cd-card border border-[#1E293B]">
          <div className="text-[10px] font-mono uppercase text-slate-500">Streak</div>
          <div className="text-2xl font-bold font-mono text-amber-400 mt-1">{stats?.learning_streak || 1} Days</div>
        </div>
        <div className="p-4 rounded-xl cd-card border border-[#1E293B]">
          <div className="text-[10px] font-mono uppercase text-slate-500">Solved</div>
          <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">{stats?.problems_solved || 0}</div>
        </div>
        <div className="p-4 rounded-xl cd-card border border-[#1E293B]">
          <div className="text-[10px] font-mono uppercase text-slate-500">Code Sessions</div>
          <div className="text-2xl font-bold font-mono text-white mt-1">{stats?.total_coding_sessions || 0}</div>
        </div>
        <div className="p-4 rounded-xl cd-card border border-[#1E293B]">
          <div className="text-[10px] font-mono uppercase text-slate-500">Quiz Accuracy</div>
          <div className="text-2xl font-bold font-mono text-blue-400 mt-1">{stats?.quiz_performance_pct || 0}%</div>
        </div>
      </div>

      {/* Recommended Roadmap Steps */}
      <div className="p-6 rounded-xl cd-card border border-[#1E293B] space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wider font-mono text-white">
          Personalized Adaptive Steps
        </div>
        <div className="space-y-2">
          {plan?.steps?.map((step, idx) => (
            <div
              key={idx}
              className="p-3.5 rounded-lg bg-[#0E1118] border border-[#1E293B] flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs font-bold text-blue-400 w-6">0{idx + 1}</span>
                <div>
                  <div className="font-semibold text-xs text-white">{step.name}</div>
                  <div className="text-[11px] text-slate-400">{step.description}</div>
                </div>
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded uppercase font-semibold bg-[#1B2230] text-blue-400">
                {step.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Topic Mastery Bars */}
      <div className="p-6 rounded-xl cd-card border border-[#1E293B] space-y-3">
        <div className="text-xs font-semibold uppercase tracking-wider font-mono text-white">
          Computer Science Topic Mastery
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {[
            { topic: "Variables & Standard I/O", progress: isGuest ? 20 : 92 },
            { topic: "Conditionals & Logic", progress: isGuest ? 15 : 85 },
            { topic: "Loops & Iterators", progress: isGuest ? 10 : 75 },
            { topic: "Functions & Scope", progress: isGuest ? 0 : 62 },
            { topic: "Arrays & Strings", progress: isGuest ? 0 : 48 },
            { topic: "Algorithmic Complexity", progress: isGuest ? 0 : 32 }
          ].map((item, idx) => (
            <div key={idx} className="p-3 rounded-lg bg-[#0E1118] border border-[#1E293B]">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="font-medium text-slate-300">{item.topic}</span>
                <span className="font-mono text-xs text-blue-400 font-semibold">{item.progress}%</span>
              </div>
              <div className="w-full bg-[#1B2230] h-1.5 rounded-full overflow-hidden">
                <div className="bg-blue-600 h-full rounded-full transition-all" style={{ width: `${item.progress}%` }}></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ----------------- PROFILE VIEW -----------------
function ProfileView({ currentUser, refreshProfile, showToast, requireAuth }) {
  const isGuest = currentUser?.isGuest;
  const [name, setName] = useState(currentUser.name || "");
  const [learningGoals, setLearningGoals] = useState(currentUser.learning_goals || "");
  const [expLevel, setExpLevel] = useState(currentUser.experience_level || "Beginner");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(currentUser.name || "");
    setLearningGoals(currentUser.learning_goals || "");
    setExpLevel(currentUser.experience_level || "Beginner");
  }, [currentUser]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (isGuest) {
      requireAuth("Create an account or sign in to save your personal student profile.");
      return;
    }
    setSaving(true);
    try {
      await apiRequest("/api/auth/profile", "PUT", {
        name,
        learning_goals: learningGoals,
        experience_level: expLevel
      });
      refreshProfile();
      showToast("Profile updated successfully.", "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Student Badge Card */}
      <div className="p-6 rounded-xl cd-card border border-[#1E293B] flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center font-bold text-xl shadow-md shrink-0">
            {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : "G"}
          </div>
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">{currentUser.name}</h2>
            <div className="text-xs text-slate-400 font-mono mt-0.5">
              {isGuest ? "Unregistered Guest Explorer" : currentUser.email}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded font-semibold ${
                isGuest ? "bg-amber-500/10 text-amber-400 border border-amber-500/20" : "bg-[#1B2230] text-blue-400"
              }`}>
                {currentUser.experience_level || "Beginner"}
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                {isGuest ? "Temporary Session" : `Member since ${currentUser.created_at ? new Date(currentUser.created_at).toLocaleDateString() : "2026"}`}
              </span>
            </div>
          </div>
        </div>

        {isGuest && (
          <button
            onClick={() => requireAuth("Create an account to save personal progress and customize your experience.")}
            className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shrink-0 transition"
          >
            Create Account
          </button>
        )}
      </div>

      {/* Edit Profile Form */}
      <div className="p-6 rounded-xl cd-card border border-[#1E293B] space-y-4">
        <h3 className="text-base font-bold text-white">Student Profile Settings</h3>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full cd-input rounded-lg px-3 py-2 text-xs focus:border-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Coding Experience Level</label>
            <select
              value={expLevel}
              onChange={(e) => setExpLevel(e.target.value)}
              className="w-full cd-input rounded-lg px-3 py-2 text-xs font-mono focus:border-blue-500 cursor-pointer"
            >
              <option value="Beginner">Beginner (New to syntax & problem solving)</option>
              <option value="Intermediate">Intermediate (Familiar with control flow & data structures)</option>
              <option value="Advanced">Advanced (System architecture & performance)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Primary Learning Goals</label>
            <textarea
              value={learningGoals}
              onChange={(e) => setLearningGoals(e.target.value)}
              rows="3"
              className="w-full cd-input rounded-lg p-3 text-xs leading-relaxed focus:border-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold shadow-md shadow-blue-500/20 transition"
          >
            {saving ? "Saving Changes..." : isGuest ? "Sign In to Save Profile" : "Save Profile"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ----------------- SETTINGS VIEW -----------------
function SettingsView({ currentUser, refreshProfile, showToast, logout, requireAuth }) {
  const isGuest = currentUser?.isGuest;
  const [apiKey, setApiKey] = useState("");
  const [apiConfig, setApiConfig] = useState(null);
  const [savingKey, setSavingKey] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const data = await apiRequest("/api/settings/config");
      setApiConfig(data);
    } catch (e) {}
  };

  const handleSaveKey = async (e) => {
    e.preventDefault();
    if (isGuest) {
      requireAuth("Create an account or sign in to configure custom Gemini API keys.");
      return;
    }
    setSavingKey(true);
    try {
      await apiRequest("/api/settings/save-key", "POST", { api_key: apiKey.trim() });
      showToast("Custom Gemini API Key updated.", "success");
      setApiKey("");
      fetchConfig();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSavingKey(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* AI Engine Configuration */}
      <div className="p-6 rounded-xl cd-card border border-[#1E293B] space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#1E293B]">
          <div>
            <h3 className="font-bold text-base text-white">AI Provider Configuration</h3>
            <p className="text-xs text-slate-400 mt-0.5">Powered by Google Gemini 2.0 / 1.5 Flash</p>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/70 text-emerald-400 border border-emerald-800 font-semibold">
            {apiConfig?.source || "Active Engine"}
          </span>
        </div>

        <form onSubmit={handleSaveKey} className="space-y-3">
          <label className="block text-xs font-medium text-slate-300">
            Custom Google Gemini API Key (Optional Override)
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy... (leave blank to restore system key)"
              className="flex-1 cd-input rounded-lg px-3 py-2 text-xs font-mono focus:border-blue-500"
            />
            <button
              type="submit"
              disabled={savingKey}
              className="px-4 py-2 rounded-lg bg-[#1B2230] hover:bg-[#283347] text-white text-xs font-medium border border-[#283347] transition shrink-0"
            >
              {savingKey ? "Saving..." : "Save Key"}
            </button>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed font-mono">
            CodeLoop provides built-in pedagogical fallbacks and shared keys. Providing your personal key enables higher custom quotas.
          </p>
        </form>
      </div>

      {/* Account Session */}
      <div className="p-6 rounded-xl cd-card border border-[#1E293B] space-y-4">
        <h3 className="font-bold text-base text-white">Account Session</h3>
        {isGuest ? (
          <div className="space-y-3">
            <p className="text-xs text-slate-400 leading-relaxed">
              You are currently using CodeLoop in <span className="text-amber-400 font-semibold">Guest Mode</span>. Your code drafts are saved in this browser.
            </p>
            <button
              onClick={() => requireAuth("Create an account to sync your programs across devices and access personalized settings.")}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow transition"
            >
              Create Free Account or Sign In
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-400 leading-relaxed">
              Signed in as <span className="text-white font-mono">{currentUser.email}</span>.
            </p>
            <button
              onClick={logout}
              className="px-4 py-2 rounded-lg bg-red-950/40 hover:bg-red-900/50 text-red-300 border border-red-800 text-xs font-semibold transition"
            >
              Sign Out of CodeLoop
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Mount React Root
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
