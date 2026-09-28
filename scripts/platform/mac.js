import fs from "fs";
import path from "path";
import { execSync } from "child_process";

export function installMac(projectRoot) {
  const nodePath = process.execPath;
  const launchAgentsDir = path.join(process.env.HOME, "Library", "LaunchAgents");

  function buildPlist(label, scriptRelPath, { keepAlive, interval }) {
    const scriptPath = path.join(projectRoot, scriptRelPath);
    const dataDir = path.join(projectRoot, "data");
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${projectRoot}</string>
  ${interval ? `<key>StartInterval</key>\n  <integer>${interval}</integer>` : ""}
  ${keepAlive ? `<key>RunAtLoad</key>\n  <true/>\n  <key>KeepAlive</key>\n  <true/>` : ""}
  <key>StandardOutPath</key>
  <string>${path.join(dataDir, label + ".log")}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(dataDir, label + "-error.log")}</string>
</dict>
</plist>
`;
  }

  const JOBS = [
    { label: "com.schoolhub.scraper", script: "src/runOnce.js", keepAlive: false, interval: 2700 },
    { label: "com.schoolhub.dashboard", script: "src/server.js", keepAlive: true },
  ];

  function run(cmd) {
    try {
      return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"] }).toString();
    } catch (err) {
      const detail = err.stderr?.toString().trim() || err.message;
      throw new Error(detail);
    }
  }

  console.log("Installing School Hub background services (launchd)...\n");
  fs.mkdirSync(path.join(projectRoot, "data"), { recursive: true });
  fs.mkdirSync(launchAgentsDir, { recursive: true });

  for (const job of JOBS) {
    const plistPath = path.join(launchAgentsDir, `${job.label}.plist`);
    fs.writeFileSync(plistPath, buildPlist(job.label, job.script, job));

    try {
      execSync(`xattr -c "${plistPath}"`);
    } catch {}
    fs.chmodSync(plistPath, 0o644);

    // Remove any existing registration first -- editing a plist that's
    // already loaded doesn't take effect on its own, and a stale broken
    // registration from an earlier failed attempt silently blocks every
    // future install attempt with a vague error otherwise.
    try {
      run(`launchctl bootout gui/$(id -u)/${job.label}`);
    } catch {}

    // launchd can still be tearing the old service down for a moment after
    // bootout returns, and an immediate bootstrap then fails with a vague
    // "Input/output error" that succeeds if you simply try again a moment
    // later. Pause, then retry a few times before reporting a failure.
    execSync("sleep 1");
    let installed = false;
    let lastError;
    for (let attempt = 1; attempt <= 3 && !installed; attempt++) {
      try {
        run(`launchctl bootstrap gui/$(id -u) "${plistPath}"`);
        installed = true;
      } catch (err) {
        lastError = err;
        if (attempt < 3) execSync("sleep 2");
      }
    }

    if (installed) {
      console.log(`✅ ${job.label} installed and running`);
    } else {
      console.log(`❌ ${job.label} failed to install (after 3 attempts)`);
      console.log(`   ${lastError.message}`);
    }
  }

  console.log("\nDone. Run 'npm run doctor' to confirm everything is healthy.");
}

export function uninstallMac() {
  const launchAgentsDir = path.join(process.env.HOME, "Library", "LaunchAgents");
  const LABELS = ["com.schoolhub.scraper", "com.schoolhub.dashboard"];

  for (const label of LABELS) {
    try {
      execSync(`launchctl bootout gui/$(id -u)/${label}`, { stdio: "ignore" });
    } catch {}
    const plistPath = path.join(launchAgentsDir, `${label}.plist`);
    if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
    console.log(`Removed ${label}`);
  }
  console.log("\nBoth background services stopped and removed.");
}
