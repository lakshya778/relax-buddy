// FINAL script.js — RelaxBuddy (FULL, corrected)
// All previously reported bugs fixed and defensive checks added.

const API_BASE = "https://relax-buddy-15fj.onrender.com";
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
  recording: false,
  mediaStream: null,
  mediaRecorder: null,
  audioChunks: [],
  audioBlob: null,
  audioUrl: null,
  audioPreviewEl: null,
  audioCtx: null,
  analyser: null,
  rafId: null,
  recordStartX: 0,
  canceled: false,
  recordStartTime: 0,
};

// -------------------------
// DOM Helpers
// -------------------------
const $ = (id) => document.getElementById(id);
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
    logoutBtn: $("logoutBtn"),

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

    // Recording UI
    recordBtn: $("recordBtn"),
    recordingBubble: $("recordingBubble"),
    recordTimer: $("recordTimer"),
  };
}

// -------------------------
// Utility functions
// -------------------------
function showToast(t) {
  try {
    const el = document.createElement("div");
    el.textContent = t;
    el.style =
      "position:fixed;bottom:16px;right:16px;background:#222;color:#fff;padding:10px 14px;border-radius:8px;z-index:9999;opacity:0;transition:opacity .2s";
    document.body.appendChild(el);
    requestAnimationFrame(() => (el.style.opacity = "1"));
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 300);
    }, 2200);
  } catch {
    alert(t);
  }
}

function authHeaders(json = true) {
  const h = {};
  if (state.token) h["Authorization"] = "Bearer " + state.token;
  if (json) h["Content-Type"] = "application/json";
  return h;
}

