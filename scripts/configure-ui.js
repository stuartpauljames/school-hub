// A friendlier alternative to `npm run setup`: opens a local web page that
// walks through the same setup as a series of simple forms, including a
// real dropdown of your actual Google Calendars to pick from (rather than
// pasting in a calendar ID), and buttons to install the background service
// and run a first test check without leaving the browser.
//
// Everything here runs on your own machine and only your own machine --
// this is the same self-hosted model as the rest of School Hub, just with
// a nicer front end than typing into a terminal.
import express from "express";
import fs from "fs";
import path from "path";
import { google } from "googleapis";
import nodemailer from "nodemailer";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");
const envPath = path.join(projectRoot, ".env");
const tokenPath = path.join(projectRoot, "data", "google-token.json");
const PORT = 4175;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

// In-memory only -- this is a single local session for one setup run, not a
// real server with multiple users.
const state = {
  googleClientId: "",
  googleClientSecret: "",
  calendarId: "primary",
  calendarName: "",
};

const app = express();
app.use(express.urlencoded({ extended: true }));

app.get("/favicon.svg", (req, res) => {
  res.type("image/svg+xml");
  res.sendFile(path.join(projectRoot, "favicon.svg"));
});

function getAuthedCalendarClient() {
  const client = new google.auth.OAuth2(state.googleClientId, state.googleClientSecret, REDIRECT_URI);
  client.setCredentials(JSON.parse(fs.readFileSync(tokenPath, "utf8")));
  return google.calendar({ version: "v3", auth: client });
}

// Creates a calendar with this exact name, or reuses one that already has
// it -- so re-running the wizard later (e.g. to add a second child) doesn't
// create duplicate calendars for names already in use.
async function createOrGetCalendarByName(name) {
  const calendar = getAuthedCalendarClient();
  const { data } = await calendar.calendarList.list();
  const existing = (data.items || []).find(
    (c) => c.summary?.trim().toLowerCase() === name.trim().toLowerCase()
  );
  if (existing) return existing.id;

  const { data: created } = await calendar.calendars.insert({ requestBody: { summary: name } });
  return created.id;
}

const STYLE = `
  :root { --ink: #1b2a4a; --parchment: #faf7f0; --card: #ffffff; --slate: #6b7280; --rule: #e5e0d5; --accent: #4f46e5; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--parchment); color: var(--ink); margin: 0; padding: 48px 24px 80px; }
  .wrap { max-width: 560px; margin: 0 auto; }
  h1 { font-size: 24px; margin: 0 0 6px; }
  .step { font-size: 13px; color: var(--slate); margin-bottom: 24px; }
  p.lead { color: #444; line-height: 1.6; }
  label { display: block; font-size: 13.5px; font-weight: 600; margin: 18px 0 6px; }
  label .hint { font-weight: 400; color: var(--slate); display: block; margin-top: 2px; }
  input[type=text], input[type=email], input[type=password], select {
    width: 100%; padding: 10px 12px; border: 1px solid var(--rule); border-radius: 6px; font-size: 14px; background: white;
  }
  .btn { display: inline-block; background: var(--accent); color: white; border: none; padding: 11px 22px; border-radius: 6px; font-size: 14.5px; font-weight: 600; cursor: pointer; text-decoration: none; margin-top: 24px; }
  .btn.secondary { background: white; color: var(--ink); border: 1px solid var(--rule); }
  .card { background: var(--card); border: 1px solid var(--rule); border-radius: 8px; padding: 24px 28px; }
  .note { background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 12px 14px; font-size: 13px; color: #92400e; margin: 16px 0; }
  a.link { color: var(--accent); }
  pre { background: #1b2a4a; color: #e5e0d5; padding: 16px; border-radius: 6px; font-size: 12.5px; overflow-x: auto; white-space: pre-wrap; }
  .fieldset { border: none; padding: 0; margin: 28px 0 0; border-top: 1px solid var(--rule); padding-top: 18px; }
  .fieldset legend { font-size: 14px; font-weight: 600; padding: 0; }
  .fieldset .hint { font-size: 12.5px; color: var(--slate); margin-bottom: 10px; }
`;

function layout(title, step, body) {
  return `<html><head><title>School Hub setup</title><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" type="image/svg+xml" href="/favicon.svg"><style>${STYLE}</style></head>
  <body><div class="wrap">
    ${step ? `<div class="step">${step}</div>` : ""}
    <h1>${title}</h1>
    ${body}
  </div></body></html>`;
}

