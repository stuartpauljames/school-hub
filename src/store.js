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
function significantWords(text) {
  return new Set(
    (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s£]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

const DUPLICATE_SIMILARITY_THRESHOLD = 0.4;

// Same real-world event reported by two different apps (e.g. ClassDojo and
// MyChildAtSchool both posting about the same trip) will never share exact
// wording, so this compares by date + how much meaningful vocabulary
// overlaps between summaries, rather than exact text matching. Checks both
// already-added events and anything currently sitting in someone's
// approval inbox, so two low-confidence duplicates queued in the same run
// don't both get emailed either.
export function findCrossSourceDuplicate(item) {
  const added = readJson(LOG_PATH, []);
  const pending = Object.values(readJson(PENDING_PATH, {}));
  const candidates = [...added, ...pending].filter(
    (c) => c.date === item.date && c.source !== item.source
  );

  const itemWords = significantWords(item.summary);
  for (const candidate of candidates) {
    const similarity = jaccardSimilarity(itemWords, significantWords(candidate.summary));
    if (similarity >= DUPLICATE_SIMILARITY_THRESHOLD) {
      return candidate;
    }
  }
  return null;
}
