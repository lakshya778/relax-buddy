/* RelaxBuddy — FIXED script.js
   Keep same features, but fixed bugs:
   - floating typing show/hide (works with existing HTML)
   - safe emoji-picker toggle & outside-click handling
   - stubs for missing session/export/lock/search functions
   - robust session id handling (id vs session_id)
   - safe null checks for DOM refs
   - minor UX improvements (toast when required)
*/

const API_BASE = "http://127.0.0.1:5000";
console.log("SCRIPT RUNNING");
console.log("SpeechRecognition supported:", "SpeechRecognition" in window || "webkitSpeechRecognition" in window);

// ---------- State ----------
let state = {
  token: localStorage.getItem("rb_token") || null,
  sessions: [],
  activeSessionId: null,
  streamingAbortController: null,
  lastUserMessage: ""
};

// ---------- Helpers ----------
const $ = id => document.getElementById(id) || null;

// DOM refs (declared early)
let messagesEl,
  inputEl,
  sendBtn,
  newSessionBtn,
  sessionsList,
  authModal,
  loginUser,
  loginPass,
  loginBtn,
  signupBtn,
  profileModal,
  profileName,
  profileAvatar,
  profileSave,
  profileCancel,
  emojiBtn,
  emojiPicker,
  voiceToggleBtn,
  themeToggle,
  wallpaperSelect,
  profileOpenBtn,
  exportBtn,
  lockBtn,
  deleteBtn,
  searchBtn,
  maleBtnEl,
  femaleBtnEl;

// ---------- UI: Toast ----------
function showToast(msg, type = "info") {
  const id = "toast-container";
  let cont = document.getElementById(id);
  if (!cont) {
    cont = document.createElement("div");
    cont.id = id;
    cont.style.position = "fixed";
    cont.style.top = "18px";
    cont.style.right = "18px";
    cont.style.zIndex = 9999;
    document.body.appendChild(cont);
  }
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  t.style.marginTop = "8px";
  t.style.padding = "10px 14px";
  t.style.borderRadius = "8px";
  t.style.background = "#fff";
  t.style.boxShadow = "0 8px 30px rgba(0,0,0,0.12)";
  t.style.opacity = "0";
  t.style.transform = "translateX(8px)";
  cont.appendChild(t);
  requestAnimationFrame(() => {
    t.style.opacity = "1";
    t.style.transform = "translateX(0)";
  });
  setTimeout(() => {
    t.style.transition = "opacity 300ms, transform 300ms";
    t.style.opacity = "0";
    t.style.transform = "translateX(8px)";
    setTimeout(() => t.remove(), 320);
  }, 2800);
}

// ---------- Auth Helpers ----------
function authHeaders(isJson = true) {
  const hd = {};
  if (state.token) hd["Authorization"] = "Bearer " + state.token;
  if (isJson) hd["Content-Type"] = "application/json";
  return hd;
}

