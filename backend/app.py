# final app.py — RelaxBuddy (Patched, RESTful + DB migrations)
import os
import sqlite3
import secrets
import bcrypt
import io
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, send_file, g, Response
from flask_cors import CORS

# Optional model + TTS libs (if not used you can safely comment out)
try:
    from prompts import SYSTEM_PROMPT
except Exception:
    SYSTEM_PROMPT = "You are RelaxBuddy — a supportive, non-clinical assistant. Keep replies concise and empathetic."

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# If you use Groq, keep this — else mock or adapt call_groq_compound
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MODEL_NAME = os.getenv("MODEL_NAME", "groq/compound")
try:
    from groq import Groq
    client = Groq(api_key=GROQ_API_KEY, default_headers={"Groq-Model-Version": "latest"})
except Exception:
    client = None

# TTS & ffmpeg usage
try:
    from gtts import gTTS
except Exception:
    gTTS = None
import subprocess

# ---------------------------
# Config
# ---------------------------
DB_PATH = os.getenv("RB_DB_PATH", "relaxbuddy.db")
TOKEN_TTL_DAYS = int(os.getenv("RB_TOKEN_TTL_DAYS", "30"))

# ---------------------------
# Flask
# ---------------------------
app = Flask(__name__)
CORS(app)

# ---------------------------
# DB helpers + migrations
# ---------------------------
def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DB_PATH, check_same_thread=False)
        db.row_factory = sqlite3.Row
    return db

def ensure_column(table, column, definition):
    """Add column if missing (simple sqlite ALTER)."""
    db = get_db()
    cur = db.execute(f"PRAGMA table_info({table});").fetchall()
    cols = [c["name"] for c in cur]
    if column not in cols:
        db.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition};")
        db.commit()

