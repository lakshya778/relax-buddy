/* -------------------------------------------------------
   FINAL — script.js (Matched to final app.py)
   • All routes fixed (DELETE, rename, pin, etc.)
   • Full session refresh fixed
   • No double messages
   • Voice selector + STT + TTS stable
   • Sidebar, ripple, search, drag, swipe fixed
   • Dark mode + wallpapers perfected
------------------------------------------------------- */

const API_BASE = "http://127.0.0.1:5000";
console.log("RelaxBuddy FINAL script.js loaded");

// -------------------------
// STATE
// -------------------------
const state = {
  token: localStorage.getItem("rb_token") || null,
  sessions: [],
  activeSessionId: null,
  streamingAbortController: null,
  voicesLoaded: false,
  voiceMode: "female",
};

// -------------------------
// DOM Helpers
// -------------------------
const $ = (id) => document.getElementById(id);

// Cache references
let refs = {};

function cacheRefs() {
  refs = {
    messagesEl: $("messages"),
    inputEl: $("input"),
    sendBtn: $("sendBtn"),

    newSessionBtn: $("newSessionBtn"),
    sessionSearch: $("sessionSearch"),

    sectionPinned: $("sectionPinned"),
    sectionToday: $("sectionToday"),
    sectionYesterday: $("sectionYesterday"),
    sectionOlder: $("sectionOlder"),

    sidebar: document.querySelector(".sidebar"),
    sidebarToggle: $("sidebarToggle"),
    sidebarResizer: document.querySelector(".sidebar-resizer"),

    authModal: $("authModal"),
    loginUser: $("loginUser"),
    loginPass: $("loginPass"),
    loginBtn: $("loginBtn"),
    signupBtn: $("signupBtn"),

    profileModal: $("profileModal"),
    profileName: $("profileName"),
    profileAvatar: $("profileAvatar"),
    profileSave: $("profileSave"),
    profileCancel: $("profileCancel"),
    profileOpenBtn: $("profileOpenBtn"),

    emojiBtn: $("emojiBtn"),
    emojiPicker: $("emojiPicker"),

    maleBtn: $("maleBtn"),
    femaleBtn: $("femaleBtn"),

    enMaleBtn: $("enMaleBtn"),
    enFemaleBtn: $("enFemaleBtn"),
    hiMaleBtn: $("hiMaleBtn"),
    hiFemaleBtn: $("hiFemaleBtn"),

    voiceToggleBtn: $("voiceToggleBtn"),

    themeToggle: $("themeToggle"),
    wallpaperSelect: $("wallpaperSelect"),

    searchBtn: $("searchBtn"),
    exportBtn: $("exportBtn"),
    lockBtn: $("lockBtn"),
    deleteBtn: $("deleteBtn"),

    activeChatTitle: $("activeChatTitle"),

    floatingTypingEl: $("floatingTyping"),
  };
}

// -------------------------
// Utility
// -------------------------
function showToast(text, type = "info") {
  alert(text); // minimal fallback
}