function escapeHtml(t = "") {
  return String(t)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Convert newlines to <br>
function nl2br(t = "") {
  return String(t).replace(/\n/g, "<br>");
}

function scrollBottom() {
  if (refs.messagesEl) refs.messagesEl.scrollTop = refs.messagesEl.scrollHeight;
}

// -------------------------
// Message appenders
// -------------------------
function appendUser(text) {
  if (!refs.messagesEl) return;
  const div = document.createElement("div");
  div.className = "bubble user show";
  div.innerHTML = `<div class="text">${nl2br(escapeHtml(text))}</div>`;
  refs.messagesEl.appendChild(div);
  scrollBottom();
}

function appendBot(text) {
  if (!refs.messagesEl) return;
  const div = document.createElement("div");
  div.className = "bubble bot show";
  div.innerHTML = `<div class="text">${nl2br(escapeHtml(text))}</div>`;
  refs.messagesEl.appendChild(div);
  scrollBottom();
  speak(text);
}

// -------------------------
// Typing indicator
// -------------------------
function showFloatingTyping() {
  if (!refs.floatingTypingEl) return;
  refs.floatingTypingEl.style.display = "block";
}
function hideFloatingTyping() {
  if (!refs.floatingTypingEl) return;
  refs.floatingTypingEl.style.display = "none";
}

// -------------------------
// Wallpaper + theme
// -------------------------
function applyWallpaper(w) {
  document.body.classList.remove(
    "wall-default",
    "wall-nature",
    "wall-lavender",
    "wall-dark"
  );
  if (w) document.body.classList.add(w);
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
  const v = document.body.classList.toggle("theme-dark");
  localStorage.setItem("rb_theme", v ? "dark" : "light");
}

function wallpaperChanged(v) {
  applyWallpaper(v);
  localStorage.setItem("rb_wallpaper", v);
}

// -------------------------
// Profile
// -------------------------
function loadProfile() {
  try {
    const p = JSON.parse(localStorage.getItem("rb_profile") || "{}");
    if (refs.profileName) refs.profileName.value = p.name || "";
    if (refs.profileAvatar) refs.profileAvatar.value = p.avatar || "";
  } catch {
    if (refs.profileName) refs.profileName.value = "";
    if (refs.profileAvatar) refs.profileAvatar.value = "";
  }
}

function saveProfile() {
  if (!refs.profileName || !refs.profileAvatar || !refs.profileModal) return;
  localStorage.setItem(
    "rb_profile",
    JSON.stringify({
      name: refs.profileName.value,
      avatar: refs.profileAvatar.value,
    })
  );
  refs.profileModal.style.display = "none";
  showToast("Profile saved");
}

// -------------------------
// Auth: signup, login, logout
// -------------------------
async function signupRequest(u, p) {
  const r = await fetch(`${API_BASE}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u, password: p }),
  });
  return r;
}

async function signup(u, p) {
  const r = await signupRequest(u, p);
  const d = await r.json().catch(() => ({}));
  return { status: r.status, body: d };
}

async function login(u, p) {
  const r = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: u, password: p }),
  });

  const d = await r.json().catch(() => ({}));

  if (r.ok && d.token) {
    // Save token
    state.token = d.token;
    localStorage.setItem("rb_token", d.token);

    // Fetch user data
    try {
      const me = await fetch(`${API_BASE}/me`, { headers: authHeaders(false) });
      if (me.ok) {
        const userData = await me.json();
        localStorage.setItem("rb_user", JSON.stringify(userData));
        // Hide modal + load sessions
        if (refs.authModal) refs.authModal.style.display = "none";
        await fetchSessions();
        showToast(`Welcome ${userData.username || "user"}!`);
      } else if (me.status === 401) {
        // Shouldn't normally happen immediately
        await logout();
        showToast("Authentication failed — please login again");
      } else {
        if (refs.authModal) refs.authModal.style.display = "none";
        await fetchSessions();
        showToast("Logged in");
      }
    } catch (e) {
      if (refs.authModal) refs.authModal.style.display = "none";
      await fetchSessions();
      showToast("Logged in (no profile)");
    }
  } else {
    showToast(d.error || "Login failed");
  }
}

async function logout() {
  // If backend supports logout endpoint, call it (best-effort)
  try {
    if (state.token) {
      await fetch(`${API_BASE}/logout`, {
        method: "POST",
        headers: authHeaders(false),
      }).catch(() => {});
    }
  } catch {}

  // Clear local data
  state.token = null;
  localStorage.removeItem("rb_token");
  localStorage.removeItem("rb_user");

  // Stop any streaming
  if (state.streamingAbortController) {
    try {
      state.streamingAbortController.abort();
    } catch {}
    state.streamingAbortController = null;
  }

  // Reset UI
  if (refs.messagesEl) refs.messagesEl.innerHTML = "";
  state.sessions = [];
  state.activeSessionId = null;

  // Show login modal
  if (refs.authModal) refs.authModal.style.display = "flex";

  showToast("Logged out successfully");
}

// -------------------------
// Part 2: Sessions, streaming chat, recording, audio upload
// -------------------------
async function fetchSessions() {
  if (!state.token) return;
  const r = await fetch(`${API_BASE}/sessions`, {
    headers: authHeaders(false),
  });

  if (r.status === 401) {
    // Auto logout on invalid/expired token
    logout();
    showToast("Session expired — please login again");
    return;
  }

  const arr = await r.json().catch(() => []);
  state.sessions = Array.isArray(arr) ? arr : [];
  renderSessions();

  if (!state.activeSessionId && state.sessions.length > 0) {
    openSession(state.sessions[0].id);
  }
}

async function createNewSession() {
  const name = prompt("Session name", "Chat") || "Chat";
  const r = await fetch(`${API_BASE}/new_session`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  });

  if (r.status === 401) {
    logout();
    return;
  }

  const d = await r.json().catch(() => ({}));
  await fetchSessions();
  openSession(d.session_id || d.id);
}

async function openSession(id) {
  if (!id) return;
  const r = await fetch(`${API_BASE}/session/${id}`, {
    headers: authHeaders(false),
  });

  if (!r.ok) {
    if (r.status === 401) {
      logout();
      return;
    }

    const d = await r.json().catch(() => ({}));
    if (d.locked) {
      const pin = prompt("PIN?");
      if (!pin) return;

      const un = await fetch(`${API_BASE}/session/${id}/unlock`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ pin }),
      });

      const udata = await un.json().catch(() => ({}));

      if (un.ok) return openSession(id);
      return showToast(udata.error || "Unlock failed");
    }
    return;
  }

  const msgs = await r.json().catch(() => []);
  if (refs.messagesEl) refs.messagesEl.innerHTML = "";

  msgs.forEach((m) => {
    if (m && m.sender === "user") appendUser(m.text || "");
    else appendBot(m?.text || "");
  });

  state.activeSessionId = id;

  document.querySelectorAll(".session-item").forEach((i) =>
    i.classList.toggle("active", i.dataset.id == id)
  );

  const s = state.sessions.find((x) => x.id == id);
  if (refs.activeChatTitle) refs.activeChatTitle.textContent = s?.name || "Chat";
}

async function deleteSessionFromServer(id) {
  const r = await fetch(`${API_BASE}/session/${id}`, {
    method: "DELETE",
    headers: authHeaders(false),
  });

  if (r.status === 401) {
    logout();
    return;
  }

  if (r.ok) {
    showToast("Deleted");
    await fetchSessions();
    if (state.activeSessionId == id) {
      if (refs.messagesEl) refs.messagesEl.innerHTML = "";
      state.activeSessionId = null;
    }
  } else {
    showToast("Delete failed");
  }
}

async function renameSession(id) {
  const name = prompt("Rename session");
  if (!name) return;

  const r = await fetch(`${API_BASE}/session/${id}/rename`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ name }),
  });

  if (r.status === 401) {
    logout();
    return;
  }

  fetchSessions();
}

async function togglePin(id, isPinned) {
  const r = await fetch(`${API_BASE}/session/${id}/pin`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ pinned: isPinned }),
  });

  if (r.status === 401) {
    logout();
    return;
  }

  fetchSessions();
}

// -------------------------
// SSE STREAMING CHAT (fixed parsing + delimiters)
// -------------------------
async function startStreaming(text, sid) {
  if (!refs.messagesEl) return;
  appendUser(text);
  showFloatingTyping();

  if (state.streamingAbortController) {
    try {
      state.streamingAbortController.abort();
    } catch {}
    state.streamingAbortController = null;
  }

  const controller = new AbortController();
  state.streamingAbortController = controller;

  const div = document.createElement("div");
  div.className = "bubble bot show";
  div.innerHTML = `<div class="text"></div>`;
  refs.messagesEl.appendChild(div);

  const textNode = div.querySelector(".text");
  let buffer = "";
  let full = "";

  try {
    const r = await fetch(`${API_BASE}/chat_stream`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ message: text, session_id: sid }),
      signal: controller.signal,
    });

    if (!r.ok) {
      if (r.status === 401) {
        logout();
        if (textNode) textNode.innerHTML = `<i>[Logged out — please login again]</i>`;
      } else {
        const err = await r.json().catch(() => ({}));
        if (textNode)
          textNode.innerHTML = `<i>[Error: ${escapeHtml(err.error || "Stream error")}]</i>`;
      }
      hideFloatingTyping();
      return;
    }

    if (!r.body) {
      hideFloatingTyping();
      return;
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      // Expecting SSE-style blocks separated by double newline
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 2);

        // process each line inside block
        const lines = block.split("\n");
        lines.forEach((ln) => {
          if (ln.startsWith("data:")) {
            const piece = ln.replace(/^data:/, "").trim();
            full += piece;
            if (textNode) textNode.innerHTML = nl2br(escapeHtml(full));
            scrollBottom();
          }
        });
      }
    }
  } catch (e) {
    if (e && e.name !== "AbortError") {
      console.error("Stream error", e);
      if (textNode) textNode.innerHTML += "<br><i>[Stream error]</i>";
    }
  }

  hideFloatingTyping();
  await fetchSessions();
  // after streaming, refresh messages & reopen active session
  if (state.activeSessionId) openSession(state.activeSessionId);
}

// -------------------------
// Send message
// -------------------------
async function sendMessage() {
  if (!refs.inputEl) return;
  const t = refs.inputEl.value.trim();
  if (!t) return;

  refs.inputEl.value = "";
  startStreaming(t, state.activeSessionId);
}

// -------------------------
// Session rendering
// -------------------------
function renderSessions() {
  if (!refs.sectionPinned || !refs.sectionToday || !refs.sectionYesterday || !refs.sectionOlder) return;

  refs.sectionPinned.innerHTML = "";
  refs.sectionToday.innerHTML = "";
  refs.sectionYesterday.innerHTML = "";
  refs.sectionOlder.innerHTML = "";

  const today = new Date().toDateString();
  const now = new Date();

  state.sessions.forEach((s) => {
    const d = new Date(s.updated_at || s.created_at || Date.now());

    const el = document.createElement("div");
    el.className = "session-item";
    el.dataset.id = s.id;

    el.innerHTML = `
      <div class="session-row">
        <div class="chat-icon">${(s.name || "?")[0]?.toUpperCase() || "?"}</div>
        <div class="chat-name">${s.name || "Chat"}</div>
        ${s.pinned ? `<div class="unread-dot"></div>` : ""}
      </div>

      <div class="chat-menu">
        <button data-act="pin">${s.pinned ? "Unpin" : "Pin"}</button>
        <button data-act="rename">Rename</button>
        <button data-act="delete">Delete</button>
      </div>

      <div class="delete-bg">🗑</div>
    `;

    const dateStr = d.toDateString();

    if (s.pinned) refs.sectionPinned.appendChild(el);
    else if (dateStr === today) refs.sectionToday.appendChild(el);
    else if (now - d < 1000 * 86400 * 2) refs.sectionYesterday.appendChild(el);
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

    const menuButtons = el.querySelectorAll(".chat-menu button");
    menuButtons.forEach((b) => {
      b.onclick = (ev) => {
        ev.stopPropagation();
        const act = b.dataset.act;
        if (act === "delete") deleteSessionFromServer(id);
        if (act === "rename") renameSession(id);
        if (act === "pin") {
          const s = state.sessions.find((x) => x.id == id);
          togglePin(id, !s?.pinned);
        }
      };
    });

    const del = el.querySelector(".delete-bg");
    if (del) {
      del.onclick = (ev) => {
        ev.stopPropagation();
        deleteSessionFromServer(id);
      };
    }
  });
}

// -------------------------
// Search
// -------------------------
function bindSearch() {
  if (!refs.sessionSearch) return;
  refs.sessionSearch.oninput = () => {
    const q = refs.sessionSearch.value.toLowerCase();
    document.querySelectorAll(".session-item").forEach((el) => {
      el.style.display = el.textContent.toLowerCase().includes(q) ? "flex" : "none";
    });
  };
}

// -------------------------
// Sidebar
// -------------------------
function bindSidebar() {
  if (!refs.sidebarToggle || !refs.sidebar || !refs.sidebarResizer) return;

  refs.sidebarToggle.onclick = () => {
    refs.sidebar.classList.toggle("collapsed");
    localStorage.setItem(
      "rb_sidebar",
      refs.sidebar.classList.contains("collapsed") ? "1" : "0"
    );
  };

  if (localStorage.getItem("rb_sidebar") == "1") {
    refs.sidebar.classList.add("collapsed");
  }

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

  const w = localStorage.getItem("rb_sidebar_width");
  if (w) refs.sidebar.style.width = w + "px";
}

// -------------------------
// Browser TTS
// -------------------------
let voices = [];
function loadVoices() {
  voices = speechSynthesis.getVoices ? speechSynthesis.getVoices() : [];
  state.voicesLoaded = true;
}
if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = loadVoices;
  setTimeout(loadVoices, 250);
}

function detectLang(t) {
  return /[ऀ-ॿ]/.test(t) ? "hi-IN" : "en-US";
}

function speak(text) {
  if (!text) return;
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = detectLang(text);
    u.rate = 1.03;
    u.pitch = state.voiceMode === "male" ? 0.85 : 1.15;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) {
    console.warn("TTS failed", e);
  }
}

// -------------------------
// STT (speech recognition) - support both standard and webkit prefixes
// -------------------------
let recognition = null;
let recognizing = false;

const SRClass = window.SpeechRecognition || window.webkitSpeechRecognition || null;
if (SRClass) {
  recognition = new SRClass();
  recognition.lang = "en-US";
  recognition.interimResults = true;

  recognition.onstart = () => {
    recognizing = true;
    if (refs.voiceToggleBtn) refs.voiceToggleBtn.classList.add("active");
  };
  recognition.onerror = () => {
    recognizing = false;
    if (refs.voiceToggleBtn) refs.voiceToggleBtn.classList.remove("active");
  };
  recognition.onend = () => {
    recognizing = false;
    if (refs.voiceToggleBtn) refs.voiceToggleBtn.classList.remove("active");
  };

  recognition.onresult = (ev) => {
    let final = "";
    for (let i = 0; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) final += ev.results[i][0].transcript;
    }
    if (final && refs.inputEl) refs.inputEl.value = final;
  };
}

function toggleSTT() {
  if (!recognition) return showToast("Speech recognition not supported");
  recognizing ? recognition.stop() : recognition.start();
}

// -------------------------
// Part 3: Recording helpers, upload, UI bindings, init
// -------------------------

// Recording Helpers
async function initMedia() {
  if (state.mediaStream) return state.mediaStream;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast("Microphone not supported");
    throw new Error("No getUserMedia");
  }
  const s = await navigator.mediaDevices.getUserMedia({ audio: true });
  state.mediaStream = s;
  return s;
}

function startWaveform() {
  if (!state.mediaStream) return;
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  const ctx = state.audioCtx;

  if (!state.analyser) {
    const src = ctx.createMediaStreamSource(state.mediaStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    state.analyser = analyser;
  }

  const bars = (refs.recordingBubble && refs.recordingBubble.querySelectorAll(".waveform .bar")) || [];
  const analyser = state.analyser;
  const data = new Uint8Array(analyser.frequencyBinCount);

  function frame() {
    analyser.getByteFrequencyData(data);
    for (let i = 0; i < bars.length; i++) {
      const idx = Math.min(data.length - 1, i * Math.floor(data.length / bars.length));
      const v = data[idx] || 0;
      const h = Math.max(3, Math.min(60, Math.floor((v / 255) * 60)));
      bars[i].style.height = `${h}px`;
    }
    state.rafId = requestAnimationFrame(frame);
  }
  frame();
}

function stopWaveform() {
  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.rafId = null;

  if (refs.recordingBubble) {
    refs.recordingBubble.querySelectorAll(".waveform .bar").forEach((b) => (b.style.height = "6px"));
  }
}

function formatTime(ms) {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, "0")}`;
}

// Recording
async function startRecording() {
  if (state.recording) return;

  try {
    await initMedia();
  } catch {
    return;
  }

  state.audioChunks = [];
  state.canceled = false;
  state.recordStartTime = Date.now();

  let options = {};
  const mimeTypes = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/wav"];

  for (const mt of mimeTypes) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mt)) {
      options.mimeType = mt;
      break;
    }
  }

  try {
    state.mediaRecorder = new MediaRecorder(state.mediaStream, options);
  } catch {
    state.mediaRecorder = new MediaRecorder(state.mediaStream);
  }

  state.mediaRecorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) state.audioChunks.push(ev.data);
  };

  state.mediaRecorder.onstop = async () => {
    stopWaveform();
    state.recording = false;
    if (refs.recordBtn) refs.recordBtn.classList.remove("active");

    const blob = new Blob(state.audioChunks, {
      type: state.mediaRecorder && state.mediaRecorder.mimeType ? state.mediaRecorder.mimeType : "audio/webm",
    });

    state.audioBlob = blob;
    state.audioUrl = URL.createObjectURL(blob);

    hideRecordingBubble();

    if (state.canceled) {
      state.audioChunks = [];
      state.audioBlob = null;
      state.audioUrl = null;
      showToast("Recording canceled");
      return;
    }

    showAudioPreview(state.audioUrl, blob);
  };

  state.mediaRecorder.start();
  state.recording = true;
  if (refs.recordBtn) refs.recordBtn.classList.add("active");

  showRecordingBubble();
  startWaveform();
}