// ---------- Step 0: welcome ----------
app.get("/", (req, res) => {
  const existing = fs.existsSync(envPath)
    ? `<div class="note">A .env file already exists. Continuing will overwrite it once you finish this wizard.</div>`
    : "";
  res.send(
    layout(
      "Set up School Hub",
      null,
      `
      <div class="card">
        <p class="lead">This will connect your Google Calendar, add your school app logins, and get everything running in the background. Takes about 10 minutes.</p>
        <p class="lead">Detected platform: <strong>${process.platform === "darwin" ? "Mac" : process.platform === "win32" ? "Windows" : process.platform}</strong> -- no need to choose, the right background service gets installed automatically at the end.</p>
        <div class="note">Keep this terminal window open until you reach the very last screen. This page stops working the moment that window closes or gets reused for another command.</div>
        ${existing}
        <a class="btn" href="/google">Get started</a>
      </div>
    `
    )
  );
});

// ---------- Step 1: Google OAuth client ----------
app.get("/google", (req, res) => {
  res.send(
    layout(
      "Connect Google Calendar",
      "Step 1 of 3",
      `
      <div class="card">
        <p class="lead">First, set up a free Google Cloud project so School Hub can write to your calendar. Takes about 10 minutes, no credit card needed.</p>
        <ol style="color:#444; line-height:1.8; font-size:14px;">
          <li>Go to <a class="link" href="https://console.cloud.google.com" target="_blank">console.cloud.google.com</a>, create a project, and enable the "Google Calendar API"</li>
          <li>Go to <strong>OAuth consent screen</strong>, click "Get started", and fill in an app name, your email, and audience "External"</li>
          <li>Under <strong>Audience &rarr; Test users</strong>, add the Gmail address whose calendar you want events added to</li>
          <li>Under <strong>Branding &rarr; App domain</strong>, put any URL in both the homepage and privacy policy fields (a GitHub repo link works fine for a personal app) -- Google won't let you continue without them</li>
          <li>Under <strong>Audience</strong>, click <strong>Publish app</strong> and confirm -- this matters: if left in "Testing," Google cancels the connection every 7 days without telling you</li>
          <li>Go to <strong>Clients &rarr; Create client</strong>, type "Desktop app", and copy the Client ID and secret below (Desktop app clients don't need a redirect URI -- ignore any prompt asking for one)</li>
        </ol>
        <p class="lead" style="font-size:13px; color:var(--slate);">
          Full step-by-step with screenshots-worth of detail: see
          <a class="link" href="https://github.com/stuartpauljames/school-hub/blob/main/GOOGLE_CALENDAR_SETUP.md" target="_blank">GOOGLE_CALENDAR_SETUP.md</a>
          in the repo.
        </p>
        <div class="note">
          <strong>Right after you click "Connect" below</strong>, Google will show a
          red warning screen: "Google hasn't verified this app." This is expected --
          it just means you (not a company) built this, and it's exactly what you'd
          see for any personal project like this one. Click <strong>Advanced</strong>,
          then <strong>Go to School Hub (unsafe)</strong>, then <strong>Continue</strong>.
          "Unsafe" here just means Google hasn't reviewed it, not that anything's
          actually wrong.
        </div>
        <form method="POST" action="/google">
          <label>Client ID</label>
          <input type="text" name="clientId" required>
          <label>Client Secret</label>
          <input type="text" name="clientSecret" required>
          <button class="btn" type="submit">Connect Google Calendar</button>
        </form>
      </div>
    `
    )
  );
});

app.post("/google", (req, res) => {
  state.googleClientId = req.body.clientId.trim();
  state.googleClientSecret = req.body.clientSecret.trim();
  res.redirect("/connect-google");
});

app.get("/connect-google", (req, res) => {
  const client = new google.auth.OAuth2(state.googleClientId, state.googleClientSecret, REDIRECT_URI);
  const url = client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/calendar"],
    prompt: "consent",
  });
  res.redirect(url);
});

app.get("/oauth2callback", async (req, res) => {
  try {
    const client = new google.auth.OAuth2(state.googleClientId, state.googleClientSecret, REDIRECT_URI);
    const { tokens } = await client.getToken(req.query.code);
    fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
    fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
    res.redirect("/calendar");
  } catch (err) {
    res.status(500).send(
      layout("Something went wrong", null, `<div class="card"><p>${err.message}</p><a class="btn secondary" href="/google">Try again</a></div>`)
    );
  }
});

