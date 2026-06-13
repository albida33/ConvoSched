"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateEvent = updateEvent;
const firestore_1 = require("firebase-admin/firestore");
async function updateEvent(req, res) {
    const id = req.query.id;
    if (!id) {
        res.status(400).json({ error: "Missing 'id' query parameter" });
        return;
    }
    const body = req.body;
    if (!body.title || !body.startDateTime || !body.endDateTime) {
        res.status(400).json({
            error: "title, startDateTime, and endDateTime are required",
        });
        return;
    }
    const db = (0, firestore_1.getFirestore)();
    const ref = db.collection("events").doc(id);
    const existing = await ref.get();
    if (!existing.exists) {
        res.status(404).json({ error: "Event not found" });
        return;
    }
    await ref.update({
        title: body.title,
        description: body.description ?? null,
        location: body.location ?? null,
        start: firestore_1.Timestamp.fromDate(new Date(body.startDateTime)),
        end: firestore_1.Timestamp.fromDate(new Date(body.endDateTime)),
        allDay: body.allDay ?? false,
    });
    res.status(200).json({ id });
}
//# sourceMappingURL=update.js.map