function stopRecording() {
  if (!state.recording) return;
  try {
    if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") state.mediaRecorder.stop();
  } catch {}
}

function cancelRecording() {
  if (!state.recording) return;
  state.canceled = true;
  try {
    if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") state.mediaRecorder.stop();
  } catch {}
  hideRecordingBubble();
}

// Recording bubble UI
let timerInterval = null;

function showRecordingBubble() {
  if (!refs.recordingBubble || !refs.recordTimer) return;
  refs.recordingBubble.style.display = "flex";
  refs.recordingBubble.setAttribute("aria-hidden", "false");

  refs.recordTimer.textContent = "0:00";
  clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    const ms = Date.now() - state.recordStartTime;
    refs.recordTimer.textContent = formatTime(ms);
  }, 250);
}

function hideRecordingBubble() {
  if (!refs.recordingBubble) return;
  refs.recordingBubble.style.display = "none";
  refs.recordingBubble.setAttribute("aria-hidden", "true");
  clearInterval(timerInterval);
  timerInterval = null;
  stopWaveform();
}

// Audio preview (send/delete)
function showAudioPreview(url, blob) {
  const container = document.createElement("div");
  container.className = "audio-preview";
  container.style =
    "display:flex;align-items:center;gap:10px;padding:8px;border-radius:10px;background:#fff;margin:8px;border:1px solid #e6eef6";

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.src = url;
  audio.style = "width:220px";

  const sendBtn = document.createElement("button");
  sendBtn.className = "btn-primary";
  sendBtn.textContent = "Send";
  sendBtn.onclick = async () => {
    sendBtn.disabled = true;
    sendBtn.textContent = "Uploading...";

    const res = await uploadAudio(blob, state.activeSessionId);

    if (res && res.transcription) {
      if (refs.inputEl) refs.inputEl.value = res.transcription;
      showToast("Transcription inserted");
    } else if (res && res.message) {
      showToast(res.message);
    } else {
      showToast(res && (res.error || "Upload done") || "Upload done");
    }

    container.remove();
    try { URL.revokeObjectURL(url); } catch {}
  };

  const delBtn = document.createElement("button");
  delBtn.className = "btn-secondary";
  delBtn.textContent = "Delete";
  delBtn.onclick = () => {
    container.remove();
    try { URL.revokeObjectURL(url); } catch {}
  };

  container.append(audio, sendBtn, delBtn);

  const composer = document.querySelector(".composer");
  composer && composer.parentNode.insertBefore(container, composer);

  audio.play().catch(() => {});
}

