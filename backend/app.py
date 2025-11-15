# app.py
import os
import sqlite3
import secrets
import bcrypt
import io
from datetime import datetime, timedelta
from functools import wraps
from flask import Flask, request, jsonify, send_file, g
from flask_cors import CORS
from flask import Response, stream_with_context

from prompts import SYSTEM_PROMPT

from dotenv import load_dotenv
from groq import Groq
from reportlab.pdfgen import canvas

# load env
load_dotenv()
MODEL_NAME = "groq/compound"

# ---------------------------
# Config
# ---------------------------
DB_PATH = "relaxbuddy.db"
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MODEL_NAME = "groq/compound"
TOKEN_TTL_DAYS = 30

# ---------------------------
# Flask + Groq clients
# ---------------------------
app = Flask(__name__)
CORS(app)

client = Groq(api_key=GROQ_API_KEY, default_headers={"Groq-Model-Version": "latest"})

# ---------------------------
# DB initialization
# ---------------------------
def get_db():
    db = getattr(g, "_database", None)
    if db is None:
        db = g._database = sqlite3.connect(DB_PATH, check_same_thread=False)
        db.row_factory = sqlite3.Row
    return db

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
    # sessions (chat sessions)
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

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, "_database", None)
    if db is not None:
        db.close()

# boot db
with app.app_context():
    init_db()

# ---------------------------
# Utilities
# ---------------------------
def hash_password(password: str) -> bytes:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())

def check_password(password: str, pw_hash: bytes) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), pw_hash)

def hash_pin(pin: str) -> bytes:
    return bcrypt.hashpw(pin.encode("utf-8"), bcrypt.gensalt())

def check_pin(pin: str, pin_hash: bytes) -> bool:
    return bcrypt.checkpw(pin.encode("utf-8"), pin_hash)

def generate_token():
    return secrets.token_hex(32)

