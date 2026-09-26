# School Hub — setup instructions

This checks your kids' school apps (ClassDojo, MyChildAtSchool) and puts
important dates straight into a Google Calendar, with a check running
quietly in the background every 45 minutes. It runs entirely on your own
computer — nothing is shared or hosted anywhere else, and your passwords
stay on your machine.

Works on both **Mac** and **Windows**.

*(Already comfortable with git and the command line? `README.md` in this same folder covers the same setup more tersely, plus architecture, troubleshooting, and advanced options this file doesn't cover.)*

## What you'll need

- A Mac or Windows PC
- About 15 minutes
- Your own school app logins
- A free Google account (you probably already have one)
- [Node.js](https://nodejs.org) installed (the "LTS" version)

## Setup

1. Go to https://github.com/stuartpauljames/school-hub. Click the green
   **Code** button, then **Download ZIP**. Unzip it somewhere sensible, like
   Documents -- **but not inside OneDrive** if you have it, since OneDrive
   will otherwise back up your passwords to the cloud along with everything
   else in the folder. `C:\school-hub` (Windows) or `~/Documents/school-hub`
   (Mac, outside any iCloud Drive folder) are both safe choices.
2. **Important:** the zip unpacks to an outer folder (e.g.
   `school-hub-main`) containing an *inner* folder also called
   `school-hub` -- the actual project. Open that inner folder before doing
   anything else. If a command later says `Could not read package.json`,
   you're one level too high; open the inner `school-hub` folder and try
   again.
3. Open a terminal **inside that inner folder**:
   - **Mac**: press Cmd+Space, type "Terminal", press enter, then type
     `cd ` (with a space after it) and drag the inner folder into the
     window.
   - **Windows**: open the inner folder in File Explorer, click the address
     bar, type `powershell`, and press enter.
4. Run:
   ```
   npm install
   npx playwright install chromium
   npm run configure
   ```
5. **Keep this terminal window open** for the rest of setup -- the page in
   your browser stops working the moment this window closes or gets reused
   for another command.
6. It'll print a link like `http://localhost:4175` — open that in your
   browser. This walks you through everything with simple forms: connecting
   your Google Calendar (see `GOOGLE_CALENDAR_SETUP.md` in this folder for
   the full walkthrough, including Google's consent screen setup, which
   trips up most first-time users), your children's names, and your school
   app logins. The last screen has two clearly labeled steps — run a test
   check first to make sure everything works, then install it to run
   automatically from then on.

That's it. No manual file editing required.

## On Windows specifically

- **Install the background service from an Administrator PowerShell.**
  Right-click PowerShell in the Start menu and choose "Run as
  administrator" before running `npm run install-service` -- one of the two
  background tasks needs elevated rights to register, and installing
  without it fails without a clear reason.
- **Class Charts wrong credentials fail loudly, every 45 minutes.** If you
  haven't set it up, leave those fields blank in the wizard entirely rather
  than filling in placeholder or incorrect values -- a wrong pupil code or
  DOB will keep failing with "didn't return authentication cookies" on
  every single run.

## If something goes wrong

In the terminal, run:
```
npm run doctor
```
This checks the most common problems and tells you plainly what to fix.

## Two honest caveats

- **ClassDojo and MyChildAtSchool** don't offer an official way to check
  them automatically, so this works by automating a real browser login
  instead. It's a little fragile by nature and can occasionally break if
  either app changes its design.
- **Class Charts isn't included in this setup wizard yet** — it needs a
  child's own login code rather than a parent account, due to a security
  check on their site. If you want it, see `README.md` for how to add it
  by hand afterward.

If you have more than one child at the same school on MyChildAtSchool,
School Hub finds and checks each of them automatically — nothing to set
up for that specifically.

## Windows: now genuinely tested

A real parent ran this end to end on Windows 11 -- logged into ClassDojo
and MyChildAtSchool, read real posts, and added real events to a real
calendar with no duplicates on reruns. The setup issues that came up along
the way (folder structure, Google's consent screen, the two notes above)
are already fixed or documented here. If you hit something new, that's
useful to know about.

## Prefer the terminal instead?

Run `npm run setup` for a text-based version of the same wizard, or see
`README.md` for the fully manual process.
