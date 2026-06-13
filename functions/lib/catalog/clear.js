"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearCatalogEvents = clearCatalogEvents;
const firestore_1 = require("firebase-admin/firestore");
async function clearCatalogEvents(_req, res) {
    const db = (0, firestore_1.getFirestore)();
    const snapshot = await db.collection("catalogEvents").get();
    const batch = db.batch();
    snapshot.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    res.status(200).json({ deleted: snapshot.size });
}
//# sourceMappingURL=clear.js.map