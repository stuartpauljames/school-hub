# School Hub

A personal aggregator that checks ClassDojo and MyChildAtSchool, extracts
calendar-worthy events with Gemini (free), and either adds them straight to
your Google Calendar (high confidence) or emails you an approve/decline
link (lower confidence). Runs entirely on your own computer -- nothing is
hosted anywhere else, and your school app passwords never leave your
machine.

A Class Charts connector also exists (`src/connectors/classCharts.js`) but
isn't part of the guided setup wizard -- see "Adding Class Charts by hand"
below if you want it.

**New to this, or setting it up for someone else?** Open `SETUP.md` instead
-- it's a plain-English walkthrough of the same setup, written for someone
who isn't necessarily comfortable in a terminal. This file covers the same
ground more tersely (for anyone already comfortable with git/npm), plus
everything SETUP.md leaves out: architecture, troubleshooting, adding Class
Charts, and every other advanced option.

Works on **Mac** (via `launchd`) and **Windows** (via Task Scheduler) --
`npm run install-service` detects your OS automatically.

## For other families using this

This is designed to be self-hosted: each family runs their own copy, with
their own credentials, on their own computer. The connectors are built
against ClassDojo and MyChildAtSchool themselves -- not anything specific
to one school -- so if your children's school uses these same apps, this
should work without needing to change any of the scraping code. You'll
just need to bring your own:
- A free Gemini API key
- Your own Google Cloud OAuth credentials (a few minutes to set up)
- Your own school app logins

Nothing here is a hosted service -- there's no shared server, and no one
else's data passes through anyone else's machine. Please don't run this
against school accounts you don't have a legitimate right to access.

If you're considering sharing the resulting calendar more widely (a whole
class or year group, not just your own family), see
`CLASS_REP_GUIDE.md` first -- it covers the real decisions worth making
before doing that, written from an actual class rollout.

## Before you start: read this

- **ClassDojo and MyChildAtSchool have no public API.** The connectors for
  them use Playwright to drive a real browser and log in as you. This is
  fragile by nature -- it can break when either site changes its UI.
- **Class Charts isn't in the guided wizard**, and its parent login has
  reCAPTCHA protection that can't reliably be automated -- see "Adding
  Class Charts by hand" below if you want to add it separately.
- **ClassDojo is exploring an official API/MCP server.** Worth signing up
  for early access at https://www.classdojo.com/classdojo-api-mcp/ -- if it
  ships, it should replace the ClassDojo connector with something far more
  reliable.
- **Windows has now been tested end-to-end** by a real user on Windows 11 --
  logged in, read real posts, added real events, no duplicates on reruns.
  A few real setup gaps that testing surfaced (Task Scheduler not finding
  `.env`, admin rights needed for one of the two scheduled tasks) are fixed
  in `scripts/platform/windows.js`; see `SETUP.md`'s Windows section for
  what's still worth knowing.
- **See `GOOGLE_CALENDAR_SETUP.md`** for the full Google Cloud walkthrough
  -- the OAuth consent screen setup is the single most common place a
  first-time user gets stuck, and it's not obvious from Google's own UI.
- Treat this as a personal tool for your own family. The moment it starts
  handling another family's children's data on your behalf (rather than
  each family running their own copy), different legal obligations apply.

## Quick setup

Open a terminal (Terminal.app on Mac, PowerShell on Windows), then:

```
git clone https://github.com/stuartpauljames/school-hub.git
cd school-hub
npm install
npx playwright install chromium
npm run configure          # opens a browser-based setup wizard
```

This opens `http://localhost:4175` with a step-by-step wizard: connecting
your Google Calendar (with a real dropdown of your actual calendars to pick
from, not a pasted-in ID), your children's names, your school app logins,
and finally two clearly ordered buttons -- run a test check first, then
install everything to run automatically. No manual file editing required.

Prefer the terminal throughout? `npm run setup` is a text-based version of
the same wizard (no live calendar picker, just paste in a calendar ID),
followed by `npm run authorize-google`, `npm run install-service`, and
`npm run doctor`.

`npm run install-service` detects whether you're on Mac or Windows and
installs the right kind of background service automatically -- on Mac this
handles correct file paths, macOS quarantine attributes, and cleaning up
any previous broken install; on Windows it registers two Task Scheduler
tasks (one running the check every 45 minutes, one keeping the approval
dashboard running continuously with automatic restart if it ever crashes).

Run `npm run doctor` any time something seems off -- it checks every common
failure point and tells you exactly what to fix, on either platform.

To stop everything: `npm run uninstall-service`.

**One thing worth knowing if you ever run a second copy for testing**: the
background service installer uses the same service names regardless of
which folder it's run from, so installing from a test copy while a real
one is already running will silently take over the real one's services.
The `configure` wizard's install button detects a folder path containing
"test" and asks for confirmation before proceeding, as a safety net --
worth being deliberate about which folder you're in regardless.

