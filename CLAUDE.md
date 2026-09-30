# Midal Cables · Furnace Gas Monitor

Handoff notes for Claude Code. Owner: Mahmood (Assistant Mechanical Engineer, Midal Cables, Bahrain).
The app was built in a claude.ai chat; this file carries the context over.

## What it is
A website that tracks daily natural-gas meter readings for Midal's furnaces and turns them into
consumption analytics. Hosted on **GitHub Pages** (this repo) with a **Supabase** database.

- Furnaces: **HF 1–8** and **TF 1, 2, 5–12** (18 total; no TF 3/4). HF and TF are always analysed as
  separate groups, HF first. Naming is always "HF 3" / "TF 10" (the app normalises "hf3", "HF-03", …).
- Values are **cumulative meter readings** (daily use = today − previous reading). When days are
  missed, the difference is spread evenly across them and marked "Spread". Zero use = idle, never flagged.
- Unusual day = more than ±40 % from the furnace's 30-day median (both configurable in settings).
- Unit: Nm³.

## Files
| File | Purpose |
|---|---|
| `index.html` | Markup + CSS only. **No inline `<script>`** (required by the CSP). |
| `app.js` | All application code (one IIFE). |
| `config.js` | The only file the owner edits: `window.MIDAL_CONFIG = { supabaseUrl, supabaseKey }`. Public anon/publishable key only. |
| `supabase-setup.sql` | Full database setup. Idempotent; re-run it in Supabase SQL Editor after changes. |

**Never commit** the Excel data files (e.g. `gas_readings_cleaned.xlsx`), the Supabase
`service_role`/secret key, the database password, or any login password. The repo is public.

## Roles and logins
Login screen offers two cards: **Supervisor** and **Manager**; user types only a password.
Logins are Supabase Auth users `mahmood.ali@midalcable.com` (manager) and `mahmood02ali@gmail.com` (supervisor)
(mapping is in `CONFIG.managerEmail` / `supervisorEmail`). Passwords live only in
Supabase. Role comes from `public.profiles.role` on the server, never from the button pressed.

- **Manager**: full dashboard — Overview (HF/TF split, Recently added panel with notes and change
  requests), group pages, per-furnace pages, Compare (2–12 furnaces, custom colours, index scale),
  Daily entry table, Import/Export Excel, Furnaces & settings. Auto-logout after 30 idle minutes.
- **Supervisor** (non-technical, on a phone): simplified wizard only. Today/Yesterday buttons →
  one furnace per screen → custom on-screen number pad (digits and `.` only; the phone keyboard never
  opens) → red highlight + confirm dialog for unrealistic numbers (lower than last reading, missing
  decimal, far above/below typical) → quick-note chips (Stopped / Maintenance / Meter problem) →
  review list → Send. Arabic/English toggle. Drafts auto-saved in localStorage. Shows manager's
  change requests with "Check now". Keep this UI minimal: no free typing, big targets.

## Database (see `supabase-setup.sql`)
Tables: `profiles`, `furnaces`, `readings` (PK furnace_id+reading_date), `settings` (single row),
`requests` (manager → supervisor change requests), `readings_log` (audit trail via trigger),
`reviewed_batches` (manager marked a Recently added batch as read; manager only).

Security model — **the database enforces everything; the page only chooses which screen to show**:
- RLS on every table. `readings`, `requests`, `readings_log`: manager only. `furnaces`, `settings`:
  readable by any login with a role, writable by manager only. New logins get **no role**.
- Supervisor never touches `readings` directly. He uses SECURITY DEFINER RPCs:
  `submit_readings(p_date, p_items, p_by)`, `last_readings(p_date)` (last value + rough typical use,
  for typo warnings), `my_submissions()`, `my_day(p_date)`, `my_requests()`.
- `submit_readings` rules: today/yesterday only (Asia/Bahrain) unless an open request exists for
  that furnace/day (then up to 30 days back); never overwrites a reading entered by someone else
  unless requested; ≤100 items; value 0 ≤ v < 1e12, no NaN.
- `anon` has no table privileges at all; functions revoked from `anon`/`public`.
- Check constraints on value range and text lengths.

Tested against real PostgreSQL + PostgREST with direct API attacks (supervisor reading history,
deleting, self-promoting, old/future dates, NaN; anonymous access) — all blocked.

## Front-end security (keep these when editing)
- **CSP** `<meta>` in `index.html`: `script-src 'self' https://cdn.jsdelivr.net`, `connect-src` to
  `*.supabase.co`, `default-src 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`.
  So: no inline scripts, no `onclick=""` attributes, no `eval`. Attach handlers in `app.js`.
- **SRI** `integrity="sha384-…"` on the three CDN libraries (Chart.js 4.4.1 UMD, SheetJS xlsx 0.18.5,
  @supabase/supabase-js 2.117.2 UMD). If you change a version, recompute:
  `curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A`.
- All user text rendered through `esc()`; toasts/dialogs use `textContent`.
- Frame-busting at the top of `app.js`; `body` stays hidden until it runs.
- CSV export neutralises cells starting with `= + - @` (formula injection).
- `noindex` robots meta, `no-referrer`.
- Known limitation: SheetJS 0.18.5 has published CVEs for crafted files (prototype pollution, ReDoS).
  Only the manager imports, and only his own files. Upgrading needs SheetJS's own CDN (not on npm).

## Code map (`app.js`)
Helpers & state → `Store` (modes: `sb` = Supabase, `local` = browser-only practice mode, `db` =
legacy claude.ai artifact storage; the `db` paths are unused on GitHub Pages) → analytics
(`analyse()`, `sumRange()`, baselines) → groups/rail/switcher/find (Ctrl+K) → Overview, Group,
Compare, Furnace views → Daily entry (manager table) → Furnaces & settings → legacy in-Claude
supervisor code → Recently added + requests → Data entry check (`checkPanel()`: missing days, unrealistic readings, notes/late entries, latest activity; Overview) → Supabase layer (`sbBoot`, login screen, `sbLoadAll`,
`sbPoll` every 60 s, `sbWrite` upserts in batches of 500) → simple supervisor wizard (`SS`, `sp*`
functions, `supCheck()` rules) → Import/Export → boot.

## Status / next steps
1. Owner still has to: create the Supabase project, run `supabase-setup.sql`, turn **off** public
   sign-ups, create the two users, run the two role `update` lines at the bottom of the SQL, and put
   Project URL + publishable key into `config.js`.
2. GitHub Pages: Settings → Pages → Deploy from branch `main` / root; tick **Enforce HTTPS**.
3. Import the cleaned history as manager (Import & export). The cleaned Excel stays off GitHub.
4. Recommended to the owner: much stronger manager password (the chosen ones differ only by
   letter case), 2FA on GitHub and Supabase, weekly Excel export as backup (free Supabase tier has no
   downloadable backups).
5. Ideas not built yet: PWA/offline install for the supervisor phone, QR code per meter opening that
   furnace, email/WhatsApp alert to the manager on unusual readings.