// ---------- Step 2: name the general (catch-all) calendar ----------
app.get("/calendar", async (req, res) => {
  res.send(
    layout(
      "Create a general school calendar",
      "Step 1 of 3 -- almost done",
      `
      <div class="card">
        <p class="lead">Google connected. School Hub will create a dedicated calendar for anything that isn't matched to one specific child's class or year group -- genuine whole-school events, but also anything ambiguous or from a class you haven't set up separately. This keeps school events separate from your own personal calendar entirely.</p>
        <form method="POST" action="/calendar">
          <label>Calendar name</label>
          <input type="text" name="calendarName" placeholder="e.g. General School Events" required>
          <button class="btn" type="submit">Create and continue</button>
        </form>
      </div>
    `
    )
  );
});

app.post("/calendar", async (req, res) => {
  try {
    state.calendarId = await createOrGetCalendarByName(req.body.calendarName.trim());
    res.redirect("/details");
  } catch (err) {
    res.status(500).send(
      layout("Couldn't create that calendar", null, `<div class="card"><p>${err.message}</p><a class="btn secondary" href="/calendar">Try again</a></div>`)
    );
  }
});

// ---------- Step 3: everything else ----------
function renderDetailsForm(values = {}, error = null) {
  const v = (name) => values[name] || "";

  // The child rows are entered dynamically via JS (add one at a time, or
  // remove one), so the server only ever renders the *shape* of a row here
  // -- real values (if re-rendering after a validation error) get filled
  // back in by the same script using JSON embedded in the page.
  const existingChildren = JSON.stringify(values.children || [{ name: "", class: "" }]);

  return layout(
    "Household and school details",
    "Step 2 of 3",
    `
      <div class="card">
        ${error ? `<div class="note">${error}</div>` : ""}
        <form method="POST" action="/details" id="detailsForm">
          <fieldset class="fieldset">
            <legend>Children</legend>
            <div class="hint">
              Add each child one at a time. School Hub creates a dedicated calendar
              named after each class (or reuses one that already has that name), and
              routes that child's events there. The child's name is only used
              internally to match messages to the right child -- it's never shown
              anywhere a parent would see it.
            </div>
            <div id="childRows"></div>
            <button type="button" class="btn secondary" id="addChildBtn" style="margin-top:4px;">+ Add another child</button>
          </fieldset>

          <fieldset class="fieldset">
            <legend>Classification</legend>
            <div class="hint">Free -- get a key at <a class="link" href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a>, no card needed.</div>
            <label>Gemini API key</label>
            <input type="text" name="geminiKey" value="${v("geminiKey")}" required>
          </fieldset>

          <fieldset class="fieldset">
            <legend>Approval emails</legend>
            <div class="hint">Create an App Password at <a class="link" href="https://myaccount.google.com/apppasswords" target="_blank">myaccount.google.com/apppasswords</a> (needs 2-factor authentication on first). This is checked before you continue -- your normal Gmail password won't work here.</div>
            <label>Your Gmail address</label>
            <input type="email" name="gmailAddress" value="${v("gmailAddress")}" required>
            <label>Gmail App Password</label>
            <input type="text" name="gmailAppPassword" value="${v("gmailAppPassword")}" required>
            <label>Send approvals to <span class="hint" style="display:inline;">(leave blank to use the address above)</span></label>
            <input type="email" name="notifyEmail" value="${v("notifyEmail")}">
          </fieldset>

          <fieldset class="fieldset">
            <legend>ClassDojo</legend>
            <div class="hint">Leave blank if you don't use it.</div>
            <label>Email</label>
            <input type="email" name="dojoEmail" value="${v("dojoEmail")}">
            <label>Password</label>
            <input type="password" name="dojoPassword" value="${v("dojoPassword")}">
          </fieldset>

          <fieldset class="fieldset">
            <legend>MyChildAtSchool</legend>
            <div class="hint">Leave blank if you don't use it.</div>
            <label>Email</label>
            <input type="email" name="mcasEmail" value="${v("mcasEmail")}">
            <label>Password</label>
            <input type="password" name="mcasPassword" value="${v("mcasPassword")}">
          </fieldset>

          <button class="btn" type="submit">Save and continue</button>
        </form>
      </div>

      <script>
        const EXISTING_CHILDREN = ${existingChildren};
        let childIndex = 0;

        function addChildRow(prefill) {
          const i = childIndex++;
          const wrap = document.createElement('div');
          wrap.style.cssText = 'border:1px solid var(--rule); border-radius:6px; padding:14px; margin-bottom:10px;';
          wrap.innerHTML =
            '<label>Child\\'s name</label>' +
            '<input type="text" name="children[' + i + '][name]" placeholder="e.g. Olive" value="' + (prefill?.name || '') + '">' +
            '<label>Class <span class="hint" style="display:inline;">(this becomes the calendar\\'s name, so use whatever you\\'d want other parents to see)</span></label>' +
            '<input type="text" name="children[' + i + '][class]" placeholder="e.g. Nightingale Class 26/27" value="' + (prefill?.class || '') + '" required>' +
            '<label>Year group <span class="hint" style="display:inline;">(optional -- catches messages that say "Year 4" rather than the class name, common on MyChildAtSchool)</span></label>' +
            '<input type="text" name="children[' + i + '][yearGroup]" placeholder="e.g. Year 4" value="' + (prefill?.yearGroup || '') + '">' +
            '<button type="button" class="btn secondary" style="margin-top:8px; font-size:12.5px; padding:5px 12px;" onclick="this.parentElement.remove()">Remove this child</button>';
          document.getElementById('childRows').appendChild(wrap);
        }

        EXISTING_CHILDREN.forEach(addChildRow);
        document.getElementById('addChildBtn').addEventListener('click', () => addChildRow());
      </script>
    `
  );
}

