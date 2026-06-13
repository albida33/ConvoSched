import { Request, Response } from "express";
import { getFirestore } from "firebase-admin/firestore";
import { CatalogEventSummary } from "../parser/types";

export async function listCatalogEvents(_req: Request, res: Response): Promise<void> {
  const db = getFirestore();
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
export async function fetchCatalogEvents(limit = 1000): Promise<CatalogEventSummary[]> {
  const db = getFirestore();
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
