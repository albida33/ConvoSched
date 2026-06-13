"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEvent = createEvent;
const firestore_1 = require("firebase-admin/firestore");
async function createEvent(req, res) {
    const body = req.body;
    if (!body.title || !body.startDateTime || !body.endDateTime) {
        res.status(400).json({
            error: "title, startDateTime, and endDateTime are required",
        });
        return;
    }
    const db = (0, firestore_1.getFirestore)();
    const docData = {
        title: body.title,
        description: body.description ?? null,
        location: body.location ?? null,
        start: firestore_1.Timestamp.fromDate(new Date(body.startDateTime)),
        end: firestore_1.Timestamp.fromDate(new Date(body.endDateTime)),
        allDay: body.allDay ?? false,
        rawInput: body.rawInput ?? null,
        userId: null, // reserved for future auth
        createdAt: firestore_1.Timestamp.now(),
    };
    const ref = await db.collection("events").add(docData);
    res.status(201).json({ id: ref.id });
}
//# sourceMappingURL=create.js.map