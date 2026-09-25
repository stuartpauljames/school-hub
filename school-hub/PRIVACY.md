# Privacy Policy

School Hub is a personal, self-hosted tool. This policy describes exactly
what it does with data, in plain terms.

## What it accesses

- **Your Google Calendar**, to create and update events it extracts from
  your children's school apps.
- **Your Gmail**, only to send you approval emails from your own address
  when an extracted event's date or details are uncertain.
- **Your ClassDojo / MyChildAtSchool / ClassCharts login**, to read your
  children's school communications.

## Where your data goes

Everywhere. Nowhere else. School Hub runs entirely on your own computer.
There is no server, no hosting, no third party this data is sent to,
other than:
- **Google's own APIs** (Calendar and Gmail), to do the two things above.
- **Google's Gemini API**, to classify extracted message text into
  structured event data (date, category, summary).

No data is collected, stored, or seen by the developer of this tool. Each
person who runs School Hub uses their own Google account, their own API
keys, and their own copy of the code -- this isn't a hosted service.

## Data storage

Login sessions, classification results, and calendar-sync state are stored
in plain files on your own computer, inside the project's `data/` folder.
Nothing here is uploaded anywhere.

## Your school app credentials

Stored in a local `.env` file on your own computer, used only to log in on
your behalf via an automated browser session. Never transmitted to the
developer of this tool or anyone else.

## Questions

This is a personal open-source project, not a company or commercial
product. If you have questions, open an issue on the GitHub repository.
