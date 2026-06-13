"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listEvents = listEvents;
exports.fetchExistingEvents = fetchExistingEvents;
const firestore_1 = require("firebase-admin/firestore");
async function listEvents(_req, res) {
    const db = (0, firestore_1.getFirestore)();
    const snapshot = await db.collection("events").orderBy("start", "asc").get();
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
    res.status(200).json({ events });
}
// Summary of existing events, given to Gemini as context so it can match
// natural-language references to a specific event for update/delete.
async function fetchExistingEvents(db, limit = 50) {
    const snapshot = await db.collection("events").orderBy("start", "asc").limit(limit).get();
    return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
            id: doc.id,
            title: data.title,
            description: data.description ?? null,
            startDateTime: data.start.toDate().toISOString(),
            endDateTime: data.end.toDate().toISOString(),
            location: data.location,
            allDay: data.allDay,
        };
    });
}
//# sourceMappingURL=list.js.map