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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SESSION_PATH = path.join(__dirname, "..", "..", "data", "classdojo-session.json");

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

  const posts = await page.$$eval('div[data-name="storyPost"]', (nodes) =>
    nodes.map((post) => {
      const header = post.querySelector('[data-name="storyPostHeader"]');
      const poster = header?.querySelector("h3")?.textContent?.trim() || null;

      const spans = Array.from(header?.querySelectorAll("span.nessie-text") || []);
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

      return { poster, classContext, timestampTitle, text };
    })
  );

  await browser.close();

  return posts
    .filter((p) => p.text)
    .map((p) => ({
      source: "ClassDojo",
      poster: p.poster,
      classContext: p.classContext,
      postDate: parsePostDateFromTitle(p.timestampTitle),
      text: p.text,
    }));
}
