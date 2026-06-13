"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.events = exports.parseEvent = void 0;
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const create_1 = require("./events/create");
const delete_1 = require("./events/delete");
const list_1 = require("./events/list");
const update_1 = require("./events/update");
const gemini_1 = require("./parser/gemini");
(0, app_1.initializeApp)();
const REGION = "us-central1";
// Turn Gemini's raw classification into the response sent to the frontend,
// falling back to "clarify" if the result is incomplete or references an
// event that doesn't exist.
function toCommandResult(raw, existingEvents) {
    const clarify = (message) => ({
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
        const hasRequiredFields = !!raw.title && !!raw.startDateTime && !!raw.endDateTime && raw.allDay !== null;
        if (!hasRequiredFields) {
            return clarify();
        }
        return {
            action: "create",
            eventId: null,
            preview: {
                title: raw.title,
                description: raw.description,
                location: raw.location,
                startDateTime: raw.startDateTime,
                endDateTime: raw.endDateTime,
                allDay: raw.allDay,
            },
            message: null,
        };
    }
    return clarify();
}
exports.parseEvent = (0, https_1.onRequest)({ cors: true, region: REGION }, async (req, res) => {
    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }
    const { text, timeZone } = req.body;
    if (!text || !text.trim()) {
        res.status(400).json({ error: "Missing 'text' in request body" });
        return;
    }
    try {
        const db = (0, firestore_1.getFirestore)();
        const existingEvents = await (0, list_1.fetchExistingEvents)(db);
        const raw = await (0, gemini_1.interpretCommand)(text, new Date(), timeZone ?? "UTC", existingEvents);
        res.status(200).json(toCommandResult(raw, existingEvents));
    }
    catch (err) {
        console.error("parseEvent error", err);
        res.status(500).json({ error: "Failed to interpret command" });
    }
});
exports.events = (0, https_1.onRequest)({ cors: true, region: REGION }, async (req, res) => {
    try {
        switch (req.method) {
            case "GET":
                await (0, list_1.listEvents)(req, res);
                break;
            case "POST":
                await (0, create_1.createEvent)(req, res);
                break;
            case "PATCH":
                await (0, update_1.updateEvent)(req, res);
                break;
            case "DELETE":
                await (0, delete_1.deleteEvent)(req, res);
                break;
            default:
                res.status(405).json({ error: "Method not allowed" });
        }
    }
    catch (err) {
        console.error("events error", err);
        res.status(500).json({ error: "Internal error" });
    }
});
//# sourceMappingURL=index.js.map