# ConvoSched: Final Report

## 1. Research Process and Tools Explored

The starting point for this project was a simple goal: let a user manage a
calendar by typing plain English, and (later) let them pull events directly
from a real convention schedule (Anime Expo 2026) instead of copying them by
hand. Before settling on the final design, I researched and evaluated several
options at each layer of the stack.

**Backend/hosting platform.** I compared a traditional Node/Express server
with a separate database and hosting provider against an all-in-one
Firebase/Google Cloud setup. I chose **Firebase** (Hosting + Cloud Functions +
Firestore) because it deploys as a single unit (`firebase deploy`), has a
generous free tier for a project this size, and — critically — shares IAM and
project identity with **Vertex AI**, so the backend can call Gemini using the
function's own service account with no API keys to manage.

**Natural-language understanding.** I considered three approaches:

- *Regex/keyword parsing* — rejected immediately; resolving phrases like "move
  my lunch with Sarah to 2pm next Friday" or matching "the Maid Cafe" against
  437 possible convention panels is not realistically solvable with pattern
  matching.
- *General-purpose LLM API (e.g., OpenAI)* — viable, but would require a
  second vendor, a second credential to manage, and a separate billing
  relationship outside the GCP project already hosting everything else.
- *Vertex AI Gemini with structured output (`responseSchema`)* — chosen. It
  lives in the same GCP project, authenticates via the existing service
  account, and Gemini's JSON-mode/schema feature lets the model's output be
  treated as a typed object rather than a free-text string to parse.

**Local development tooling.** I investigated the **Firebase Local Emulator
Suite** (Firestore + Functions + Hosting emulators) to speed up iteration
without redeploying for every change. This stalled immediately: the Firestore
emulator requires a local Java runtime, and `java -version` returned "command
not found" in this environment. I weighed installing a JDK against simply
testing against the live deployed project, and — since each
`firebase deploy --only functions` or `--only hosting` completes in well under
a minute — chose to **adopt a deploy-and-curl-test workflow** for the entire
project rather than introduce a new dependency. In retrospect this also forced
every feature to be tested against the real Vertex AI/Firestore services from
day one, which surfaced infrastructure-level issues (described in Section 4)
that a mocked emulator likely would have hidden.

**Schedule-parsing approach.** For the Anime Expo catalog feature, I first
considered a positional/regex parser, since the raw schedule
(`ax-events.txt`) follows a repeating 9-line block format (date, title, room,
start/end times, description). I rejected this after inspecting the file: it
contains 437 "Panel Room:" markers but the line count doesn't divide evenly
into 9-line blocks, because some entries (e.g., a recurring "Maid Cafe" slot)
have extra blank lines. A strict positional parser would silently misalign on
those entries. Instead, I used **Gemini itself** as the parser — feeding raw
text chunks plus a `CatalogEvent[]` JSON schema and letting the model handle
formatting irregularities, which proved far more robust.

**Other tools used throughout:** the Firebase CLI (`firebase deploy`,
`firebase functions:log`) for deployment and debugging; `curl` for exercising
every HTTP endpoint directly; Python scripts for batch-importing the 437-event
catalog and for analyzing the resulting Firestore data (duplicate detection,
date-range checks); and `npm`/`tsc` for building the TypeScript Cloud
Functions codebase.

---

## 2. Technical Design

### a. High-Level System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                 Firebase Hosting — convosched.web.app                  │
│  Static frontend (index.html / app.js / styles.css):                   │
│   • Natural-language input box + "Submit"                              │
│   • Editable preview card (create / update / delete / clarify)         │
│   • "Planner": Jul 2–5 day-by-day view of the user's events            │
└───────────────┬───────────────────────────────┬────────────────────────┘
                 │ POST /api/parseEvent           │ GET/POST/PATCH/DELETE
                 ▼                                │      /api/events
