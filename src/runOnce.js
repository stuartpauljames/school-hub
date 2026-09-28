import { config } from "./config.js";
import { hashItem, isSeen, markSeen, addPending, logAdded, findDuplicate } from "./store.js";
import { classifyItem } from "./classify.js";
import { upsertCalendarEvent } from "./calendarSync.js";
import { sendApprovalEmail } from "./notify.js";
import { fetchClassChartsItems } from "./connectors/classCharts.js";
import { fetchClassDojoItems } from "./connectors/classDojo.js";
import { fetchMcasItems } from "./connectors/mcas.js";

function datesLabel(item) {
  return item.end_date && item.end_date !== item.date ? `${item.date} to ${item.end_date}` : item.date;
}

async function fetchAllRawItems() {
  const labeled = [
    { name: "ClassCharts", promise: fetchClassChartsItems() },
    { name: "ClassDojo", promise: fetchClassDojoItems() },
    { name: "MyChildAtSchool", promise: fetchMcasItems() },
  ];

  const results = await Promise.allSettled(labeled.map((l) => l.promise));

  const items = [];
  results.forEach((r, i) => {
    const name = labeled[i].name;
    if (r.status === "fulfilled") {
      console.log(`[runOnce] ${name}: ${r.value.length} raw items`);
      for (const item of r.value) {
        // A short preview of each raw item, so a future "why wasn't X picked
        // up" question can be answered by reading the log rather than
        // needing fresh screenshots -- the full text isn't needed here,
        // just enough to recognize which message this was.
        console.log(`[runOnce]   - [${item.postDate || "no date"}] ${item.text.slice(0, 70).replace(/\n/g, " ")}...`);
      }
      items.push(...r.value);
    } else {
      console.error(`[runOnce] ${name} connector failed:`, r.reason);
    }
  });
  return items;
}

async function main() {
  console.log(`[runOnce] Starting run at ${new Date().toISOString()}`);

  const rawItems = await fetchAllRawItems();
  console.log(`[runOnce] Fetched ${rawItems.length} raw items total`);

  let newCount = 0;

  for (const raw of rawItems) {
    // Items that carry their own stable identity (ClassDojo calendar events,
    // keyed by ClassDojo's event id) use that instead of their text.
    const rawId = hashItem(raw.source, raw.dedupeKey || raw.text);
    if (isSeen(rawId)) continue;
    newCount++;

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const result = await classifyItem({
      text: raw.text,
      source: raw.source,
      poster: raw.poster,
      classContext: raw.classContext,
      postDate: raw.postDate,
    });

    if (result.parse_error) {
      console.warn(`[runOnce] Classification failed for an item, will retry next run: ${raw.text.slice(0, 60)}...`);
      continue;
    }

    let allEventsSucceeded = true;

    for (const event of result.events || []) {
      if (!event.date) continue;

      if (raw.childName) event.child_name = raw.childName;

      // A single message can now produce more than one calendar entry (e.g.
      // a payment deadline and a separate event date) -- each needs its own
      // id, derived from the specific date + summary, not just the raw
      // message, so they don't collide with each other or with a
      // single-event message's id.
      // Calendar-event cards derive their id from ClassDojo's event id and the
      // date only -- NOT the AI's summary wording, which can vary between
      // runs and would otherwise turn a re-read of the same event into a
      // second calendar entry.
      const eventId = raw.dedupeKey
        ? hashItem(raw.source, `${raw.dedupeKey}::${event.date}`)
        : hashItem(raw.source, `${raw.text}::${event.date}::${event.summary}`);

      const item = {
        id: eventId,
        source: raw.source,
        poster: raw.poster,
        original_text: raw.text,
        kind: raw.kind,
        eventTitle: raw.eventTitle,
        ...event,
      };

      const duplicate = findDuplicate(item);
      if (duplicate) {
        // Same real-world event reported twice -- by a different app (e.g.
        // ClassDojo and MyChildAtSchool both posting about the same trip),
        // or by ClassDojo as both a calendar-event card and an ordinary
        // post. Not a failure, just nothing further to do with this one.
        console.log(
          `[runOnce] Skipping "${item.summary}" -- looks like a duplicate of an item already known (${duplicate.source}: "${duplicate.summary}")`
        );
        continue;
      }

      try {
        if (event.confidence >= config.autoAddThreshold) {
          const sync = await upsertCalendarEvent(item);
          logAdded({ ...item, syncAction: sync.action, calendarId: sync.calendarId });
          console.log(`[runOnce] Auto-added (${event.confidence}%) to ${sync.calendarId}: ${item.summary} [${datesLabel(item)}]`);
        } else {
          addPending(item);
          await sendApprovalEmail(item);
          console.log(`[runOnce] Sent for approval (${event.confidence}%): ${item.summary} [${datesLabel(item)}]`);
        }
      } catch (err) {
        // A failure here (e.g. an expired Google token, or a bad Gmail App
        // Password) shouldn't take down every other item queued up behind
        // it in this run -- log it and keep going, rather than crashing.
        console.error(`[runOnce] Failed to save "${item.summary}":`, err.message);
        allEventsSucceeded = false;
      }
    }

    // Only mark the raw message as dealt with once every one of its events
    // has actually been saved (to the calendar or as an approval email).
    // If anything failed partway through, leave it unmarked so the whole
    // message -- including reclassification -- gets retried next run
    // rather than being silently lost because it was technically
    // "classified" even though nothing was ever saved.
    if (allEventsSucceeded) {
      markSeen(rawId);
    } else {
      console.warn(`[runOnce] Not marking as seen due to a save failure above -- will retry next run.`);
    }
  }

  console.log(`[runOnce] Done. ${newCount} new items processed.`);
}

// Two safety nets so a stuck run can never block the scheduled ones (the
// scheduler won't start a new run while the previous one is still going):
//  1. Exit explicitly once finished, rather than waiting for the event loop
//     to empty -- a stray open handle (e.g. a browser that failed to close)
//     would otherwise keep the process alive forever after "Done".
//  2. A watchdog that gives up on a run that takes far too long. Anything
//     already saved stays saved, and anything not yet marked as seen is
//     simply retried on the next run.
const MAX_RUN_MS = 20 * 60 * 1000;
setTimeout(() => {
  console.error("[runOnce] Run exceeded 20 minutes -- exiting so the next scheduled run isn't blocked.");
  process.exit(1);
}, MAX_RUN_MS).unref();

// Wait for buffered output to be written before exiting, so the last lines
// of the log are never lost.
function exitAfterFlush(code) {
  process.stdout.write("", () => process.stderr.write("", () => process.exit(code)));
}

main()
  .then(() => exitAfterFlush(0))
  .catch((err) => {
    console.error("[runOnce] Fatal error:", err);
    exitAfterFlush(1);
  });
