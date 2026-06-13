"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCatalogEvents = listCatalogEvents;
exports.fetchCatalogEvents = fetchCatalogEvents;
const firestore_1 = require("firebase-admin/firestore");
async function listCatalogEvents(_req, res) {
    const db = (0, firestore_1.getFirestore)();
    const snapshot = await db.collection("catalogEvents").orderBy("start", "asc").get();
    const events = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
            id: doc.id,
            title: data.title,
            description: data.description,
            location: data.location,
            start: data.start.toDate().toISOString(),
            end: data.end.toDate().toISOString(),
            allDay: data.allDay,
        };
    });
    res.status(200).json({ count: events.length, events });
}
// Compact summary of all catalog events, given to Gemini as context so it
// can match natural-language requests to a specific catalog entry.
async function fetchCatalogEvents(limit = 1000) {
    const db = (0, firestore_1.getFirestore)();
    const snapshot = await db.collection("catalogEvents").orderBy("start", "asc").limit(limit).get();
    return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
            id: doc.id,
            title: data.title,
            startDateTime: data.start.toDate().toISOString(),
            endDateTime: data.end.toDate().toISOString(),
            location: data.location,
        };
    });
}
//# sourceMappingURL=list.js.map