"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.interpretCommand = interpretCommand;
exports.parseCatalogChunk = parseCatalogChunk;
const vertexai_1 = require("@google-cloud/vertexai");
const LOCATION = "us-central1";
const MODEL_NAME = "gemini-2.5-flash";
const commandSchema = {
    type: vertexai_1.SchemaType.OBJECT,
    properties: {
        action: {
            type: vertexai_1.SchemaType.STRING,
            enum: ["create", "update", "delete", "clarify"],
            description: "The action the user wants to perform",
        },
        eventId: {
            type: vertexai_1.SchemaType.STRING,
            nullable: true,
            description: "ID of the existing event being updated/deleted, copied from the provided list. Null for create/clarify.",
        },
        catalogEventId: {
            type: vertexai_1.SchemaType.STRING,
            nullable: true,
            description: "ID of the matching convention catalog event, copied from the catalog list. Only set for 'create' when the request matches a catalog event. Otherwise null.",
        },
        title: { type: vertexai_1.SchemaType.STRING, nullable: true },
        description: { type: vertexai_1.SchemaType.STRING, nullable: true },
        location: { type: vertexai_1.SchemaType.STRING, nullable: true },
        startDateTime: {
            type: vertexai_1.SchemaType.STRING,
            nullable: true,
            description: "ISO 8601 datetime with timezone offset",
        },
        endDateTime: {
            type: vertexai_1.SchemaType.STRING,
            nullable: true,
            description: "ISO 8601 datetime with timezone offset",
        },
        allDay: { type: vertexai_1.SchemaType.BOOLEAN, nullable: true },
        message: {
            type: vertexai_1.SchemaType.STRING,
            nullable: true,
            description: "Human-readable note. Required for the 'clarify' action.",
        },
    },
    required: ["action"],
};
async function interpretCommand(text, now, timeZone, existingEvents, catalogEvents) {
    const vertexAI = new vertexai_1.VertexAI({
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
            .map((e) => `- id: ${e.id} | "${e.title}" | ${e.startDateTime} to ${e.endDateTime}` +
            `${e.location ? ` | location: ${e.location}` : ""}` +
            `${e.description ? ` | description: ${e.description}` : ""}` +
            `${e.allDay ? " | all-day" : ""}`)
            .join("\n")
        : "(none)";
    const catalogList = catalogEvents.length
        ? catalogEvents
            .map((e) => `- id: ${e.id} | "${e.title}" | ${e.startDateTime} to ${e.endDateTime}` +
            `${e.location ? ` | location: ${e.location}` : ""}`)
            .join("\n")
        : "(none)";
    const prompt = `You are a calendar assistant. Interpret the user's natural-language
request and convert it into a single structured command matching the response schema.

Current date/time (reference point for relative dates): ${now.toISOString()}
User's timezone: ${timeZone}

The user's existing events:
${eventsList}

Convention schedule catalog (events the user might want to add to their
calendar by name, e.g. "Add the Welcome Ceremony to my calendar" or "I want
to go to the Maid Cafe"):
${catalogList}

Decide which action the request describes:

- "create": the user describes a NEW event to add, OR wants to add one of the
  catalog events above to their calendar.
  - If the request matches a catalog event above (by title/description, and
    by date/time if the user mentions one and multiple sessions share a
    title), set catalogEventId to that entry's id. You may leave title,
    description, location, startDateTime, endDateTime, and allDay as null —
    they will be copied from the catalog entry automatically. If the user
    asks for something different from the catalog entry (e.g. a different
    time), set just that field to override it.
  - Otherwise, fill title, startDateTime, endDateTime, allDay (and
    description/location if mentioned) from the request itself, and leave
    catalogEventId null.
  - Leave eventId null in all cases for "create".

- "update": the user wants to change an EXISTING event (reschedule, rename,
  change location, etc). Find the best-matching event from "existing events"
  above and set eventId to its id. Only set the fields that are changing;
  leave any field that should keep its existing value as null (it will be
  preserved automatically). If only the start time changes, shift the end
  time to preserve the original duration unless a new duration/end time is
  given. catalogEventId stays null for "update".

- "delete": the user wants to remove/cancel an EXISTING event. Set eventId to
  the matching event's id from "existing events" above. Other fields may be
  left null. catalogEventId stays null for "delete".

- "clarify": use this if the request doesn't clearly match any of the above —
  e.g. no existing/catalog event matches the description, more than one
  catalog event could match and the request doesn't disambiguate (e.g. no
  date/time given when multiple sessions share a title), or the request isn't
  about a calendar event at all. Set message to a short question or
  explanation for the user. Leave eventId, catalogEventId, and event fields
  null.

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
    return JSON.parse(responseText);
}
const catalogEventSchema = {
    type: vertexai_1.SchemaType.ARRAY,
    items: {
        type: vertexai_1.SchemaType.OBJECT,
        properties: {
            title: { type: vertexai_1.SchemaType.STRING },
            description: { type: vertexai_1.SchemaType.STRING, nullable: true },
            location: { type: vertexai_1.SchemaType.STRING, nullable: true },
            startDateTime: {
                type: vertexai_1.SchemaType.STRING,
                description: "ISO 8601 datetime with timezone offset",
            },
            endDateTime: {
                type: vertexai_1.SchemaType.STRING,
                description: "ISO 8601 datetime with timezone offset",
            },
            allDay: { type: vertexai_1.SchemaType.BOOLEAN },
        },
        required: ["title", "startDateTime", "endDateTime", "allDay"],
    },
};
// Parses a chunk of raw convention-schedule text into structured catalog
// events. Each event block in the input looks like:
//   <Date>
//   <Title>
//   Panel Room:
//   <Room>
//   START:
//   <Time>
//   END:
//   <Time>
//   Panel Description: <description>
async function parseCatalogChunk(text, timeZone) {
    const vertexAI = new vertexai_1.VertexAI({
        project: process.env.GCLOUD_PROJECT,
        location: LOCATION,
    });
    const model = vertexAI.getGenerativeModel({
        model: MODEL_NAME,
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: catalogEventSchema,
            maxOutputTokens: 32768,
        },
    });
    const prompt = `You are parsing a convention event schedule into structured data.

Each event in the input is a block of lines with this format:
<Date, e.g. "July 2, 2026">
<Title>
Panel Room:
<Room>
START:
<Time, e.g. "10:00 AM">
END:
<Time>
Panel Description: <description>

Convert EVERY event block in the input below into an object with:
- title: the event title, exactly as given
- description: the panel description text, or null if there isn't one
- location: the panel room, or null if there isn't one
- startDateTime / endDateTime: ISO 8601 datetime strings combining the
  event's date and time, with the correct UTC offset for ${timeZone}
- allDay: false for all of these events (they all have specific times)

Return one object per event block, in the same order they appear.

Input:
${text}`;
    const result = await model.generateContent(prompt);
    const responseText = result.response.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
        throw new Error("Gemini returned an empty response");
    }
    return JSON.parse(responseText);
}
//# sourceMappingURL=gemini.js.map