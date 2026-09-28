// Applies the current look (yellow) and reminder (6pm, two days before) to
// the calendars and events School Hub created earlier. Colour and reminders
// are stored on each event, and the colour of a calendar is stored on the
// calendar, so changing them in the code only affects things created from
// then on.
//
// Deliberately does NOT re-run classification: the AI's summary wording can
// differ slightly between runs, which changes an event's ID and would
// create duplicates instead of updating what's already there.
//
// Only touches events whose ID starts with "schoolhub" (the ones this app
// created), and never recolours your main personal calendar. Nothing else
// on your calendars is changed.
//
// Run with: npm run update-existing-events
import { google } from "googleapis";
import { config } from "../src/config.js";
import { getAuthedClient } from "../src/calendarSync.js";
import {
  EVENT_COLOR_ID,
  REMINDER_MINUTES_BEFORE,
  CALENDAR_BACKGROUND,
  CALENDAR_FOREGROUND,
} from "../src/style.js";

const calendarIds = [
  ...new Set(
    [
      config.google.calendarId,
      config.google.wholeSchoolCalendarId,
      ...Object.values(config.google.childCalendars),
      ...Object.values(config.google.classCalendars),
      ...Object.values(config.google.yearGroupCalendars),
    ].filter(Boolean)
  ),
];

const calendar = google.calendar({ version: "v3", auth: getAuthedClient() });
let eventsUpdated = 0;
let calendarsRecoloured = 0;
let problems = 0;

for (const calendarId of calendarIds) {
  console.log(`\nCalendar ${calendarId}`);

  // The calendar's own colour (the swatch in the sidebar).
  try {
    const { data: entry } = await calendar.calendarList.get({ calendarId });
    if (entry.primary) {
      console.log("  main personal calendar -- leaving its colour alone");
    } else {
      await calendar.calendarList.patch({
        calendarId,
        colorRgbFormat: true,
        requestBody: { backgroundColor: CALENDAR_BACKGROUND, foregroundColor: CALENDAR_FOREGROUND },
      });
      calendarsRecoloured++;
      console.log(`  calendar colour set: ${entry.summary}`);
    }
  } catch (err) {
    problems++;
    console.error(`  Couldn't set the calendar's colour: ${err.message}`);
  }

  // The events School Hub created on it.
  let pageToken;
  try {
    do {
      const { data } = await calendar.events.list({ calendarId, maxResults: 250, pageToken });
      for (const event of data.items || []) {
        if (!event.id?.startsWith("schoolhub")) continue;
        try {
          await calendar.events.patch({
            calendarId,
            eventId: event.id,
            requestBody: {
              colorId: EVENT_COLOR_ID,
              reminders: { useDefault: false, overrides: [{ method: "popup", minutes: REMINDER_MINUTES_BEFORE }] },
            },
          });
          eventsUpdated++;
          console.log(`  updated: ${event.summary}`);
        } catch (err) {
          problems++;
          console.error(`  FAILED: ${event.summary} -- ${err.message}`);
        }
      }
      pageToken = data.nextPageToken;
    } while (pageToken);
  } catch (err) {
    problems++;
    console.error(`  Couldn't read this calendar's events: ${err.message}`);
  }
}

console.log(
  `\nDone. ${calendarsRecoloured} calendar(s) recoloured, ${eventsUpdated} event(s) updated` +
    `${problems ? `, ${problems} problem(s) -- see above` : ""}.`
);
