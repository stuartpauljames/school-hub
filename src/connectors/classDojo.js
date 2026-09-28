// ClassDojo has no public parent API (they're exploring one -- see
// https://www.classdojo.com/classdojo-api-mcp/ -- worth switching to that
// once/if it ships). Until then this drives a real browser with Playwright.
//
// Selectors below are confirmed against real ClassDojo markup (Sept 2026) and
// deliberately avoid the hashed CSS-module classnames that change on
// ClassDojo's next deploy -- they key off `data-name` attributes and element
// structure instead, which are more likely to survive a redesign.
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { config } from "../config.js";
import { hashItem, isSeen } from "../store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const SESSION_PATH = path.join(DATA_DIR, "classdojo-session.json");

async function getContext(browser) {
  if (fs.existsSync(SESSION_PATH)) {
    return browser.newContext({ storageState: SESSION_PATH });
  }
  return browser.newContext();
}

async function login(page) {
  await page.goto("https://home.classdojo.com/#/login");
  await page.waitForLoadState("networkidle");

  // If the saved session is actually still valid, ClassDojo redirects the
  // login URL straight back to the feed instead of showing the form again.
  // Detect that and bail out cleanly rather than waiting forever for a
  // login field that will never appear.
  const alreadyLoggedIn = await page
    .locator('[data-name="storyPost"]')
    .first()
    .isVisible({ timeout: 3000 })
    .catch(() => false);
  if (alreadyLoggedIn) {
    console.log("[classDojo] Already logged in (redirected back to feed) -- skipping login form.");
    return;
  }

  try {
    await page.fill('[data-name="loginEmailInput"]', config.classDojo.email);
  } catch (err) {
    const screenshotPath = path.join(__dirname, "..", "..", "data", "classdojo-failure.png");
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    console.error(`[classDojo] Login failed -- screenshot saved to ${screenshotPath}`);
    throw err;
  }

  await page.waitForTimeout(800);
  await page.waitForSelector('[data-name="loginPasswordInput"]', { state: "attached" });

  await page.fill('[data-name="loginPasswordInput"]', config.classDojo.password);
  await page.click('[data-name="loginSubmitButton"]');
  await page.waitForSelector('[data-name="storyPost"]', { timeout: 15000 });
}

function parsePostDateFromTitle(title) {
  if (!title) return null;
  const datePart = title.split(",")[0].trim();
  const [day, month, year] = datePart.split("/");
  if (!day || !month || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export async function fetchClassDojoItems() {
  if (!config.classDojo.email || !config.classDojo.password) {
    console.warn("[classDojo] Skipping: no credentials in .env");
    return [];
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await getContext(browser);
    const page = await context.newPage();

    const isLoggedIn = await page
      .goto("https://home.classdojo.com/#/story")
      .then(() => page.locator('[data-name="storyPost"]').first().isVisible({ timeout: 12000 }))
      .catch(() => false);

    if (!isLoggedIn) {
      await login(page);
      await context.storageState({ path: SESSION_PATH });
    }

    // Every post, whatever its type, has a header -- so find posts by that and
    // take its parent as the post's container. That covers ordinary text posts
    // AND ClassDojo's separate "calendar event" post type, which isn't wrapped
    // in the same [data-name="storyPost"] element.
    // Give the feed a moment to finish rendering -- a post's header can appear
    // before the rest of its content (e.g. a calendar-event card) has filled in.
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(1500);

    const posts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-name="storyPostHeader"]')).map((header) => {
        const post = header.parentElement;
        const poster = header.querySelector("h3")?.textContent?.trim() || null;

        const spans = Array.from(header.querySelectorAll("span.nessie-text"));
        const classContext =
          spans.find((s) => !s.hasAttribute("title"))?.textContent?.trim() || null;
        const timestampTitle = spans.find((s) => s.hasAttribute("title"))?.getAttribute("title");

        const bodyEl = post.querySelector('[data-name="richText"]');
        let text = "";
        if (bodyEl) {
          const clone = bodyEl.cloneNode(true);
          clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
          text = clone.textContent.replace(/\n{3,}/g, "\n\n").trim();
        }

        // A calendar-event post has a "See details" button rather than a text
        // body. Its card holds a label ("MULTI-DAY"), the title (an h2), and
        // the date range in the element right after the title.
        let event = null;
        const cta = post.querySelector('a[data-name="eventSignupCTA"]');
        if (cta) {
          const h2 = post.querySelector("h2");
          const next = h2?.nextElementSibling;
          event = {
            href: cta.getAttribute("href"),
            title: h2?.textContent?.trim() || "",
            label: post.querySelector('[data-name="formattedDate"]')?.textContent?.trim() || "",
            when: next && next !== cta ? next.textContent.trim() : "",
          };
        }

        const preview = (post.innerText || post.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
        return { poster, classContext, timestampTitle, text, event, preview };
      })
    );

    const items = [];
    const eventsThisRun = new Set();
    const needDetails = [];

    for (const p of posts) {
      const base = {
        source: "ClassDojo",
        poster: p.poster,
        classContext: p.classContext,
        postDate: parsePostDateFromTitle(p.timestampTitle),
      };

      if (!p.event) {
        if (p.text) items.push({ ...base, text: p.text });
        continue;
      }

      if (!p.event.title) continue;
      const eventId = p.event.href ? p.event.href.split("/").filter(Boolean).pop() : null;
      // Identity comes from ClassDojo's own event id, not from the text -- the
      // details page may or may not be readable on a given run, and that must
      // never make the same event look like a new one.
      const dedupeKey = eventId ? `dojo-event:${eventId}` : `dojo-event-title:${p.event.title}`;
      if (eventsThisRun.has(dedupeKey)) continue;
      eventsThisRun.add(dedupeKey);

      const item = {
        ...base,
        kind: "event-card",
        eventTitle: p.event.title,
        dedupeKey,
        text: buildEventText(p, ""),
      };
      items.push(item);
      // Only open the details page for events not already processed, so a
      // normal run doesn't navigate to every known event every 45 minutes.
      if (p.event.href && !isSeen(hashItem("ClassDojo", dedupeKey))) {
        needDetails.push({ item, post: p, eventId });
      }
    }

    const ordinary = posts.filter((p) => !p.event && p.text);
    const events = posts.filter((p) => p.event);
    const skipped = posts.filter((p) => !p.event && !p.text);
    console.log(
      `[classDojo] Feed has ${posts.length} posts: ${ordinary.length} with text, ` +
        `${events.length} calendar event(s), ${skipped.length} with neither`
    );
    for (const p of events) {
      console.log(`[classDojo]   calendar event: "${p.event.title}" (${p.event.when || "no date shown"})`);
    }
    for (const p of skipped) {
      console.log(`[classDojo]   skipped (no text): ${p.poster} | ${p.classContext} | ${p.timestampTitle} | "${p.preview}"`);
    }

    // Done reading the feed -- now follow each new event's "See details"
    // button. Done as a second pass because navigating away would invalidate
    // everything read from the feed above.
    for (const { item, post, eventId } of needDetails) {
      const detail = await fetchEventDetails(page, post.event, eventId);
      if (detail) {
        item.text = buildEventText(post, detail);
        console.log(
          `[classDojo]   read details for "${post.event.title}" (${detail.length} chars): "${detail.replace(/\s+/g, " ").slice(0, 100)}"`
        );
      }
    }

    return items;
  } finally {
    // Always close the browser, even if something above threw.
    await browser.close().catch(() => {});
  }
}

