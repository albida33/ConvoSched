import { Request, Response } from "express";
import { Firestore, getFirestore } from "firebase-admin/firestore";
import { ExistingEventSummary } from "../parser/types";

export async function listEvents(_req: Request, res: Response): Promise<void> {
  const db = getFirestore();
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
export async function fetchExistingEvents(
  db: Firestore,
  limit = 50
): Promise<ExistingEventSummary[]> {
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
