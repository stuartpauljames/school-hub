import { config } from "./config.js";
import { hashItem, isSeen, markSeen, addPending, logAdded } from "./store.js";
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
    const id = hashItem(raw.source, raw.text);
    if (isSeen(id)) continue;
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
    markSeen(id);

    if (!result.is_event || !result.date) continue;

    if (raw.childName) result.child_name = raw.childName;

    const item = {
      id,
      source: raw.source,
      poster: raw.poster,
      original_text: raw.text,
      ...result,
    };

    if (result.confidence >= config.autoAddThreshold) {
      const sync = await upsertCalendarEvent(item);
      logAdded({ ...item, syncAction: sync.action });
      console.log(`[runOnce] Auto-added (${result.confidence}%): ${item.summary}`);
    } else {
      addPending(item);
      await sendApprovalEmail(item);
      console.log(`[runOnce] Sent for approval (${result.confidence}%): ${item.summary}`);
    }
  }

  console.log(`[runOnce] Done. ${newCount} new items processed.`);
}

main().catch((err) => {
  console.error("[runOnce] Fatal error:", err);
  process.exit(1);
});