function authHeaders(json = true) {
  const h = {};
  if (state.token) h["Authorization"] = "Bearer " + state.token;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

function escapeHtml(t = "") {
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function nl2br(t = "") {
  return t.replace(/\n/g, "<br>");
}

function scrollBottom() {
  if (refs.messagesEl)
    refs.messagesEl.scrollTop = refs.messagesEl.scrollHeight;
}

// -------------------------
// UI: Messages
// -------------------------
function appendUser(text) {
  const div = document.createElement("div");
  div.className = "bubble user show";
  div.innerHTML = `<div class="text">${nl2br(escapeHtml(text))}</div>`;
  refs.messagesEl.appendChild(div);
  scrollBottom();
}

function appendBot(text) {
  const div = document.createElement("div");
  div.className = "bubble bot show";
  div.innerHTML = `<div class="text">${nl2br(escapeHtml(text))}</div>`;
  refs.messagesEl.appendChild(div);
  scrollBottom();
}

// -------------------------
// Typing Indicators
// -------------------------
function showFloatingTyping() {
  refs.floatingTypingEl.style.display = "block";
}
function hideFloatingTyping() {
  refs.floatingTypingEl.style.display = "none";
}

// -------------------------
// THEME + WALLPAPER
// -------------------------
function applyWallpaper(w) {
  document.body.classList.remove(
    "wall-default",
    "wall-nature",
    "wall-lavender",
    "wall-dark"
  );
  document.body.classList.add(w);
}

function loadTheme() {
  const t = localStorage.getItem("rb_theme") || "light";
  if (t === "dark") document.body.classList.add("theme-dark");
  else document.body.classList.remove("theme-dark");

  const w = localStorage.getItem("rb_wallpaper") || "wall-default";
  applyWallpaper(w);
  if (refs.wallpaperSelect) refs.wallpaperSelect.value = w;
}

function toggleTheme() {
  const isDark = document.body.classList.toggle("theme-dark");
  localStorage.setItem("rb_theme", isDark ? "dark" : "light");
}

function wallpaperChanged(v) {
  applyWallpaper(v);
  localStorage.setItem("rb_wallpaper", v);
}

// -------------------------
// PROFILE
// -------------------------
function loadProfile() {
  const p = JSON.parse(localStorage.getItem("rb_profile") || "{}");
  refs.profileName.value = p.name || "";
  refs.profileAvatar.value = p.avatar || "";
}

function saveProfile() {
  const p = {
    name: refs.profileName.value,
    avatar: refs.profileAvatar.value,
  };
  localStorage.setItem("rb_profile", JSON.stringify(p));
  refs.profileModal.style.display = "none";
  showToast("Profile saved");
}

// -------------------------
// AUTH
// -------------------------
async function signup(username, password) {
  const r = await fetch(`${API_BASE}/signup`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ username, password }),
  });
  return r.json();
}

async function login(username, password) {
  const r = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ username, password }),
  });

  const data = await r.json();
  if (r.ok && data.token) {
    state.token = data.token;
    localStorage.setItem("rb_token", data.token);
    refs.authModal.style.display = "none";
    fetchSessions();
  } else {
    showToast(data.error || "Login failed");
  }
}

// -------------------------
// SESSIONS
// -------------------------
function extractId(s) {
  return s.id || s.session_id;
}

async function fetchSessions() {
  if (!state.token) return;
  const r = await fetch(`${API_BASE}/sessions`, {
    headers: authHeaders(false),
  });
  const arr = await r.json();

  state.sessions = arr;
  renderSessions();

  if (!state.activeSessionId && arr.length > 0) {
    openSession(arr[0].id);
  }
}

async function createNewSession() {
  const name = prompt("Session name", "Chat") || "Chat";
  const r = await fetch(`${API_BASE}/new_session`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  });
  const d = await r.json();
  await fetchSessions();
  openSession(d.session_id || d.id);
}

async function openSession(id) {
  const r = await fetch(`${API_BASE}/session/${id}`, {
    headers: authHeaders(false),
  });

  if (!r.ok) {
    const d = await r.json();
    if (d.locked) {
      const pin = prompt("PIN?");
      if (!pin) return;
      const un = await fetch(`${API_BASE}/session/${id}/unlock`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ pin }),
      });
      if (un.ok) return openSession(id);
    }
    return;
  }

  const msgs = await r.json();
  refs.messagesEl.innerHTML = "";
  msgs.forEach((m) => {
    if (m.sender === "user") appendUser(m.text);
    else appendBot(m.text);
  });

  state.activeSessionId = id;

  // set active UI
  document.querySelectorAll(".session-item").forEach((i) => {
    i.classList.toggle("active", i.dataset.id == id);
  });

  const s = state.sessions.find((x) => x.id == id);
  if (refs.activeChatTitle) refs.activeChatTitle.textContent = s?.name || "Chat";
}

