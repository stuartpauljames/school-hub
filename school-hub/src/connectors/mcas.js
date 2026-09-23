// No public API or known community library exists for MyChildAtSchool/Bromcom,
// so this drives a real browser with Playwright. Selectors below are confirmed
// against real MCAS markup (Sept 2026). If your school's portal differs
// (e.g. it does show a separate School ID step), the login() function below
// already handles that conditionally -- no changes needed either way.
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = path.join(__dirname, "..", "..", "data", "mcas-session.json");

async function getContext(browser) {
  if (fs.existsSync(SESSION_PATH)) {
    return browser.newContext({ storageState: SESSION_PATH });
  }
  return browser.newContext();
}

async function login(page) {
  await page.goto("https://www.mychildatschool.com/");

  const schoolIdField = page.locator("#SchoolID");
  if (config.mcas.schoolId && (await schoolIdField.count()) > 0) {
    await schoolIdField.fill(config.mcas.schoolId);
    await page.click("#ContinueButton").catch(() => {});
  }

  await page.fill("#EmailTextBox", config.mcas.email);
  await page.fill("#PasswordTextBox", config.mcas.password);
  await page.click("#LoginButton");
  await page.waitForSelector(".timeline-body", { timeout: 25000 });
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function parseTimelineTime(timeText) {
  if (!timeText) return { school: null, date: null };
  const match = timeText.match(/^(.*?)\s+on\s+(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(\d{4})/);
  if (!match) return { school: timeText.trim(), date: null };
  const [, school, day, monthName, year] = match;
  const month = MONTHS[monthName.toLowerCase()];
  if (!month) return { school: school.trim(), date: null };
  return {
    school: school.trim(),
    date: `${year}-${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`,
  };
}

async function scrapeOnce() {
  const browser = await chromium.launch({ headless: true });
  const context = await getContext(browser);
  const page = await context.newPage();

  const loggedIn = await page
    .goto("https://www.mychildatschool.com/Dashboard")
    .then(() => page.locator(".timeline-body").first().isVisible({ timeout: 8000 }))
    .catch(() => false);

  if (!loggedIn) {
    await login(page);
    await context.storageState({ path: SESSION_PATH });
  }

  await page.waitForLoadState("networkidle").catch(() => {});

  const elementCount = await page.locator(".timeline-body").count();
  console.log(`[mcas] Found ${elementCount} .timeline-body elements on the page`);

  const announcements = await page.$$eval(".timeline-body", (nodes) =>
    nodes.map((n) => {
      const title = n.querySelector(".timeline-body-title")?.textContent?.trim() || "";
      const timeText = n.querySelector(".timeline-body-time")?.textContent?.trim() || "";

      const contentEl = n.querySelector(".timeline-body-content");
      let body = "";
      if (contentEl) {
        const clone = contentEl.cloneNode(true);
        clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
        body = clone.textContent.replace(/\n{3,}/g, "\n\n").trim();
      }

      return { title, timeText, body };
    })
  );

  await browser.close();

  return announcements
    .filter((a) => a.body || a.title)
    .map((a) => {
      const { school, date } = parseTimelineTime(a.timeText);
      return {
        source: "MyChildAtSchool",
        poster: school,
        classContext: null,
        postDate: date,
        text: `${a.title}\n${a.body}`.trim(),
      };
    });
}

export async function fetchMcasItems() {
  if (!config.mcas.email || !config.mcas.password) {
    console.warn("[mcas] Skipping: no credentials in .env");
    return [];
  }

  try {
    return await scrapeOnce();
  } catch (err) {
    console.warn(`[mcas] First attempt failed (${err.message.split("\n")[0]}), retrying once...`);
    try {
      fs.unlinkSync(SESSION_PATH);
    } catch {}
    return await scrapeOnce();
  }
}
