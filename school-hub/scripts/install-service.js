import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, "..");

if (process.platform === "darwin") {
  const { installMac } = await import("./platform/mac.js");
  installMac(projectRoot);
} else if (process.platform === "win32") {
  const { installWindows } = await import("./platform/windows.js");
  installWindows(projectRoot);
} else {
  console.error(
    `No automated installer for platform "${process.platform}" yet.\n` +
      `You can still run School Hub manually with 'npm run run-once' and\n` +
      `'npm run dashboard', or set up your own scheduler (e.g. cron) to run\n` +
      `'node src/runOnce.js' periodically and 'node src/server.js' continuously.`
  );
}
