import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { clearCatalogEvents } from "./catalog/clear";
import { importCatalogEvents } from "./catalog/import";
import { fetchCatalogEvents, listCatalogEvents } from "./catalog/list";
import { createEvent } from "./events/create";
import { deleteEvent } from "./events/delete";
import { fetchExistingEvents, listEvents } from "./events/list";
import { updateEvent } from "./events/update";
import { interpretCommand } from "./parser/gemini";
import { CatalogEvent, CommandResult, ExistingEventSummary, RawCommand } from "./parser/types";

initializeApp();

const REGION = "us-central1";

// Turn Gemini's raw classification into the response sent to the frontend,
// falling back to "clarify" if the result is incomplete or references an
// event that doesn't exist.
function toCommandResult(
  raw: RawCommand,
  existingEvents: ExistingEventSummary[],
  catalogEvent: CatalogEvent | null
): CommandResult {
  const clarify = (message?: string | null): CommandResult => ({
    action: "clarify",
    eventId: null,
    preview: null,
    message: message ?? raw.message ?? "I couldn't quite understand that. Could you rephrase or be more specific?",
  });

  if (raw.action === "delete") {
    const existing = existingEvents.find((e) => e.id === raw.eventId);
    if (!existing) {
      return clarify("I couldn't find that event. Could you be more specific?");
    }
    return {
      action: "delete",
      eventId: existing.id,
      preview: {
        title: existing.title,
        description: existing.description,
        location: existing.location,
        startDateTime: existing.startDateTime,
        endDateTime: existing.endDateTime,
        allDay: existing.allDay,
      },
      message: raw.message,
    };
  }

  if (raw.action === "update") {
    const existing = existingEvents.find((e) => e.id === raw.eventId);
    if (!existing) {
      return clarify("I couldn't find that event. Could you be more specific?");
    }

    return {
      action: "update",
      eventId: existing.id,
      preview: {
        title: raw.title ?? existing.title,
        description: raw.description ?? existing.description,
        location: raw.location ?? existing.location,
        startDateTime: raw.startDateTime ?? existing.startDateTime,
        endDateTime: raw.endDateTime ?? existing.endDateTime,
        allDay: raw.allDay ?? existing.allDay,
      },
      message: null,
    };
  }

  if (raw.action === "create") {
    const title = raw.title ?? catalogEvent?.title ?? null;
    const description = raw.description ?? catalogEvent?.description ?? null;
    const location = raw.location ?? catalogEvent?.location ?? null;
    const startDateTime = raw.startDateTime ?? catalogEvent?.startDateTime ?? null;
    const endDateTime = raw.endDateTime ?? catalogEvent?.endDateTime ?? null;
    const allDay = raw.allDay ?? catalogEvent?.allDay ?? false;

    const hasRequiredFields = !!title && !!startDateTime && !!endDateTime;

    if (!hasRequiredFields) {
      return clarify();
    }

    return {
      action: "create",
      eventId: null,
      preview: {
        title,
        description,
        location,
        startDateTime,
        endDateTime,
        allDay,
      },
      message: null,
    };
  }

  return clarify();
}

export const parseEvent = onRequest(
  { cors: true, region: REGION },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const { text, timeZone } = req.body as { text?: string; timeZone?: string };
    if (!text || !text.trim()) {
      res.status(400).json({ error: "Missing 'text' in request body" });
      return;
    }

    try {
      const db = getFirestore();
      const existingEvents = await fetchExistingEvents(db);
      const catalogEvents = await fetchCatalogEvents();
      const raw = await interpretCommand(
        text,
        new Date(),
        timeZone ?? "UTC",
        existingEvents,
        catalogEvents
      );

      let catalogEvent: CatalogEvent | null = null;
      if (raw.action === "create" && raw.catalogEventId) {
        const doc = await db.collection("catalogEvents").doc(raw.catalogEventId).get();
        if (doc.exists) {
          const data = doc.data()!;
          catalogEvent = {
            title: data.title,
            description: data.description,
            location: data.location,
            startDateTime: data.start.toDate().toISOString(),
            endDateTime: data.end.toDate().toISOString(),
            allDay: data.allDay,
          };
        }
      }

      res.status(200).json(toCommandResult(raw, existingEvents, catalogEvent));
    } catch (err) {
      console.error("parseEvent error", err);
      res.status(500).json({ error: "Failed to interpret command" });
    }
  }
);

export const events = onRequest(
  { cors: true, region: REGION },
  async (req, res) => {
    try {
      switch (req.method) {
        case "GET":
          await listEvents(req, res);
          break;
        case "POST":
          await createEvent(req, res);
          break;
        case "PATCH":
          await updateEvent(req, res);
          break;
        case "DELETE":
          await deleteEvent(req, res);
          break;
        default:
          res.status(405).json({ error: "Method not allowed" });
      }
    } catch (err) {
      console.error("events error", err);
      res.status(500).json({ error: "Internal error" });
    }
  }
);

// Admin endpoint for importing convention-schedule catalog events. Not
// linked from the frontend; used to seed/reset the `catalogEvents`
// collection.
export const catalog = onRequest(
  { cors: true, region: REGION, timeoutSeconds: 120 },
  async (req, res) => {
    try {
      switch (req.method) {
        case "GET":
          await listCatalogEvents(req, res);
          break;
        case "POST":
          await importCatalogEvents(req, res);
          break;
        case "DELETE":
          await clearCatalogEvents(req, res);
          break;
        default:
          res.status(405).json({ error: "Method not allowed" });
      }
    } catch (err) {
      console.error("catalog error", err);
      res.status(500).json({ error: "Internal error" });
    }
  }
);
