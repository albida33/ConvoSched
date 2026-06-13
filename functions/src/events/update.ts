import { Request, Response } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { ParsedEvent } from "../parser/types";

type UpdateEventBody = Partial<ParsedEvent>;

export async function updateEvent(req: Request, res: Response): Promise<void> {
  const id = req.query.id as string | undefined;
  if (!id) {
    res.status(400).json({ error: "Missing 'id' query parameter" });
    return;
  }

  const body = req.body as UpdateEventBody;
  if (!body.title || !body.startDateTime || !body.endDateTime) {
    res.status(400).json({
      error: "title, startDateTime, and endDateTime are required",
    });
    return;
  }

  const db = getFirestore();
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
    start: Timestamp.fromDate(new Date(body.startDateTime)),
    end: Timestamp.fromDate(new Date(body.endDateTime)),
    allDay: body.allDay ?? false,
  });

  res.status(200).json({ id });
}