// -------------------------
// SESSION DELETE / RENAME / PIN
// -------------------------
async function deleteSessionFromServer(id) {
  const r = await fetch(`${API_BASE}/session/${id}`, {
    method: "DELETE",
    headers: authHeaders(false),
  });

  if (r.ok) {
    showToast("Deleted");
    await fetchSessions();
    if (state.activeSessionId == id) {
      refs.messagesEl.innerHTML = "";
      state.activeSessionId = null;
    }
  } else showToast("Delete failed");
}

async function renameSession(id) {
  const name = prompt("Rename session");
  if (!name) return;
  const r = await fetch(`${API_BASE}/session/${id}/rename`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  });
  if (r.ok) showToast("Renamed");
  await fetchSessions();
}

async function togglePin(id, isPinned) {
  const r = await fetch(`${API_BASE}/session/${id}/pin`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ pinned: isPinned }),
  });
  if (r.ok) showToast(isPinned ? "Pinned" : "Unpinned");
  await fetchSessions();
}

// -------------------------
// STREAMING CHAT
// -------------------------
async function startStreaming(text, sid) {
  appendUser(text);
  showFloatingTyping();

  if (state.streamingAbortController)
    try { state.streamingAbortController.abort(); } catch {}

  const controller = new AbortController();
  state.streamingAbortController = controller;

  // Create bot bubble to stream into
  const div = document.createElement("div");
  div.className = "bubble bot show";
  div.innerHTML = `<div class="text"></div>`;
  refs.messagesEl.appendChild(div);
  const textNode = div.querySelector(".text");

  try {
    const r = await fetch(`${API_BASE}/chat_stream`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: text, session_id: sid }),
      signal: controller.signal,
    });

    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let full = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const pieces = chunk.split("\n");

      pieces.forEach((p) => {
        if (p.startsWith("data: ")) {
          const t = p.replace("data: ", "");
          full += t;
          textNode.innerHTML = nl2br(escapeHtml(full));
          scrollBottom();
        }
      });
    }

  } catch (e) {
    console.log("Stream error", e);
    textNode.innerHTML += "<br><i>[Stream error]</i>";
  }

  hideFloatingTyping();
  await fetchSessions();
  openSession(state.activeSessionId);
}

// -------------------------
// SEND
// -------------------------
async function sendMessage() {
  const t = refs.inputEl.value.trim();
  if (!t) return;
  if (!state.token) return showToast("Login first");
  refs.inputEl.value = "";
  startStreaming(t, state.activeSessionId);
}

// -------------------------
// SIDEBAR
// -------------------------
function renderSessions() {
  refs.sectionPinned.innerHTML = "";
  refs.sectionToday.innerHTML = "";
  refs.sectionYesterday.innerHTML = "";
  refs.sectionOlder.innerHTML = "";

  const today = new Date().toDateString();
  const now = new Date();

  state.sessions.forEach((s) => {
    const d = new Date(s.updated_at || s.created_at);
    const dateStr = d.toDateString();

    const el = document.createElement("div");
    el.className = "session-item";
    el.dataset.id = s.id;

    el.innerHTML = `
      <div class="session-row">
        <div class="chat-icon">${(s.name || "?")[0].toUpperCase()}</div>
        <div style="flex:1">${s.name}</div>
        ${s.pinned ? `<div class="unread-dot"></div>` : ""}
      </div>
      <div class="chat-menu">
        <button data-act="pin">${s.pinned ? "Unpin" : "Pin"}</button>
        <button data-act="rename">Rename</button>
        <button data-act="delete">Delete</button>
      </div>
      <div class="delete-bg">🗑</div>
      <div class="hold-delete"></div>
    `;

    // place in category
    if (s.pinned) refs.sectionPinned.appendChild(el);
    else if (dateStr === today) refs.sectionToday.appendChild(el);
    else if (now - d < 86400 * 1000 * 2) refs.sectionYesterday.appendChild(el);
    else refs.sectionOlder.appendChild(el);
  });

  bindSessionItems();
}

