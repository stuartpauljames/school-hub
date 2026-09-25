import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
let failures = 0;

async function check(label, fn) {
  try {
    const result = await fn();
    console.log(`✅ ${label}${result ? " -- " + result : ""}`);
  } catch (err) {
    console.log(`❌ ${label} -- ${err.message}`);
    failures++;
  }
}

console.log("School Hub doctor\n------------------\n");

await check("Node version", () => {
  const v = process.versions.node;
  if (parseInt(v.split(".")[0], 10) < 20) throw new Error(`v${v} found, need 20 or newer`);
  return `v${v}`;
});

await check(".env file", () => {
  if (!fs.existsSync(path.join(root, ".env"))) throw new Error("not found -- run 'npm run setup'");
  return "found";
});

await check("Gemini API key", () => {
  if (!process.env.GEMINI_API_KEY) throw new Error("missing -- run 'npm run setup'");
  return "set";
});

await check("Google Calendar authorization", async () => {
  const tokenPath = path.join(root, "data", "google-token.json");
  if (!fs.existsSync(tokenPath)) {
    throw new Error("not connected -- run 'npm run authorize-google'");
  }
  // A real API call, not just a file-exists check -- this is the only way
  // to actually catch an expired token (invalid_grant), which a Testing-mode
  // Google app hits every 7 days. The file can exist and still be useless.
  try {
    const tokens = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
    const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
    client.setCredentials(tokens);
    const calendar = google.calendar({ version: "v3", auth: client });
    await calendar.calendarList.list({ maxResults: 1 });
  } catch (err) {
    if (err.message?.includes("invalid_grant")) {
      throw new Error(
        "token expired or revoked -- run 'npm run authorize-google' again. " +
          "If this keeps happening every ~7 days, publish the Google app " +
          "(OAuth consent screen -> Publish app) so tokens stop expiring."
      );
    }
    throw new Error(`token exists but the API call failed: ${err.message}`);
  }
  return "connected and verified";
});

await check("Gmail credentials for approval emails", () => {
  if (!process.env.GMAIL_ADDRESS || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error("missing -- run 'npm run setup'");
  }
  return "set";
});

function macServiceStatus(label) {
  let out;
  try {
    out = execSync(`launchctl print gui/$(id -u)/${label}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error("not installed -- run 'npm run install-service'");
  }
  if (out.includes("last exit code = (never exited)")) return "running cleanly";
  const crashMatch = out.match(/last exit code = (\d+: \w+)/);
  if (crashMatch) throw new Error(`installed but crashing (exit ${crashMatch[1]}) -- check data/*.log`);
  return "registered";
}

function windowsTaskStatus(taskName) {
  let out;
  try {
    out = execSync(`schtasks /query /tn "${taskName}"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error("not installed -- run 'npm run install-service'");
  }
  if (/Disabled/i.test(out)) throw new Error("task exists but is disabled in Task Scheduler");
  return "registered";
}

if (process.platform === "darwin") {
  await check("Scraper background service", () => macServiceStatus("com.schoolhub.scraper"));
  await check("Dashboard background service", () => macServiceStatus("com.schoolhub.dashboard"));
} else if (process.platform === "win32") {
  await check("Scraper background task", () => windowsTaskStatus("SchoolHubScraper"));
  await check("Dashboard background task", () => windowsTaskStatus("SchoolHubDashboard"));
} else {
  console.log(`⚠️  No automated service checks for platform "${process.platform}"`);
}

await check("At least one school connector configured", () => {
  const hasDojo = process.env.CLASSDOJO_EMAIL;
  const hasMcas = process.env.MCAS_EMAIL;
  const hasCharts = process.env.CLASSCHARTS_STUDENTS;
  if (!hasDojo && !hasMcas && !hasCharts) {
    throw new Error("none configured -- run 'npm run setup' and add at least one");
  }
  const active = [hasDojo && "ClassDojo", hasMcas && "MyChildAtSchool", hasCharts && "ClassCharts"]
    .filter(Boolean)
    .join(", ");
  return active;
});

console.log(
  failures === 0
    ? "\nAll checks passed."
    : `\n${failures} issue${failures === 1 ? "" : "s"} found -- fix the item(s) above and run 'npm run doctor' again.`
);