function timeNow() {
  const d = new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(s = "") {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nl2br(s = "") {
  return s.replace(/\n/g, "<br>");
}

// ---------- Message UI ----------
function appendUserBubble(text) {
  if (!messagesEl) return;
  const div = document.createElement("div");
  div.className = "bubble user entering";
  div.innerHTML = `<div class="text">${nl2br(escapeHtml(text))}</div><div class="time">${timeNow()}</div>`;
  messagesEl.appendChild(div);
  requestAnimationFrame(() => div.classList.add("show"));
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendBotBubble(text) {
  if (!messagesEl) return;
  const div = document.createElement("div");
  div.className = "bubble bot entering";
  div.innerHTML = `<div class="text">${nl2br(escapeHtml(text))}</div><div class="time">${timeNow()}</div>`;
  messagesEl.appendChild(div);
  requestAnimationFrame(() => div.classList.add("show"));
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showTypingBubbleInline() {
  removeTypingBubbleInline();
  if (!messagesEl) return;
  const el = document.createElement("div");
  el.id = "typingBubbleInline";
  el.className = "bubble bot typing-bubble entering";
  el.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;
  messagesEl.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeTypingBubbleInline() {
  const el = document.getElementById("typingBubbleInline");
  if (el) el.remove();
}

// ---------- Floating Typing Indicator ----------
function showFloatingTyping() {
  const existing = document.querySelector('.floating-typing');
  if (existing) {
    existing.style.display = 'block';
    return;
  }
  const el = document.createElement('div');
  el.className = 'floating-typing';
  el.innerHTML = `<div class="typing-bubble"><div class="loading-waves"><span></span><span></span><span></span></div></div>`;
  document.body.appendChild(el);
}

function hideFloatingTyping() {
  const el = document.querySelector('.floating-typing');
  if (el) {
    if (el.id === "floatingTyping") {
      el.style.display = "none";
    } else {
      el.remove();
    }
  }
}

// ---------- Send Button Loader ----------
function setSendLoading(isLoading = true) {
  if (!sendBtn) return;
  if (isLoading) {
    sendBtn.classList.add('loading');
    if (!sendBtn.querySelector('.tiny-wave')) {
      const w = document.createElement('span');
      w.className = 'tiny-wave';
      w.innerHTML = `<span class="loading-waves"><span></span><span></span><span></span></span>`;
      sendBtn.appendChild(w);
    }
  } else {
    sendBtn.classList.remove('loading');
    const w = sendBtn.querySelector('.tiny-wave');
    if (w) w.remove();
  }
}

// ---------- Auth API ----------
async function signup(username, password) {
  try {
    const res = await fetch(`${API_BASE}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    return await res.json();
  } catch (e) {
    return { error: e.message || "Network error" };
  }
}

async function login(username, password) {
  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok && data.token) {
      state.token = data.token;
      localStorage.setItem("rb_token", data.token);
      if (authModal) authModal.style.display = "none";
      await fetchSessions();
      showToast("Logged in", "success");
    } else {
      showToast(data.error || "Login failed", "error");
    }
    return data;
  } catch (e) {
    showToast("Login error", "error");
    return { error: e.message };
  }
}

async function logout() {
  try {
    await fetch(`${API_BASE}/logout`, {
      method: "POST",
      headers: authHeaders()
    });
  } catch (e) {}
  state.token = null;
  localStorage.removeItem("rb_token");
  showToast("Logged out", "info");
  if (authModal) authModal.style.display = "flex";
  if (sessionsList) sessionsList.innerHTML = "";
  if (messagesEl) messagesEl.innerHTML = "";
  state.sessions = [];
  state.activeSessionId = null;
}

// ---------- Sessions ----------
async function fetchSessions() {
  if (!state.token) return;
  try {
    const res = await fetch(`${API_BASE}/sessions`, { headers: authHeaders() });
    if (!res.ok) return;
    const arr = await res.json();
    state.sessions = Array.isArray(arr) ? arr : [];
    renderSessions();
    if (!state.activeSessionId && state.sessions.length > 0) {
      const id = state.sessions[0].id || state.sessions[0].session_id;
      openSession(id);
    }
  } catch (e) {
    console.error("fetchSessions:", e);
  }
}

function renderSessions() {
  if (!sessionsList) return;
  sessionsList.innerHTML = "";
  state.sessions.forEach(s => {
    const id = s.id || s.session_id;
    const el = document.createElement("div");
    el.className = "session-item";
    el.textContent = (s.name || "Chat") + (s.locked ? " 🔒" : "");
    el.onclick = () => openSession(id);
    sessionsList.appendChild(el);
  });
}

async function createNewSession() {
  const name = prompt("Session name", "Chat");
  if (!name) return;
  try {
    const res = await fetch(`${API_BASE}/new_session`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name })
    });
    const d = await res.json();
    if (res.ok) {
      showToast("Session created", "success");
      await fetchSessions();
      openSession(d.session_id);
    } else {
      showToast(d.error || "Error", "error");
    }
  } catch (e) {
    console.error(e);
    showToast("Network error");
  }
}

async function openSession(id) {
  if (!state.token) return showToast("Login required");
  try {
    const res = await fetch(`${API_BASE}/session/${id}`, { headers: authHeaders() });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      if (d.locked) {
        const pin = prompt("PIN?");
        if (!pin) return;
        const unlock = await fetch(`${API_BASE}/session/${id}/unlock`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({ pin })
        });
        if (unlock.ok) return openSession(id);
      }
      return;
    }
    const msgs = await res.json();
    state.activeSessionId = id;
    if (messagesEl) messagesEl.innerHTML = "";
    msgs.forEach(m => {
      if (m.sender === "user") appendUserBubble(m.text);
      else appendBotBubble(m.text);
    });
  } catch (e) {
    console.error(e);
  }
}

// ---------- Chat Streaming ----------
async function startStreamingReply(userText, sessionId) {
  if (!sessionId) {
    try {
      const newRes = await fetch(`${API_BASE}/new_session`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ name: "Chat" })
      });
      const d = await newRes.json();
      sessionId = d.session_id;
      await fetchSessions();
    } catch (e) {
      console.error(e);
    }
  }

  appendUserBubble(userText);
  showTypingBubbleInline();
  showFloatingTyping();
  setSendLoading(true);

  if (state.streamingAbortController) {
    state.streamingAbortController.abort();
    state.streamingAbortController = null;
  }

  const controller = new AbortController();
  state.streamingAbortController = controller;

  try {
    const resp = await fetch(`${API_BASE}/chat_stream`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: userText, session_id: sessionId }),
      signal: controller.signal
    });

    if (!resp.ok) {
      removeTypingBubbleInline();
      hideFloatingTyping();
      setSendLoading(false);
      return fallbackChat(userText, sessionId);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullReply = "";

    removeTypingBubbleInline();

    const botDiv = document.createElement("div");
    botDiv.className = "bubble bot entering";
    botDiv.innerHTML = `<div class="text"></div><div class="time">${timeNow()}</div>`;
    messagesEl.appendChild(botDiv);
    requestAnimationFrame(() => botDiv.classList.add("show"));
    const textNode = botDiv.querySelector(".text");

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split(/\r?\n/);
      for (const line of lines) {
        if (!line) continue;
        const piece = line.startsWith("data: ") ? line.substring(6) : line;
        fullReply += piece;
        textNode.innerHTML = nl2br(escapeHtml(fullReply));
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    hideFloatingTyping();
    setSendLoading(false);
    speakText(fullReply);

    await openSession(sessionId);
  } catch (e) {
    console.error("stream error", e);
    removeTypingBubbleInline();
    hideFloatingTyping();
    setSendLoading(false);
    await fallbackChat(userText, sessionId);
  }
}

async function fallbackChat(userText, sessionId) {
  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: userText, session_id: sessionId })
    });
    const d = await res.json();
    appendBotBubble(d.reply || "No reply");
    if (d.session_id) await openSession(d.session_id);
  } catch (e) {
    console.error(e);
  }
}

// ---------- TTS + Language Detect ----------
let voiceMode = "female";
let voices = [];
let enFemale = null;
let enMale = null;
let hiFemale = null;
let hiMale = null;

function detectLanguage(text) {
  if (!text) return "en";
  const hindiRegex = /[\u0900-\u097F]/;
  if (hindiRegex.test(text)) return "hi";
  const words = ["kya","hai","haan","nahi","kaise","kyu","thik","theek","mera","tum","aap"];
  const lower = text.toLowerCase();
  if (words.some(w => lower.includes(w))) return "hi";
  return "en";
}

function loadAllVoices() {
  voices = speechSynthesis.getVoices() || [];

  enFemale = voices.find(v => /^en/i.test(v.lang) && /female/i.test(v.name))
    || voices.find(v => /^en/i.test(v.lang)) || voices[0];

  enMale = voices.find(v => /^en/i.test(v.lang) && /male/i.test(v.name))
    || voices.find(v => /^en/i.test(v.lang)) || voices[1] || voices[0];

  hiFemale = voices.find(v => /^hi/i.test(v.lang) && /female/i.test(v.name))
    || voices.find(v => /^hi/i.test(v.lang)) || enFemale;

  hiMale = voices.find(v => /^hi/i.test(v.lang) && /male/i.test(v.name))
    || voices.find(v => /^hi/i.test(v.lang)) || enMale;

  console.log("Voices loaded");
}

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = loadAllVoices;
  setTimeout(loadAllVoices, 200);
}

function speakText(text) {
  const lang = detectLanguage(text);

  if ("speechSynthesis" in window) {
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.05;
    utter.pitch = 1.0;
    utter.volume = 1.0;

    if (lang === "hi") {
      utter.lang = "hi-IN";
      utter.voice = voiceMode === "male" ? hiMale : hiFemale;
    } else {
      utter.lang = "en-US";
      utter.voice = voiceMode === "male" ? enMale : enFemale;
    }

    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
    return;
  }
}

// ---------- Speech Recognition ----------
let recognition = null, recognizing = false;

if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = "en-US";
  recognition.interimResults = true;

  recognition.onstart = () => {
    recognizing = true;
    voiceToggleBtn?.classList.add("active");
    showToast("Recording...");
  };

  recognition.onerror = e => {
    recognizing = false;
    voiceToggleBtn?.classList.remove("active");
  };

  recognition.onend = () => {
    recognizing = false;
    voiceToggleBtn?.classList.remove("active");
  };

  recognition.onresult = ev => {
    let interim = "", final = "";
    for (let i = 0; i < ev.results.length; i++) {
      const r = ev.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    inputEl.value =
      (inputEl.value ? inputEl.value + " " : "") +
      final + (interim ? " " + interim : "");
  };
}

// ---------- Emoji Picker ----------
const EMOJIS = ["😀","😃","😄","😁","😅","😂","😊","🙂","🙃","😉","😍","😘","😜","🤗","🤔","😴","😪","😢","😭","😤","😡","🤯","😇","👏","🙏","👍","👎"];

function buildEmojiPicker() {
  if (!emojiPicker) return;
  emojiPicker.innerHTML = "";
  emojiPicker.style.display = "none";

  EMOJIS.forEach(e => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "emoji-btn";
    b.textContent = e;
    b.onclick = () => {
      const st = inputEl.selectionStart || inputEl.value.length;
      inputEl.value =
        inputEl.value.slice(0, st) + e + inputEl.value.slice(st);
    };
    emojiPicker.appendChild(b);
  });
}

// ---------- Profile ----------
function loadProfile() {
  const p = JSON.parse(localStorage.getItem("rb_profile") || "{}");
  profileName.value = p.name || "";
  profileAvatar.value = p.avatar || "";
  profileOpenBtn.innerText = p.avatar || (p.name ? p.name.slice(0,2).toUpperCase() : "A");
}

function saveProfile() {
  const p = {
    name: profileName.value,
    avatar: profileAvatar.value.slice(0,2).toUpperCase()
  };
  localStorage.setItem("rb_profile", JSON.stringify(p));
  loadProfile();
  profileModal.style.display = "none";
  showToast("Saved!");
}

// ---------- Theme + Wallpaper ----------
const APP_ROOT = document.body;

function loadThemeAndWallpaper() {
  const theme = localStorage.getItem("rb_theme") || "light";
  if (theme === "dark") document.body.classList.add("theme-dark");

  const wall = localStorage.getItem("rb_wallpaper") || "wall-default";
  ["wall-default","wall-nature","wall-lavender","wall-dark"]
    .forEach(c => document.body.classList.remove(c));
  document.body.classList.add(wall);

  wallpaperSelect.value = wall;
}

function toggleTheme() {
  const isDark = document.body.classList.toggle("theme-dark");
  localStorage.setItem("rb_theme", isDark ? "dark" : "light");
}

function wallpaperChanged(v) {
  ["wall-default","wall-nature","wall-lavender","wall-dark"]
    .forEach(c => document.body.classList.remove(c));
  document.body.classList.add(v);
  localStorage.setItem("rb_wallpaper", v);
}

// ---------- Missing Stubs ----------
function deleteCurrentSession() {
  if (!state.activeSessionId) return showToast("No session selected");
  showToast("Delete session (server not implemented)");
}

function exportCurrentSessionPDF() {
  showToast("Export PDF (server not implemented)");
}

function lockCurrentSessionWithPin() {
  showToast("Lock session (server not implemented)");
}

function searchInSession() {
  showToast("Search (not implemented)");
}

// ---------- Bind Events ----------
function bindEvents() {
  maleBtnEl?.addEventListener("click", () => {
    voiceMode = "male";
    maleBtnEl.classList.add("active");
    femaleBtnEl?.classList.remove("active");
    showToast("Male voice selected");
  });

  femaleBtnEl?.addEventListener("click", () => {
    voiceMode = "female";
    femaleBtnEl.classList.add("active");
    maleBtnEl?.classList.remove("active");
    showToast("Female voice selected");
  });

  signupBtn?.addEventListener("click", async () => {
    const u = loginUser.value.trim();
    const p = loginPass.value;
    if (!u || !p) return showToast("Enter credentials");
    const res = await signup(u,p);
    if (res.ok) showToast("Sign up successful");
    else showToast(res.error);
  });

  loginBtn?.addEventListener("click", async () => {
    const u = loginUser.value.trim();
    const p = loginPass.value;
    if (!u || !p) return showToast("Enter credentials");
    await login(u,p);
  });

  profileOpenBtn?.addEventListener("click", () => {
    profileModal.style.display = "flex";
    loadProfile();
  });

  profileCancel?.addEventListener("click", () => profileModal.style.display = "none");
  profileSave?.addEventListener("click", saveProfile);

  sendBtn?.addEventListener("click", async () => {
    const txt = inputEl.value.trim();
    if (!txt) return showToast("Write something");
    if (!state.token) return showToast("Login required");
    await startStreamingReply(txt, state.activeSessionId);
    inputEl.value = "";
  });

  inputEl?.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendBtn.click();
    }
  });

  newSessionBtn?.addEventListener("click", createNewSession);
  deleteBtn?.addEventListener("click", deleteCurrentSession);
  exportBtn?.addEventListener("click", exportCurrentSessionPDF);
  lockBtn?.addEventListener("click", lockCurrentSessionWithPin);
  searchBtn?.addEventListener("click", searchInSession);

  emojiBtn?.addEventListener("click", () => {
    emojiPicker.style.display =
      emojiPicker.style.display === "block" ? "none" : "block";
  });

  document.addEventListener("click", e => {
    if (!emojiPicker.contains(e.target) && !emojiBtn.contains(e.target)) {
      emojiPicker.style.display = "none";
    }
  });

  voiceToggleBtn?.addEventListener("click", () => {
    if (!recognition) return showToast("Speech recognition unsupported");
    if (!recognizing) {
      try { recognition.start(); } catch {}
    } else recognition.stop();
  });

  themeToggle?.addEventListener("click", toggleTheme);
  wallpaperSelect?.addEventListener("change", e => wallpaperChanged(e.target.value));
}

// ---------- Init ----------
window.addEventListener("DOMContentLoaded", () => {
  messagesEl = $("messages");
  inputEl = $("input");
  sendBtn = $("sendBtn");
  newSessionBtn = $("newSessionBtn");
  sessionsList = $("sessionsList");
  authModal = $("authModal");
  loginUser = $("loginUser");
  loginPass = $("loginPass");
  loginBtn = $("loginBtn");
  signupBtn = $("signupBtn");
  profileModal = $("profileModal");
  profileName = $("profileName");
  profileAvatar = $("profileAvatar");
  profileSave = $("profileSave");
  profileCancel = $("profileCancel");
  emojiBtn = $("emojiBtn");
  emojiPicker = $("emojiPicker");
  voiceToggleBtn = $("voiceToggleBtn");
  themeToggle = $("themeToggle");
  wallpaperSelect = $("wallpaperSelect");
  profileOpenBtn = $("profileOpenBtn");
  exportBtn = $("exportBtn");
  lockBtn = $("lockBtn");
  deleteBtn = $("deleteBtn");
  searchBtn = $("searchBtn");
  maleBtnEl = $("maleBtn");
  femaleBtnEl = $("femaleBtn");

  buildEmojiPicker();
  loadThemeAndWallpaper();

  const floatEl = $("floatingTyping");
  if (floatEl) floatEl.style.display = "none";

  if (!state.token) authModal.style.display = "flex";
  else {
    authModal.style.display = "none";
    fetchSessions();
  }

  bindEvents();
  loadAllVoices();
});