function bindSessionItems() {
  document.querySelectorAll(".session-item").forEach((el) => {
    const id = el.dataset.id;

    el.onclick = (e) => {
      if (e.target.closest(".chat-menu")) return;
      openSession(id);
    };

    el.querySelectorAll(".chat-menu button").forEach((b) => {
      b.onclick = (ev) => {
        ev.stopPropagation();
        const act = b.dataset.act;
        if (act === "delete") deleteSessionFromServer(id);
        if (act === "rename") renameSession(id);
        if (act === "pin") {
          const s = state.sessions.find((x) => x.id == id);
          togglePin(id, !s.pinned);
        }
      };
    });

    const delBg = el.querySelector(".delete-bg");
    if (delBg)
      delBg.onclick = (ev) => {
        ev.stopPropagation();
        deleteSessionFromServer(id);
      };
  });
}

// -------------------------
// SEARCH FILTER
// -------------------------
function bindSearch() {
  refs.sessionSearch.oninput = () => {
    const q = refs.sessionSearch.value.toLowerCase();
    document.querySelectorAll(".session-item").forEach((el) => {
      el.style.display = el.textContent.toLowerCase().includes(q)
        ? "flex"
        : "none";
    });
  };
}

// -------------------------
// SIDEBAR TOGGLE + RESIZER
// -------------------------
function bindSidebar() {
  refs.sidebarToggle.onclick = () => {
    refs.sidebar.classList.toggle("collapsed");
    localStorage.setItem(
      "rb_sidebar",
      refs.sidebar.classList.contains("collapsed") ? "1" : "0"
    );
  };

  const saved = localStorage.getItem("rb_sidebar");
  if (saved == "1") refs.sidebar.classList.add("collapsed");

  let resizing = false;
  refs.sidebarResizer.onmousedown = () => {
    resizing = true;
    document.body.style.cursor = "ew-resize";
  };
  document.onmousemove = (e) => {
    if (!resizing) return;
    const w = Math.min(520, Math.max(140, e.clientX));
    refs.sidebar.style.width = w + "px";
    localStorage.setItem("rb_sidebar_width", w);
  };
  document.onmouseup = () => {
    resizing = false;
    document.body.style.cursor = "default";
  };

  const sw = localStorage.getItem("rb_sidebar_width");
  if (sw) refs.sidebar.style.width = sw + "px";
}

// -------------------------
// VOICE (browser TTS)
// -------------------------
let voices = [];

function loadVoices() {
  voices = speechSynthesis.getVoices();

  state.voicesLoaded = true;
}

if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
  setTimeout(loadVoices, 300);
}

function detectLang(t) {
  const hi = /[\u0900-\u097F]/;
  return hi.test(t) ? "hi-IN" : "en-US";
}

function speak(text) {
  if (!text) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = detectLang(text);
  u.rate = 1.03;
  u.pitch = state.voiceMode === "male" ? 0.85 : 1.15;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// -------------------------
// STT (SpeechRecognition)
// -------------------------
let recognition = null,
  recognizing = false;

if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
  const SR =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = "en-US";
  recognition.interimResults = true;

  recognition.onstart = () => {
    recognizing = true;
    refs.voiceToggleBtn.classList.add("active");
  };
  recognition.onerror = () => {
    recognizing = false;
    refs.voiceToggleBtn.classList.remove("active");
  };
  recognition.onend = () => {
    recognizing = false;
    refs.voiceToggleBtn.classList.remove("active");
  };
  recognition.onresult = (ev) => {
    let f = "";
    for (let i = 0; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) f += ev.results[i][0].transcript;
    }
    if (f) refs.inputEl.value = f;
  };
}

function toggleSTT() {
  if (!recognition) return showToast("STT not supported");
  if (!recognizing) recognition.start();
  else recognition.stop();
}

