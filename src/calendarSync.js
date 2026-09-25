import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { config } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, "..", "data", "google-token.json");

function getAuthedClient() {
  if (!fs.existsSync(TOKEN_PATH)) {
    throw new Error(
      "No Google token found. Run `npm run authorize-google` first (one-time setup)."
    );
  }
  const tokens = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
  const client = new google.auth.OAuth2(config.google.clientId, config.google.clientSecret);
  client.setCredentials(tokens);
  return client;
}

const CATEGORY_COLORS = {
  trip: "9",
  deadline: "11",
  payment: "6",
  meeting: "3",
  non_uniform: "5",
  club: "10",
  other: "8",
};

function toCalendarEventId(itemId) {
  return `schoolhub${itemId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 40)}`;
}

// Which calendar does this specific event belong on? Three cases, in order:
// 1. It names a child we have a mapped calendar for -> that child's calendar.
// 2. It doesn't name a specific child (a whole-school trip, an inset day)
//    -> the dedicated whole-school calendar, so it isn't duplicated across
//    every child's calendar.
// 3. Neither CHILD_CALENDARS nor WHOLE_SCHOOL_CALENDAR_ID is configured at
//    all -> the single default calendar, exactly as before. This keeps a
//    simple one-family, one-calendar setup working unchanged.
function resolveCalendarId(item) {
  const hasMultiCalendarSetup =
    Object.keys(config.google.childCalendars).length > 0 || config.google.wholeSchoolCalendarId;

  if (!hasMultiCalendarSetup) return config.google.calendarId;

  const childKey = item.child_name?.toLowerCase();
  if (childKey && config.google.childCalendars[childKey]) {
    return config.google.childCalendars[childKey];
  }

  return config.google.wholeSchoolCalendarId || config.google.calendarId;
}

export async function upsertCalendarEvent(item) {
  const auth = getAuthedClient();
  const calendar = google.calendar({ version: "v3", auth });
  const eventId = toCalendarEventId(item.id);
  const calendarId = resolveCalendarId(item);

  const eventBody = {
    summary: `${item.category ? `[${item.category}] ` : ""}${item.summary}`,
    description: `${item.original_text}\n\nSource: ${item.source} (${item.poster || "unknown"})`,
    start: { date: item.date },
    end: { date: item.end_date || item.date },
    colorId: CATEGORY_COLORS[item.category] || CATEGORY_COLORS.other,
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: 24 * 60 }],
    },
  };

  try {
    await calendar.events.update({
      calendarId,
      eventId,
      requestBody: eventBody,
    });
    return { action: "updated", eventId, calendarId };
  } catch (err) {
    if (err.code === 404) {
      await calendar.events.insert({
        calendarId,
        requestBody: { id: eventId, ...eventBody },
      });
      return { action: "created", eventId, calendarId };
    }
    throw err;
  }
}
