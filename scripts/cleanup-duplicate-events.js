// Finds duplicate events already sitting in your calendars -- the same
// real event added more than once, from before today's duplicate-detection
// fix existed (or from before it was tightened). Uses the exact same
// significantWords/jaccardSimilarity/datesOverlap logic as findDuplicate()
// in store.js, so "what counts as a duplicate" can never drift between
// preventing new ones and cleaning up old ones.
//
// SAFE BY DEFAULT: this only ever lists what it would delete. Nothing is
// actually deleted unless you run it a second time with --confirm, after
// reading the list.
//
//   node scripts/cleanup-duplicate-events.js            (list only)
//   node scripts/cleanup-duplicate-events.js --confirm  (actually delete)
import { google } from "googleapis";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../src/config.js";
import { getAuthedClient } from "../src/calendarSync.js";
import { significantWords, jaccardSimilarity, datesOverlap, DUPLICATE_SIMILARITY_THRESHOLD } from "../src/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADDED_LOG_PATH = path.join(__dirname, "..", "data", "added.json");

const CONFIRM = process.argv.includes("--confirm");

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

// Prefer keeping a multi-day (ranged) event over a single-day one covering
// part of the same range -- matches the real inset-day case this was built
// for. Otherwise keep whichever was added first, since the later one is
// the one that would have been caught as a duplicate had this check existed
// at the time.
export function pickWhichToKeep(a, b) {
  const aRanged = !!(a.end_date && a.end_date !== a.date);
  const bRanged = !!(b.end_date && b.end_date !== b.date);
  if (aRanged && !bRanged) return a;
  if (bRanged && !aRanged) return b;
  return a.addedAt <= b.addedAt ? a : b;
}

// Groups items (each needing date, end_date, summary, addedAt) into
// duplicate clusters using the same date-overlap + similarity test as
// findDuplicate(). Returns only groups of 2 or more.
export function groupDuplicates(items) {
  const groups = [];
  const groupedAway = new Set();
  for (let i = 0; i < items.length; i++) {
    if (groupedAway.has(i)) continue;
    const group = [items[i]];
    for (let j = i + 1; j < items.length; j++) {
      if (groupedAway.has(j)) continue;
      if (!datesOverlap(items[i], items[j])) continue;
      const sim = jaccardSimilarity(significantWords(items[i].summary), significantWords(items[j].summary));
      if (sim >= DUPLICATE_SIMILARITY_THRESHOLD) {
        group.push(items[j]);
        groupedAway.add(j);
      }
    }
    if (group.length >= 2) groups.push(group);
  }
  return groups;
}

let totalGroups = 0;
let totalDeleted = 0;
let totalAlreadyGone = 0;
let totalProblems = 0;
let totalBackfilled = 0;

// A survivor can genuinely predate added.json tracking (exactly how tonight's
// orphaned flu-vaccination event was found at all -- it had no entry, which
// is why no amount of searching added.json ever turned it up). Left alone,
// that same gap means a future reprocessing of the source message wouldn't
// recognize this event as already handled, and could create another
// duplicate right alongside it. So every KEPT event gets checked against
// added.json, and backfilled if it's missing -- closing the gap for good,
// not just cleaning up what's visible today.
const addedLog = fs.existsSync(ADDED_LOG_PATH) ? JSON.parse(fs.readFileSync(ADDED_LOG_PATH, "utf8")) : [];
const addedIds = new Set(addedLog.map((e) => e.id));
const toBackfill = [];

function maybeQueueBackfill(keep, calendarId) {
  if (addedIds.has(keep.event.id)) return;
  addedIds.add(keep.event.id); // avoid queueing the same backfill twice across groups
  toBackfill.push({
    id: keep.event.id,
    source: "unknown (backfilled by cleanup-duplicate-events.js)",
    poster: null,
    original_text: keep.event.description || "",
    date: keep.date,
    end_date: keep.end_date,
    summary: keep.summary,
    confidence: null,
    syncAction: "backfilled",
    calendarId,
    addedAt: keep.event.created || new Date().toISOString(),
  });
}

for (const calendarId of calendarIds) {
  console.log(`\nCalendar ${calendarId}`);

  let events = [];
  let pageToken;
  try {
    do {
      const { data } = await calendar.events.list({ calendarId, maxResults: 250, pageToken });
      events.push(...(data.items || []).filter((e) => e.id?.startsWith("schoolhub")));
      pageToken = data.nextPageToken;
    } while (pageToken);
  } catch (err) {
    console.error(`  Couldn't read this calendar's events: ${err.message}`);
    totalProblems++;
    continue;
  }

  // Turn each real calendar event back into the {date, end_date, summary}
  // shape findDuplicate()'s helpers expect, keeping a reference to the real
  // event alongside it.
  const items = events.map((e) => ({
    event: e,
    date: e.start?.date,
    end_date: e.end?.date && e.start?.date && e.end.date > e.start.date
      ? // stored end date is exclusive (see calendarSync.js) -- convert back
        new Date(new Date(`${e.end.date}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10)
      : null,
    summary: e.summary || "",
    addedAt: e.created || "",
  }));

  for (const group of groupDuplicates(items)) {
    totalGroups++;
    const keep = group.reduce((a, b) => pickWhichToKeep(a, b));
    const wasMissingFromLog = !addedIds.has(keep.event.id);
    maybeQueueBackfill(keep, calendarId);
    console.log(`\n  Duplicate group (${group.length} events):`);
    for (const g of group) {
      const range = g.end_date ? `${g.date} to ${g.end_date}` : g.date;
      const tag = g === keep ? "KEEP  " : "DELETE";
      const note = g === keep && wasMissingFromLog ? "  (had no added.json entry -- will backfill one)" : "";
      console.log(`    [${tag}] ${range} -- "${g.summary}"${note}`);
    }

    for (const g of group) {
      if (g === keep) continue;
      if (!CONFIRM) continue;
      try {
        await calendar.events.delete({ calendarId, eventId: g.event.id });
        totalDeleted++;
        console.log(`    Deleted: "${g.summary}"`);
      } catch (err) {
        if (err.code === 410 || err.code === 404) {
          totalAlreadyGone++;
        } else {
          totalProblems++;
          console.error(`    FAILED to delete "${g.summary}": ${err.message}`);
        }
      }
    }
  }
}

if (CONFIRM && toBackfill.length > 0) {
  fs.writeFileSync(ADDED_LOG_PATH, JSON.stringify([...addedLog, ...toBackfill], null, 2));
  totalBackfilled = toBackfill.length;
}

console.log(`\n${"=".repeat(60)}`);
if (!CONFIRM) {
  console.log(
    `Found ${totalGroups} duplicate group(s) above. Nothing has been deleted --` +
      ` this was a listing only. Review the list, then run again with` +
      ` --confirm to actually delete the ones marked DELETE` +
      `${toBackfill.length ? ` (and backfill ${toBackfill.length} missing added.json entr${toBackfill.length === 1 ? "y" : "ies"})` : ""}.`
  );
} else {
  console.log(
    `Done. ${totalGroups} duplicate group(s) found, ${totalDeleted} event(s) deleted` +
      `${totalBackfilled ? `, ${totalBackfilled} missing added.json entr${totalBackfilled === 1 ? "y" : "ies"} backfilled` : ""}` +
      `${totalAlreadyGone ? `, ${totalAlreadyGone} already gone (no action needed)` : ""}` +
      `${totalProblems ? `, ${totalProblems} problem(s) -- see above` : ""}.`
  );
}