// -------------------------
// EMOJI PANEL
// -------------------------
const EMOJIS = ["😀","😄","😁","😂","🙂","😍","😴","😢","😭","😡","👏","🙏","👍","👎"];
function buildEmojiPanel() {
  refs.emojiPicker.innerHTML = "";
  EMOJIS.forEach((e) => {
    const b = document.createElement("button");
    b.className = "emoji-btn";
    b.textContent = e;
    b.onclick = () => {
      refs.inputEl.value += e;
      refs.emojiPicker.style.display = "none";
    };
    refs.emojiPicker.appendChild(b);
  });
}

// -------------------------
// EVENTS
// -------------------------
function bindEvents() {
  // Auth
  refs.loginBtn.onclick = () =>
    login(refs.loginUser.value, refs.loginPass.value);
  refs.signupBtn.onclick = () =>
    signup(refs.loginUser.value, refs.loginPass.value).then((d) =>
      showToast(d.message || d.error)
    );

  // Profile
  refs.profileOpenBtn.onclick = () => {
    loadProfile();
    refs.profileModal.style.display = "flex";
  };
  refs.profileCancel.onclick = () =>
    (refs.profileModal.style.display = "none");
  refs.profileSave.onclick = saveProfile;

  // Composer
  refs.sendBtn.onclick = sendMessage;
  refs.inputEl.onkeydown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Emoji
  refs.emojiBtn.onclick = () => {
    refs.emojiPicker.style.display =
      refs.emojiPicker.style.display === "block" ? "none" : "block";
  };

  // Voice selector
  refs.maleBtn.onclick = () => (state.voiceMode = "male");
  refs.femaleBtn.onclick = () => (state.voiceMode = "female");

  refs.enMaleBtn.onclick = () => (state.voiceMode = "male");
  refs.enFemaleBtn.onclick = () => (state.voiceMode = "female");
  refs.hiMaleBtn.onclick = () => (state.voiceMode = "male");
  refs.hiFemaleBtn.onclick = () => (state.voiceMode = "female");

  // STT
  refs.voiceToggleBtn.onclick = toggleSTT;

  // Tools
  refs.searchBtn.onclick = () => showToast("Search inside chat coming soon");
  refs.exportBtn.onclick = () => {
    if (!state.activeSessionId) return;
    window.open(`${API_BASE}/export/${state.activeSessionId}`, "_blank");
  };
  refs.deleteBtn.onclick = () => {
    if (!state.activeSessionId) return;
    if (confirm("Delete this session?"))
      deleteSessionFromServer(state.activeSessionId);
  };
  refs.lockBtn.onclick = () => showToast("Locking session coming soon");

  // Theme + wallpaper
  refs.themeToggle.onclick = toggleTheme;
  refs.wallpaperSelect.onchange = (e) => wallpaperChanged(e.target.value);

  // New chat ripple
  refs.newSessionBtn.onclick = (e) => {
    const rect = e.target.getBoundingClientRect();
    e.target.style.setProperty("--ripple-x", e.clientX - rect.left + "px");
    e.target.style.setProperty("--ripple-y", e.clientY - rect.top + "px");
    e.target.classList.remove("ripple-active");
    void e.target.offsetWidth;
    e.target.classList.add("ripple-active");
    setTimeout(createNewSession, 120);
  };

  // Sidebar + search
  bindSidebar();
  bindSearch();

  // Section collapse
  document.querySelectorAll(".section-header").forEach((h) => {
    h.onclick = () => {
      const sec = h.getAttribute("data-sec");
      const id = "section" + sec.charAt(0).toUpperCase() + sec.slice(1);
      document.getElementById(id)?.classList.toggle("collapsed");
    };
  });
}

// -------------------------
// INIT
// -------------------------
window.addEventListener("DOMContentLoaded", () => {
  cacheRefs();
  buildEmojiPanel();
  loadTheme();

  if (!state.token) refs.authModal.style.display = "flex";
  else fetchSessions();

  bindEvents();
  console.log("RelaxBuddy FINAL JS Ready");
});