app.get("/details", (req, res) => {
  res.send(renderDetailsForm());
});

app.post("/details", async (req, res) => {
  const b = req.body;

  // Check the Gmail App Password actually works before writing it to .env
  // and moving on -- otherwise this doesn't surface as a problem until a
  // background run crashes on it later, by which point it's much less
  // obvious what went wrong.
  try {
    const testTransport = nodemailer.createTransport({
      service: "gmail",
      auth: { user: b.gmailAddress, pass: b.gmailAppPassword },
    });
    await testTransport.verify();
  } catch (err) {
    return res.send(
      renderDetailsForm(
        b,
        `Couldn't sign in to Gmail with those details: ${err.message}. ` +
          `Make sure you're using an App Password (16 letters, no spaces) from ` +
          `<a class="link" href="https://myaccount.google.com/apppasswords" target="_blank">myaccount.google.com/apppasswords</a>, ` +
          `not your normal Gmail password.`
      )
    );
  }

  // req.body.children arrives as an array of {name, class} thanks to
  // express's bracket-notation parsing (children[0][name] etc). Filter out
  // any fully-empty rows (e.g. if someone clicked "Add" and didn't fill it in).
  const children = (Array.isArray(b.children) ? b.children : [b.children].filter(Boolean)).filter(
    (c) => c && c.name && c.name.trim()
  );

  const missingClass = children.find((c) => !c.class || !c.class.trim());
  if (missingClass) {
    return res.send(
      renderDetailsForm(b, `${missingClass.name} needs a class name -- it's used to name that child's calendar.`)
    );
  }

  const householdChildrenLine = children.map((c) => c.name.trim()).join(", ");

  // Actually create (or reuse, if a calendar with that exact name already
  // exists -- e.g. re-running this wizard to add a second child) a real
  // calendar for each child, named after their class.
  let mappedChildren;
  try {
    mappedChildren = await Promise.all(
      children.map(async (c) => ({
        name: c.name.trim(),
        class: c.class.trim(),
        yearGroup: c.yearGroup ? c.yearGroup.trim() : "",
        calendarId: await createOrGetCalendarByName(c.class.trim()),
      }))
    );
  } catch (err) {
    return res.send(
      renderDetailsForm(b, `Couldn't create a calendar for one of the children: ${err.message}`)
    );
  }

  const childCalendarComments = mappedChildren.map((c) => `# ${c.name} -> ${c.class}`).join("\n");
  const childCalendarsValue = mappedChildren.map((c) => `${c.name}:${c.calendarId}`).join(";");
  // Same calendars, but also keyed by class name -- this is what lets a
  // message that names the class ("Nightingale Class parents") route
  // correctly even when it never mentions a specific child.
  const classCalendarsValue = mappedChildren.map((c) => `${c.class}:${c.calendarId}`).join(";");
  // And keyed by year group too, when given -- catches messages (common on
  // MyChildAtSchool) that say "Year 4" rather than the class's actual name.
  const yearGroupCalendarsValue = mappedChildren
    .filter((c) => c.yearGroup && c.yearGroup.trim())
    .map((c) => `${c.yearGroup.trim()}:${c.calendarId}`)
    .join(";");

  const env = `# Generated by the School Hub setup wizard on ${new Date().toISOString().slice(0, 10)}

HOUSEHOLD_CHILDREN=${householdChildrenLine}

GEMINI_API_KEY=${b.geminiKey}
AUTO_ADD_THRESHOLD=80

GOOGLE_CLIENT_ID=${state.googleClientId}
GOOGLE_CLIENT_SECRET=${state.googleClientSecret}
GOOGLE_CALENDAR_ID=${state.calendarId}

${childCalendarComments ? childCalendarComments + "\n" : ""}CHILD_CALENDARS=${childCalendarsValue}
CLASS_CALENDARS=${classCalendarsValue}
YEAR_GROUP_CALENDARS=${yearGroupCalendarsValue}
WHOLE_SCHOOL_CALENDAR_ID=

GMAIL_ADDRESS=${b.gmailAddress}
GMAIL_APP_PASSWORD=${b.gmailAppPassword}
NOTIFY_EMAIL=${b.notifyEmail || b.gmailAddress}

DASHBOARD_PORT=4173
DASHBOARD_PUBLIC_URL=

CLASSCHARTS_STUDENTS=

CLASSDOJO_EMAIL=${b.dojoEmail || ""}
CLASSDOJO_PASSWORD=${b.dojoPassword || ""}

MCAS_SCHOOL_ID=
MCAS_EMAIL=${b.mcasEmail || ""}
MCAS_PASSWORD=${b.mcasPassword || ""}
`;
  fs.writeFileSync(envPath, env, { mode: 0o600 });
  res.redirect("/done");
});

