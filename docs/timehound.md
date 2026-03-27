# TimeHound — Personal Documentation

> TimeHound is your automated Zoho Invoice timesheet assistant. It runs inside NanoClaw and is accessible via Discord. Each Friday it will ask if you want your timesheet completed, or you can trigger it manually at any time.

---

## How It Works — End to End

```
You type in #timehound (Discord)
        ↓
Discord's servers receive the message and push it over a
persistent outbound WebSocket connection to NanoClaw on your Mac.
(Your Mac initiated this connection — no open ports, no firewall
rules needed. Discord never connects inward to your machine.)
        ↓
discord.js (inside NanoClaw) receives the message event.
NanoClaw checks the channel ID (1487102444491247880),
matches it to the "timehound" registered group in SQLite,
and queues the message for processing.
        ↓
NanoClaw spawns a fresh Apple Container (Linux VM).
Zoho credentials from .env are injected as environment variables.
The timehound group folder is mounted into the container
at /workspace/group (read/write).
        ↓
Claude agent starts inside the container and reads:
  - /workspace/group/CLAUDE.md  (instructions and API details)
  - /workspace/group/weekly-template.yaml  (your schedule)
        ↓
Agent calls Zoho Invoice REST API to log time entries.
All HTTP calls use a 30-second timeout. On any failure,
the agent reports the error back to you immediately.
        ↓
Agent sends a summary back through NanoClaw → Borker → #timehound
        ↓
Container shuts down and is destroyed
```

The container is **ephemeral** — it spins up on demand and tears down when done. Your Zoho credentials are never stored in the container; they are injected at runtime from `.env` on your Mac and discarded when the container exits.

---

## Key Files

| File | Purpose |
|------|---------|
| `groups/timehound/CLAUDE.md` | Agent instructions — how to call the API, calculate weeks, handle duplicates |
| `groups/timehound/weekly-template.yaml` | Your recurring schedule — projects, tasks, and hours per day |
| `docs/timehound.md` | This document |
| `.env` | Zoho credentials (and all other credentials) — never leave this file |

---

## Discord Setup

| Item | Value |
|------|-------|
| Bot | Borker#4542 |
| Channel | `#timehound` |
| Channel ID | `1487102444491247880` |
| Trigger required | No — every message in `#timehound` goes to TimeHound |

---

## How to Use It

### Manual — complete a specific week

Send any of these in `#timehound`:

```
Complete my timesheet for this week
Complete my timesheet for last week
Complete my timesheet for 2 weeks ago
Complete my timesheet for the week of February 8th
```

TimeHound will:
1. Check if entries already exist for that week (to avoid duplicates)
2. Log all non-zero entries from your weekly template
3. Reply with a summary of what was logged

### Automatic — Friday prompt

Every **Friday at 11:00 AM Eastern**, TimeHound will send you a message asking if you want your timesheet completed for the current week. Simply reply:

```
yes
```

And it will run automatically.

---

## Your Weekly Template

**42 hours/week** across 8 recurring entries:

| Project | Task | Mon | Tue | Wed | Thu | Fri |
|---------|------|-----|-----|-----|-----|-----|
| Meetings | Software Dev Meetings | 2:00 | 2:00 | 2:00 | 2:00 | 2:00 |
| Jira | Jira Administration | 2:00 | — | — | 1:00 | 1:00 |
| Springfield Clinic Website/Careers | Project Management | 1:00 | 1:00 | 1:00 | 1:00 | 1:00 |
| Meetings | Change Advisory Board | — | — | 1:00 | — | — |
| Meetings | SC Experience Meetings | — | 2:00 | — | — | — |
| PASPort Application | Design | 1:00 | 1:00 | 1:00 | 1:00 | 1:00 |
| PASPort Application | Project Management | 2:00 | 2:00 | 2:00 | 2:00 | 2:00 |
| Jira | Jira Cloud Migration | 1:00 | 1:00 | 1:00 | 1:00 | 1:00 |
| **Daily Total** | | **9:00** | **9:00** | **8:00** | **8:00** | **8:00** |

---

## Modifying the Weekly Template

Edit `groups/timehound/weekly-template.yaml` directly. The format is straightforward:

```yaml
- project: "Project Name"
  project_id: "..."       # Zoho project ID (do not change)
  task: "Task Name"
  task_id: "..."          # Zoho task ID (do not change)
  hours:
    mon: "2:00"
    tue: "1:30"
    wed: "0:00"           # 0:00 = skipped
    thu: "0:00"
    fri: "1:00"
```

> **Important:** Do not change `project_id` or `task_id` values — these are Zoho's internal IDs. Only change the `hours` values and the display names.

To add a new recurring entry, find the project and task IDs by running:
```bash
npx tsx scripts/zoho-discover.ts
```

---

## Ad-Hoc / One-Off Time Entries

TimeHound only logs your **recurring weekly template**. For one-off projects or tasks that aren't in the template:

1. After TimeHound completes the template, go to [Zoho Invoice](https://invoice.zoho.com) in your browser
2. Manually add the project/task entry
3. Log the hours for that week

---

## Credentials & Security

All credentials are stored **only** in `/Users/jeff/nanoclaw/.env`:

| Variable | Purpose |
|----------|---------|
| `ZOHO_CLIENT_ID` | Zoho OAuth app ID |
| `ZOHO_CLIENT_SECRET` | Zoho OAuth app secret |
| `ZOHO_REFRESH_TOKEN` | Long-lived token (never expires) — used to get fresh access tokens |

The Zoho OAuth app is registered at [accounts.zoho.com/developerconsole](https://accounts.zoho.com/developerconsole) under the name "TimeHound". The refresh token was obtained once during setup and does not need to be renewed.

If you ever need to re-authenticate (e.g. if the refresh token is revoked), run:
```bash
npx tsx scripts/zoho-auth.ts
```
Then update `ZOHO_REFRESH_TOKEN` in `.env` with the new value.

---

## Troubleshooting

**TimeHound takes more than 1 minute to respond**
- The container has a 1-minute hard timeout. If it hits that, the container is killed and you'll get a timeout error in Discord. Try again — if it keeps happening, check NanoClaw logs.

**TimeHound isn't responding in Discord**
- Check that NanoClaw is running: `launchctl list | grep nanoclaw`
- Restart if needed: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`

**"Entries already exist for this week" warning**
- TimeHound checks for duplicates before logging. If you already have entries, it will ask before proceeding. Reply `yes` to overwrite or `no` to cancel.

**Zoho API auth error**
- The refresh token may have been revoked. Re-run `npx tsx scripts/zoho-auth.ts` and update `.env`.

**Friday prompt didn't arrive**
- Check the scheduled task: `sqlite3 store/messages.db "SELECT next_run, status FROM scheduled_tasks WHERE group_folder = 'timehound';"`
