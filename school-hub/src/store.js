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
