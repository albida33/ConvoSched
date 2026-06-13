import { SchemaType, VertexAI } from "@google-cloud/vertexai";
import { ExistingEventSummary, RawCommand } from "./types";

const LOCATION = "us-central1";
const MODEL_NAME = "gemini-2.5-flash";

const commandSchema = {
  type: SchemaType.OBJECT,
  properties: {
    action: {
      type: SchemaType.STRING,
      enum: ["create", "update", "delete", "clarify"],
      description: "The action the user wants to perform",
    },
    eventId: {
      type: SchemaType.STRING,
      nullable: true,
      description:
        "ID of the existing event being updated/deleted, copied from the provided list. Null for create/clarify.",
    },
    title: { type: SchemaType.STRING, nullable: true },
    description: { type: SchemaType.STRING, nullable: true },
    location: { type: SchemaType.STRING, nullable: true },
    startDateTime: {
      type: SchemaType.STRING,
      nullable: true,
      description: "ISO 8601 datetime with timezone offset",
    },
    endDateTime: {
      type: SchemaType.STRING,
      nullable: true,
      description: "ISO 8601 datetime with timezone offset",
    },
    allDay: { type: SchemaType.BOOLEAN, nullable: true },
    message: {
      type: SchemaType.STRING,
      nullable: true,
      description: "Human-readable note. Required for the 'clarify' action.",
    },
  },
  required: ["action"],
};

export async function interpretCommand(
  text: string,
  now: Date,
  timeZone: string,
  existingEvents: ExistingEventSummary[]
): Promise<RawCommand> {
  const vertexAI = new VertexAI({
    project: process.env.GCLOUD_PROJECT,
    location: LOCATION,
  });

  const model = vertexAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: commandSchema,
    },
  });

  const eventsList = existingEvents.length
    ? existingEvents
        .map(
          (e) =>
            `- id: ${e.id} | "${e.title}" | ${e.startDateTime} to ${e.endDateTime}` +
            `${e.location ? ` | location: ${e.location}` : ""}` +
            `${e.description ? ` | description: ${e.description}` : ""}` +
            `${e.allDay ? " | all-day" : ""}`
        )
        .join("\n")
    : "(none)";

  const prompt = `You are a calendar assistant. Interpret the user's natural-language
request and convert it into a single structured command matching the response schema.

Current date/time (reference point for relative dates): ${now.toISOString()}
User's timezone: ${timeZone}

The user's existing events:
${eventsList}

Decide which action the request describes:

- "create": the user describes a NEW event to add. Fill title, startDateTime,
  endDateTime, allDay (and description/location if mentioned). Leave eventId null.

- "update": the user wants to change an EXISTING event (reschedule, rename,
  change location, etc). Find the best-matching event from the list above and
  set eventId to its id. Only set the fields that are changing; leave any
  field that should keep its existing value as null (it will be preserved
  automatically). If only the start time changes, shift the end time to
  preserve the original duration unless a new duration/end time is given.

- "delete": the user wants to remove/cancel an EXISTING event. Set eventId to
  the matching event's id from the list above. Other fields may be left null.

- "clarify": use this if the request doesn't clearly match any of the above —
  e.g. no existing event matches the description, more than one event could
  match, or the request isn't about a calendar event at all. Set message to a
  short question or explanation for the user. Leave eventId and event fields null.

Rules for datetimes:
- Resolve relative dates ("tomorrow", "next Friday", "in two weeks") using the
  current date/time above, in the user's timezone.
- Return startDateTime/endDateTime as ISO 8601 strings with the correct offset
  for ${timeZone}.
- If a new event has no end time given, default the duration to 1 hour.
- If the request describes an all-day event, set allDay to true and use
  midnight-to-midnight for start/end.

User request: "${text}"`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!responseText) {
    throw new Error("Gemini returned an empty response");
  }

  return JSON.parse(responseText) as RawCommand;
}
