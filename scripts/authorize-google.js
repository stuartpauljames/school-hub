import "dotenv/config";
import { google } from "googleapis";
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = path.join(__dirname, "..", "data", "google-token.json");
const REDIRECT_URI = "http://localhost:4174/oauth2callback";

const oAuth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  scope: ["https://www.googleapis.com/auth/calendar"], // matches configure-ui.js's scope -- narrower scopes can't list calendars
  prompt: "consent",
});

console.log("\nOpen this URL in your browser to authorize Google Calendar access:\n");
console.log(authUrl);
console.log("");

const server = http
  .createServer(async (req, res) => {
    if (!req.url.startsWith("/oauth2callback")) return;
    const code = new URL(req.url, REDIRECT_URI).searchParams.get("code");
    res.end("Authorized. You can close this tab and return to the terminal.");
    server.close();

    const { tokens } = await oAuth2Client.getToken(code);
    fs.mkdirSync(path.dirname(TOKEN_PATH), { recursive: true });
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log(`Saved refresh token to ${TOKEN_PATH}`);
    process.exit(0);
  })
  .listen(4174);
