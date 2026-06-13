"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.importCatalogEvents = importCatalogEvents;
const firestore_1 = require("firebase-admin/firestore");
const gemini_1 = require("../parser/gemini");
async function importCatalogEvents(req, res) {
    const { text, timeZone } = req.body;
    if (!text || !text.trim()) {
        res.status(400).json({ error: "Missing 'text' in request body" });
        return;
    }
    try {
        const parsed = await (0, gemini_1.parseCatalogChunk)(text, timeZone ?? "America/Los_Angeles");
        const db = (0, firestore_1.getFirestore)();
        const batch = db.batch();
        const ids = [];
        for (const event of parsed) {
            const ref = db.collection("catalogEvents").doc();
            ids.push(ref.id);
            batch.set(ref, {
                title: event.title,
                description: event.description ?? null,
                location: event.location ?? null,
                start: firestore_1.Timestamp.fromDate(new Date(event.startDateTime)),
                end: firestore_1.Timestamp.fromDate(new Date(event.endDateTime)),
                allDay: event.allDay ?? false,
            });
        }
        await batch.commit();
        res.status(201).json({
            count: parsed.length,
            events: parsed.map((event, i) => ({ id: ids[i], ...event })),
        });
    }
    catch (err) {
        console.error("importCatalogEvents error", err);
        res.status(500).json({ error: "Failed to parse/import catalog chunk" });
    }
}
//# sourceMappingURL=import.js.map