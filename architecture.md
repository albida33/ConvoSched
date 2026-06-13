# NLP Calendar Assistant — Architecture

## Overview

A minimal web app where a user types a plain-English sentence — to create an event ("*Lunch with Sarah next Tuesday at noon for an hour at Cafe Luna*"), update one ("*Move my lunch with Sarah to 2pm*"), or delete one ("*Cancel the dentist appointment*"). Gemini (via Vertex AI) classifies the request into an action — `create` / `update` / `delete` / `clarify` — and, for update/delete, matches it against the user's existing events. The user confirms (or cancels) the resulting preview before anything is written to Firestore. No authentication / multi-user logic yet — single shared event list. Built so auth, reminders, calendar sync, etc. can be bolted on later without restructuring.

```
┌──────────────┐   text + existing  ┌────────────────────┐   prompt+schema+   ┌──────────────────┐
│   Frontend    │ ─────events──────▶│  Cloud Function:    │ ──existing events─▶│  Vertex AI Gemini │
│ (Firebase     │                   │  /parseEvent        │◀───────────────── │ (command + fields)│
│  Hosting)     │◀──────────────────│  (command           │   classified      └──────────────────┘
│               │ command + preview │   interpreter)       │   command (JSON)
│               │ (create/update/   └─────────┬──────────┘
│               │  delete/clarify)             │ reads existing events
│               │                              ▼
│               │  confirm/cancel    ┌────────────────────┐
│               │ ──POST/PATCH/────▶│  Cloud Function:    │
│               │      DELETE        │  /events            │
│               │◀───────────────────│  (GET/POST/PATCH/  │
└──────────────┘   event list        │   DELETE)           │
                                      └─────────┬──────────┘
                                                 │
                                                 ▼
                                           ┌───────────┐
                                           │ Firestore │
                                           │  events   │
                                           └───────────┘
```

---

## Components

### 1. Frontend — Firebase Hosting

A single static page, kept deliberately simple (plain HTML/CSS/JS, no framework required to start):

- **Input box** — user types a natural-language request: create, update, or delete an event.
- **"Parse" button** — sends text to `/parseEvent`, which returns a classified command (`create` / `update` / `delete` / `clarify`):
  - `create` / `update` → shows an editable preview card ("New event" / "Update event") with the proposed title, date/time, location, description, all-day flag.
  - `delete` → shows a read-only summary of the matched event with a "Confirm Delete" button.
  - `clarify` → no preview; shows Gemini's clarifying question/message inline (e.g. "I couldn't find that event. Could you be more specific?") so the user can rephrase.
- **"Confirm & Save" / "Confirm Update" / "Confirm Delete" button** — sends the (possibly edited) event to `/events` via `POST` (create), `PATCH ?id=...` (update), or `DELETE ?id=...` (delete).
- **"Cancel" button** — discards the preview without writing anything.
- **Event list** — fetches `/events` (or reads Firestore directly via the client SDK) and renders upcoming events, simplest as a sorted list (calendar grid view can come later).

Served via `firebase deploy --only hosting`. Talks to the backend over HTTPS Cloud Function URLs.

> Room to grow: this is structured as static assets in `public/`, so swapping in React/Vite later just means changing the build output directory in `firebase.json` — no architecture change.

---

### 2. Backend API — Cloud Functions for Firebase (2nd gen, Node/TypeScript)

Two HTTP functions, each handling a family of related operations, so parsing and storage can evolve independently:

| Function | Method | Purpose |
|---|---|---|
| `parseEvent` | `POST` | Takes raw text + current timestamp/timezone. Fetches up to 50 upcoming events from Firestore as context, calls Gemini to classify the request (`create`/`update`/`delete`/`clarify`) and extract/merge event fields, returns a `CommandResult` (`action`, `eventId`, `preview`, `message`). **Does not write to Firestore** — this is a preview step. |
| `events` | `GET` | Returns upcoming events from Firestore, sorted by start time. |
| `events` | `POST` | Takes a confirmed structured event, validates it, writes to Firestore `events` collection. |
| `events` | `PATCH ?id=<docId>` | Takes a confirmed structured event, overwrites the matching Firestore document's fields. 404 if the id doesn't exist. |
| `events` | `DELETE ?id=<docId>` | Deletes the matching Firestore document. 404 if the id doesn't exist. |

Keeping "interpret" and "save" separate means:
- The user can review/edit before committing (no surprise events from a misread date, no accidental deletes).
- The parsing logic is reusable later (e.g. bulk-import, voice input) without touching storage code.