## Fixing the scraper selectors (only if something breaks)

The CSS selectors in `src/connectors/classDojo.js` and
`src/connectors/mcas.js` are confirmed against real markup as of Sept 2026.
If either app changes its UI and a connector stops working, you'll need to
open the real page, use your browser's "Inspect Element" on the relevant
part of the page, and update the selectors marked with comments explaining
what to look for. This is the one part that can't be fully automated away,
regardless of platform.

## Approving/declining events

The approval email adapts to where you open it. On a normal computer email
client, it shows one-click Add/Ignore buttons. On a phone, those buttons
are hidden (they'd point at `localhost`, which only the computer running
School Hub can reach) -- instead you get a plain notification with a
reminder to open the dashboard on your computer
(`http://localhost:4173` by default) to actually act on it.

This uses a CSS media query, which most modern mail apps (Apple Mail,
current Gmail) respect -- but not every email client does. If a client
doesn't understand it, you'll just see the buttons regardless of device,
which is exactly what happened before this existed -- nothing gets worse,
some clients just don't get the nicer behavior.

If you'd rather check things from your phone properly, the dashboard is
just a normal local web page -- installing something like
[Tailscale](https://tailscale.com) and setting `DASHBOARD_PUBLIC_URL` in
`.env` to the address it gives you will make that same dashboard page
(with its own working Approve/Ignore buttons) reachable from your phone
too, but this is entirely optional and not needed for School Hub to work.

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

## Adding Class Charts by hand (not in the guided wizard)

Class Charts isn't part of `npm run configure` or `npm run setup` -- it
needs a child's own pupil login code + date of birth rather than a parent
account (Class Charts' parent web login has reCAPTCHA protection that can't
be automated around; the connector instead uses the tested `StudentClient`
path from the `classcharts-api` library). To add it:

1. Get each child's pupil code from their school (a short code they'd use
   to log in themselves, separate from anything sent to you as the parent).
2. Add this line to your `.env` by hand:
   ```
   CLASSCHARTS_STUDENTS=Name,code,DOB;Name,code,DOB
   ```
   (DOB as `DD/MM/YYYY`, semicolon between children if you have more than one)
3. It'll be picked up automatically on the next run -- no other changes needed.

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
    configure-ui.js           - browser-based setup wizard (primary path, see SETUP.md)
    setup-wizard.js            - terminal-based setup wizard (alternative)
    authorize-google.js        - one-time Google OAuth setup (used by the terminal path)
    install-service.js         - platform-detecting entry point
    uninstall-service.js       - platform-detecting entry point
    doctor.js                   - diagnostic health check (platform-aware)
    platform/
      mac.js                    - launchd install/uninstall logic
      windows.js                 - Task Scheduler install/uninstall logic
  data/                         - all local state lives here (gitignored)
  SETUP.md                      - non-technical setup instructions
```

## Tuning the confidence threshold

`AUTO_ADD_THRESHOLD` in `.env` (default 80) controls the cutoff. Items scoring
at or above it go straight to your calendar; below it, you get an email.
After running for a week or two, check `data/added.json` against what
actually happened -- if auto-added events are ever wrong, raise the
threshold; if you're getting approval emails for things that were obviously
fine, you can lower it.

## Other things worth knowing

- **Multi-calendar routing** (optional, most single-family setups can
  ignore this and just use `GOOGLE_CALENDAR_ID`): events can route to a
  separate calendar per child (`CHILD_CALENDARS`), per class
  (`CLASS_CALENDARS`, for messages that name the class but not a specific
  child), or per year group (`YEAR_GROUP_CALENDARS`, for messages -- common
  on MyChildAtSchool -- that say "Year 4" rather than the class's actual
  name), with `WHOLE_SCHOOL_CALENDAR_ID` catching anything that matches
  none of those. The wizard sets all of this up automatically if you fill
  in each child's class and year group; see `CLASS_REP_GUIDE.md` for the
  full picture. Every run logs exactly which rule matched (or didn't) for
  each event -- look for `[calendarSync] Routing "..."` lines in
  `data/scraper.log` if something lands somewhere unexpected.

- **`HOUSEHOLD_CHILDREN`** in `.env` (a comma-separated list of names) is
  passed to the classifier as context, so it can attribute a ClassDojo or
  MyChildAtSchool message to the right child by name when one is mentioned,
  rather than only ever guessing from the message text alone.
- **Classification calls to Gemini have a 30-second timeout**, and the
  `configure` wizard's test-check button has a 3-minute timeout on the
  whole run -- both fail cleanly and skip/retry rather than hanging
  indefinitely if a network request ever stalls.
- **A failed classification (rate limit, timeout, API error) is retried
  automatically on the next run** rather than being silently dropped --
  it's only marked "seen" once it's actually been classified successfully.
