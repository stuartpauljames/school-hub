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

// Some MCAS accounts (more than one child at the school) show a child
// switcher in the sidebar; single-child accounts don't. Returns [] when
// there's nothing to switch between, so that case is handled identically
// to before this existed.
async function getAvailableChildren(page) {
  const hasSelector = await page.locator("#StudentSelectorContainer").count();
  if (!hasSelector) return [];

  return page.$$eval('#StudentSelectorContainer li[data-studentid]', (nodes) =>
    nodes.map((li) => {
      const rawName = li.querySelector(".student-selector-stname")?.textContent?.trim() || "";
      // MCAS displays "Lastname, Firstname" -- take the part after the comma.
      const firstName = rawName.includes(",") ? rawName.split(",")[1].trim() : rawName;
      return {
        name: firstName,
        studentId: li.getAttribute("data-studentid"),
        schoolId: li.getAttribute("data-schoolid"),
      };
    })
  );
}

// Calls the page's own onClickStudentDropdownItem(schoolId, studentId, true)
// function directly (the same one each dropdown row's onclick uses) rather
// than simulating a click through the dropdown UI -- more reliable than
// fighting the dropdown's open/close animation and exact click coordinates.
// Confirmed this triggers a real page reload (a few seconds), not just an
// in-place AJAX update, so we wait for an actual navigation event.
async function switchToStudent(page, { studentId, schoolId }) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle", timeout: 15000 }).catch(() => {}),
    page.evaluate(
      ({ schoolId, studentId }) => {
        // eslint-disable-next-line no-undef -- defined by MCAS's own page script
        onClickStudentDropdownItem(schoolId, studentId, true);
      },
      { schoolId, studentId }
    ),
  ]);
  await page.waitForLoadState("networkidle").catch(() => {});
  // The outer page can finish loading before the announcements panel itself
  // has actually populated (the same timing gap solved for the very first
  // page load) -- wait for real content to appear rather than a fixed
  // delay, which isn't always enough after a client-side switch.
  await page.waitForSelector(".timeline-body", { timeout: 10000 }).catch(() => {});
}

async function scrapeCurrentTimeline(page) {
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

  return announcements
    .filter((a) => a.body || a.title)
    .map((a) => {
      const { school, date } = parseTimelineTime(a.timeText);
      return {
        poster: school,
        postDate: date,
        text: `${a.title}\n${a.body}`.trim(),
      };
    });
}

// Anything seen under more than one child's timeline is genuinely
// whole-school content (both children's accounts show it), so it gets
// tagged with no specific child rather than being duplicated once per
// child. Matched by exact text, since a shared announcement renders
// identically regardless of which child's timeline you're viewing it from.
function reconcileAcrossChildren(perChildResults) {
  const seenByChild = new Map(); // raw item text -> Set of child names (or [null] for a no-switcher single scrape)
  const itemByText = new Map();

  for (const { childName, items } of perChildResults) {
    for (const item of items) {
      if (!seenByChild.has(item.text)) seenByChild.set(item.text, new Set());
      seenByChild.get(item.text).add(childName);
      itemByText.set(item.text, item);
    }
  }

  const results = [];
  for (const [text, childrenSet] of seenByChild) {
    const item = itemByText.get(text);
    const seenByMultipleChildren = childrenSet.size > 1;
    results.push({
      source: "MyChildAtSchool",
      poster: item.poster,
      classContext: null,
      childName: seenByMultipleChildren ? null : [...childrenSet][0],
      postDate: item.postDate,
      text,
    });
  }
  return results;
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

  const children = await getAvailableChildren(page);
  const perChildResults = [];

  if (children.length === 0) {
    // No switcher present -- single-child account, scrape once as before.
    const items = await scrapeCurrentTimeline(page);
    perChildResults.push({ childName: null, items });
  } else {
    console.log(`[mcas] Found child switcher: ${children.map((c) => c.name).join(", ")}`);
    for (const child of children) {
      await switchToStudent(page, child);
      let items = await scrapeCurrentTimeline(page);

      if (items.length === 0) {
        // A genuine zero seems unlikely if a sibling's timeline has content
        // (whole-school posts should appear for both) -- more likely the
        // panel just hadn't finished loading yet. Give it one more real
        // chance before accepting zero as the actual answer.
        console.warn(`[mcas]   ${child.name}: 0 items, waiting and retrying once before accepting that...`);
        await page.waitForTimeout(3000);
        await page.waitForSelector(".timeline-body", { timeout: 8000 }).catch(() => {});
        items = await scrapeCurrentTimeline(page);
      }

      console.log(`[mcas]   ${child.name}: ${items.length} items`);
      perChildResults.push({ childName: child.name, items });
    }
  }

  await browser.close();

  return reconcileAcrossChildren(perChildResults);
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
