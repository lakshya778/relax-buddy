/* RelaxBuddy — merged & fixed script.js
   Features preserved & fixed:
   - Login / Signup (auth modal)
   - Sessions list (create / open / delete)
   - Streaming replies via /chat_stream (SSE style chunked text)
   - Fallback to /chat if stream fails
   - Export PDF, Set PIN (lock), Unlock
   - Search in session
   - Toast notifications
   - Emoji picker
   - Voice input (SpeechRecognition) and TTS (speechSynthesis)
   - Profile modal (localStorage)
   - Theme (dark) and wallpaper persistence
   Works with backend endpoints:
   /signup, /login, /logout, /sessions, /new_session, /session/<id>,
   /chat_stream (POST streaming), /chat (POST fallback),
   /search, /export/<id>, /session/<id>/set_pin, /session/<id>/unlock,
   /session/<id>/delete
*/

const API_BASE = "http://127.0.0.1:5000";

// ---------- State ----------
let state = {
  token: localStorage.getItem("rb_token") || null,
  sessions: [],
  activeSessionId: null,
  streamingAbortController: null,
  lastUserMessage: ""
};

// ---------- Helpers ----------
const $ = id => document.getElementById(id);

// DOM refs (must exist in your index.html)
const messagesEl = $("messages");
const inputEl = $("input");
const sendBtn = $("sendBtn");
const newSessionBtn = $("newSessionBtn");
const sessionsList = $("sessionsList");
const authModal = $("authModal");
const loginUser = $("loginUser");
const loginPass = $("loginPass");
const loginBtn = $("loginBtn");
const signupBtn = $("signupBtn");
const profileModal = $("profileModal");
const profileName = $("profileName");
const profileAvatar = $("profileAvatar");
const profileSave = $("profileSave");
const profileCancel = $("profileCancel");
const emojiBtn = $("emojiBtn");
const emojiPicker = $("emojiPicker");
const voiceToggleBtn = $("voiceToggleBtn");
const themeToggle = $("themeToggle");
const wallpaperSelect = $("wallpaperSelect");
const profileOpenBtn = $("profileOpenBtn");
const exportBtn = $("exportBtn");
const lockBtn = $("lockBtn");
const deleteBtn = $("deleteBtn");
const searchBtn = $("searchBtn");

// small toast helper (non-blocking)
function showToast(msg, type="info") {
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
  cont.appendChild(t);
  requestAnimationFrame(()=> { t.style.opacity = "1"; t.style.transform = "translateX(0)"; });
  setTimeout(()=> { t.remove(); }, 3500);
}

function authHeaders(isJson=true) {
  const hd = {};
  if (state.token) hd["Authorization"] = "Bearer " + state.token;
  if (isJson) hd["Content-Type"] = "application/json";
  return hd;
}

function timeNow() {
  const d = new Date();
  return d.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"});
}

function escapeHtml(s="") {
  return s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
          .replaceAll('"',"&quot;").replaceAll("'", "&#039;");
}

function nl2br(s="") { return s.replace(/\n/g, "<br>"); }

// ---------- Message bubbles ----------
function appendUserBubble(text) {
  const div = document.createElement("div");
  div.className = "bubble user";
  div.innerHTML = `<div class="text">${nl2br(escapeHtml(text))}</div><div class="time">${timeNow()}</div>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendBotBubble(text) {
  const div = document.createElement("div");
  div.className = "bubble bot";
  div.innerHTML = `<div class="text">${nl2br(escapeHtml(text))}</div><div class="time">${timeNow()}</div>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showTyping() {
  removeTyping();
  const el = document.createElement("div");
  el.id = "typingBubble";
  el.className = "bubble bot typing-bubble";
  el.innerHTML = `<div class="typing"><span></span><span></span><span></span></div>`;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById("typingBubble");
  if (el) el.remove();
}

// ---------- Auth: signup/login/logout ----------
async function signup(username, password) {
  try {
    const res = await fetch(`${API_BASE}/signup`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({username, password})
    });
    return await res.json();
  } catch (e) {
    return {error: e.message || "Network error"};
  }
}

async function login(username, password) {
  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({username, password})
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
    return {error: e.message};
  }
}