def get_user_by_token(token):
    if not token:
        return None
    db = get_db()
    row = db.execute(
        "SELECT * FROM users WHERE token = ? AND token_expiry > ?",
        (token, datetime.utcnow().isoformat()),
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
        # attach user to request context
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
# Auth endpoints: signup/login/logout
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
        now = datetime.utcnow().isoformat()
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
# Session and message helpers
# ---------------------------
def create_session_db(user_id=None, name="Chat"):
    db = get_db()
    now = datetime.utcnow().isoformat()
    cur = db.execute("INSERT INTO sessions (user_id, name, created_at) VALUES (?,?,?)", (user_id, name, now))
    db.commit()
    return cur.lastrowid

def save_message_db(session_id, sender, text):
    db = get_db()
    now = datetime.utcnow().strftime("%H:%M")
    db.execute("INSERT INTO messages (session_id, sender, text, time) VALUES (?,?,?,?)", (session_id, sender, text, now))
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
# Groq call
# ---------------------------
def call_groq_compound(user_message):
    try:
        completion = client.chat.completions.create(
            model=MODEL_NAME,
            messages=[
                {"role": "system", "content": "You are RelaxBuddy — a supportive, non-clinical assistant. Keep replies concise and empathetic."},
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
        print("GROQ ERROR:", e)
        return None

# ---------------------------
# API: sessions/messages
# ---------------------------

@app.route("/sessions", methods=["GET"])
@require_auth
def list_sessions():
    user = request.user
    db = get_db()
    # admins can see all
    if user["is_admin"] == 1:
        rows = db.execute("SELECT id, name, user_id, created_at, locked FROM sessions ORDER BY id DESC").fetchall()
    else:
        rows = db.execute("SELECT id, name, user_id, created_at, locked FROM sessions WHERE user_id = ? ORDER BY id DESC", (user["id"],)).fetchall()
    out = [dict(r) for r in rows]
    return jsonify(out)

@app.route("/session/<int:sid>", methods=["GET"])
@require_auth
def get_session_messages(sid):
    user = request.user
    row = get_session(sid)
    if not row:
        return jsonify({"error": "session not found"}), 404
    # ownership or admin
    if row["user_id"] and row["user_id"] != user["id"] and user["is_admin"] != 1:
        return jsonify({"error": "forbidden"}), 403
    # locked?
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
    return jsonify({"session_id": sid})

@app.route("/chat_stream", methods=["POST"])
@require_auth
def chat_stream():
    user = request.user
    data = request.get_json() or {}
    msg = data.get("message", "").strip()
    session_id = data.get("session_id")

    if not msg:
        return jsonify({"error": "Message required"}), 400

    # Create or validate session
    if not session_id:
        session_id = create_session_db(user["id"], "Chat")

    session = get_session(session_id)
    if not session:
        return jsonify({"error": "session not found"}), 404

    # SAVE user message (in request context)
    save_message_db(session_id, "user", msg)

    def generate():
        full_reply = ""

        try:
            stream = client.chat.completions.create(
                model="groq/compound",
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": msg}
                ],
                stream=True,
                compound_custom={"tools": {"enabled_tools": []}},
                extra_headers={"Groq-Model-Version": "latest"}
            )

            # STREAM LOOP
            for chunk in stream:
                delta = chunk.choices[0].delta

                if delta and delta.content:
                    piece = delta.content
                    full_reply += piece
                    yield f"data: {piece}\n\n"

            # SAVE Bot message (needs context!)
            with app.app_context():
                save_message_db(session_id, "bot", full_reply)

        except Exception as e:
            print("STREAM ERROR:", e)
            yield "data: [Stream error occurred]\n\n"

    return app.response_class(generate(), mimetype="text/event-stream")

@app.route("/chat", methods=["POST"])
@require_auth
def chat():
    user = request.user
    data = request.get_json() or {}
    msg = (data.get("message") or "").strip()
    session_id = data.get("session_id")
    if not msg:
        return jsonify({"reply": "Please say something.", "crisis": False}), 400

    # if session missing -> create one
    if not session_id:
        session_id = create_session_db(user_id=user["id"], name="Chat")

    session = get_session(session_id)
    if not session:
        return jsonify({"error": "session not found"}), 404

    # ownership check
    if session["user_id"] and session["user_id"] != user["id"] and user["is_admin"] != 1:
        return jsonify({"error": "forbidden"}), 403

    # locked check
    if session["locked"] == 1:
        return jsonify({"error": "session locked"}, 403)

    # save user msg
    save_message_db(session_id, "user", msg)

    # crisis
    if detect_crisis(msg):
        save_message_db(session_id, "bot", "If you're in danger, please contact emergency services immediately.")
        return jsonify({"reply": "I'm really sorry you're feeling this way. Please contact emergency services.", "crisis": True, "helpline": HELPLINES, "session_id": session_id})

    # call model
    reply = call_groq_compound(msg)
    if reply is None:
        # model error
        save_message_db(session_id, "bot", "AI error: please retry later.")
        return jsonify({"reply": "AI model error. Please try again later.", "crisis": False, "session_id": session_id})

    # save bot reply
    save_message_db(session_id, "bot", reply)
    return jsonify({"reply": reply, "crisis": False, "session_id": session_id})

# ---------------------------
# Search messages in a session
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

    # generate PDF in-memory
    buffer = io.BytesIO()
    p = canvas.Canvas(buffer)
    p.setTitle(f"RelaxBuddy_session_{session_id}")
    y = 800
    p.setFont("Helvetica-Bold", 14)
    p.drawString(40, y, f"RelaxBuddy Chat - Session {session_id}")
    y -= 30
    p.setFont("Helvetica", 11)
    for m in msgs:
        txt = f"[{m['time']}] {m['sender'].upper()}: {m['text']}"
        # wrap simple
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

# ---------------------------
# Delete session
# ---------------------------
@app.route("/session/<int:session_id>/delete", methods=["POST"])
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

# ---------------------------
# PIN / Private mode
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
    db.execute("UPDATE sessions SET locked = 1, pin_hash = ? WHERE id = ?", (pin_h, session_id))
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
        db.execute("UPDATE sessions SET locked = 0 WHERE id = ?", (session_id,))
        db.commit()
        return jsonify({"ok": True})
    else:
        return jsonify({"error":"invalid pin"}), 403

# ---------------------------
# Admin endpoints (requires admin token)
# ---------------------------
@app.route("/admin/sessions", methods=["GET"])
@require_auth
@require_admin
def admin_list_sessions():
    db = get_db()
    rows = db.execute("SELECT s.id, s.name, s.user_id, u.username, s.created_at, s.locked FROM sessions s LEFT JOIN users u ON s.user_id = u.id ORDER BY s.id DESC").fetchall()
    out = []
    for r in rows:
        out.append({"id": r["id"], "name": r["name"], "user_id": r["user_id"], "username": r["username"], "created_at": r["created_at"], "locked": r["locked"]})
    return jsonify(out)

@app.route("/admin/session/<int:sid>/messages", methods=["GET"])
@require_auth
@require_admin
def admin_session_messages(sid):
    msgs = get_messages_for_session(sid)
    return jsonify(msgs)

# ---------------------------
# Run
# ---------------------------
if __name__ == "__main__":
    print("RelaxBuddy (SQLite + Auth) running at http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=True)
