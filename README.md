# RelaxBuddy — AI Mental Health Support Chatbot (Non-Clinical)

**Project overview**
RelaxBuddy is a small demonstration web app: an empathetic, non-clinical AI chatbot that supports emotional well-being with a calming tone. It is **not** a replacement for professional mental health care.

**Features**
- Empathetic, calming responses (non-clinical)
- Crisis keyword detection (self-harm, suicide, etc.) that returns supportive messaging + helpline suggestion
- Simple HTML/CSS/JS frontend with typing animation
- Python Flask backend with LLM integration (OpenAI or local model)
- No database required

---

## File structure
```
ai-mental-health-chatbot/
├─ frontend/
│ ├─ index.html
│ ├─ style.css
│ └─ script.js
├─ backend/
│ ├─ app.py
│ └─ prompts.py
├─ .env.example
├─ requirements.txt
├─ README.md
└─ PPT/
└─ slides.txt


---
```
## Installation

1. Clone the repo:
```bash
git clone <repo-url>
cd ai-mental-health-chatbot
Create a Python virtual environment (recommended):


python -m venv venv
source venv/bin/activate      # macOS/Linux
venv\Scripts\activate         # Windows PowerShell
Install Python packages:


pip install -r requirements.txt
Add your OpenAI API key (optional but recommended) - create a .env file or set environment variable:

```
# .env (example)
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
If you do not set OPENAI_API_KEY, the server will run but return placeholder responses.

Run the server
From project root:


# run backend
cd backend
python app.py
Server starts at http://127.0.0.1:5000.

Open frontend/index.html in your browser (or serve the frontend/ directory via a static server). The frontend posts messages to http://127.0.0.1:5000/chat.

How to integrate your own API key (OpenAI)
Obtain an API key from OpenAI.

Set OPENAI_API_KEY environment variable (or add to .env).

Edit backend/app.py > call_openai_chat to select your desired model and parameters.

Restart the server.

Safety & Important notes
This project is for demonstration and educational purposes only. It is not a clinical service.

The crisis helpline strings in the code are placeholders. Before any public deployment replace them with verified, local helpline numbers and follow legal/regulatory guidance.

Always include an obvious disclaimer and emergency instructions.

Screenshots (placeholders)
screenshots/01-home.png — Chat window

screenshots/02-typing.png — Typing animation

screenshots/03-crisis.png — Crisis helpline suggestion

Future improvements
Add verified, localized helpline lookup by geolocation or user-provided country.

Add conversation history persistence (securely).

Add tone controls or user preferences.

Add audit logging for safety review (with privacy safeguards).

yaml
Copy code

---

# .env.example

Copy to .env and fill your key
OPENAI_API_KEY=sk-XXXX



---

# G. PPT Content (10 Slides)

Place in `PPT/slides.txt` or copy directly into PowerPoint. Each slide: title + bullet points.

Slide 1 — Title

RelaxBuddy: AI Mental Health Support Chatbot (Non-Clinical)

Calm, empathetic conversational companion

Demo project (frontend: HTML/CSS/JS, backend: Flask, LLM: OpenAI or local)

Slide 2 — Problem statement

Many people seek quick emotional support online

Immediate listening and validation can reduce distress

Professional care isn't always immediately available

Need for safe, non-clinical conversational support

Slide 3 — Why mental health support?

Early emotional support helps people cope

Encourages help-seeking and reduces isolation

Lowers short-term distress through validation and grounding

Complements professional services, not a replacement

Slide 4 — Solution overview

RelaxBuddy: empathetic chatbot for emotional well-being

Provides validation, grounding exercises, coping suggestions

Detects crisis language and suggests helplines

Non-clinical: refuses to give medical/diagnostic advice

Slide 5 — Architecture

Frontend (HTML/CSS/JS) <-> Backend Flask API (/chat)

Backend integrates with LLM (OpenAI or local)

Safety layer: crisis keyword detection & responses

No DB required (simple, stateless sample)

Slide 6 — Features

Empathetic, calm responses tuned by a system prompt

Crisis detection with helpline suggestions

Typing animation and friendly UI

Easily configurable LLM and helpline content

Slide 7 — Frontend flow

User types message -> send POST /chat

Show user bubble + typing animation

Display bot reply with supportive tone

Responsive UI for mobile and desktop

Slide 8 — Backend flow

Receive POST /chat with message

Run crisis detection

If crisis: return supportive message + helpline

Else: call LLM with empathy system prompt

Return reply JSON to frontend

Slide 9 — Safety mechanisms

System prompt prohibits medical advice

Crisis keyword detection returns immediate helpline suggestions

Simple banned-phrase guard to avoid accidental clinical language

Recommendation: localize and verify helplines before deployment

Slide 10 — Future improvements

Verified, localized helpline database & geolocation lookup

Persistent conversation history with user consent

Escalation/triage workflows for human review

Accessibility improvements and multi-language support

yaml
Copy code

---

# Additional Implementation Notes & Best Practices

1. **Local testing without API key**: The backend includes safe placeholder replies if no OpenAI key is set — good for UI testing.
2. **Privacy**: Do **not** log sensitive user data in production. If storing logs, implement encryption and obtain consent.
3. **Helplines**: Replace the sample helpline strings with accurate, up-to-date, country-specific helplines before any public deployment.
4. **Legal**: Consult legal/regulatory guidance if deploying publicly, especially for health-related applications.
5. **Rate limits**: If using OpenAI, respect rate limits and handle API errors gracefully (backoff/retry).
6. **Testing**: Test the crisis detection thoroughly with many example phrasings, and involve mental health professionals for review.

---

# Quick Start (copy & run)

1. Create folders and files exactly as shown.
2. `pip install -r requirements.txt`
3. Set `OPENAI_API_KEY` in env if you want real LLM responses.
4. From `backend/`: `python app.py`
5. Open `frontend/index.html` in a browser (or run a static server) and chat.

---

# Final safety reminder (please read)

This sample is educational. **RelaxBuddy is explicitly non-clinical**. It must not provide diagnoses, prescribe, or replace emergency services. The crisis helplines and keywords included are examples — **localize and verify** before any real deployment. If you want, I can produce a version that automatically looks up country helplines given a country code (requires adding a small dataset). Would you like that?

---

If you want, I can:
- Provide the project as a downloadable zip (I cannot host files here, but I can generate a script that writes all files when run).
- Expand the crisis keyword list and helpline mapping for specific countries.
- Show how to run via VS Code (launch.json) or Dockerize the app.

Which of those would you like next?