async function logout() {
  try { await fetch(`${API_BASE}/logout`, {method: "POST", headers: authHeaders()}); } catch(e){}
  state.token = null;
  localStorage.removeItem("rb_token");
  showToast("Logged out", "info");
  if (authModal) authModal.style.display = "flex";
  sessionsList.innerHTML = "";
  messagesEl.innerHTML = "";
  state.sessions = [];
  state.activeSessionId = null;
}

// ---------- Sessions management ----------
async function fetchSessions() {
  if (!state.token) return;
  try {
    const res = await fetch(`${API_BASE}/sessions`, {headers: authHeaders()});
    if (!res.ok) {
      const d = await res.json().catch(()=>({}));
      if (d.error && d.error.toLowerCase().includes("auth")) {
        logout();
      }
      return;
    }
    const arr = await res.json();
    state.sessions = arr;
    renderSessions();
    if (!state.activeSessionId && arr.length>0) await openSession(arr[0].id);
  } catch (e) {
    console.error("fetchSessions:", e);
  }
}

function renderSessions() {
  if(!sessionsList) return;
  sessionsList.innerHTML = "";
  state.sessions.forEach(s=>{
    const el = document.createElement("div");
    el.className = "session-item";
    el.textContent = (s.name || "Chat") + (s.locked ? " 🔒": "");
    el.onclick = ()=> openSession(s.id);
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
      body: JSON.stringify({name})
    });
    const d = await res.json();
    if (res.ok) {
      showToast("Session created", "success");
      await fetchSessions();
      if (d.session_id) openSession(d.session_id);
    } else showToast(d.error || "Failed to create", "error");
  } catch(e){ showToast("Create session failed","error"); console.error(e); }
}

