
# 📄 **`FLOWCHARTS.md` – RelaxBuddy System Flowcharts (v1)**

````markdown
# 🌊 RelaxBuddy Flowcharts (v1)
This document contains all major system flowcharts for the RelaxBuddy Emotional Support Chatbot.

Diagrams are written in **Mermaid** and render automatically inside GitHub.

---

# 1️⃣ User Authentication Flow
```mermaid
flowchart TD

A[Open App] --> B{Token exists in localStorage?}

B -->|Yes| C[Validate token /sessions]
C -->|Valid| D[Load dashboard]
C -->|Invalid| E[Show login modal]

B -->|No| E[Show login modal]

E --> F[User enters username & password]
F --> G[POST /login]
G -->|Success| H[Save token in localStorage]
H --> D[Load dashboard]
G -->|Fail| I[Show error toast]
````

---

# 2️⃣ Session Creation & Management Flow

```mermaid
flowchart TD

A[Dashboard Loaded] --> B[User clicks New Session]
B --> C[Prompt for name]
C -->|Provided| D[POST /new_session]
D -->|Success| E[Add to session list UI]
E --> F[Open session]
D -->|Error| G[Show toast]

F --> H[User views all messages]
H --> I[User can delete / lock / rename]
```

---

# 3️⃣ Chat Messaging + Streaming Flow

```mermaid
sequenceDiagram
    participant U as User
    participant FE as Frontend
    participant BE as Flask Backend
    participant AI as Groq Model

    U->>FE: Types message & clicks Send
    FE->>FE: appendUserBubble()
    FE->>BE: POST /chat_stream { message, session_id }
    BE-->>FE: Stream begins (chunked data)

    loop While chunks arrive
        BE->>AI: Send partial prompt
        AI-->>BE: Partial reply token(s)
        BE-->>FE: data:<chunk_text>
        FE->>FE: Append to typing bubble
    end

    FE->>FE: Replace typing bubble with final bot message
    BE->>DB: Save user + bot messages
```

---

# 4️⃣ Crisis Detection Flow

```mermaid
flowchart TD
A[Received user message] --> B[Lowercase message]
B --> C{Contains crisis keywords?}

C -->|Yes| D[Skip AI]
D --> E[Return crisis-safe message]
E --> F[Show helpline numbers]
F --> G[Save message to DB]

C -->|No| H[Send to Groq AI for reply]
H --> I[Stream response]
I --> J[Save message]
```

---

# 5️⃣ Session Lock / Unlock Flow (PIN)

```mermaid
flowchart TD

A[User selects session] --> B{Session locked?}

B -->|No| C[Load messages]

B -->|Yes| D[Prompt: Enter PIN]
D --> E[POST /unlock]

E -->|Valid| C[Load messages]
E -->|Invalid| F[Show error toast]
```

---

# 6️⃣ Export to PDF Flow

```mermaid
flowchart TD

A[User clicks Export PDF] --> B[GET /export/<session_id>]

B -->|Backend fetches messages| C[Generate PDF via ReportLab]

C --> D[Return PDF file]
D --> E[Frontend triggers download]
```

---

# 7️⃣ Full System Architecture Overview

```mermaid
flowchart LR

subgraph FE[Frontend - HTML/CSS/JS]
    A1[UI Components<br>Auth Modal<br>Session List<br>Chat UI] 
    A2[LocalStorage<br>(token, theme, profile)]
    A3[Streaming Handler<br>(Reader API)]
end

subgraph BE[Flask Backend]
    B1[Auth Controller]
    B2[Session Controller]
    B3[Chat Controller]
    B4[Crisis Detector]
    B5[PDF Exporter]
    B6[SQLite ORM Layer]
end

subgraph AI[Groq API]
    C1[groq/compound Model]
end

A1 --> B1
A1 --> B2
A1 --> B3
B3 --> B4
B3 --> C1
C1 --> B3
B3 --> B6
B2 --> B6

A2 -.-> A1
```

---

# ✔ End of Flowcharts

These diagrams cover everything:

* Auth workflow
* Chat streaming logic
* Session system
* AI processing
* Crisis handling
* Data storage
* Architectural overview

---
