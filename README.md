# ConvoSched

A natural-language calendar assistant for Anime Expo 2026. Type a plain
English request — "Add the Welcome Ceremony to my calendar" or "Lunch with
Sarah next Tuesday at noon" — and ConvoSched interprets it, matches it against
the official Anime Expo schedule when relevant, and shows an editable preview
before saving anything to your calendar.

**Live app:** https://convosched.web.app

## Features

- **Natural-language create / update / delete** for personal calendar events,
  with Gemini resolving references like "move my lunch with Sarah to 2pm"
  against your existing events.
- **Catalog matching** against 437 pre-parsed Anime Expo 2026 panels — ask for
  a panel by name and its title, room, time, and description are filled in
  automatically (with disambiguation if multiple sessions share a name).
- **Review-before-save** — every create/update/delete shows an editable
  preview; nothing is written until you confirm.
- **Planner view** — your events grouped by convention day (Jul 2–5, 2026),
  plus an "Other" section for everything else.

## Stack

- **Frontend:** static HTML/CSS/JS (`public/`), served by Firebase Hosting
- **Backend:** Cloud Functions for Firebase (2nd gen, Node 20 / TypeScript) —
  `parseEvent`, `events`, `catalog`
- **AI:** Vertex AI Gemini 2.5 Flash, structured JSON output
- **Database:** Cloud Firestore (`events`, `catalogEvents` collections)

See [`architecture.md`](architecture.md) for the detailed system design,
[`proposal.md`](proposal.md) for the project proposal, and
[`final-report.md`](final-report.md) for the full write-up (research,
evaluation, challenges, and lessons learned).

## Project layout

```
public/             frontend (index.html, app.js, styles.css)
functions/src/       Cloud Functions source (TypeScript)
firestore.rules      Firestore security rules
firebase.json        Hosting rewrites + Functions config
ax-events.txt        raw Anime Expo 2026 schedule (catalog source data)
```

## Local setup

```bash
cd functions
npm install
npm run build
```

## Deploy

```bash
firebase deploy --only hosting          # frontend only
firebase deploy --only functions        # backend only
firebase deploy                          # everything (hosting + functions + firestore)
```

> Deploy `functions` and `hosting` separately when possible — combined deploys
> can leave hosting un-finalized due to a non-blocking "cleanup policy"
> warning in `us-central1`. After a frontend deploy, hard-refresh the browser
> (static assets are cached for up to 1 hour).