async function openSession(id) {
  if (!state.token) { showToast("Login first","info"); return; }
  try {
    const res = await fetch(`${API_BASE}/session/${id}`, {headers: authHeaders()});
    if (!res.ok) {
      const d = await res.json().catch(()=>({}));
      if (d.locked || d.error === "locked") {
        const pin = prompt("Enter PIN to unlock:");
        if (!pin) return;
        const unlock = await fetch(`${API_BASE}/session/${id}/unlock`, {
          method: "POST", headers: authHeaders(), body: JSON.stringify({pin})
        });
        const ud = await unlock.json();
        if (!unlock.ok) { showToast(ud.error || "Unlock failed","error"); return; }
        return openSession(id);
      } else { showToast(d.error || "Cannot open session","error"); return; }
    }
    const msgs = await res.json();
    state.activeSessionId = id;
    messagesEl.innerHTML = "";
    msgs.forEach(m=>{
      if (m.sender === "user") appendUserBubble(m.text);
      else appendBotBubble(m.text);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  } catch(e){ console.error("openSession",e); showToast("Open failed","error"); }
}

async function deleteCurrentSession() {
  if (!state.activeSessionId) return showToast("Open a session first","info");
  if (!confirm("Delete this session?")) return;
  try {
    const res = await fetch(`${API_BASE}/session/${state.activeSessionId}/delete`, {
      method: "POST", headers: authHeaders()
    });
    const d = await res.json();
    if (res.ok) {
      showToast("Deleted", "success");
      state.activeSessionId = null;
      messagesEl.innerHTML = "";
      await fetchSessions();
    } else showToast(d.error || "Delete failed","error");
  } catch(e){ console.error(e); showToast("Delete error","error"); }
}

async function exportCurrentSessionPDF() {
  if (!state.activeSessionId) return showToast("Open a session first","info");
  try {
    const res = await fetch(`${API_BASE}/export/${state.activeSessionId}`, {
      headers: {"Authorization": "Bearer " + state.token}
    });
    if (!res.ok) { const d = await res.json().catch(()=>({})); showToast(d.error||"Export failed","error"); return; }
    const blob = await res.blob();
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u; a.download = `session_${state.activeSessionId}.pdf`; a.click();
    URL.revokeObjectURL(u);
    showToast("Export started","success");
  } catch(e){ console.error(e); showToast("Export failed","error"); }
}

async function lockCurrentSessionWithPin() {
  if (!state.activeSessionId) return showToast("Open a session first","info");
  const pin = prompt("Set PIN (4+ digits):");
  if (!pin || pin.length<4) return showToast("PIN too short","info");
  try {
    const res = await fetch(`${API_BASE}/session/${state.activeSessionId}/set_pin`, {
      method: "POST", headers: authHeaders(), body: JSON.stringify({pin})
    });
    const d = await res.json();
    if (res.ok) { showToast("Locked","success"); await fetchSessions(); }
    else showToast(d.error || "Lock failed","error");
  } catch(e){ console.error(e); showToast("Lock failed","error"); }
}

async function searchInSession() {
  if (!state.activeSessionId) return showToast("Open a session first","info");
  const q = prompt("Search query:");
  if (!q) return;
  try {
    const res = await fetch(`${API_BASE}/search?session_id=${state.activeSessionId}&q=${encodeURIComponent(q)}`, {
      headers: authHeaders(false)
    });
    if (!res.ok) { const d = await res.json().catch(()=>({})); showToast(d.error||"Search failed","error"); return; }
    const items = await res.json();
    // show results overlay
    let html = `<div style="padding:12px;max-height:60vh;overflow:auto">Found ${items.length} results<hr>`;
    items.forEach(it=>{
      html += `<div style="padding:8px;border-bottom:1px solid #eee"><div style="font-size:12px;color:#666">${escapeHtml(it.sender)} • ${escapeHtml(it.time)}</div><div style="margin-top:6px">${nl2br(escapeHtml(it.text))}</div></div>`;
    });
    html += `</div><div style="text-align:right;padding:8px"><button id="closeSearch">Close</button></div>`;
    const overlay = document.createElement("div");
    overlay.style = "position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:9999";
    const panel = document.createElement("div");
    panel.style = "width:720px;background:#fff;border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,0.18);";
    panel.innerHTML = html;
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    panel.querySelector("#closeSearch").onclick = () => overlay.remove();
  } catch(e){ console.error(e); showToast("Search failed","error"); }
}

// ---------- Streaming logic (core) ----------
async function startStreamingReply(userText, sessionId) {
  // create session if not present
  if (!sessionId) {
    try {
      const res = await fetch(`${API_BASE}/new_session`, {
        method: "POST", headers: authHeaders(), body: JSON.stringify({name: "Chat"})
      });
      const d = await res.json();
      if (res.ok && d.session_id) sessionId = d.session_id;
      await fetchSessions();
    } catch(e){ showToast("Failed to create session","error"); return; }
  }

  // save last message for regenerate
  state.lastUserMessage = userText;

  // show user bubble locally
  appendUserBubble(userText);

  // show typing
  showTyping();

  // abort previous stream if any
  if (state.streamingAbortController) {
    try { state.streamingAbortController.abort(); } catch(e){}
    state.streamingAbortController = null;
  }
  const controller = new AbortController();
  state.streamingAbortController = controller;

  try {
    const resp = await fetch(`${API_BASE}/chat_stream`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({message: userText, session_id: sessionId}),
      signal: controller.signal
    });

    if (!resp.ok) {
      removeTyping();
      const d = await resp.json().catch(()=>({}));
      showToast(d.error || "Stream failed, falling back", "error");
      await fallbackChat(userText, sessionId);
      state.streamingAbortController = null;
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullReply = "";
    // create a bot bubble we update in-place
    removeTyping();
    const botDiv = document.createElement("div");
    botDiv.className = "bubble bot";
    botDiv.innerHTML = `<div class="text"></div><div class="time">${timeNow()}</div>`;
    messagesEl.appendChild(botDiv);
    const textNode = botDiv.querySelector(".text");

    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, {stream:true});
      // handle SSE style "data: " lines or raw text
      const lines = chunk.split(/\r?\n/);
      for (const line of lines) {
        if (!line) continue;
        let piece = null;
        if (line.startsWith("data: ")) piece = line.replace(/^data: /, "");
        else piece = line;
        if (piece) {
          fullReply += piece;
          textNode.innerHTML = nl2br(escapeHtml(fullReply));
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      }
    }

    // stream ended
    state.streamingAbortController = null;
    // TTS if enabled
    const ttsPref = localStorage.getItem("rb_speak_bot") ?? "true";
    if (ttsPref === "true") speakText(fullReply);

    // refresh session messages (ensure DB sync)
    try { await openSession(sessionId); } catch(e){ /* ignore */ }

  } catch (e) {
    removeTyping();
    state.streamingAbortController = null;
    if (e.name === "AbortError") showToast("Stream cancelled","info");
    else {
      console.error("stream error", e);
      showToast("Streaming failed, using fallback", "error");
      await fallbackChat(userText, sessionId);
    }
  }
}

// fallback single-call
async function fallbackChat(userText, sessionId) {
  try {
    const res = await fetch(`${API_BASE}/chat`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({message: userText, session_id: sessionId})
    });
    const d = await res.json();
    if (res.ok) {
      if (d.crisis) {
        appendBotBubble(d.reply);
        appendBotBubble("Helpline: " + (d.helpline || "Check local emergency services"));
      } else {
        appendBotBubble(d.reply || "No reply");
      }
      if (d.session_id) await openSession(d.session_id);
    } else showToast(d.error || "Chat failed","error");
  } catch(e){ console.error(e); showToast("Chat failed","error"); }
}

