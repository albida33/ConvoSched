import { Request, Response } from "express";
import { getFirestore } from "firebase-admin/firestore";

export async function clearCatalogEvents(_req: Request, res: Response): Promise<void> {
  const db = getFirestore();
  const snapshot = await db.collection("catalogEvents").get();

  const batch = db.batch();
  snapshot.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();

  res.status(200).json({ deleted: snapshot.size });
}