// ---------- Step 4: install + test, without leaving the browser ----------
app.get("/done", (req, res) => {
  res.send(
    layout(
      "All set",
      "Step 3 of 3",
      `
      <div class="card">
        <p class="lead">Your details are saved. Two steps left -- do them in this order.</p>

        <div style="border: 1px solid var(--rule); border-radius: 8px; padding: 18px 20px; margin-top: 20px;">
          <div style="font-size: 13px; font-weight: 700; color: var(--accent); margin-bottom: 4px;">STEP 1 -- DO THIS FIRST</div>
          <p style="margin: 0 0 4px; font-weight: 600;">Run a test check</p>
          <p style="margin: 0 0 14px; font-size: 13.5px; color: var(--slate); line-height: 1.5;">
            Logs into each school app once, right now, and shows you exactly what happened -- this is how you find out if a password was mistyped or a login isn't working, while you can still see and fix it easily. It also sends you a test email straight away: if that arrives in your inbox, your email setup is confirmed working.
          </p>
          <form method="POST" action="/run-check">
            <button class="btn" type="submit">Run a test check now</button>
          </form>
        </div>

        <div style="border: 1px solid var(--rule); border-radius: 8px; padding: 18px 20px; margin-top: 14px;">
          <div style="font-size: 13px; font-weight: 700; color: var(--slate); margin-bottom: 4px;">STEP 2 -- ONCE THE TEST LOOKS GOOD</div>
          <p style="margin: 0 0 4px; font-weight: 600;">Install the background service</p>
          <p style="margin: 0 0 14px; font-size: 13.5px; color: var(--slate); line-height: 1.5;">
            Sets everything running automatically every 45 minutes from now on, with no further action needed. Do this after the test check above has run cleanly, not before -- that way you're not troubleshooting a service that's already running unattended.
          </p>
          <form method="POST" action="/run-install">
            <button class="btn secondary" type="submit">Install background service</button>
          </form>
        </div>

        <p class="lead" style="margin-top:24px; font-size:13px; color:var(--slate);">
          Prefer the terminal instead? Run <code>npm run run-once</code> then <code>npm run install-service</code>.
        </p>
      </div>
    `
    )
  );
});

function runCommandPage(title, command) {
  let output;
  try {
    output = execSync(command, {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180000, // 3 minutes -- long enough for a real check, short enough not to leave the browser hanging forever
    });
  } catch (err) {
    if (err.signal === "SIGTERM" || err.code === "ETIMEDOUT") {
      output =
        (err.stdout || "") +
        "\n\n--- Timed out after 3 minutes ---\nThis was stopped automatically rather than leaving the page loading forever. " +
        "Check the terminal where 'npm run configure' is running, or the data/*.log files, for what it was doing when it was stopped.";
    } else {
      output = (err.stdout || "") + (err.stderr || "") + `\n\nExit code: ${err.status}`;
    }
  }
  return layout(
    title,
    null,
    `<div class="card"><pre>${output.replace(/</g, "&lt;")}</pre><a class="btn" href="/done">Back</a></div>`
  );
}