// Upload audio to backend
async function uploadAudio(blob, sessionId) {
  try {
    const fd = new FormData();
    fd.append("file", blob, `record_${Date.now()}.webm`);
    if (sessionId) fd.append("session_id", sessionId);

    const r = await fetch(`${API_BASE}/upload_audio`, {
      method: "POST",
      headers: state.token ? { Authorization: "Bearer " + state.token } : {},
      body: fd,
    });

    return await r.json().catch(() => ({ ok: false, error: "Invalid response" }));
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
}

// Hold-to-record interactions
function bindRecordingInteractions() {
  const btn = refs.recordBtn;
  if (!btn) return;

  let pointerId = null;
  let startX = 0;

  btn.addEventListener("pointerdown", async (ev) => {
    ev.preventDefault();
    pointerId = ev.pointerId;
    try { btn.setPointerCapture(pointerId); } catch {}
    startX = ev.clientX;
    state.canceled = false;

    try {
      await startRecording();
    } catch {
      showToast("Recording failed");
    }
  });

  btn.addEventListener("pointermove", (ev) => {
    if (!state.recording || ev.pointerId !== pointerId) return;
    const dx = ev.clientX - startX;

    if (dx < -80) {
      btn.classList.add("canceling");
      if (refs.recordingBubble) refs.recordingBubble.querySelector(".cancel-tip").textContent = "Release to cancel";
      state.canceled = true;
    } else {
      btn.classList.remove("canceling");
      if (refs.recordingBubble) refs.recordingBubble.querySelector(".cancel-tip").textContent = "Slide left to cancel";
      state.canceled = false;
    }
  });

  const finish = () => {
    if (pointerId != null) {
      try {
        btn.releasePointerCapture(pointerId);
      } catch {}
    }
    pointerId = null;

    if (state.canceled) cancelRecording();
    else stopRecording();
    btn.classList.remove("canceling");
  };

  btn.addEventListener("pointerup", finish);
  btn.addEventListener("pointercancel", finish);
}

// UI / events binding
function bindEvents() {
  // AUTH
  if (refs.loginBtn)
    refs.loginBtn.onclick = () =>
      login(refs.loginUser?.value.trim(), refs.loginPass?.value.trim());

  if (refs.signupBtn)
    refs.signupBtn.onclick = async () => {
      const u = refs.loginUser?.value.trim();
      const p = refs.loginPass?.value.trim();

      const res = await signup(u, p);
      if (res.status === 201 && res.body && res.body.token) {
        // store token (signup auto-generates token on backend)
        localStorage.setItem("rb_token", res.body.token);
        state.token = res.body.token;

        // fetch user
        try {
          const me = await fetch(`${API_BASE}/me`, { headers: authHeaders(false) });
          if (me.ok) {
            const userData = await me.json();
            localStorage.setItem("rb_user", JSON.stringify(userData));
          }
        } catch {}

        if (refs.authModal) refs.authModal.style.display = "none";
        await fetchSessions();
        showToast("Signup successful");
      } else {
        showToast(res.body?.error || "Signup failed");
      }
    };

  // Logout
  if (refs.logoutBtn) refs.logoutBtn.onclick = logout;

  // Profile
  if (refs.profileOpenBtn)
    refs.profileOpenBtn.onclick = () => {
      loadProfile();
      if (refs.profileModal) refs.profileModal.style.display = "flex";
    };
  if (refs.profileCancel) refs.profileCancel.onclick = () => (refs.profileModal.style.display = "none");
  if (refs.profileSave) refs.profileSave.onclick = saveProfile;

  // Send message
  if (refs.sendBtn) refs.sendBtn.onclick = sendMessage;
  if (refs.inputEl)
    refs.inputEl.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    };

  // Emoji picker
  if (refs.emojiBtn)
    refs.emojiBtn.onclick = () => {
      if (!refs.emojiPicker) return;
      refs.emojiPicker.style.display =
        refs.emojiPicker.style.display === "block" ? "none" : "block";
    };

  // Voice mode (male/female icons)
  if (refs.maleBtn) refs.maleBtn.onclick = () => {
    state.voiceMode = "male";
    refs.maleBtn.classList.add("active");
    refs.femaleBtn && refs.femaleBtn.classList.remove("active");
  };
  if (refs.femaleBtn) refs.femaleBtn.onclick = () => {
    state.voiceMode = "female";
    refs.femaleBtn.classList.add("active");
    refs.maleBtn && refs.maleBtn.classList.remove("active");
  };

  // Voice selector buttons (EN/HI): add active UI and speak sample text
  const vsButtons = [refs.enMaleBtn, refs.enFemaleBtn, refs.hiMaleBtn, refs.hiFemaleBtn].filter(Boolean);
  vsButtons.forEach((btn) => {
    btn.onclick = () => {
      // remove active from all
      vsButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      // set voice mode based on label (male/female)
      const txt = btn.textContent || "";
      state.voiceMode = /male/i.test(txt) ? "male" : "female";
      // speak current input as demo if present
      if (refs.inputEl && refs.inputEl.value) speak(refs.inputEl.value);
    };
  });

  // STT
  if (refs.voiceToggleBtn) refs.voiceToggleBtn.onclick = toggleSTT;

  // Tools
  if (refs.searchBtn) refs.searchBtn.onclick = () => showToast("Search coming soon");
  if (refs.exportBtn)
    refs.exportBtn.onclick = () => {
      if (!state.activeSessionId) return;
      window.open(`${API_BASE}/export/${state.activeSessionId}`, "_blank");
    };
  if (refs.deleteBtn)
    refs.deleteBtn.onclick = () => {
      if (!state.activeSessionId) return;
      if (confirm("Delete this session?")) deleteSessionFromServer(state.activeSessionId);
    };
  if (refs.lockBtn) refs.lockBtn.onclick = () => showToast("Lock coming soon");

  // Theme
  if (refs.themeToggle) refs.themeToggle.onclick = toggleTheme;
  if (refs.wallpaperSelect)
    refs.wallpaperSelect.onchange = (e) => wallpaperChanged(e.target.value);

  // New session ripple + create
  if (refs.newSessionBtn)
    refs.newSessionBtn.onclick = (e) => {
      const rect = e.target.getBoundingClientRect();
      e.target.style.setProperty("--ripple-x", e.clientX - rect.left + "px");
      e.target.style.setProperty("--ripple-y", e.clientY - rect.top + "px");
      e.target.classList.remove("ripple-active");
      void e.target.offsetWidth;
      e.target.classList.add("ripple-active");
      setTimeout(createNewSession, 140);
    };

  bindSidebar();
  bindSearch();

  document.querySelectorAll(".section-header").forEach((h) => {
    h.onclick = () => {
      // Toggle only the corresponding .section-body sibling
      const parent = h.parentElement;
      if (!parent) return;
      const body = parent.querySelector(".section-body");
      if (!body) return;
      body.classList.toggle("collapsed");
    };
  });

  bindRecordingInteractions();
}

