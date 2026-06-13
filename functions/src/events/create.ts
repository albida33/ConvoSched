import { Request, Response } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { ParsedEvent } from "../parser/types";

type CreateEventBody = Partial<ParsedEvent> & { rawInput?: string };

export async function createEvent(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateEventBody;

  if (!body.title || !body.startDateTime || !body.endDateTime) {
    res.status(400).json({
      error: "title, startDateTime, and endDateTime are required",
    });
    return;
  }

  const db = getFirestore();
  const docData = {
    title: body.title,
    description: body.description ?? null,
    location: body.location ?? null,
    start: Timestamp.fromDate(new Date(body.startDateTime)),
    end: Timestamp.fromDate(new Date(body.endDateTime)),
    allDay: body.allDay ?? false,
    rawInput: body.rawInput ?? null,
    userId: null, // reserved for future auth
    createdAt: Timestamp.now(),
  };

  const ref = await db.collection("events").add(docData);
  res.status(201).json({ id: ref.id });
}
