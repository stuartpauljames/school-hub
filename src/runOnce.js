import { config } from "./config.js";
import { hashItem, isSeen, markSeen, addPending, logAdded, findCrossSourceDuplicate } from "./store.js";
import { classifyItem } from "./classify.js";
import { upsertCalendarEvent } from "./calendarSync.js";
import { sendApprovalEmail } from "./notify.js";
import { fetchClassChartsItems } from "./connectors/classCharts.js";
import { fetchClassDojoItems } from "./connectors/classDojo.js";
import { fetchMcasItems } from "./connectors/mcas.js";

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
    const rawId = hashItem(raw.source, raw.text);
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
      const eventId = hashItem(raw.source, `${raw.text}::${event.date}::${event.summary}`);

      const item = {
        id: eventId,
        source: raw.source,
        poster: raw.poster,
        original_text: raw.text,
        ...event,
      };

      const duplicate = findCrossSourceDuplicate(item);
      if (duplicate) {
        // Same real-world event, reported by a different app -- e.g.
        // ClassDojo and MyChildAtSchool both posting about the same trip.
        // Not a failure, just nothing further to do with this one.
        console.log(
          `[runOnce] Skipping "${item.summary}" -- looks like a duplicate of a ${duplicate.source} item already known ("${duplicate.summary}")`
        );
        continue;
      }

      try {
        if (event.confidence >= config.autoAddThreshold) {
          const sync = await upsertCalendarEvent(item);
          logAdded({ ...item, syncAction: sync.action, calendarId: sync.calendarId });
          console.log(`[runOnce] Auto-added (${event.confidence}%) to ${sync.calendarId}: ${item.summary}`);
        } else {
          addPending(item);
          await sendApprovalEmail(item);
          console.log(`[runOnce] Sent for approval (${event.confidence}%): ${item.summary}`);
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

main().catch((err) => {
  console.error("[runOnce] Fatal error:", err);
  process.exit(1);
});
