# Roadmap: nice-to-have features

Everything below is optional. The core job is covered: notes, SAP PS time
tracking with `/zeit`, CATS export and the assistant. The list comes from
four review rounds (design, bug hunting, feature scouting) and is ordered by
value for day-to-day consulting work.

## Worth doing next
- **Calendar picker for daily notes.** A month popover on the „Heute“ button,
  with dots on days that have a note or bookings.
- **Recurring bookings.** For example a daily stand-up at 0.25 h on
  NP-…/0010, created as draft entries each week.
- **Unlinked mentions.** Pages that name the current title without linking
  it, listed under the backlinks with a one-click „verlinken“.
- **ICS/Outlook import.** Turn meetings from an exported calendar into
  suggested bookings and meeting notes. No Graph API needed.
- **Automatic Markdown mirror.** Write the notes as Markdown files next to
  each backup, so they are never locked into SQLite.

## Smaller improvements
- Saved searches and task filters as sidebar entries.
- A Markdown source mode as a fallback for text that doesn't round-trip.
- A spellcheck language setting (DE/EN).
- Direct Jira worklog upload with approval; today it only writes payload files.
- Signed installer and auto-update from GitHub releases. Needs a code-signing
  certificate.
- Test runs on real Windows hardware for the tray, notifications, autostart
  and restart paths. Those are covered only by the Linux e2e suite and the
  Windows cross-build.

## Deliberately left out
- Graph view and canvas.
- Encryption at rest (BitLocker covers company laptops).
- Mobile apps and sync.
