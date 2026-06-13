"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteEvent = deleteEvent;
const firestore_1 = require("firebase-admin/firestore");
async function deleteEvent(req, res) {
    const id = req.query.id;
    if (!id) {
        res.status(400).json({ error: "Missing 'id' query parameter" });
        return;
    }
    const db = (0, firestore_1.getFirestore)();
    const ref = db.collection("events").doc(id);
    const existing = await ref.get();
    if (!existing.exists) {
        res.status(404).json({ error: "Event not found" });
        return;
    }
    await ref.delete();
    res.status(200).json({ id });
}
//# sourceMappingURL=delete.js.map