// Emoji builder
function buildEmojiPanel() {
  const EMOJIS = [
    "😀",
    "😄",
    "😁",
    "😂",
    "🙂",
    "😍",
    "😴",
    "😢",
    "😭",
    "😡",
    "👏",
    "🙏",
    "👍",
    "👎",
  ];

  if (!refs.emojiPicker || !refs.inputEl) return;
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

// Init
window.addEventListener("DOMContentLoaded", () => {
  cacheRefs();
  try {
    buildEmojiPanel();
  } catch {}

  loadTheme();

  // If token exists but user object missing, try to fetch /me silently
  if (state.token) {
    (async () => {
      try {
        const me = await fetch(`${API_BASE}/me`, { headers: authHeaders(false) });
        if (me.ok) {
          const ud = await me.json();
          localStorage.setItem("rb_user", JSON.stringify(ud));
          if (refs.authModal) refs.authModal.style.display = "none";
          await fetchSessions();
        } else if (me.status === 401) {
          // invalid stored token
          localStorage.removeItem("rb_token");
          state.token = null;
          if (refs.authModal) refs.authModal.style.display = "flex";
        } else {
          // proceed but show login
          if (refs.authModal) refs.authModal.style.display = "flex";
        }
      } catch (e) {
        if (refs.authModal) refs.authModal.style.display = "flex";
      }
    })();
  } else {
    if (refs.authModal) refs.authModal.style.display = "flex";
  }

  bindEvents();
  console.log("RelaxBuddy: FINAL script.js initialized");
});
