import { Request, Response } from "express";
import { getFirestore } from "firebase-admin/firestore";

export async function deleteEvent(req: Request, res: Response): Promise<void> {
  const id = req.query.id as string | undefined;
  if (!id) {
    res.status(400).json({ error: "Missing 'id' query parameter" });
    return;
  }

  const db = getFirestore();
  const ref = db.collection("events").doc(id);

  const existing = await ref.get();
  if (!existing.exists) {
    res.status(404).json({ error: "Event not found" });
    return;
  }

  await ref.delete();
  res.status(200).json({ id });
}