function looksLikeTestFolder() {
  return /test/i.test(projectRoot);
}

app.post("/run-install", (req, res) => {
  if (looksLikeTestFolder() && req.query.confirmed !== "1") {
    return res.send(
      layout(
        "Wait -- this looks like a test folder",
        null,
        `
        <div class="card">
          <p class="lead">This folder's path (<code>${projectRoot}</code>) looks like a test copy, not your main install.</p>
          <p class="lead">Installing the background service here can silently take over your real setup's services if you already have School Hub running elsewhere -- both installs use the same service names, so whichever one installs last "wins."</p>
          <p class="lead">If this genuinely is where you want School Hub to live permanently, go ahead. Otherwise, go back and run this from your real project folder instead.</p>
          <form method="POST" action="/run-install?confirmed=1">
            <button class="btn" type="submit">Install anyway</button>
          </form>
          <a class="btn secondary" href="/done">Cancel</a>
        </div>
      `
      )
    );
  }

  let output;
  try {
    output = execSync("npm run install-service", {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
    });
  } catch (err) {
    output = (err.stdout || "") + (err.stderr || "") + `\n\nExit code: ${err.status}`;
  }

  const succeeded = !output.includes("❌");
  const escapedOutput = output.replace(/</g, "&lt;");

  if (!succeeded) {
    // Something went wrong -- show the raw output so it can actually be
    // fixed, rather than redirecting to a dashboard that may not be
    // running correctly.
    return res.send(
      layout(
        "Installing background service...",
        null,
        `<div class="card"><pre>${escapedOutput}</pre><a class="btn" href="/done">Back</a></div>`
      )
    );
  }

  const dashboardPort = readEnvValue("DASHBOARD_PORT") || "4173";
  const dashboardUrl = `http://localhost:${dashboardPort}/?installed=1`;

  res.send(
    layout(
      "All set",
      null,
      `
      <div class="card" style="text-align:center;">
        <div style="font-size:40px;margin-bottom:8px;">✅</div>
        <p class="lead">Everything's installed and running in the background.</p>
        <p class="lead" style="font-size:13px;color:var(--slate);">Taking you to your dashboard in a moment...</p>
        <a class="btn" href="${dashboardUrl}">Go there now</a>
        <details style="margin-top:24px; text-align:left;">
          <summary style="cursor:pointer; color:var(--slate); font-size:13px;">Show install details</summary>
          <pre>${escapedOutput}</pre>
        </details>
      </div>
      <script>
        setTimeout(() => { window.location.href = ${JSON.stringify(dashboardUrl)}; }, 2500);
      </script>
    `
    )
  );
});

function readEnvValue(key) {
  if (!fs.existsSync(envPath)) return "";
  const line = fs
    .readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : "";
}

app.post("/run-check", async (req, res) => {
  let emailStatus;
  try {
    const testTransport = nodemailer.createTransport({
      service: "gmail",
      auth: { user: readEnvValue("GMAIL_ADDRESS"), pass: readEnvValue("GMAIL_APP_PASSWORD") },
    });
    await testTransport.sendMail({
      from: readEnvValue("GMAIL_ADDRESS"),
      to: readEnvValue("NOTIFY_EMAIL") || readEnvValue("GMAIL_ADDRESS"),
      subject: "School Hub test email",
      html: `<p>This is a test email from School Hub's setup wizard.</p><p>If you're reading this, your email setup works -- real approval emails will look like this but with an actual event and Approve/Decline links.</p>`,
    });
    emailStatus = "✅ Test email sent -- check your inbox.\n\n";
  } catch (err) {
    emailStatus = `❌ Test email failed to send: ${err.message}\n\n`;
  }

  const checkOutput = runCommandPage(
    "Test check results",
    "npm run run-once"
  );
  // Prepend the guaranteed email-send result to the real check's output,
  // rather than only hoping the real check happens to trigger an email --
  // it might not, if there's simply nothing new to review right now.
  res.send(checkOutput.replace("<pre>", `<pre>${emailStatus}`));
});

app.listen(PORT, () => {
  console.log(`\nSetup wizard running -- open this in your browser:\n\nhttp://localhost:${PORT}\n`);
});
