import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const SEEN_PATH = path.join(DATA_DIR, "seen.json");
const PENDING_PATH = path.join(DATA_DIR, "pending.json");
const LOG_PATH = path.join(DATA_DIR, "added.json");

function readJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

export function hashItem(source, text) {
  return crypto.createHash("sha256").update(`${source}::${text}`).digest("hex");
}

export function isSeen(id) {
  const seen = readJson(SEEN_PATH, {});
  return Boolean(seen[id]);
}

export function markSeen(id) {
  const seen = readJson(SEEN_PATH, {});
  seen[id] = new Date().toISOString();
  writeJson(SEEN_PATH, seen);
}

export function addPending(item) {
  const pending = readJson(PENDING_PATH, {});
  pending[item.id] = { ...item, status: "pending", createdAt: new Date().toISOString() };
  writeJson(PENDING_PATH, pending);
}

export function getPending() {
  const pending = readJson(PENDING_PATH, {});
  return Object.values(pending).filter((p) => p.status === "pending");
}

export function resolvePending(id, status) {
  const pending = readJson(PENDING_PATH, {});
  if (!pending[id]) return null;
  pending[id].status = status;
  pending[id].resolvedAt = new Date().toISOString();
  writeJson(PENDING_PATH, pending);
  return pending[id];
}

export function logAdded(item) {
  const log = readJson(LOG_PATH, []);
  log.push({ ...item, addedAt: new Date().toISOString() });
  writeJson(LOG_PATH, log);
}

// Reduces text to its meaningful words for comparison -- short/common words
// ("the", "for", "and") are dropped since they'd inflate similarity between
// genuinely unrelated events that just share ordinary sentence structure.
export function significantWords(text) {
  return new Set(
    (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s£]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

export function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

export const DUPLICATE_SIMILARITY_THRESHOLD = 0.4;

function datesOf(item) {
  return [item.date, item.end_date].filter(Boolean);
}

export function datesOverlap(a, b) {
  const bDates = new Set(datesOf(b));
  return datesOf(a).some((d) => bDates.has(d));
}

// The same real-world event can reach us more than once: from two different
// apps (ClassDojo and MyChildAtSchool both posting about the same trip),
// from ClassDojo as both a calendar-event card and an ordinary post, or --
// the most common case in practice -- the same app posting more than one
// reminder about the same thing, worded differently each time. Wording
// will never match exactly, so this compares by date plus how much
// meaningful vocabulary overlaps between summaries.
//
// Every pair is compared the same way, regardless of source or kind. An
// earlier version skipped comparing two ordinary posts from the same app,
// reasoning that separate events on the same day were likelier than a
// genuine duplicate -- real data showed the opposite: a school posting
// several differently-worded reminders about one thing (a deposit deadline,
// a club starting) turned out to be the common case, not a rare one, and
// that exemption was hiding real duplicates from an otherwise reliable
// check rather than protecting against false ones.
//
// Checks both already-added events and anything currently sitting in the
// approval inbox, so two low-confidence duplicates queued in the same run
// don't both get emailed either.
export function findDuplicate(item) {
  const added = readJson(LOG_PATH, []);
  const pending = Object.values(readJson(PENDING_PATH, {}));
  const itemWords = significantWords(item.summary);

  for (const candidate of [...added, ...pending]) {
    if (candidate.id === item.id) continue; // the same event being saved again, not a duplicate

    const differentSource = candidate.source !== item.source;
    const differentKind = (candidate.kind || "post") !== (item.kind || "post");

    // A multi-day event card starts on one date, but a post about it might
    // give the deadline or the end date -- so any shared date counts.
    if (!datesOverlap(item, candidate)) continue;

    if (jaccardSimilarity(itemWords, significantWords(candidate.summary)) >= DUPLICATE_SIMILARITY_THRESHOLD) {
      return candidate;
    }

    // An event card and an ordinary post about the same event usually share
    // the event's title word for word, which is a stronger signal than
    // the AI's two differently-worded summaries.
    if (!differentSource && differentKind) {
      const card = item.kind === "event-card" ? item : candidate;
      const post = card === item ? candidate : item;
      if (card.eventTitle && post.original_text?.toLowerCase().includes(card.eventTitle.toLowerCase())) {
        return candidate;
      }
    }
  }
  return null;
}
