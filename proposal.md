# Project Proposal: ConvoSched

## 1. Problem

Comic and anime conventions like Anime Expo publish enormous schedules — hundreds
of panels, screenings, workshops, and ceremonies spread across multiple days,
rooms, and overlapping time slots, usually as a long, undifferentiated text or
PDF listing. Figuring out "what's happening Friday afternoon that I'd actually
want to go to" means scrolling through hundreds of entries, cross-referencing
times and rooms by hand, and then separately copying anything interesting into
a personal calendar.

For Anime Expo 2026 specifically, I found this process genuinely frustrating:
the official schedule is hard to search, easy to lose track of, and offers no
way to build a personal itinerary without manual copy-paste into a calendar
app. ConvoSched solves this by letting a user describe what they want in plain
English — either "add the Welcome Ceremony to my calendar" (a known panel from
the convention schedule) or "lunch with Sarah next Tuesday at noon" (a normal
personal event) — and have it parsed, matched against the real convention
schedule when relevant, and added to a single personal planner with one
confirmation step.

## 2. Intended Users

The primary user is **myself**, as an attendee planning my Anime Expo 2026
schedule alongside my normal personal commitments. More broadly, the tool is
useful to:

- **Convention attendees** who want to build a personal itinerary from a large
  published schedule without manually transcribing times, rooms, and
  descriptions.
- **Students / individuals** managing a mix of event-specific plans (panels,
  meetups) and everyday tasks (meals, appointments) in one place, using
  natural language instead of a traditional calendar form.
- **Event organizers**, as a secondary use case: the same "parse a raw
  schedule into structured catalog entries" pipeline could be reused to
  digitize any convention's published schedule for attendee-facing tools.

The current version assumes a single shared user/event list (no
authentication), which is appropriate for a personal-use prototype but is
explicitly designed so per-user accounts can be added later without
restructuring.

## 3. Cloud Platform and Services

The project is built entirely on **Google Cloud / Firebase**:

| Service | Role |
|---|---|
| **Firebase Hosting** | Serves the static frontend (plain HTML/CSS/JS) at `convosched.web.app`. |
| **Cloud Functions for Firebase (2nd gen, Node/TypeScript)** | Three HTTP endpoints: `parseEvent` (natural-language command interpretation), `events` (CRUD on the user's personal calendar), and `catalog` (import/list/clear of the pre-parsed convention schedule). |
| **Vertex AI — Gemini (`gemini-2.5-flash`)** | Powers all natural-language understanding: classifying a request as create/update/delete/clarify, extracting structured event fields (title, time, location, description) with JSON-schema-constrained output, and matching free-text requests against the convention catalog. |
| **Cloud Firestore (Native mode)** | Two collections: `events` (the user's personal calendar) and `catalogEvents` (437 pre-parsed Anime Expo 2026 panels, imported once from the official schedule text via a Gemini-based parsing pipeline). |

All AI calls happen server-side via Cloud Functions using the function's
service account (Application Default Credentials) — no API keys live in the
frontend. A single `firebase deploy` updates hosting, functions, and Firestore
rules/indexes together.

## 4. Type of AI Assistant

ConvoSched is a **task-oriented conversational assistant for calendar
management**, combining two AI capabilities:

1. **Natural-language command interpretation.** Every user input is sent to
   Gemini with structured-output (JSON schema) prompting, which classifies the
   intent (`create` / `update` / `delete` / `clarify`) and extracts the
   relevant fields (title, start/end time, location, description, all-day
   flag). For updates and deletes, the model is given a summary of the user's
   existing events so it can resolve references like "move my lunch with
   Sarah" to the correct entry. Ambiguous or incomplete requests fall back to
   a `clarify` response with a follow-up question, rather than guessing.

2. **Catalog-grounded retrieval/matching.** A separate one-time pipeline uses
   Gemini to parse the raw Anime Expo 2026 schedule text into 437 structured
   catalog entries stored in Firestore. At request time, a compact summary of
   the full catalog is given to Gemini alongside the user's request, so a
   phrase like "I want to go to the Maid Cafe on July 3 at noon" is matched to
   the correct catalog entry (disambiguating by time when multiple sessions
   share a title) and its full details — description, room, exact times — are
   merged into the proposed event automatically.

In both cases, the assistant never writes to the database directly: it returns
a proposed event for the user to review, edit if needed, and confirm — keeping
the human in control while removing the manual work of looking up, copying,
and re-typing schedule information. The frontend organizes the resulting
personal calendar into a day-by-day "Planner" view spanning the four days of
the convention (July 2–5, 2026), plus an "Other" section for non-convention
events.
