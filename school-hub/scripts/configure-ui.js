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
  return `<html><head><title>School Hub setup</title><meta name="viewport" content="width=device-width, initial-scale=1"><style>${STYLE}</style></head>
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
        <p class="lead">First, create a free Google OAuth Client ID so School Hub can write to your calendar on your behalf.</p>
        <ol style="color:#444; line-height:1.8; font-size:14px;">
          <li>Go to <a class="link" href="https://console.cloud.google.com" target="_blank">console.cloud.google.com</a></li>
          <li>Create a project (or use an existing one)</li>
          <li>Enable the "Google Calendar API"</li>
          <li>Create Credentials &rarr; OAuth Client ID &rarr; type "Desktop app"</li>
          <li>Add <code>${REDIRECT_URI}</code> as an authorized redirect URI</li>
        </ol>
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

// ---------- Step 2: pick a calendar ----------
app.get("/calendar", async (req, res) => {
  try {
    const client = new google.auth.OAuth2(state.googleClientId, state.googleClientSecret, REDIRECT_URI);
    client.setCredentials(JSON.parse(fs.readFileSync(tokenPath, "utf8")));
    const calendar = google.calendar({ version: "v3", auth: client });
    const { data } = await calendar.calendarList.list();
    const options = (data.items || [])
      .map((c) => `<option value="${c.id}">${c.summary}${c.primary ? " (main calendar)" : ""}</option>`)
      .join("");
    res.send(
      layout(
        "Choose a calendar",
        "Step 1 of 3 -- almost done",
        `
        <div class="card">
          <p class="lead">Google connected. Which calendar should school events be added to? (You can create a dedicated "School events" calendar in Google Calendar first if you'd rather keep it separate.)</p>
          <form method="POST" action="/calendar">
            <label>Calendar</label>
            <select name="calendarId" required>${options}</select>
            <button class="btn" type="submit">Continue</button>
          </form>
        </div>
      `
      )
    );
  } catch (err) {
    res.status(500).send(
      layout("Couldn't load your calendars", null, `<div class="card"><p>${err.message}</p><a class="btn secondary" href="/google">Start over</a></div>`)
    );
  }
});

app.post("/calendar", (req, res) => {
  state.calendarId = req.body.calendarId;
  res.redirect("/details");
});

// ---------- Step 3: everything else ----------
app.get("/details", (req, res) => {
  res.send(
    layout(
      "Household and school details",
      "Step 2 of 3",
      `
      <div class="card">
        <form method="POST" action="/details">
          <fieldset class="fieldset">
            <legend>Children</legend>
            <div class="hint">Helps School Hub attribute messages to the right child. Comma-separated.</div>
            <input type="text" name="children" placeholder="e.g. Olive, Edie">
          </fieldset>

          <fieldset class="fieldset">
            <legend>Classification</legend>
            <div class="hint">Free -- get a key at <a class="link" href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com/apikey</a>, no card needed.</div>
            <label>Gemini API key</label>
            <input type="text" name="geminiKey" required>
          </fieldset>

          <fieldset class="fieldset">
            <legend>Approval emails</legend>
            <div class="hint">Create an App Password at <a class="link" href="https://myaccount.google.com/apppasswords" target="_blank">myaccount.google.com/apppasswords</a> (needs 2-factor authentication on first).</div>
            <label>Your Gmail address</label>
            <input type="email" name="gmailAddress" required>
            <label>Gmail App Password</label>
            <input type="text" name="gmailAppPassword" required>
            <label>Send approvals to <span class="hint" style="display:inline;">(leave blank to use the address above)</span></label>
            <input type="email" name="notifyEmail">
          </fieldset>

          <fieldset class="fieldset">
            <legend>ClassDojo</legend>
            <div class="hint">Leave blank if you don't use it.</div>
            <label>Email</label>
            <input type="email" name="dojoEmail">
            <label>Password</label>
            <input type="password" name="dojoPassword">
          </fieldset>

          <fieldset class="fieldset">
            <legend>MyChildAtSchool</legend>
            <div class="hint">Leave blank if you don't use it.</div>
            <label>Email</label>
            <input type="email" name="mcasEmail">
            <label>Password</label>
            <input type="password" name="mcasPassword">
          </fieldset>

          <button class="btn" type="submit">Save and continue</button>
        </form>
      </div>
    `
    )
  );
});

app.post("/details", (req, res) => {
  const b = req.body;
  const env = `# Generated by the School Hub setup wizard on ${new Date().toISOString().slice(0, 10)}

HOUSEHOLD_CHILDREN=${b.children || ""}

GEMINI_API_KEY=${b.geminiKey}
AUTO_ADD_THRESHOLD=80

GOOGLE_CLIENT_ID=${state.googleClientId}
GOOGLE_CLIENT_SECRET=${state.googleClientSecret}
GOOGLE_CALENDAR_ID=${state.calendarId}

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
            Logs into each school app once, right now, and shows you exactly what happened. This is how you find out if a password was mistyped or a login isn't working -- while you can still see and fix it easily.
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
  res.send(runCommandPage("Installing background service...", "npm run install-service"));
});

app.post("/run-check", (req, res) => {
  res.send(runCommandPage("Running a test check (this can take up to a few minutes -- checking each app and classifying anything new)...", "npm run run-once"));
});

app.listen(PORT, () => {
  console.log(`\nSetup wizard running -- open this in your browser:\n\nhttp://localhost:${PORT}\n`);
});
