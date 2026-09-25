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
    Object.keys(config.google.childCalendars).length > 0 ||
    Object.keys(config.google.classCalendars).length > 0 ||
    Object.keys(config.google.yearGroupCalendars).length > 0 ||
    config.google.wholeSchoolCalendarId;

  if (!hasMultiCalendarSetup) return { calendarId: config.google.calendarId, matchedVia: "default (single-calendar mode)" };

  const childKey = item.child_name?.toLowerCase();
  if (childKey && config.google.childCalendars[childKey]) {
    return { calendarId: config.google.childCalendars[childKey], matchedVia: `child_name="${item.child_name}"` };
  }

  const classKey = item.class_name?.toLowerCase().trim();
  if (classKey) {
    for (const [configuredClass, calendarId] of Object.entries(config.google.classCalendars)) {
      if (classKey.includes(configuredClass) || configuredClass.includes(classKey)) {
        return { calendarId, matchedVia: `class_name="${item.class_name}" matched "${configuredClass}"` };
      }
    }
  }

  // Fall back to year group ("Year 4") when class name didn't match or
  // wasn't extracted -- MCAS messages especially tend to say the year
  // group rather than a class's actual name.
  const yearKey = item.year_group?.toLowerCase().trim();
  if (yearKey && config.google.yearGroupCalendars[yearKey]) {
    return { calendarId: config.google.yearGroupCalendars[yearKey], matchedVia: `year_group="${item.year_group}"` };
  }

  return {
    calendarId: config.google.wholeSchoolCalendarId || config.google.calendarId,
    matchedVia: `no match (child_name="${item.child_name || "none"}", class_name="${item.class_name || "none"}", year_group="${item.year_group || "none"}")`,
  };
}

export async function upsertCalendarEvent(item) {
  const auth = getAuthedClient();
  const calendar = google.calendar({ version: "v3", auth });
  const eventId = toCalendarEventId(item.id);
  const { calendarId, matchedVia } = resolveCalendarId(item);
  console.log(`[calendarSync] Routing "${item.summary}" -> ${calendarId} (${matchedVia})`);

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