┌─────────────────────────────────┐              ▼
│ Cloud Function: parseEvent        │   ┌──────────────────────────────┐
│  1. fetch existing events          │   │ Cloud Function: events         │
│  2. fetch catalog summaries        │   │  CRUD on Firestore `events`    │
│  3. call Gemini (interpretCommand) │   └───────────────┬────────────────┘
│  4. if catalogEventId set, fetch    │                   │
│     full CatalogEvent & merge       │                   │
│  5. return CommandResult (preview)  │                   │
└───────────────┬─────────────────────┘                   │
                 │                                          ▼
                 │ reads                          ┌───────────────────┐
                 ▼                                │     Firestore       │
┌─────────────────────────────────┐              │  • events            │
│ Cloud Function: catalog            │─────────▶ │  • catalogEvents     │
│  GET    → list catalog events       │  reads/   └───────────────────┘
│  POST   → parseCatalogChunk + import│  writes
│  DELETE → clear catalog              │
└───────────────┬─────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│                    Vertex AI — Gemini 2.5 Flash                        │
│  • interpretCommand(): NL text → {action, fields, catalogEventId}      │
│  • parseCatalogChunk(): raw schedule text → CatalogEvent[]              │
└──────────────────────────────────────────────────────────────────────┘
```

The system has three logical layers — a static frontend, a thin set of HTTP
Cloud Functions, and two backing services (Vertex AI for language
understanding, Firestore for storage) — with no server to manage and a single
deploy command that updates all of them together.

### b. Cloud Services Used

| Service | Role |
|---|---|
| **Firebase Hosting** | Serves the static frontend at `convosched.web.app`; rewrites `/api/*` to the corresponding Cloud Function. |
| **Cloud Functions for Firebase** (2nd gen, Node 20 / TypeScript) | Three HTTP functions — `parseEvent`, `events`, `catalog` — each `onRequest` with CORS enabled and a `us-central1` region (matching Firestore, to avoid cross-region latency). |
| **Vertex AI — Gemini API** | Called from within the Cloud Functions via the `@google-cloud/vertexai` SDK, using the function's default compute service account (granted `roles/aiplatform.user`) — no API key in any client or config file. |
| **Cloud Firestore (Native mode, `us-central1`)** | Two collections: `events` (the user's personal calendar) and `catalogEvents` (437 pre-parsed Anime Expo 2026 panels). |
| **Firebase CLI / Cloud Build / Artifact Registry** | Used transparently by `firebase deploy` to build and push each function's container image. |

### c. Model(s) Used and Why

A single model, **`gemini-2.5-flash`**, is used for every AI call in the
project, via two distinct prompt/schema pairs:

- **`interpretCommand`** — an `OBJECT` schema (`RawCommand`) with fields for
  `action` (`create`/`update`/`delete`/`clarify`), `eventId`,
  `catalogEventId`, the event fields (`title`, `description`, `location`,
  `startDateTime`, `endDateTime`, `allDay`), and an optional `message`. This
  is called on every user request to `parseEvent`.
- **`parseCatalogChunk`** — an `ARRAY` schema of `CatalogEvent` objects, used
  only during the one-time catalog import, with `maxOutputTokens` raised to
  `32768` so a single call can return ~40 fully-described events.

**Why Gemini 2.5 Flash specifically:**

1. **Structured output support.** Both schemas rely on Gemini's
   `responseMimeType: "application/json"` + `responseSchema` mode, which
   constrains the model to emit valid JSON matching a fixed shape. This was
   the single most important design decision in the project — it turns "ask
   an LLM and hope it formats its answer correctly" into "call a typed
   function," which is what makes it safe to feed the output directly into a
   preview UI and, on confirmation, into Firestore.
2. **Cost and latency tier appropriate for the task.** Neither classifying a
   short request into create/update/delete/clarify nor reformatting a
   schedule listing requires deep multi-step reasoning — "flash" tier models
   are well-suited and meaningfully cheaper/faster than a "pro"-tier model for
   this volume of calls (every keystroke-to-submit round trip calls Gemini
   once).
3. **Large context window.** The catalog-matching prompt includes a compact
   summary of **all 437** convention events (~10–25K tokens) plus the user's
   existing events on every `parseEvent` call. Gemini 2.5 Flash's context
   window comfortably accommodates this without truncation.
4. **Same-project integration.** Calling Gemini via Vertex AI (rather than the
   public Gemini API) means the Cloud Functions' existing service account and
   IAM permissions cover model access — one less credential to provision or
   rotate.

### d. Data Flow and User Interaction Flow

**Personal event flow (create/update/delete):**

1. User types a request (e.g., "Move my lunch with Sarah to 2pm") and clicks
   **Submit**.
2. The frontend POSTs `{ text, timeZone }` to `/api/parseEvent`.
3. `parseEvent` loads the user's existing events from Firestore (id, title,
   time range, location, description, all-day flag) and the compact catalog
   summary, then calls `interpretCommand`.
4. Gemini returns a `RawCommand`: for an update, it identifies the matching
   `eventId` and returns only the *changed* fields (others left `null`).
5. The backend merges the raw command with the existing event (null fields
   fall back to current values) and/or a matched catalog event, validates the
   result has the required fields, and returns a `CommandResult`
   (`action`, `eventId`, `preview`, `message`).
6. The frontend shows an editable preview card (or, for `clarify`, just shows
   Gemini's follow-up question). The user can edit any field before
   confirming.
7. On confirm, the frontend sends `POST` / `PATCH ?id=` / `DELETE ?id=` to
   `/api/events`, which writes to Firestore. **No AI output is ever written to
   the database without this explicit confirmation step.**
8. The frontend reloads `/api/events` and re-renders the **Planner** —
   personal events grouped into four day-sections (Jul 2–5, 2026) plus an
   "Other" section for anything outside that range.

**Catalog-matching flow (new feature):**

1. User types something referencing a convention panel (e.g., "I want to go
   to the Maid Cafe on July 3 at noon").
2. The same `interpretCommand` call receives the **catalog summary list**
   (id, title, start/end time, location — deliberately *without*
   descriptions, to keep the prompt small) alongside the user's existing
   events.
3. If Gemini recognizes a match — disambiguating by date/time if multiple
   sessions share a title — it returns `action: "create"` with
   `catalogEventId` set and the event fields left `null`.
4. The backend fetches the **full** `CatalogEvent` document (including its
   description) from `catalogEvents` by that id, and merges it into the
   preview via the same null-coalescing logic used for updates — so a user
   can still override, e.g., the start time, while everything else (title,
   description, location) is auto-filled.
5. From here, the flow rejoins the standard create flow (steps 6–8 above).

**One-time catalog import flow:**

1. The 437-event raw schedule text is split into per-event blocks and grouped
   into chunks of ~40.
2. Each chunk is POSTed to `/api/catalog`, which calls `parseCatalogChunk` and
   batch-writes the resulting `CatalogEvent[]` to Firestore.
3. This is a **one-time, redeployable operation** — the catalog persists in
   Firestore independent of future code deploys, but the same endpoint can be
   re-run for a future convention's schedule.

---

## 3. Evaluation

### a. What Tasks Does It Help With?

- **Creating a personal event** from natural language, including relative
  dates ("next Tuesday"), durations, locations, and descriptions.
- **Updating an existing event** by referring to it descriptively (e.g.,
  "move my lunch with Sarah to 2pm"), without needing to know its ID or
  re-enter unchanged fields.
- **Deleting/cancelling an event** by description, with a read-only
  confirmation step before the delete is committed.
- **Adding a convention panel to the personal calendar by name**, with title,
  description, room, and exact times auto-filled from the official schedule.
- **Disambiguating** when a request could refer to multiple convention
  sessions (e.g., multiple "Maid Cafe" time slots).
- **Viewing a day-by-day itinerary** ("Planner") spanning the four days of
  Anime Expo 2026, separate from other personal events.

### b. How Accurate or Useful Are the Responses?

Testing against the live deployment produced the following results:

| Input | Result |
|---|---|
| "Add the Welcome Ceremony to my calendar" | Correctly matched the catalog entry; preview auto-filled with full description, "The Novo," and the exact 2026-07-02 17:00–17:50 UTC time range. |
| "I want to go to the Maid Cafe" | Correctly returned `clarify`: *"Multiple 'Maid Cafe' events found. Please specify which one you would like to add (e.g., by date and time)."* |
| "Add the Maid Cafe on July 3 at noon" | Correctly resolved the ambiguity, matching the specific July 3 noon session with its description and room ("515 AB"). |
| "Schedule a dentist appointment next Tuesday at 3pm" | Correctly created as a **non-catalog** event — confirms the model doesn't over-eagerly force a catalog match. |
| "Move my lunch with Sarah to 2pm" (from earlier testing) | Correctly identified the `update` action, matched the existing event, and shifted only the time. |
| Catalog import (437 raw text blocks) | All 437 events parsed and stored, exactly matching the source file's 437 `"Panel Room:"` markers. |

The structured-output approach meant that, once a response came back as valid
JSON, it was *usable* essentially 100% of the time — there were no cases of
malformed JSON breaking the frontend. The remaining accuracy issues were at
the **decision** level (did Gemini pick the right action/match?), not at the
**format** level.

### c. Limitations or Failures Observed

- **Non-determinism in classification.** The identical prompt "Add the
  Welcome Ceremony to my calendar" returned `clarify` (generic "I couldn't
  quite understand that") on one call and a correct catalog match on a later,
  functionally identical call. With 437 catalog entries in the prompt, Gemini
  doesn't always reliably "find" a specific entry — a needle-in-haystack
  effect that's hard to eliminate without retrieval/pre-filtering.
- **A field-merging bug surfaced by non-determinism.** For a plain
  (non-catalog) create, Gemini sometimes returns `allDay: null` instead of
  `false`. The original merge logic (`raw.allDay ?? catalogEvent?.allDay ??
  null`) then produced `allDay = null`, which failed a `!== null` validation
  check and caused a valid create request to be reported as `clarify`. This
  was a **latent bug** that only manifested intermittently, depending on
  Gemini's exact output for a given call.
- **Infrastructure-level timeouts during bulk import.** Sending 40-event
  chunks through the Firebase Hosting rewrite (`convosched.web.app/api/catalog`)
  frequently returned **HTTP 502** after roughly 60 seconds, even though the
  Cloud Function itself was configured with `timeoutSeconds: 120` and often
  *did* complete the write server-side. The client-visible error and the
  actual database state diverged.
- **Duplicate writes from automatic retries.** Some of those "502 but actually
  succeeded" requests appear to have been retried automatically by Google's
  frontend infrastructure, resulting in the same 40-event chunk being
  processed (and written) twice — discovered via a duplicate-signature
  analysis of the resulting Firestore documents.
- **Genuine duplicates in source data.** Separately from the above, the
  official schedule itself lists a few panels (e.g., "Catbus Collective") more
  than once at identical times — the parser faithfully reproduces these, which
  is arguably correct but means "437 catalog entries" includes a handful of
  true duplicates from the source.
- **Prompt-size scaling.** Sending all 437 catalog summaries on *every*
  `parseEvent` call — even for requests with nothing to do with the
  convention — is a fixed ~10–25K-token overhead per request. This is
  acceptable for one convention's schedule but would not scale cleanly to,
  say, a multi-convention or year-over-year catalog without filtering.
- **No authentication / single shared event list.** Appropriate for a
  personal prototype, but not multi-user safe as-is (the `userId` field is
  reserved in the schema for exactly this future change).

### d. How Does It Compare to Not Using an AI Assistant?

Without ConvoSched, adding panels from a 437-entry convention schedule to a
personal calendar means: searching the published schedule (a dense
PDF/website) for something of interest, manually noting its date, time, and
room, then switching to a calendar app and re-typing all of that — repeated
for every panel of interest, across four days. This is slow and error-prone
(easy to mistype a time or miss that two same-named sessions occur on
different days).

With ConvoSched, the same task is a single sentence: the correct panel
(disambiguated if necessary) is located, and its title, time, room, and
description are populated automatically into a reviewable preview — reducing
a multi-step lookup-and-retype task to "type a sentence, click confirm."

For purely personal events (no catalog match), ConvoSched is roughly
comparable to typing into a good calendar app's natural-language quick-add
field — its main advantage there is **unifying** convention-specific and
personal scheduling in one interface, plus the same relative-date resolution
("next Tuesday") that good calendar apps already provide. The clearest,
largest win is specifically the catalog-matching use case.

---

## 4. Challenges Faced and How They Were Solved

**1. No local emulator (missing Java).** The Firestore emulator's Java
dependency wasn't available, and installing it conflicted with the goal of
keeping the environment minimal. *Solution:* abandoned local emulation
entirely and tested every change against the live Firebase project via
`firebase deploy` + `curl`. This added a short deploy delay per iteration but
meant every test exercised the real Vertex AI and Firestore services.

**2. Designing token-efficient catalog matching.** Sending all 437 catalog
events *with descriptions* on every request would be prohibitively large.
*Solution:* split the catalog representation into a **compact summary**
(id, title, time range, location — no description) sent to Gemini for
matching, and a **full record** (with description) fetched from Firestore
*only when there's an actual match* (a single cheap document read), then
merged into the preview server-side.

**3. HTTP 502s during bulk catalog import.** Large `parseCatalogChunk` calls
(40 events, full descriptions) sometimes took longer than Firebase Hosting's
rewrite-proxy timeout (~60s), returning a 502 to the client even though the
Cloud Function (configured for `timeoutSeconds: 120`) often finished and wrote
to Firestore anyway. *Solution:* diagnosed by comparing the import script's
self-reported totals against a direct `GET /api/catalog` count from Firestore
(which showed more documents than the script believed it had written), then
switched the import script to call the **Cloud Function's direct Cloud Run
URL** (`https://us-central1-convosched.cloudfunctions.net/catalog`) instead of
the Hosting rewrite, with a longer client-side `curl --max-time`. This
returned clean JSON responses with no further 502s.

**4. Duplicate catalog entries from retried requests.** After the above fix,
the catalog had 474 documents (expected 437) — analysis showed 140 duplicate
documents, consistent with several chunks having been processed twice during
the earlier 502-affected run. *Solution:* cleared the entire `catalogEvents`
collection (`DELETE /api/catalog`) and re-ran the full import via the direct
Cloud Run URL with sequential requests and short delays between chunks. The
result was exactly 437 documents, with each chunk's reported count matching
its input block count precisely.

**5. Two chunks failing with a clean error during re-import.** During the
clean re-import, two chunks (out of eleven) returned a proper JSON error
(`"Failed to parse/import catalog chunk"`) rather than 502s — likely a
transient Vertex AI rate-limit immediately following a prior large call.
*Solution:* re-ran just those two chunks individually with a longer delay
(15s) between requests; both succeeded on retry, bringing the total to 437/437.

**6. The `allDay: null` clarify bug.** A plain "schedule a dentist
appointment..." request was incorrectly returned as `clarify` with a generic
message. *Solution:* temporarily added a `console.log` of the raw Gemini
response to the deployed `parseEvent` function, redeployed, and re-tested.
The log revealed Gemini *had* returned a valid create command but with
`allDay: null`; the merge expression `raw.allDay ?? catalogEvent?.allDay ??
null` therefore evaluated to `null`, failing a `!== null` check. Fixed by
changing the fallback to `false` and removing the now-unnecessary `allDay`
check from the validation, then redeployed and confirmed both the dentist
appointment and a disambiguated catalog match worked correctly.

---

## 5. What I Learned About Cloud AI Systems

- **Structured output is the feature that makes LLMs production-usable.**
  `responseSchema`/JSON mode converts "parse a free-text reply" into "call a
  typed function." This was the single design choice that made it safe to
  wire Gemini's output directly into a UI and, on confirmation, into a
  database — without it, the project would have needed a fragile layer of
  text parsing and error recovery.

- **LLM output is non-deterministic even for "deterministic-sounding" tasks.**
  Classification (create/update/delete/clarify) and field extraction aren't
  guaranteed to be stable across identical calls. Backend code needs to treat
  the schema's "required" fields as a *minimum* contract and defensively
  normalize values (e.g., default `allDay` to `false`) rather than assuming
  semantic completeness.

- **Serverless platforms have multiple, independently-configured timeout
  layers that can silently disagree.** A Cloud Function's `timeoutSeconds`,
  the underlying Cloud Run service's request timeout, and Firebase Hosting's
  rewrite-proxy timeout are three different numbers. A request can fail at the
  proxy layer while succeeding at the function/database layer — meaning the
  HTTP response code alone is not sufficient evidence of what happened; the
  actual data store state has to be checked too.

- **The "interpret → preview → confirm → write" pattern is a strong safety
  net.** Because nothing is written to Firestore without an explicit user
  confirmation, both the 502-retry duplication (during the *admin* catalog
  import) and the `allDay` bug (in the *user-facing* flow) were contained —
  the worst outcome of the latter was an incorrect "I didn't understand that"
  message, never a corrupted or silently-wrong calendar entry.

- **Cost/latency tradeoffs become concrete very quickly, even at small
  scale.** A single convention's schedule (437 entries) is already a
  meaningful fraction of a single prompt. Designing the "compact summary +
  fetch full record on match" split early avoided a redesign later, and made
  the cost implications of "what if there were 10 conventions" immediately
  visible as a real engineering question, not an abstract one.

- **One-time data pipelines are worth building as real application code.**
  Building the catalog importer as a redeployable Cloud Function (rather than
  a throwaway local script) meant it inherited the project's existing
  deployment, IAM, and region configuration for free, and remains reusable for
  importing a future year's schedule.

---

## 6. Future Improvements

1. **Migrate off the deprecated Vertex AI SDK.** `@google-cloud/vertexai` is
   deprecated as of June 2025 and scheduled for removal in June 2026; the
   project should move to the `@google/genai` SDK before that deadline.

2. **Add authentication and per-user data.** Firebase Authentication plus
   Firestore security rules keyed on the already-reserved `userId` field would
   turn this from a single-shared-list prototype into a real multi-user app.

3. **Replace "send the whole catalog every time" with retrieval.** As the
   catalog grows (more conventions, multiple years), pre-filtering candidate
   catalog entries — via keyword search or vector embeddings — before calling
   Gemini would keep prompt size and cost roughly constant regardless of
   catalog size, and likely also improve match accuracy by reducing the
   needle-in-haystack problem.

4. **Make catalog import idempotent.** Add an upsert key (e.g., hash of
   title+start+end) so re-running the import after a partial failure can't
   produce duplicates, removing the need for the manual clear-and-rebuild
   process used this time.

5. **Add retry/backoff for transient Vertex AI errors** instead of
   manually re-running individual failed chunks.

6. **Generalize the Planner.** The four-day range (July 2–5, 2026) is
   currently hardcoded; a future version should derive the date range from the
   active catalog's date span (or let the user configure it), and could grow
   into a full calendar-grid view.

7. **Support multi-event requests** ("Add the Welcome Ceremony and the Maid
   Cafe on July 3 to my calendar") by allowing `interpretCommand` to return
   multiple commands per request.

8. **Add automated tests** for the field-merging logic in particular (the
   class of bug that produced the `allDay` issue), plus integration tests once
   a Java runtime makes the Firestore emulator viable — to catch
   Gemini-output-shape regressions before they reach the deployed app.

9. **Reminders and recurring events** via Cloud Scheduler + Pub/Sub, for both
   personal events and convention panels (e.g., "remind me 15 minutes before
   each panel I've added").
