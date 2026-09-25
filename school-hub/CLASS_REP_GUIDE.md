# Sharing School Hub with a class: a guide for the person setting it up

This is for anyone thinking about running School Hub and sharing the
resulting calendar with other parents in a class or year group, rather
than just using it for their own family. Written from a real Windows
install and a real class rollout attempt.

School Hub was built by one parent, in their own time, for their own use.
It saves a lot of scrolling through school apps. If you're using it, a
thank-you to the person who built it goes a long way.

## Part 1: decide these before installing

For a year group, the safe setup is **approve every event by hand before
it goes into the shared calendar**. School Hub reads *your own* family's
accounts, and it has no idea which posts are meant for the whole year and
which are just about your child.

How it works: School Hub logs into ClassDojo and MyChildAtSchool **as
you**, reads everything you can see, and uses Google's Gemini AI to turn
posts into calendar events. It lives on your PC, and your passwords never
leave it. But everything your family receives goes through the same pipe,
so these things need deciding first:

| Question | Why it matters | Recommendation |
| --- | --- | --- |
| Do you have children in more than one year group, or at another school? | Used to mean events from every class landed in one calendar. As of this version, School Hub can route each child's events to their own separate calendar (`CHILD_CALENDARS` in `.env`), with whole-school events kept in their own calendar too so they aren't duplicated. If you set this up, you can be the rep for more than one class at once | See "Running as rep for more than one class" below |
| Could personal items get through? | MyChildAtSchool carries messages about *your* child specifically: payments due, individual notes, medical letters. These can be classified as events and auto-added | Set `AUTO_ADD_THRESHOLD=101` in `.env`. Nothing gets added automatically any more -- every event comes to you by email first, and you tap Add or Decline |
| What goes into each event? | Each event's description holds **the full text of the original post**, including teachers' names and anything else it mentions | Read a few events in full before sharing. If posts routinely name children, that's worth knowing before the calendar goes out |
| Is the school happy with it? | You'd be sharing school communications with parents outside the platform they were sent through | Worth a quick check with the school office or head first: "I'd like to share a read-only calendar of year-group dates taken from ClassDojo, is that OK?" |
| Are you comfortable with the AI step? | Every post is sent to Google's Gemini API to be classified. Check Gemini's current API terms for how content may be used, especially on the free tier | A paid API key (pennies a month at this volume) is worth considering if this matters to you |
| Will the PC be on? | It only runs while the PC is on and you're logged in | A home PC left on is fine. Nothing is lost when it's off -- events just arrive once it's back on |

If you can't get the school's OK, or you have children in several year
groups without setting up multi-calendar routing (below), it's still a
great tool -- just keep it for your own family rather than sharing the
calendar.

## Running as rep for more than one class

If you have children in different classes or year groups, the setup
wizard (`npm run configure`) now handles this automatically:

1. When you get to "Create a whole-school calendar," name it something
   like "Whole School Events" -- School Hub creates it for you.
2. On the next page, add each child one at a time with their name and
   their class. **The class name becomes that calendar's actual title**,
   so use whatever you'd want other parents in that class to see (e.g.
   "Nightingale Class 26/27 dates"). School Hub creates a dedicated
   calendar for each one automatically -- for two children in different
   classes, that's 3 calendars in total: one whole-school, one per class.
3. An event gets routed to a child's calendar only when the message
   clearly names that child. A whole-school trip or inset day, which
   doesn't name a specific child, goes to the whole-school calendar
   instead -- so it shows up once, not duplicated in every class calendar.
4. Share each calendar separately with the parents in that specific class,
   following Part 2 below for each one.

If you only have one child, or don't need separate calendars, just add
that one child in the wizard as normal -- you'll end up with two
calendars (whole-school and their class), which is still useful for
keeping school events out of your personal calendar even without sharing
anything.

Re-running the wizard later (e.g. to add a second child) won't create
duplicate calendars -- it reuses any calendar whose name already matches.

## Part 2: sharing the calendar once it's running

The calendars School Hub created for you are already separate from your
personal calendar -- nothing further to set up there. Each one just needs
to be set to **read-only** for the parents you share it with.

### Choose how to share it

Open the calendar's **Settings and sharing**. Two routes:

| Route | How | Good | Bad |
| --- | --- | --- | --- |
| **Link (recommended for a class)** | Under **Access permissions**, tick *Make available to public*, set to *See all event details*. Share the **Public address in iCal format** (under *Integrate calendar*) | Works on iPhone, Android and Outlook, no Google account needed | Anyone with the link can read it -- this is exactly why approval mode matters |
| **Named people** | **Share with specific people**, add each parent's email with *See all event details* | Only people you add can see it | Needs a Google account per parent, and a list to maintain |

Either way, **never** grant *Make changes to events*, and never share the
**Secret address in iCal format** -- that one is for you alone.

### A message you could send

> Unofficial [year group] dates calendar: trips, payment deadlines,
> non-uniform days and so on, taken from ClassDojo and MyChildAtSchool.
> Read-only, updated several times a day. Always check the original post
> before paying or sending anything in.
> **iPhone:** Settings > Calendar > Accounts > Add Account > Other > Add
> Subscribed Calendar, paste the link.
> **Android / Google:** on a computer, calendar.google.com > Other
> calendars > + > From URL, paste the link.
> **Outlook:** Add calendar > Subscribe from web, paste the link.

Phones and Outlook refresh subscribed calendars on their own schedule --
often every few hours, sometimes only once a day. A change made in the
morning may not reach everyone until the afternoon, so a group chat is
still worth keeping for anything urgent.

## Part 3: week to week

- **Approvals.** Each possible event arrives as an email. On a computer,
  it shows Add/Ignore buttons directly. On a phone, those are hidden
  automatically (they'd point at `localhost`, unreachable from a phone) --
  you'll instead see a reminder to open the dashboard on the computer
  running School Hub. See "Approving/declining events" in `README.md` if
  you want the buttons to work from your phone too (optional, needs
  Tailscale).
- **A quick weekly check.** Open `data/scraper.log` and scroll to the
  bottom. The last run should end in `Done` and be less than an hour or
  so old.
- **If events stop arriving**, check the log for these:

| Log says | Meaning | Fix |
| --- | --- | --- |
| `invalid_grant` | The Google connection expired (usually because the app wasn't published) | Publish the Google app, delete `data/google-token.json`, reconnect via `npm run configure` |
| A ClassDojo or MyChildAtSchool login failure | Password changed, or the site changed its design | Update `.env`. If the password's right and it's still failing, the site's probably changed and the connector needs updating |
| No new lines for hours | The PC is off or asleep | Nothing is lost -- it catches up at the next run |

- **Handing over.** When you stop running it, run
  `npm run uninstall-service`, then transfer ownership of the shared
  calendar to whoever's taking over. They install School Hub fresh, on
  their own PC, with their own logins -- nothing here transfers between
  machines.
