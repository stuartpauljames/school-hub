# School Hub

A personal aggregator that checks ClassDojo, ClassCharts, and MyChildAtSchool,
extracts calendar-worthy events with Gemini (free), and either adds them
straight to your Google Calendar (high confidence) or emails you an
approve/decline link (lower confidence). Runs entirely on your own computer
-- nothing is hosted anywhere else, and your school app passwords never
leave your machine.

Works on **Mac** (via `launchd`) and **Windows** (via Task Scheduler) --
`npm run install-service` detects your OS automatically.

## For other families using this

This is designed to be self-hosted: each family runs their own copy, with
their own credentials, on their own computer. The connectors are built
against ClassDojo, ClassCharts, and MyChildAtSchool themselves -- not
anything specific to one school -- so if your children's school uses these
same apps, this should work without needing to change any of the scraping
code. You'll just need to bring your own:
- A free Gemini API key
- Your own Google Cloud OAuth credentials (a few minutes to set up)
- Your own school app logins

Nothing here is a hosted service -- there's no shared server, and no one
else's data passes through anyone else's machine. Please don't run this
against school accounts you don't have a legitimate right to access.

## Before you start: read this

- **ClassDojo and MyChildAtSchool have no public API.** The connectors for
  them use Playwright to drive a real browser and log in as you. This is
  fragile by nature -- it can break when either site changes its UI.
- **Class Charts' parent login has reCAPTCHA protection** that can't
  reliably be automated. This connector instead logs in as each *child*,
  using their own pupil code + date of birth (the same login they'd use at
  school) -- ask your school for this if you don't already have it.
- **ClassDojo is exploring an official API/MCP server.** Worth signing up
  for early access at https://www.classdojo.com/classdojo-api-mcp/ -- if it
  ships, it should replace the ClassDojo connector with something far more
  reliable.
- **The Windows install path is newer and less battle-tested** than the Mac
  one -- the Mac version has been used and debugged against a real setup
  over several days; Windows support was built against documented behavior
  but hasn't had the same real-world mileage yet.
- Treat this as a personal tool for your own family. The moment it starts
  handling another family's children's data on your behalf (rather than
  each family running their own copy), different legal obligations apply.

## Quick setup

```
git clone <this repo>
cd school-hub
npm install
npx playwright install chromium
npm run setup              # interactive: asks for each credential
npm run authorize-google   # connects your Google Calendar (one-time)
npm run install-service    # sets everything running automatically
npm run doctor             # confirms everything is working
```

`npm run setup` writes your `.env` for you instead of hand-editing it.
`npm run install-service` detects whether you're on Mac or Windows and
installs the right kind of background service automatically -- on Mac this
handles correct file paths, macOS quarantine attributes, and cleaning up
any previous broken install; on Windows it registers two Task Scheduler
tasks (one running the check every 45 minutes, one keeping the approval
dashboard running continuously with automatic restart if it ever crashes).

Run `npm run doctor` any time something seems off -- it checks every common
failure point and tells you exactly what to fix, on either platform.

To stop everything: `npm run uninstall-service`.

## Fixing the scraper selectors (only if something breaks)

The CSS selectors in `src/connectors/classDojo.js` and
`src/connectors/mcas.js` are confirmed against real markup as of Sept 2026.
If either app changes its UI and a connector stops working, you'll need to
open the real page, use your browser's "Inspect Element" on the relevant
part of the page, and update the selectors marked with comments explaining
what to look for. This is the one part that can't be fully automated away,
regardless of platform.

## Approving/declining from your phone

Approval emails link to a local dashboard (`src/server.js`), kept running
continuously by the background service installed above. By default this
only works on your home network (`http://localhost:4173`). To
approve/decline from your phone while out and about, you have two options:
- **Simplest:** just wait until you're home and open the dashboard link then.
- **Full remote access:** run a free
  [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
  pointed at port 4173, and put the resulting public URL in
  `DASHBOARD_PUBLIC_URL` in `.env`. This exposes the dashboard to the
  internet, protected only by the obscurity of the URL -- fine for a personal
  tool, but worth knowing.

## Waking your computer from sleep (optional)

Background scheduling only fires while your computer is awake. On Mac, if
you want the scraper to run even when the lid's closed, and it's plugged
in, you can schedule a daily wake:
```
sudo pmset repeat wake MTWRFSU 07:00:00
```
(Windows machines generally stay more consistently awake/asleep based on
their own power settings; adjust those in Settings > System > Power if
needed.)

## Manual setup on Mac (advanced / without the wizard)

<details>
<summary>Expand for the step-by-step manual process</summary>

1. Copy `.env.example` to `.env` and fill in every value by hand
   (`chmod 600 .env` afterward).
2. `npm run authorize-google`
3. `npm run run-once` to test
4. To install the background services manually rather than via
   `npm run install-service`, you can call the platform module directly:
   ```
   node -e "import('./scripts/platform/mac.js').then(m => m.installMac(process.cwd()))"
   ```
   If this fails with a vague "Input/output error" from `launchctl`, the
   most common cause is a stale registration left over from an earlier
   attempt -- clear it first:
   ```
   launchctl bootout gui/$(id -u)/com.schoolhub.scraper
   launchctl bootout gui/$(id -u)/com.schoolhub.dashboard
   ```
   then retry.

</details>

## Project structure

```
school-hub/
  src/
    config.js              - loads .env
    store.js                - simple JSON-file store (seen items, pending approvals, log)
    classify.js              - sends raw text to Gemini, gets structured event + confidence
    calendarSync.js          - creates/updates Google Calendar events, categorized and color-coded
    notify.js                - sends the approval email
    server.js                - local dashboard + approve/decline links
    runOnce.js               - orchestrates one full check across all connectors
    connectors/
      classCharts.js         - via the classcharts-api npm package's StudentClient
      classDojo.js            - via Playwright browser automation
      mcas.js                 - via Playwright browser automation
  scripts/
    setup-wizard.js           - interactive .env creation
    authorize-google.js       - one-time Google OAuth setup
    install-service.js        - platform-detecting entry point
    uninstall-service.js      - platform-detecting entry point
    doctor.js                  - diagnostic health check (platform-aware)
    platform/
      mac.js                   - launchd install/uninstall logic
      windows.js                - Task Scheduler install/uninstall logic
  data/                        - all local state lives here (gitignored)
```

## Tuning the confidence threshold

`AUTO_ADD_THRESHOLD` in `.env` (default 80) controls the cutoff. Items scoring
at or above it go straight to your calendar; below it, you get an email.
After running for a week or two, check `data/added.json` against what
actually happened -- if auto-added events are ever wrong, raise the
threshold; if you're getting approval emails for things that were obviously
fine, you can lower it.
