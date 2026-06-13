const API_BASE = "/api";

const nlInput = document.getElementById("nl-input");
const parseBtn = document.getElementById("parse-btn");
const parseError = document.getElementById("parse-error");
const parseInfo = document.getElementById("parse-info");

const preview = document.getElementById("preview");
const previewTitle = document.getElementById("preview-title");
const previewFields = document.getElementById("preview-fields");
const deleteSummary = document.getElementById("delete-summary");
const pTitle = document.getElementById("p-title");
const pLocation = document.getElementById("p-location");
const pDescription = document.getElementById("p-description");
const pAllday = document.getElementById("p-allday");
const pStart = document.getElementById("p-start");
const pEnd = document.getElementById("p-end");
const saveBtn = document.getElementById("save-btn");
const cancelBtn = document.getElementById("cancel-btn");
const saveError = document.getElementById("save-error");

const eventList = document.getElementById("event-list");

let rawInputText = "";
let currentAction = null; // "create" | "update" | "delete"
let currentEventId = null;

parseBtn.addEventListener("click", async () => {
  const text = nlInput.value.trim();
  if (!text) return;

  parseError.classList.add("hidden");
  parseInfo.classList.add("hidden");
  preview.classList.add("hidden");
  parseBtn.disabled = true;
  parseBtn.textContent = "Parsing...";

  try {
    const res = await fetch(`${API_BASE}/parseEvent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });

    if (!res.ok) throw new Error("Failed to parse command");
    const result = await res.json();

    if (result.action === "clarify" || !result.preview) {
      parseInfo.textContent =
        result.message ?? "I couldn't understand that. Could you rephrase?";
      parseInfo.classList.remove("hidden");
      return;
    }

    rawInputText = text;
    currentAction = result.action;
    currentEventId = result.eventId;
    showPreview(result);
  } catch (err) {
    parseError.textContent = "Sorry, couldn't parse that. Try rephrasing.";
    parseError.classList.remove("hidden");
  } finally {
    parseBtn.disabled = false;
    parseBtn.textContent = "Parse";
  }
});

function showPreview(result) {
  const { action, preview: ev } = result;

  pTitle.value = ev.title ?? "";
  pLocation.value = ev.location ?? "";
  pDescription.value = ev.description ?? "";
  pAllday.checked = Boolean(ev.allDay);
  pStart.value = toLocalInputValue(ev.startDateTime);
  pEnd.value = toLocalInputValue(ev.endDateTime);

  saveError.classList.add("hidden");
  saveBtn.classList.remove("danger");

  if (action === "delete") {
    previewTitle.textContent = "Delete event?";
    previewFields.classList.add("hidden");
    deleteSummary.classList.remove("hidden");

    const start = new Date(ev.startDateTime);
    const end = new Date(ev.endDateTime);
    deleteSummary.innerHTML = `<strong>${escapeHtml(ev.title)}</strong><br>
      ${start.toLocaleString()} &ndash; ${end.toLocaleString()}
      ${ev.location ? `<br><span class="muted">${escapeHtml(ev.location)}</span>` : ""}`;

    saveBtn.textContent = "Confirm Delete";
    saveBtn.classList.add("danger");
  } else {
    previewTitle.textContent = action === "update" ? "Update event" : "New event";
    previewFields.classList.remove("hidden");
    deleteSummary.classList.add("hidden");

    saveBtn.textContent = action === "update" ? "Confirm Update" : "Confirm & Save";
  }

  preview.classList.remove("hidden");
}

saveBtn.addEventListener("click", async () => {
  saveError.classList.add("hidden");
  saveBtn.disabled = true;
  const originalLabel = saveBtn.textContent;
  saveBtn.textContent = "Saving...";

  try {
    let res;

    if (currentAction === "delete") {
      res = await fetch(`${API_BASE}/events?id=${encodeURIComponent(currentEventId)}`, {
        method: "DELETE",
      });
    } else {
      const body = {
        title: pTitle.value,
        location: pLocation.value || null,
        description: pDescription.value || null,
        allDay: pAllday.checked,
        startDateTime: new Date(pStart.value).toISOString(),
        endDateTime: new Date(pEnd.value).toISOString(),
      };

      if (currentAction === "update") {
        res = await fetch(`${API_BASE}/events?id=${encodeURIComponent(currentEventId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        body.rawInput = rawInputText;
        res = await fetch(`${API_BASE}/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
    }

    if (!res.ok) throw new Error("Request failed");

    preview.classList.add("hidden");
    nlInput.value = "";
    await loadEvents();
  } catch (err) {
    saveError.textContent = "Sorry, something went wrong. Please try again.";
    saveError.classList.remove("hidden");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = originalLabel;
  }
});

cancelBtn.addEventListener("click", () => {
  preview.classList.add("hidden");
  saveError.classList.add("hidden");
});

async function loadEvents() {
  const res = await fetch(`${API_BASE}/events`);
  if (!res.ok) return;
  const { events } = await res.json();

  eventList.innerHTML = "";
  for (const ev of events) {
    const li = document.createElement("li");
    const start = new Date(ev.start);
    const end = new Date(ev.end);
    li.innerHTML = `<strong>${escapeHtml(ev.title)}</strong><br>
      ${start.toLocaleString()} &ndash; ${end.toLocaleString()}
      ${ev.location ? `<br><span class="muted">${escapeHtml(ev.location)}</span>` : ""}`;
    eventList.appendChild(li);
  }
}

function toLocalInputValue(isoString) {
  const date = new Date(isoString);
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  const local = new Date(date.getTime() - offsetMs);
  return local.toISOString().slice(0, 16);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

loadEvents();
