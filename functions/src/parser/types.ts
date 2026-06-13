export interface ParsedEvent {
  title: string;
  description: string | null;
  location: string | null;
  startDateTime: string; // ISO 8601
  endDateTime: string; // ISO 8601
  allDay: boolean;
}

export type CommandAction = "create" | "update" | "delete" | "clarify";

// Minimal summary of an existing event, given to Gemini as context so it
// can match natural-language references ("my dentist appointment") to a
// specific Firestore document.
export interface ExistingEventSummary {
  id: string;
  title: string;
  description: string | null;
  startDateTime: string; // ISO 8601
  endDateTime: string; // ISO 8601
  location: string | null;
  allDay: boolean;
}

// Raw structured response from Gemini. All event fields are nullable since
// not every action populates them (e.g. "delete" only needs eventId).
export interface RawCommand {
  action: CommandAction;
  eventId: string | null;
  title: string | null;
  description: string | null;
  location: string | null;
  startDateTime: string | null;
  endDateTime: string | null;
  allDay: boolean | null;
  message: string | null;
}

// Response sent to the frontend after backend validation/lookup.
export interface CommandResult {
  action: CommandAction;
  eventId: string | null;
  preview: ParsedEvent | null;
  message: string | null;
}
