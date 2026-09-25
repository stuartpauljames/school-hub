## Connecting Google Calendar (step by step)

School Hub needs your permission to add events to your Google Calendar.
Google makes every app, even a personal one, get that permission through a
free "Google Cloud" project. You set this up once and it takes about 10
minutes. You won't be charged, and you don't need a credit card.

Do this **before** running `npm run configure`, or while the setup page is
open at the "Connect Google Calendar" step.

### 1. Create a project and turn on the Calendar API

1. Go to https://console.cloud.google.com and sign in with your Google account.
2. Click the project picker at the top left, then **New project**. Name it
   `School Hub` and click **Create**. Check that the new project is now
   selected in the picker at the top.
3. Type **Google Calendar API** into the search bar at the top, open it, and
   click **Enable**. It should then say "API Enabled".

### 2. Set up the consent screen

This is the screen Google shows when you give School Hub permission. If you
skip it, you get **"Access blocked: School Hub has not completed the Google
verification process"**.

1. Open the menu (☰), then **APIs & Services**, then **OAuth consent screen**.
   (The page may be called **Google Auth Platform**. It's the same thing.)
2. Click **Get started** and fill in:
   - App name: `School Hub`
   - User support email: your own email
   - Audience: **External**
   - Contact email: your own email
   - Tick the agreement box, then click **Create**.
3. Go to **Audience** in the left-hand menu. Under **Test users**, click
   **Add users** and add the Gmail address whose calendar the events should
   go into. Add a partner's address too if they'll use it.

### 3. Publish the app, so it doesn't stop working after 7 days

While the app is in "Testing", Google cancels its calendar permission every
7 days. School Hub would keep running in the background but quietly stop
adding events. Publishing the app prevents that.

1. Go to **Branding** in the left-hand menu. Under **App domain**, fill in:
   - Application home page: `https://github.com/stuartpauljames/school-hub`
   - Application privacy policy link: `https://github.com/stuartpauljames/school-hub/blob/main/PRIVACY.md`

   Google won't let you publish without both links. For a personal app, nobody
   checks what the pages say.
2. If **Save** complains about the domain, go to **Authorised domains**, click
   **+ Add domain**, enter `github.com`, and save again.
3. Go back to **Audience**. Click **Publish app**, then **Confirm**. The
   status should now say **In production**.

You don't need to send the app to Google for review.

### 4. Create the Client ID and secret

1. Go to **Clients** in the left-hand menu and click **+ Create client**.
2. Application type: **Desktop app**. Name: `School Hub`. Click **Create**.
3. Copy the **Client ID** and **Client secret** somewhere safe, such as
   Notepad, and click **Download JSON** as a backup. The secret may not be
   shown again.

**Ignore any instruction to add a redirect URI.** Desktop app clients don't
have a box for one and don't need one. They automatically accept any
`http://localhost` address. (If you made a **Web application** client by
mistake, either make a new Desktop one, or open the client and add
`http://localhost:4175/oauth2callback` under **Authorised redirect URIs**.)

### 5. Connect School Hub

1. Open a terminal (PowerShell on Windows) **in the inner `school-hub`
   folder**. The zip unpacks to `school-hub-main\school-hub`, and the commands
   only work in the inner folder. If you see `Could not read package.json`,
   type `cd school-hub` and try again.
2. Run `npm run configure` and open `http://localhost:4175` in your browser.
   Keep the terminal window open until setup is finished.
3. Paste in the Client ID and Client secret and click **Connect Google Calendar**.
4. Sign in with the account whose calendar should receive the school events.
5. Google will say **"Google hasn't verified this app"**. That's expected,
   because you built it and nobody else did. Click **Advanced**, then
   **Go to School Hub (unsafe)**, then **Continue**.
6. You should come back to a dropdown of your calendars. That means Google is
   connected. Pick one (or create a dedicated "School events" calendar in
   Google Calendar first) and carry on.

### If it goes wrong

| What you see | What to do |
|---|---|
| **Access blocked … has not completed verification** (Error 403) | Your email isn't a test user and the app isn't published. Redo steps 2.3 and 3. |
| **Publish app** is greyed out | The home page or privacy policy link is missing. See step 3.1. |
| **Error 401: invalid_client** | The ID or secret was pasted wrong, often with a stray space. Copy them again. |
| **Error 400: redirect_uri_mismatch** | You made a Web application client. See the note at the end of step 4. |
| **Google Calendar API has not been used in project…** | Step 1.3 was skipped, or done in a different project. |
| **invalid_grant**, days or weeks later | The permission expired, usually because the app was still in Testing. Publish it (step 3), delete `data\google-token.json`, and run `npm run configure` again. |
| The browser can't reach `localhost:4175` | The terminal running `npm run configure` was closed. Run it again. |
| `Could not read package.json` | You're in the outer folder. Run `cd school-hub`. |

`npm run doctor` will tell you whether the Google connection is in place.
