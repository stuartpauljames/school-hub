// One place for how School Hub events and calendars look, so the calendar
// sync, the setup wizard, the update script and the dashboard can't drift
// apart. Deliberately has no imports: the setup wizard uses this before a
// .env exists, and importing config.js there would print warnings.

// Everything is yellow. Event colour "5" is "Banana" in Google Calendar's
// event palette, and #f6bf26 is that same yellow as a hex value, used for
// the calendars themselves and the dashboard.
export const EVENT_COLOR_ID = "5";
export const YELLOW = "#f6bf26";
export const CALENDAR_BACKGROUND = YELLOW;
export const CALENDAR_FOREGROUND = "#000000";

// Popup reminder at 6pm, two days before. These are all-day events, and
// Google counts reminders back from midnight at the start of the event
// day, so 6pm two days earlier is (2 * 24 - 18) hours = 1800 minutes.
export const REMINDER_DAYS_BEFORE = 2;
export const REMINDER_HOUR = 18;
export const REMINDER_MINUTES_BEFORE = REMINDER_DAYS_BEFORE * 24 * 60 - REMINDER_HOUR * 60;