**Command interpretation flow (`parseEvent`)**:
1. Load existing events (`id`, `title`, `description`, `start`/`end`, `location`, `allDay`) — gives Gemini the context needed to match phrases like "my lunch with Sarah" or "the dentist appointment" to a specific document.
2. Ask Gemini to classify the request and return a `RawCommand` (action + nullable event fields). For `update`, Gemini only needs to return fields that are *changing* — anything left `null` is filled in from the matched existing event server-side (so an update to just the time doesn't wipe out the description, location, etc.).
3. Validate the result:
   - `delete`/`update` — the referenced `eventId` must match a real existing event, otherwise fall back to `clarify`.
   - `create` — `title`/`startDateTime`/`endDateTime`/`allDay` must all be present, otherwise fall back to `clarify`.
4. Return a `CommandResult` to the frontend — never writes to Firestore itself.

---

### 3. AI Parsing — Vertex AI Gemini

- **Model**: `gemini-2.5-flash` (fast, cheap, good enough for structured extraction/classification) via the `@google-cloud/vertexai` SDK from within the Cloud Function.
- **Structured output**: use Gemini's `responseSchema` / JSON mode so the model is constrained to return valid JSON matching a fixed shape — no fragile regex/string parsing of free-text replies.
- **Prompt context**: the function passes the *current date, time, and timezone* (for resolving "tomorrow", "next Friday", etc.) and a list of the user's *existing events* (id, title, description, time range, location, all-day) so Gemini can match natural-language references to a specific event for update/delete.

**Target JSON schema returned by Gemini (`RawCommand`):**

```json
{
  "action": "create | update | delete | clarify",
  "eventId": "string | null",
  "title": "string | null",
  "description": "string | null",
  "location": "string | null",
  "startDateTime": "ISO 8601 string | null",
  "endDateTime": "ISO 8601 string | null",
  "allDay": "boolean | null",
  "message": "string | null"
}
```

- `create` — fills `title`/`startDateTime`/`endDateTime`/`allDay` (+ optional `description`/`location`); `eventId` is `null`.
- `update` — sets `eventId` to the matched event's id and only the fields that are *changing*; everything else is left `null` and merged with the existing event server-side.
- `delete` — sets `eventId` to the matched event's id; other fields may be `null`.
- `clarify` — used when the request is ambiguous, references no matching event, or isn't calendar-related; `message` holds a short explanation/question shown to the user.

The backend converts this into a `CommandResult` (`action`, `eventId`, `preview`, `message`) before returning it to the frontend.

> Room to grow: this lives in its own `functions/src/parser/` module. Later you could add function-calling for recurring events, multi-event extraction/disambiguation from one sentence, or swap models — without touching the storage or frontend code.

---

### 4. Database — Firestore

Single collection: **`events`**

| Field | Type | Notes |
|---|---|---|
| `title` | string | required |
| `description` | string \| null | optional |
| `location` | string \| null | optional |
| `start` | Timestamp | required |
| `end` | Timestamp | required |
| `allDay` | boolean | default `false` |
| `rawInput` | string | original NL text, kept for debugging/re-parsing |
| `createdAt` | Timestamp | server-set on write |
| `userId` | string \| null | **unused for now**, reserved so multi-user/auth can be added by populating this field and adding security rules — no schema migration needed |

**Security rules (initial)**: open read/write for development since there's no auth yet — documented clearly as a TODO to lock down once auth is added (e.g. `request.auth != null && request.auth.uid == resource.data.userId`).

---

### 5. Hosting & Project Infra — Firebase

One Firebase project ties it together:

- **Firebase Hosting** → serves `public/` (frontend).
- **Cloud Functions** → backend logic, deployed alongside hosting.
- **Firestore** → database, native mode.
- **Vertex AI API** → enabled on the underlying GCP project; Cloud Functions use Application Default Credentials (the function's service account) to call it — no API keys to manage in the frontend.

Single command deploys everything: `firebase deploy`.

---

## Proposed Folder Structure

```
p2/
├── architecture.md
├── firebase.json
├── .firebaserc
├── firestore.rules
├── firestore.indexes.json
├── functions/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts            # exports HTTP functions
│       ├── parser/
│       │   ├── gemini.ts       # Vertex AI client, prompt, schema
│       │   └── types.ts        # shared ParsedEvent type
│       └── events/
│           ├── create.ts
│           ├── list.ts       # also exports fetchExistingEvents() for the parser
│           ├── update.ts
│           └── delete.ts
└── public/
    ├── index.html
    ├── styles.css
    └── app.js
```

---

## Build Order

1. **Firebase project setup** — init Firestore (native mode), Hosting, Functions; enable the Vertex AI API on the GCP project.
2. **`parseEvent` function** — Gemini integration with structured output schema; test with sample sentences.
3. **`events` create/list functions** — Firestore read/write.
4. **Frontend** — input form → preview card → confirm → list, wired to the two endpoints above.
5. **Deploy & end-to-end test** — type a sentence in the hosted app, confirm it lands correctly in Firestore.
6. **CRUD expansion** — extend `parseEvent` to classify `create`/`update`/`delete`/`clarify` using existing-events context; add `update`/`delete` to `events`; update the frontend preview to branch per action (editable form for create/update, read-only confirm for delete, inline message for clarify); deploy & re-test all four flows.

---

## Explicitly Out of Scope (for now, but designed for)

- User accounts / Firebase Auth (Firestore `userId` field reserved, rules will need tightening)
- Recurring events, reminders/notifications (Cloud Scheduler + Pub/Sub later)
- Calendar grid UI / Google Calendar sync
- Disambiguation when multiple events plausibly match a single request (currently falls back to `clarify`)
