import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const TASK_SCRAPER = "SchoolHubScraper";
const TASK_DASHBOARD = "SchoolHubDashboard";

export function installWindows(projectRoot) {
  const nodePath = process.execPath;
  const dataDir = path.join(projectRoot, "data");
  const genDir = path.join(dataDir, "win-scripts");
  fs.mkdirSync(genDir, { recursive: true });

  // The scraper just runs once per trigger -- Task Scheduler handles the
  // repetition, same role StartInterval plays on Mac.
  const scraperBat = path.join(genDir, "run-scraper.bat");
  fs.writeFileSync(
    scraperBat,
    `@echo off\r\n"${nodePath}" "${path.join(projectRoot, "src", "runOnce.js")}"\r\n`
  );

  // The dashboard needs to stay running continuously. Task Scheduler alone
  // doesn't restart a crashed process the way launchd's KeepAlive does, so
  // this wraps it in a simple restart loop instead of requiring an extra
  // dependency (like node-windows) that would need an elevated install step.
  const dashboardBat = path.join(genDir, "run-dashboard-loop.bat");
  fs.writeFileSync(
    dashboardBat,
    `@echo off\r\n:loop\r\n"${nodePath}" "${path.join(projectRoot, "src", "server.js")}"\r\ntimeout /t 5 /nobreak >nul\r\ngoto loop\r\n`
  );

  console.log("Installing School Hub background tasks (Task Scheduler)...\n");

  function run(cmd) {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString();
  }

  // Remove any existing tasks under these names first, same reasoning as
  // the Mac installer: avoids a stale registration silently blocking a
  // fresh install.
  for (const task of [TASK_SCRAPER, TASK_DASHBOARD]) {
    try {
      run(`schtasks /delete /tn "${task}" /f`);
    } catch {}
  }

  try {
    // /sc MINUTE /mo 45 runs it every 45 minutes indefinitely, starting now.
    // /RL LIMITED keeps it at standard (non-admin) privileges, matching the
    // per-user scope launchd uses on Mac.
    run(
      `schtasks /create /tn "${TASK_SCRAPER}" /tr "\\"${scraperBat}\\"" /sc MINUTE /mo 45 /RL LIMITED /f`
    );
    console.log(`✅ ${TASK_SCRAPER} installed (runs every 45 minutes)`);
  } catch (err) {
    console.log(`❌ ${TASK_SCRAPER} failed to install: ${err.message.split("\n")[0]}`);
  }

  try {
    // ONLOGON starts the restart-loop once each time you log in; the loop
    // itself keeps the dashboard alive continuously after that.
    run(
      `schtasks /create /tn "${TASK_DASHBOARD}" /tr "\\"${dashboardBat}\\"" /sc ONLOGON /RL LIMITED /f`
    );
    console.log(`✅ ${TASK_DASHBOARD} installed (starts at login)`);

    // Start it immediately too, so it's working right now rather than only
    // after the next log-in.
    run(`schtasks /run /tn "${TASK_DASHBOARD}"`);
  } catch (err) {
    console.log(`❌ ${TASK_DASHBOARD} failed to install: ${err.message.split("\n")[0]}`);
  }

  console.log("\nDone. Run 'npm run doctor' to confirm everything is healthy.");
}

export function uninstallWindows() {
  function run(cmd) {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString();
  }

  for (const task of [TASK_SCRAPER, TASK_DASHBOARD]) {
    try {
      run(`schtasks /delete /tn "${task}" /f`);
      console.log(`Removed ${task}`);
    } catch {
      console.log(`${task} was not installed`);
    }
  }

  console.log(
    "\nScheduled tasks removed. If the dashboard is currently running in a\n" +
      "window, close that window manually -- the restart loop only stops\n" +
      "being re-triggered at future logins, it doesn't force-close a copy\n" +
      "that's already running."
  );
}