// ---------- TTS & Speech Recognition ----------
function speakText(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    const ut = new SpeechSynthesisUtterance(text);
    ut.lang = 'en-US';
    ut.rate = parseFloat(localStorage.getItem("rb_tts_rate") || "1.0");
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(ut);
  } catch(e){ console.error("TTS error", e); }
}

let recognition = null, recognizing = false;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = 'en-US';
  recognition.interimResults = true;
  recognition.onstart = ()=> { recognizing = true; if (voiceToggleBtn) voiceToggleBtn.classList.add("active"); showToast("Recording...","info"); };
  recognition.onerror = (e)=>{ console.error("speech error",e); recognizing=false; voiceToggleBtn?.classList.remove("active"); showToast("Speech error","error"); };
  recognition.onend = ()=>{ recognizing = false; voiceToggleBtn?.classList.remove("active"); };
  recognition.onresult = (ev)=> {
    let interim="", final="";
    for (let i=0;i<ev.results.length;i++){
      const r = ev.results[i];
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    const ta = inputEl;
    ta.value = (ta.value ? ta.value + " " : "") + final + (interim ? " " + interim : "");
    ta.focus();
  };
} else {
  if (voiceToggleBtn) voiceToggleBtn.style.display = "none";
}

// ---------- Emoji picker ----------
const EMOJIS = ["😀","😃","😄","😁","😅","😂","😊","🙂","🙃","😉","😌","😍","😘","😜","🤗","🤔","🤨","😴","😪","😢","😭","😤","😡","🤯","😇","🤝","👏","🙏","👍","👎","💖"];
function buildEmojiPicker(){
  if (!emojiPicker) return;
  emojiPicker.innerHTML = "";
  EMOJIS.forEach(e=>{
    const b = document.createElement("button");
    b.type = "button"; b.className = "emoji-btn"; b.textContent = e;
    b.style.border = "0"; b.style.background = "transparent"; b.style.fontSize = "20px"; b.style.margin = "6px";
    b.onclick = ()=> {
      const ta = inputEl;
      const start = ta.selectionStart || 0, end = ta.selectionEnd || 0;
      ta.value = ta.value.slice(0,start) + e + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + e.length; ta.focus();
    };
    emojiPicker.appendChild(b);
  });
}

// ---------- Profile local ----------
function loadProfile(){
  const p = JSON.parse(localStorage.getItem("rb_profile") || "{}");
  if (profileName) profileName.value = p.name || "";
  if (profileAvatar) profileAvatar.value = p.avatar || "";
  if (profileOpenBtn) profileOpenBtn.innerText = p.avatar || (p.name ? p.name.slice(0,2).toUpperCase() : "A");
}
function saveProfile(){
  const p = {name: profileName?.value?.trim()||"", avatar: profileAvatar?.value?.trim().slice(0,2).toUpperCase()||""};
  localStorage.setItem("rb_profile", JSON.stringify(p));
  loadProfile();
  if (profileModal) profileModal.style.display = "none";
  showToast("Profile saved","success");
}

