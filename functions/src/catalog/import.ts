import { Request, Response } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { parseCatalogChunk } from "../parser/gemini";

export async function importCatalogEvents(req: Request, res: Response): Promise<void> {
  const { text, timeZone } = req.body as { text?: string; timeZone?: string };

  if (!text || !text.trim()) {
    res.status(400).json({ error: "Missing 'text' in request body" });
    return;
  }

  try {
    const parsed = await parseCatalogChunk(text, timeZone ?? "America/Los_Angeles");

    const db = getFirestore();
    const batch = db.batch();
    const ids: string[] = [];

    for (const event of parsed) {
      const ref = db.collection("catalogEvents").doc();
      ids.push(ref.id);
      batch.set(ref, {
        title: event.title,
        description: event.description ?? null,
        location: event.location ?? null,
        start: Timestamp.fromDate(new Date(event.startDateTime)),
        end: Timestamp.fromDate(new Date(event.endDateTime)),
        allDay: event.allDay ?? false,
      });
    }

    await batch.commit();

    res.status(201).json({
      count: parsed.length,
      events: parsed.map((event, i) => ({ id: ids[i], ...event })),
    });
  } catch (err) {
    console.error("importCatalogEvents error", err);
    res.status(500).json({ error: "Failed to parse/import catalog chunk" });
  }
}