def init_db():
    db = get_db()
    c = db.cursor()
    # users
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password_hash BLOB,
            token TEXT,
            token_expiry TEXT,
            is_admin INTEGER DEFAULT 0,
            created_at TEXT
        );
    """)
    # sessions
    c.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            name TEXT,
            created_at TEXT,
            locked INTEGER DEFAULT 0,
            pin_hash BLOB,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
    """)
    # messages
    c.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER,
            sender TEXT,
            text TEXT,
            time TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions (id)
        );
    """)
    db.commit()

    # Migrate: add updated_at and pinned if they don't exist
    ensure_column("sessions", "updated_at", "TEXT")
    ensure_column("sessions", "pinned", "INTEGER DEFAULT 0")

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()

# initialize DB + migrations
with app.app_context():
    init_db()

# ---------------------------
# Utilities
# ---------------------------
def hash_password(password: str) -> bytes:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())

def check_password(password: str, pw_hash: bytes) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), pw_hash)
    except Exception:
        return False

def hash_pin(pin: str) -> bytes:
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt())

def check_pin(pin: str, pin_hash: bytes) -> bool:
    try:
        return bcrypt.checkpw(pin.encode("utf-8"), pin_hash)
    except Exception:
        return False

def generate_token():
    return secrets.token_hex(32)

def now_iso():
    return datetime.utcnow().isoformat()

def now_time_str():
    return datetime.utcnow().strftime("%H:%M")

def get_user_by_token(token):
    if not token:
        return None
    db = get_db()
    # token_expiry stored as ISO string — simple comparison works for same format
    row = db.execute(
        "SELECT * FROM users WHERE token = ? AND token_expiry > ?",
        (token, now_iso()),
    ).fetchone()
    return row

def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        token = None
        if auth.startswith("Bearer "):
            token = auth.split(" ",1)[1]
        user = get_user_by_token(token)
        if not user:
            return jsonify({"error": "Authentication required"}), 401
        request.user = user
        return fn(*args, **kwargs)
    return wrapper

def require_admin(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        user = getattr(request, "user", None)
        if not user or user["is_admin"] != 1:
            return jsonify({"error": "Admin required"}), 403
        return fn(*args, **kwargs)
    return wrapper

# ---------------------------
# Auth endpoints
# ---------------------------
@app.route("/signup", methods=["POST"])
def signup():
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return jsonify({"error": "username & password required"}), 400

    db = get_db()
    try:
        pw_hash = hash_password(password)
        now = now_iso()
        db.execute(
            "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
            (username, pw_hash, now),
        )
        db.commit()
        return jsonify({"ok": True, "message": "User created"}), 201
    except sqlite3.IntegrityError:
        return jsonify({"error": "username already exists"}), 400

@app.route("/login", methods=["POST"])
def login():
    data = request.get_json() or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return jsonify({"error": "username & password required"}), 400

    db = get_db()
    row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
    if not row:
        return jsonify({"error": "invalid credentials"}), 401

    if not check_password(password, row["password_hash"]):
        return jsonify({"error": "invalid credentials"}), 401

    token = generate_token()
    expiry = (datetime.utcnow() + timedelta(days=TOKEN_TTL_DAYS)).isoformat()
    db.execute("UPDATE users SET token = ?, token_expiry = ? WHERE id = ?", (token, expiry, row["id"]))
    db.commit()
    return jsonify({"token": token, "user_id": row["id"], "is_admin": bool(row["is_admin"])}), 200

@app.route("/logout", methods=["POST"])
@require_auth
def logout():
    user = request.user
    db = get_db()
    db.execute("UPDATE users SET token = NULL, token_expiry = NULL WHERE id = ?", (user["id"],))
    db.commit()
    return jsonify({"ok": True})

# ---------------------------
# TTS endpoints (simple wrappers)
# ---------------------------
@app.route("/tts_female", methods=["POST"])
def tts_female():
    data = request.get_json() or {}
    text = data.get("text", "")
    if not text:
        return jsonify({"error":"text required"}), 400
    if gTTS is None:
        return jsonify({"error":"gTTS not available on server"}), 500
    buf = io.BytesIO()
    try:
        tts = gTTS(text=text, lang="hi")
        tts.write_to_fp(buf)
        buf.seek(0)
        return send_file(buf, mimetype="audio/mpeg")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/tts_male", methods=["POST"])
def tts_male():
    data = request.get_json() or {}
    text = data.get("text", "")
    if not text:
        return jsonify({"error":"text required"}), 400
    if gTTS is None:
        return jsonify({"error":"gTTS not available on server"}), 500
    try:
        base_buf = io.BytesIO()
        tts = gTTS(text=text, lang="hi")
        tts.write_to_fp(base_buf)
        base_buf.seek(0)
        # lower pitch via ffmpeg (ensure ffmpeg installed)
        process = subprocess.Popen(
            [
                "ffmpeg", "-i", "pipe:0",
                "-af", "asetrate=44100*0.9,aresample=44100", # gentle shift
                "-f", "mp3", "pipe:1"
            ],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE
        )
        out, err = process.communicate(base_buf.read())
        return send_file(io.BytesIO(out), mimetype="audio/mpeg")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ---------------------------
# Session & message helpers
# ---------------------------
def create_session_db(user_id=None, name="Chat"):
    db = get_db()
    now = now_iso()
    cur = db.execute(
        "INSERT INTO sessions (user_id, name, created_at, updated_at) VALUES (?,?,?,?)",
        (user_id, name, now, now)
    )
    db.commit()
    return cur.lastrowid

def save_message_db(session_id, sender, text):
    db = get_db()
    now = now_time_str()
    db.execute("INSERT INTO messages (session_id, sender, text, time) VALUES (?,?,?,?)", (session_id, sender, text, now))
    # update session updated_at
    db.execute("UPDATE sessions SET updated_at = ? WHERE id = ?", (now_iso(), session_id))
    db.commit()

def get_session(session_id):
    db = get_db()
    row = db.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    return row

def get_messages_for_session(session_id):
    db = get_db()
    rows = db.execute("SELECT sender, text, time FROM messages WHERE session_id = ? ORDER BY id ASC", (session_id,)).fetchall()
    return [{"sender": r["sender"], "text": r["text"], "time": r["time"]} for r in rows]

# ---------------------------
# Crisis detection
# ---------------------------
CRISIS_KEYWORDS = [
    "suicide", "kill myself", "kill me", "end my life", "want to die",
    "self-harm", "cut myself", "hurt myself", "hang myself", "life is meaningless"
]
HELPLINES = "India: Aasra 9820466726 | USA: 988 | UK: 116 123"

def detect_crisis(text):
    t = (text or "").lower()
    return any(k in t for k in CRISIS_KEYWORDS)

# ---------------------------
# Model (Groq) call (simple wrapper)
# ---------------------------
def call_groq_compound(user_message):
    if client is None:
        # Model client not configured — return a simple echo for local dev
        return f"I heard: {user_message}"
    try:
        completion = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message}
            ],
            temperature=0.7,
            max_completion_tokens=400,
            top_p=1,
            stream=False,
            compound_custom={"tools":{"enabled_tools":[]}}
        )
        return completion.choices[0].message.content
    except Exception as e:
        app.logger.error("GROQ ERROR: %s", e)
        return None

# ---------------------------
# API: sessions/messages
# ---------------------------
@app.route("/sessions", methods=["GET"])
@require_auth
def list_sessions():
    user = request.user
    db = get_db()
    if user["is_admin"] == 1:
        rows = db.execute("SELECT id, name, user_id, created_at, updated_at, locked, pinned FROM sessions ORDER BY COALESCE(updated_at, created_at) DESC").fetchall()
    else:
        rows = db.execute("SELECT id, name, user_id, created_at, updated_at, locked, pinned FROM sessions WHERE user_id = ? ORDER BY COALESCE(updated_at, created_at) DESC", (user["id"],)).fetchall()
    out = [dict(r) for r in rows]
    return jsonify(out)

@app.route("/session/<int:sid>", methods=["GET"])
@require_auth
def get_session_messages(sid):
    user = request.user
    row = get_session(sid)
    if not row:
        return jsonify({"error": "session not found"}), 404
    if row["user_id"] and row["user_id"] != user["id"] and user["is_admin"] != 1:
        return jsonify({"error": "forbidden"}), 403
    if row["locked"] == 1:
        return jsonify({"error": "locked", "locked": True}), 403
    msgs = get_messages_for_session(sid)
    return jsonify(msgs)

@app.route("/new_session", methods=["POST"])
@require_auth
def new_session():
    user = request.user
    data = request.get_json() or {}
    name = data.get("name") or "Chat"
    sid = create_session_db(user_id=user["id"], name=name)
    row = get_session(sid)
    return jsonify({"session_id": sid, "id": sid, "name": row["name"], "created_at": row["created_at"], "updated_at": row["updated_at"]})

# ---------------------------
# Rename, Pin, Delete endpoints
# ---------------------------
@app.route("/session/<int:session_id>/rename", methods=["POST"])
@require_auth
def rename_session(session_id):
    user = request.user
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    session = get_session(session_id)
    if not session:
        return jsonify({"error":"not found"}), 404
    if session["user_id"] and session["user_id"] != user["id"] and user["is_admin"] != 1:
        return jsonify({"error":"forbidden"}), 403
    db = get_db()
    db.execute("UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?", (name, now_iso(), session_id))
    db.commit()
    return jsonify({"ok": True, "name": name})

@app.route("/session/<int:session_id>/pin", methods=["POST"])
@require_auth
def pin_session(session_id):
    user = request.user
    data = request.get_json() or {}
    pinned = 1 if data.get("pinned") else 0
    session = get_session(session_id)
    if not session:
        return jsonify({"error":"not found"}), 404
    if session["user_id"] and session["user_id"] != user["id"] and user["is_admin"] != 1:
        return jsonify({"error":"forbidden"}), 403
    db = get_db()
    db.execute("UPDATE sessions SET pinned = ?, updated_at = ? WHERE id = ?", (pinned, now_iso(), session_id))
    db.commit()
    return jsonify({"ok": True, "pinned": bool(pinned)})

# RESTful delete (recommended)
@app.route("/session/<int:session_id>", methods=["DELETE"])
@require_auth
def delete_session(session_id):
    user = request.user
    session = get_session(session_id)
    if not session:
        return jsonify({"error":"not found"}), 404
    if session["user_id"] and session["user_id"] != user["id"] and user["is_admin"] != 1:
        return jsonify({"error":"forbidden"}), 403
    db = get_db()
    db.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))
    db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    db.commit()
    return jsonify({"ok": True})

# Backwards-compatible delete route (POST)
@app.route("/session/<int:session_id>/delete", methods=["POST"])
@require_auth
def delete_session_post(session_id):
    return delete_session(session_id)

# ---------------------------
# Chat streaming (SSE)
# ---------------------------
@app.route("/chat_stream", methods=["POST"])
@require_auth
def chat_stream():
    user = request.user
    data = request.get_json() or {}
    msg = data.get("message", "").strip()
    session_id = data.get("session_id")

    if not msg:
        return jsonify({"error": "Message required"}), 400

    # create or validate session
    if not session_id:
        session_id = create_session_db(user["id"], "Chat")

    session = get_session(session_id)
    if not session:
        return jsonify({"error": "session not found"}), 404

    # ownership check
    if session["user_id"] and session["user_id"] != user["id"] and user["is_admin"] != 1:
        return jsonify({"error":"forbidden"}), 403

    # save user message
    save_message_db(session_id, "user", msg)

    def generate():
        full_reply = ""
        try:
            # If Groq client available, stream; else simulate
            if client:
                stream = client.chat.completions.create(
                    model=MODEL_NAME,
                    messages=[
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": msg}
                    ],
                    stream=True,
                    compound_custom={"tools": {"enabled_tools": []}},
                    extra_headers={"Groq-Model-Version": "latest"}
                )
                for chunk in stream:
                    delta = chunk.choices[0].delta
                    if delta and delta.content:
                        piece = delta.content
                        full_reply += piece
                        yield f"data: {piece}\n\n"
            else:
                # Local fallback streaming simulation
                reply = call_groq_compound(msg) or "Sorry, I couldn't respond."
                for i in range(0, len(reply), 60):
                    piece = reply[i:i+60]
                    full_reply += piece
                    yield f"data: {piece}\n\n"
        except Exception as e:
            app.logger.error("STREAM ERROR: %s", e)
            yield "data: [Stream error occurred]\n\n"

        # save final bot message
        try:
            with app.app_context():
                save_message_db(session_id, "bot", full_reply)
        except Exception as e:
            app.logger.error("Error saving bot message: %s", e)
            # still emit a finishing event for client
            yield f"data: [Save error]\n\n"

    return Response(generate(), mimetype="text/event-stream")

# ---------------------------
# Non-stream chat (single response)
# ---------------------------
@app.route("/chat", methods=["POST"])
@require_auth
def chat():
    user = request.user
    data = request.get_json() or {}
    msg = (data.get("message") or "").strip()
    session_id = data.get("session_id")
    if not msg:
        return jsonify({"reply": "Please say something.", "crisis": False}), 400

    if not session_id:
        session_id = create_session_db(user_id=user["id"], name="Chat")

    session = get_session(session_id)
    if not session:
        return jsonify({"error": "session not found"}), 404

    if session["user_id"] and session["user_id"] != user["id"] and user["is_admin"] != 1:
        return jsonify({"error": "forbidden"}), 403

    if session["locked"] == 1:
        return jsonify({"error": "session locked"}, 403)

    save_message_db(session_id, "user", msg)

    if detect_crisis(msg):
        save_message_db(session_id, "bot", "If you're in danger, please contact emergency services immediately.")
        return jsonify({"reply": "I'm really sorry you're feeling this way. Please contact emergency services.", "crisis": True, "helpline": HELPLINES, "session_id": session_id})

    reply = call_groq_compound(msg)
    if reply is None:
        save_message_db(session_id, "bot", "AI error: please retry later.")
        return jsonify({"reply": "AI model error. Please try again later.", "crisis": False, "session_id": session_id})

    save_message_db(session_id, "bot", reply)
    return jsonify({"reply": reply, "crisis": False, "session_id": session_id})

# ---------------------------
# Search messages
# ---------------------------
@app.route("/search", methods=["GET"])
@require_auth
def search_messages():
    user = request.user
    session_id = request.args.get("session_id", type=int)
    q = (request.args.get("q") or "").strip().lower()
    if not session_id or not q:
        return jsonify({"error": "session_id & q required"}), 400
    session = get_session(session_id)
    if not session:
        return jsonify({"error": "session not found"}), 404
    if session["user_id"] and session["user_id"] != user["id"] and user["is_admin"] != 1:
        return jsonify({"error": "forbidden"}), 403
    db = get_db()
    rows = db.execute("SELECT id, sender, text, time FROM messages WHERE session_id = ? AND lower(text) LIKE ? ORDER BY id ASC", (session_id, f"%{q}%")).fetchall()
    out = [{"id": r["id"], "sender": r["sender"], "text": r["text"], "time": r["time"]} for r in rows]
    return jsonify(out)

# ---------------------------
# Export session as PDF
# ---------------------------
@app.route("/export/<int:session_id>", methods=["GET"])
@require_auth
def export_pdf(session_id):
    user = request.user
    session = get_session(session_id)
    if not session:
        return jsonify({"error":"session not found"}), 404
    if session["user_id"] and session["user_id"] != user["id"] and user["is_admin"] != 1:
        return jsonify({"error":"forbidden"}), 403
    msgs = get_messages_for_session(session_id)

    buffer = io.BytesIO()
    try:
        from reportlab.pdfgen import canvas
        p = canvas.Canvas(buffer)
        p.setTitle(f"RelaxBuddy_session_{session_id}")
        y = 800
        p.setFont("Helvetica-Bold", 14)
        p.drawString(40, y, f"RelaxBuddy Chat - Session {session_id}")
        y -= 30
        p.setFont("Helvetica", 11)
        for m in msgs:
            txt = f"[{m['time']}] {m['sender'].upper()}: {m['text']}"
            lines = []
            while len(txt) > 90:
                lines.append(txt[:90])
                txt = txt[90:]
            lines.append(txt)
            for line in lines:
                if y < 60:
                    p.showPage()
                    y = 800
                p.drawString(40, y, line)
                y -= 14
            y -= 6
        p.save()
        buffer.seek(0)
        return send_file(buffer, as_attachment=True, download_name=f"relaxbuddy_session_{session_id}.pdf", mimetype="application/pdf")
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ---------------------------
# Admin endpoints
# ---------------------------
@app.route("/admin/sessions", methods=["GET"])
@require_auth
@require_admin
def admin_list_sessions():
    db = get_db()
    rows = db.execute("SELECT s.id, s.name, s.user_id, u.username, s.created_at, s.updated_at, s.locked FROM sessions s LEFT JOIN users u ON s.user_id = u.id ORDER BY s.id DESC").fetchall()
    out = []
    for r in rows:
        out.append({"id": r["id"], "name": r["name"], "user_id": r["user_id"], "username": r["username"], "created_at": r["created_at"], "updated_at": r["updated_at"], "locked": r["locked"]})
    return jsonify(out)

@app.route("/admin/session/<int:sid>/messages", methods=["GET"])
@require_auth
@require_admin
def admin_session_messages(sid):
    msgs = get_messages_for_session(sid)
    return jsonify(msgs)

# ---------------------------
# PIN / Private mode (unlock endpoint)
# ---------------------------
@app.route("/session/<int:session_id>/set_pin", methods=["POST"])
@require_auth
def set_pin(session_id):
    user = request.user
    data = request.get_json() or {}
    pin = data.get("pin", "").strip()
    if not pin or len(pin) < 4:
        return jsonify({"error":"pin must be at least 4 digits"}), 400
    session = get_session(session_id)
    if not session:
        return jsonify({"error":"not found"}), 404
    if session["user_id"] and session["user_id"] != user["id"] and user["is_admin"] != 1:
        return jsonify({"error":"forbidden"}), 403
    pin_h = hash_pin(pin)
    db = get_db()
    db.execute("UPDATE sessions SET locked = 1, pin_hash = ?, updated_at = ? WHERE id = ?", (pin_h, now_iso(), session_id))
    db.commit()
    return jsonify({"ok": True})

@app.route("/session/<int:session_id>/unlock", methods=["POST"])
@require_auth
def unlock_session(session_id):
    user = request.user
    data = request.get_json() or {}
    pin = data.get("pin", "").strip()
    session = get_session(session_id)
    if not session:
        return jsonify({"error":"not found"}), 404
    if not session["locked"]:
        return jsonify({"ok": True, "message": "session not locked"})
    pin_hash = session["pin_hash"]
    if not pin_hash:
        return jsonify({"error":"no pin set"}), 400
    if check_pin(pin, pin_hash):
        db = get_db()
        db.execute("UPDATE sessions SET locked = 0, updated_at = ? WHERE id = ?", (now_iso(), session_id))
        db.commit()
        return jsonify({"ok": True})
    else:
        return jsonify({"error":"invalid pin"}), 403

# ---------------------------
# Run
# ---------------------------
if __name__ == "__main__":
    print("RelaxBuddy (SQLite + Auth) running at http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=True)