// ---------- Theme & Wallpaper ----------
const APP_ROOT = document.documentElement;
function loadThemeAndWallpaper(){
  const t = localStorage.getItem("rb_theme") || "light";
  if (t === "dark") APP_ROOT.classList.add("theme-dark");
  const w = localStorage.getItem("rb_wallpaper") || "wall-default";
  APP_ROOT.classList.add(w);
  if (wallpaperSelect) wallpaperSelect.value = w;
  if (themeToggle) themeToggle.classList.toggle("active", t === "dark");
}
function toggleTheme(){
  const dark = APP_ROOT.classList.toggle("theme-dark");
  localStorage.setItem("rb_theme", dark ? "dark" : "light");
  showToast(dark ? "Dark mode on" : "Dark mode off","info");
}
function wallpaperChanged(v){
  ["wall-default","wall-nature","wall-lavender","wall-dark"].forEach(c=>APP_ROOT.classList.remove(c));
  APP_ROOT.classList.add(v);
  localStorage.setItem("rb_wallpaper", v);
  showToast("Wallpaper changed","info");
}

// ---------- Event wiring ----------
async function init() {
  buildEmojiPicker();
  loadProfile();
  loadThemeAndWallpaper();
  if (!state.token) { if (authModal) authModal.style.display = "flex"; }
  else { if (authModal) authModal.style.display = "none"; await fetchSessions(); }
}

// Auth buttons
if (signupBtn) signupBtn.addEventListener("click", async ()=>{
  const u = loginUser?.value?.trim(); const p = loginPass?.value;
  if (!u||!p) return showToast("Username & password required","info");
  const r = await signup(u,p);
  if (r && r.ok) showToast("Signup successful. Login now.","success");
  else showToast(r.error || r.message || "Signup failed","error");
});
if (loginBtn) loginBtn.addEventListener("click", async ()=>{
  const u = loginUser?.value?.trim(); const p = loginPass?.value;
  if (!u||!p) return showToast("Username & password required","info");
  const r = await login(u,p);
  if (r && r.token) { /* already handled in login() */ }
  else showToast(r.error || "Login failed","error");
});

// profile modal wiring
if (profileOpenBtn) profileOpenBtn.addEventListener("click", ()=> { if (profileModal) { profileModal.style.display = "flex"; loadProfile(); }});
if (profileCancel) profileCancel.addEventListener("click", ()=> { if (profileModal) profileModal.style.display = "none"; });
if (profileSave) profileSave.addEventListener("click", saveProfile);

// composer send wiring
if (sendBtn) {
  sendBtn.addEventListener("click", async ()=>{
    const text = inputEl?.value?.trim();
    if (!text) return;
    if (!state.token) { showToast("Please login first","info"); return; }
    await startStreamingReply(text, state.activeSessionId);
    inputEl.value = "";
  });
}

// Enter key to send
if (inputEl) inputEl.addEventListener("keydown", (e)=>{ if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendBtn.click(); } });

// other controls
if (newSessionBtn) newSessionBtn.addEventListener("click", createNewSession);
if (deleteBtn) deleteBtn.addEventListener("click", deleteCurrentSession);
if (exportBtn) exportBtn.addEventListener("click", exportCurrentSessionPDF);
if (lockBtn) lockBtn.addEventListener("click", lockCurrentSessionWithPin);
if (searchBtn) searchBtn.addEventListener("click", searchInSession);
if (emojiBtn) emojiBtn.addEventListener("click", ()=> { if (!emojiPicker) return; emojiPicker.style.display = (emojiPicker.style.display === "block") ? "none" : "block"; });
document.addEventListener("click", (e)=>{ if (!emojiPicker) return; if (emojiPicker.contains(e.target) || emojiBtn.contains(e.target)) return; emojiPicker.style.display = "none"; });

if (voiceToggleBtn) voiceToggleBtn.addEventListener("click", ()=>{
  if (!recognition) return showToast("Voice not supported","info");
  if (!recognizing) { try { recognition.start(); } catch(e){ console.error(e); } }
  else recognition.stop();
});

if (themeToggle) themeToggle.addEventListener("click", toggleTheme);
if (wallpaperSelect) wallpaperSelect.addEventListener("change", (e)=> wallpaperChanged(e.target.value));

// quick focus shortcut
document.addEventListener("keydown", (e)=> { if (e.ctrlKey && e.key === "k") { inputEl?.focus(); e.preventDefault(); } });

// middle-click on profile to logout
if (profileOpenBtn) profileOpenBtn.addEventListener("auxclick", (e)=> { if (e.button === 1) logout(); });

// init on load
window.addEventListener("load", ()=> { init(); });