function buildEventText({ event, text }, detailText) {
  return [
    `ClassDojo calendar event: ${event.title}`,
    event.label && `Date label: ${event.label}`,
    event.when && `When: ${event.when}`,
    text,
    detailText && `Details from the event page:\n${detailText}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// Opens the same address the "See details" button links to. Nothing about
// the event page's own markup has been inspected yet, so this reads it
// defensively and treats "couldn't read it" as a normal outcome (the card
// alone already has the title and dates). It saves a screenshot and the
// page's HTML to data/ the first time it sees each event, so the extraction
// can be tightened against the real page.
async function fetchEventDetails(page, event, eventId) {
  try {
    const url = new URL(event.href, "https://home.classdojo.com/").toString();
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500); // let the single-page app render the event view

    const detail = await page.evaluate((title) => {
      for (const selector of ['[role="dialog"]', '[aria-modal="true"]', "main"]) {
        const el = document.querySelector(selector);
        if (!el) continue;
        // If this container holds feed posts it's the feed, not the event.
        if (el.querySelector('[data-name="storyPostHeader"]')) continue;
        const text = (el.innerText || "").trim();
        if (text && text.toLowerCase().includes(title.toLowerCase())) {
          return { text: text.slice(0, 3000), html: el.outerHTML };
        }
      }
      return null;
    }, event.title);

    await saveEventSnapshot(page, eventId, detail?.html);
    if (!detail) {
      console.warn(`[classDojo] Couldn't read the details page for "${event.title}" -- using the card alone`);
      return null;
    }
    return detail.text;
  } catch (err) {
    console.warn(`[classDojo] Couldn't open details for "${event.title}": ${err.message.split("\n")[0]}`);
    return null;
  }
}

async function saveEventSnapshot(page, eventId, html) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const base = path.join(DATA_DIR, `classdojo-event-${eventId || "unknown"}`);
    if (!fs.existsSync(`${base}.png`)) await page.screenshot({ path: `${base}.png` });
    if (!fs.existsSync(`${base}.html`)) {
      const source = html ?? (await page.evaluate(() => document.body.outerHTML));
      // Strip embedded images (huge, and not needed to work out selectors).
      fs.writeFileSync(`${base}.html`, source.replace(/data:[^"')\s]{50,}/g, "data:...").slice(0, 300000));
    }
  } catch {
    // A missing debug snapshot must never break a real run.
  }
}
