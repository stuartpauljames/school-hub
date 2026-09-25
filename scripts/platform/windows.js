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

  // Task Scheduler starts a task in C:\Windows\System32 by default, not the
  // project folder -- without an explicit `cd`, `import "dotenv/config"`
  // finds no .env and every setting silently comes back empty. `%~dp0` is
  // this .bat file's own folder (data\win-scripts), so `..\..` gets back to
  // the project root.
  const scraperBat = path.join(genDir, "run-scraper.bat");
  fs.writeFileSync(
    scraperBat,
    `@echo off\r\n` +
      `cd /d "%~dp0..\\.."\r\n` +
      `"${nodePath}" "${path.join(projectRoot, "src", "runOnce.js")}" >> "${path.join(dataDir, "scraper.log")}" 2>&1\r\n`
  );

  // The dashboard needs to stay running continuously. Task Scheduler alone
  // doesn't restart a crashed process the way launchd's KeepAlive does, so
  // this wraps it in a simple restart loop instead of requiring an extra
  // dependency (like node-windows) that would need an elevated install step.
  const dashboardBat = path.join(genDir, "run-dashboard-loop.bat");
  fs.writeFileSync(
    dashboardBat,
    `@echo off\r\n` +
      `cd /d "%~dp0..\\.."\r\n` +
      `:loop\r\n"${nodePath}" "${path.join(projectRoot, "src", "server.js")}"\r\ntimeout /t 5 /nobreak >nul\r\ngoto loop\r\n`
  );

  // A visible black console window popping up every 45 minutes (and staying
  // open all day for the dashboard) is the kind of thing that makes a
  // background tool feel broken even when it's working fine. A small
  // VBScript wrapper launches each .bat file with its window hidden --
  // Task Scheduler runs the .vbs (via wscript.exe) instead of the .bat
  // directly.
  const scraperVbs = path.join(genDir, "run-scraper-hidden.vbs");
  fs.writeFileSync(
    scraperVbs,
    `Set objShell = CreateObject("WScript.Shell")\r\n` +
      `objShell.Run """${scraperBat}""", 0, True\r\n` // 0 = hidden window, True = wait for it to finish (so Task Scheduler correctly reports when each run completes)
  );

  const dashboardVbs = path.join(genDir, "run-dashboard-hidden.vbs");
  fs.writeFileSync(
    dashboardVbs,
    `Set objShell = CreateObject("WScript.Shell")\r\n` +
      `objShell.Run """${dashboardBat}""", 0, False\r\n` // False = don't wait -- the loop runs forever, so the .vbs just launches it hidden and exits immediately
  );

  console.log("Installing School Hub background tasks (Task Scheduler)...\n");

  function run(cmd) {
    try {
      return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString();
    } catch (err) {
      // Surface the real Windows error (e.g. "Access is denied" when not
      // running as administrator) instead of swallowing it -- a silent
      // failure here previously gave no clue why the dashboard task
      // wouldn't install.
      const detail = err.stderr?.toString().trim() || err.message;
      throw new Error(detail);
    }
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
      `schtasks /create /tn "${TASK_SCRAPER}" /tr "wscript.exe \\"${scraperVbs}\\"" /sc MINUTE /mo 45 /RL LIMITED /f`
    );
    console.log(`✅ ${TASK_SCRAPER} installed (runs every 45 minutes)`);
  } catch (err) {
    console.log(`❌ ${TASK_SCRAPER} failed to install: ${err.message.split("\n")[0]}`);
  }

  try {
    // ONLOGON starts the restart-loop once each time you log in; the loop
    // itself keeps the dashboard alive continuously after that.
    run(
      `schtasks /create /tn "${TASK_DASHBOARD}" /tr "wscript.exe \\"${dashboardVbs}\\"" /sc ONLOGON /RL LIMITED /f`
    );
    console.log(`✅ ${TASK_DASHBOARD} installed (starts at login)`);

    // Start it immediately too, so it's working right now rather than only
    // after the next log-in.
    run(`schtasks /run /tn "${TASK_DASHBOARD}"`);
  } catch (err) {
    console.log(`❌ ${TASK_DASHBOARD} failed to install: ${err.message.split("\n")[0]}`);
    if (/denied|elevat|administrator/i.test(err.message)) {
      console.log(
        "   This usually means PowerShell needs to be run as Administrator " +
          "for this specific task (ONLOGON triggers are privileged in " +
          "Windows). Right-click PowerShell -> Run as administrator, then " +
          "try 'npm run install-service' again."
      );
    }
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
    "\nScheduled tasks removed. Since the dashboard ran with its window hidden, " +
      "there's nothing visible to close -- but the actual node process may " +
      "still be running until you restart your PC, or close it via Task " +
      "Manager (look for 'Node.js JavaScript Runtime')."
  );
}
