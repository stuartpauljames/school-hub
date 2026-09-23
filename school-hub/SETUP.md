# School Hub — setup instructions

This checks your kids' school apps (ClassDojo, MyChildAtSchool) and puts
important dates straight into a Google Calendar, with a check running
quietly in the background every 45 minutes. It runs entirely on your own
computer — nothing is shared or hosted anywhere else, and your passwords
stay on your machine.

Works on both **Mac** and **Windows**.

## What you'll need

- A Mac or Windows PC
- About 15 minutes
- Your own school app logins
- A free Google account (you probably already have one)
- [Node.js](https://nodejs.org) installed (the "LTS" version)

## Setup

1. Unzip this folder somewhere sensible, like Documents.
2. Open a terminal:
   - **Mac**: press Cmd+Space, type "Terminal", press enter.
   - **Windows**: press the Windows key, type "PowerShell", press enter.
3. Navigate into the unzipped folder: type `cd ` (with a space after it),
   then drag the unzipped folder into the window, then press enter.
4. Run:
   ```
   npm install
   npx playwright install chromium
   npm run configure
   ```
5. It'll print a link like `http://localhost:4175` — open that in your
   browser. This walks you through everything with simple forms: connecting
   your Google Calendar (with a real dropdown to pick which calendar to
   use), your children's names, and your school app logins. The last screen
   has two clearly labeled steps — run a test check first to make sure
   everything works, then install it to run automatically from then on.

That's it. No manual file editing required.

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

## A note for Windows users specifically

The Windows background-service install is built the same way as the Mac
one and should work, but hasn't been tested on a real Windows machine yet
the way the Mac version has. If anything looks off after clicking "Install
background service," that's useful to know about — happy to help debug it.

## Prefer the terminal instead?

Run `npm run setup` for a text-based version of the same wizard, or see
`README.md` for the fully manual process.
