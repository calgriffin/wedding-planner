# Wedding Planner

A private, all-in-one wedding planning web app. One half is a plan portal used
only by the couple; the other half is the public guest-facing site that the
couple's guests see. The whole thing runs as a single Cloudflare Worker backed
by a D1 database, with a React/TypeScript UI embedded into the Worker at build
time.

> **Privacy note:** this repository intentionally contains **no personal data**.
> Couple names, the wedding date, and venue names are entered in the plan's
> **Setup** screen and injected into the guest pages at **request time**. The
> code and docs use neutral placeholders (`[PARTNER NAMES]`, `[wedding date]`)
> and fake test fixtures only. No credentials live in this repo either — the
> deploy pipeline generates its own token.

---

## Contents

- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [The plan portal](#the-plan-portal)
- [The guest-facing site](#the-guest-facing-site)
- [Guest modes & preview hosts](#guest-modes--preview-hosts)
- [Setup-driven rendering](#setup-driven-rendering)
- [Authentication & security](#authentication--security)
- [Family payment portal](#family-payment-portal)
- [Data model](#data-model)
- [API surface](#api-surface)
- [Local development](#local-development)
- [Testing](#testing)
- [Deploying](#deploying)
  - [Push-to-deploy (Workers Builds)](#push-to-deploy-workers-builds)
  - [Manual deploy](#manual-deploy)
- [Operating rules](#operating-rules)
- [Ongoing operations log](#ongoing-operations-log)

---

## Architecture

```
┌─────────────────────────── GitHub (private repo) ───────────────────────────┐
│  frontend/  (React + TS + Vite)      worker/  (Cloudflare Worker + D1)     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ git push to main
                                       ▼
                     Cloudflare Workers Builds (CI/CD)
                         build → deploy → verify
                                       ▼
                         Cloudflare Worker "wedding-planner"
                       ┌──────────────┬───────────────────┐
                       │   D1 database (SQL)             │
                       └──────────────┴───────────────────┘
```

- **Worker** (`worker/`) — a single Cloudflare Worker script. It hosts the API
  (route table in `worker/src/index.js`), the SPA bundle (compiled from the
  frontend and embedded via `src/assets.js`, generated), and five static
  guest-facing HTML pages that are server-rendered from Setup data per request.
- **Frontend** (`frontend/`) — React 18 + TypeScript + Vite SPA for the plan
  portal. Built with `npm run build`; the output is embedded into the Worker by
  `worker/scripts/generate-assets.js` (`npm run gen-assets`) so the whole app
  is a single deployable artifact.
- **Database** — Cloudflare D1 (SQLite). Schema lives in
  `worker/migrations/`. Migrations are **additive-only**; existing rows are
  never destructively altered. Backups: D1 **Time Travel** is always on
  (automatic bookmarks, restore to any minute within ~30 days — a recorded
  restore point lives in the handoff). Live D1 migrations are applied
  out-of-band via the account API and **must also insert the matching
  `d1_migrations` row** so wrangler bookkeeping stays truthful (repaired
  2026-09-25 for 0003–0006).

### Key flow: how guests see the site

1. A guest hits the apex domain (or one of the `v1`–`v5` preview subdomains).
2. The Worker checks the host, determines the active **mode** (teaser,
   countdown, rsvp, wedding-day, thank-you) and renders the matching static
   page **server-side**, pulling couple names, the wedding date, and ceremony /
   reception venues from the `setup` table at request time.
3. In **rsvp** mode, guests get the one-page v3 guest site (published content)
   with the RSVP journey: enter their access code → a 3-step form
   (details → review → sent) with the couple's configured meal options,
   required questions, and a change-your-response path for households who have
   already replied — then an add-to-calendar success screen.

### Preview hosts

`v1`–`v5` subdomains of the apex domain are the couple-only sandboxes — one per
mode — and are **hard-gated**: only browsers with a valid plan-portal session
cookie may load them. Everyone else gets a static "preview ended" screen with
no app bundle, no API calls, and no data. The live apex serves whichever mode
is currently switched on.

---

## Repository layout

```
wedding-planner/
├── frontend/                     React/TS plan portal (Vite)
│   ├── src/
│   │   ├── api/client.ts         typed API client (entire backend surface)
│   │   ├── pages/                dashboard, timeline, setup, tasks, budget,
│   │   │                         payments, guests, suppliers, decisions,
│   │   │                         seating, events, rsvp import, wedding day,
│   │   │                         guest tools, guest website editor,
│   │   │                         email & reminders
│   │   └── pages/guest/          public guest site pages (home, access, rsvp,
│   │                             details)
│   └── dist/                     build output (gitignored; embedded at deploy)
├── worker/
│   ├── migrations/               0001_init.sql … 0012_plus_ones.sql
│   │                             (append-only; 0009 adds payments.family_visible,
│   │                             0010 the family access list)
│   ├── src/
│   │   ├── index.js              Worker: API routes + static guest page renderers
│   │   ├── family.js             family payment portal (family.* host)
│   │   ├── family-access.js      family access list + Access policy sync
│   │   ├── access.js             Cloudflare Access JWT verification
│   │   ├── mcp.js                remote MCP server
│   │   └── assets.js             generated SPA bundle map (gitignored)
│   ├── coming-soon-page.html     reference archives of the static guest pages
│   ├── countdown-page.html         (live rendering injects names/dates from
│   ├── weddingday-page.html           Setup at request time)
│   ├── thankyou-page.html
│   ├── test-local.mjs            end-to-end suite run against a local Worker
│   ├── verify-live.mjs           live-deploy spot checks
│   └── wrangler.toml             Worker / D1 bindings
├── demo-preview-handoff.txt      running operational log (no credentials)
├── .gitignore
└── README.md
```

---

## The plan portal

Sign in with the portal password (set in the live D1 — never stored in this
repo) → 30-day session cookie. Modules:

| Module | What it does |
|---|---|
| **Assistant** | AI chat with the planner (same assistant as email), shared by both partners: it updates the plan, proposes risky changes behind a Confirm button, reads attached PDFs/photos, and asks you questions (mid-chat, a daily check-in, a one-off launch review, and questions from the email assistant) with push notifications and an email fallback. A chat bubble opens it from every page. See [Assistant chat](#assistant-chat-in-the-app). |
| **Dashboard** | Overview of progress, upcoming dates, budget health. RSVP progress card shows reply rate (% of invited guests who responded) with a stacked coming·declined·pending bar, reply counts and the RSVP close date. |
| **Timeline** | One calendar across every dated thing — tasks, payments, supplier deadlines, RSVPs, appointments, decisions and events. Click a day to see what's happening and add appointments on the spot. |
| **Setup** | Couple names, wedding date, ceremony/reception venues, budget ceiling + contingency %, guest target, priorities, non-negotiables. These values feed the guest pages at request time. Also home to **AI assistant access** (MCP connection links) and the full-backup download. |
| **Tasks** | Milestones organised into stages; deadlines auto-recalculated from the wedding date. Add, complete, drag between stages. |
| **Budget** | Categories + items with quoted/committed/paid amounts; contingency tracking for categories and the total. |
| **Payments** | Payment records linked to budget items/suppliers; deposit vs balance. Each payment can carry an **invoice link** — paste the OneDrive/SharePoint/Drive share URL (there's a **Paste** button for the long ones) plus an optional label, and the row shows a clickable paperclip. Only `http(s)` links are ever stored or rendered, so a `javascript:`/`data:` URL is rejected rather than becoming a stored-XSS vector. |
| **Guests** | Households with individual guests; invitation & RSVP tracking (attendance, dietary, accessibility); access codes per household for the RSVP page. A **Song requests** tab collects the one song each guest adds on the RSVP form, with a "Copy all for the DJ" button. |
| **Suppliers** | Suppliers with venue/booking status, quotes, capacity, payments, and an optional **decision deadline** ("confirm by") that appears on the Master Timeline. |
| **Decisions** | Decision log: what was decided, when, linked options/costs. |
| **Seating** | Table planning for the wedding day. A **Room plan** tab turns tables into a draggable floor plan (positions saved per table, adjustable room canvas, print-ready), with an unseated-guest tray alongside the classic table cards and logistics. |
| **Events** | Pre/post wedding day events with per-event guest attendance. |
| **RSVP import** | Paste a CSV of RSVP responses; the app matches by invitation code (first) then full name, flags ambiguities, and **never silently overwrites** matched guest records. |
| **Wedding Day** | Run of show and day-of details. |
| **Guest Tools** | Copy/paste the guest invitation links (with codes) and the household access-code print sheet. RSVP reminders now log **and** email the household (when Email is configured). |
| **Guest Website** | Edit the public v3 guest site: welcome & appearance, schedule of the day (choose which events from the Events list are guest-visible, with start/end times and a guest-facing note), getting there & staying, what to expect, menu, FAQs (starter questions + reorder/visibility), gifts & contact, meal options for the RSVP form, and search-engine indexing. Draft → private preview on `v3.` → **Publish**. A readiness checklist shows what's still missing; nothing reaches guests until you publish. |
| **Email & Reminders** | Mailchimp-style emailing from the plan: compose in **plain text or full HTML**, pick an audience (all / unresponded / confirmed / declined / a specific household), preview recipients + a **live rendered preview** (desktop/mobile, sandboxed iframe), **send a test draft to your own inbox**, then send from the planner's own mailbox. Every email is a polished HTML brand template (button as fallback for non-HTML clients) with merge tags `{name}`, `{code}`, `{rsvp_url}`, `{rsvp_button}`. Also a **morning brief to the couple**, written by Claude from the plan (what needs doing, what's overdue, payments and decisions coming up), sent on demand or automatically each morning, with a preview; they can reply to it to update the plan. The page also shows the **email assistant**'s recent activity and the current settings, which are read-only because they live in the Worker's variables. A **simulation mode** lets the couple trial sending without delivering anything. |

---

## The guest-facing site

Five server-rendered static pages, one per mode:

| Mode | Host | Page |
|---|---|---|
| `teaser` | apex (when live) / `v1` | "Coming soon" — couple names + animated laurel wreath, light/dark themes, Google Fonts |
| `countdown` | apex (when live) / `v2` | Countdown to the wedding date (client-side ticker seeded server-side) |
| `rsvp` | apex (when live) / `v3` | The guest website: a one-page, mobile-first site (sticky section nav, full-height hero, countdown, at-a-glance, schedule timeline, getting there, what to expect, menu, Q & A, gifts, contact) with the access code + RSVP form flows. Its look is scoped to `.gs` styles and shared through `pages/guest/GuestChrome.tsx` |
| `weddingday` | apex (when live) / `v4` | "Today's the day" — the date, ceremony & reception venues, thank-you message |
| `thankyou` | apex (when live) / `v5` | "Thank you" page with the date |

All five pull names / date / venues from Setup. If Setup values are blank they
render neutral placeholders (`[PARTNER NAMES]`, `[wedding date]`) so the page
is always valid.

---

## Guest modes & preview hosts

- Mode selection is per-request, driven by the `guest_settings` row
  (`guest_mode`, go-live dates) combined with the host. RSVPs are open
  exactly while the RSVP (v3) site is the live one; optional open/close dates
  can only narrow that:
  - `vN.the-apex-domain` forces that mode (`v1` → teaser, `v2` → countdown,
    `v3` → rsvp, `v4` → weddingday, `v5` → thankyou).
  - The apex follows the go-live schedule (`teaser_live_at` … `thankyou_live_at`):
    the most recently passed entry wins. From the start of the wedding date it
    shows the Wedding Day page, and from the day after it shows Thank You, with
    nothing scheduled. With no passed entries it uses the manual `guest_mode`
    (default `countdown`).
- Preview subdomains require a valid plan session (the device whitelist *is*
  the session cookie). Unauthenticated visitors on preview hosts only ever see
  the leak screen.
- RSVP is invitation-only: each household has a short access code; the RSVP
  form is reachable with a code, and responses update only already-matched,
  pending guest records. A code is six random characters shown as two groups
  of three, e.g. `7K2-QM4` (no 0/O or 1/I; guests can type it in any case,
  with or without the dash).
- Guests can correct their own details on the RSVP form: **Edit details** on
  each guest's card opens first name, last name and (for everyone except the
  primary guest, whose contact is the household one at the top) their own
  email and mobile. A blank never replaces a saved value, and a bad email is
  refused before anything is saved.
- A guest's **Notes** in the plan are private to the couple: they are never
  sent to the guest and the RSVP never changes them. The RSVP form's free-text
  box ("Message for the couple") saves to its own field, `rsvp_message`
  (migration 0013), shown read-only on the guest in the plan.
- The household can correct its name and postal address on the RSVP form too:
  **Edit name & address** on the household card at the top. Same rule: a
  blank never replaces a saved value.
- Plus-ones: name one as their own guest, or tick **Offer a plus-one on their
  RSVP** on a guest and leave the name out. The guest is then asked on the
  RSVP form whether they are bringing someone and adds the name themselves
  (or leaves it blank, saved as "Guest of …" until they know). An offered
  plus-one counts in the dashboard, Guests, household and seating numbers
  until the guest answers; then it is either a confirmed guest of its own or
  dropped from the count.

---

## Setup-driven rendering

The static pages contain **zero** hardcoded personal data. At request time the
Worker loads the `setup` row and injects:

- partner 1/2 names → HTML titles, meta descriptions, and the name headers on
  every page (HTML-escaped via `escHtml`);
- `wedding_date` → the countdown target and formatted date lines;
- `ceremony_venue` / `reception_venue` → the wedding-day page venue block.

Leaving a value blank renders a neutral placeholder instead of failing. Change
names or dates in Setup and the guest pages update on the next request — no
redeploy needed for content changes (a redeploy *is* needed for code changes).

### Guest website content (v3) — draft → publish

The v3 guest site is written by the couple in the plan portal. Content is
settings-stored JSON (`guest_site_draft` / `guest_site_published` /
`guest_site_published_at`) with a strict isolation rule:

- **Draft** is only ever served to the couple's own session (the `v3.` preview
  host or `?draft=1` with a valid plan cookie).
- **Published** is the only content the public API (`/api/guest/site`) serves.
  Publishing copies the draft to the published snapshot and stamps the time.
- Every section hides itself on the site until the couple fills it in; FAQs
  must be marked visible **and** answered to appear. An anonymous, approximate
  view counter (`guest_site_views`) increments on public fetches for the
  portal's readiness readout — no per-visitor tracking.
- **Access-code gate**: the public site shows only the couple's names, the
  wedding date and the RSVP window. Every detail — venue, travel, schedule,
  menu, FAQs, gifts, contact, events — unlocks with the guest's RSVP access
  code (`POST /api/guest/site/unlock`); the couple's draft preview
  (`?draft=1` with a signed-in session) skips the gate. The unlocked payload
  never contains household/guest data (that stays on `/api/guest/access`).
- Guest-visible events come from the Events list: an event shows on the site
  only when `guest_visible` is set (with optional `start_time` / `end_time` /
  `guest_description`). Internal notes, budgets and guest counts never leave
  the plan portal.
- **Same location**: ticking "Ceremony and reception are at the same location"
  (`same_venue`) folds the two blocks into a single **Venue** — the at-a-glance
  and Getting-there sections each show one venue instead of Ceremony +
  Reception, and the editor hides the reception fields.
- **Caterer dietary matrix**: the RSVP form captures each guest's meal choice,
  free-text dietary requirements, and (once per household) an email + mobile
  number — stored on the primary guest. The **Caterer Matrix** page
  (`/caterer-matrix`, read-only `GET /api/rsvp/dietary-matrix`) gathers it all
  into one printable sheet grouped by seated table, falling back to household
  for the unseated, with a meal-breakdown summary and a **Print/PDF** button
  plus **CSV download** for the venue. Reuses the existing `guests` columns —
  no schema change.
- Search indexing is opt-in (`search_index`); off by default, the site serves
  `noindex, nofollow`.
- **Media & sharing**: the editor can **upload** a hero photo (JPEG/PNG/WEBP/
  GIF, ≤5MB, magic-byte sniffed) into the R2 media bucket (`MEDIA` binding),
  served same-origin from `/media/*` on every host and in every live mode
  (cross-mode pass-through) with immutable caching — previous hero photos are
  retired on re-upload. The SPA HTML shell injects **Open Graph + Twitter** meta
  so shared links show a card, but the shell is public, so the card carries
  only the couple's names and a generic line — never the published heading,
  welcome text or hero photo, which stay behind the access code.
- **PWA ("Add to Home Screen")**: the guest site is installable on phones/desks
  as an app — hand-rolled, zero new dependencies. `public/manifest.webmanifest`
  (name, theme, standalone display) + three generated PNG icons
  (`npm run gen-icons` → `scripts/gen-pwa-icons.mjs`, Node built-ins only) +
  a hand-written `public/sw.js`. The service worker never touches `/api/*` or
  `/media/*` (network always fresh), cache-firsts the hashed `/assets/*`, and
  gives offline navigation via a cached shell. Served by the Worker with the
  right content-types; `sw.js` + manifest get `Cache-Control: no-cache` so
  updates propagate. Registered in `main.tsx` for production builds only.

---

## Authentication & security

- **Plan portal — Cloudflare Access (preferred)**: when the Worker has
  `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` set, Cloudflare Access (Zero Trust)
  handles sign-in at the edge. The Worker verifies the signed Access JWT
  (`Cf-Access-Jwt-Assertion`, RS256; it checks issuer, audience and expiry
  against the team's `/cdn-cgi/access/certs`) on every gated request. The
  password endpoints (`/api/auth/init`, `login`, `change-password`) return
  `410`, and the UI shows a "Continue to sign in" button instead of a
  password box. The optional `ACCESS_ALLOWED_EMAILS` var adds an allowlist
  on top of the Access policy. See [Cloudflare Access](#cloudflare-access).
- **Plan portal — password (fallback)**: if the Access vars are unset, a single
  password (stored hashed in D1, set once during first-run setup — never in
  this repo). Login sets an HttpOnly, Secure, SameSite cookie (`wp_session`)
  with a 30-day lifetime.
- **Preview gate**: `v1`–`v5` hosts check the session (the Access JWT, or the
  password cookie in fallback mode) before serving anything. The SPA bundle
  itself is never served to non-whitelisted devices.
- **Guest API**: public reads only; mutations are gated by access-code /
  household matching and the RSVP window. An RSVP submit only accepts the
  values the form sends (status `confirmed`/`declined`), caps every free-text
  field, and is written as one D1 batch, so it saves completely or not at all.
- **Code guess limit**: 5 wrong access codes from one visitor inside 15
  minutes time that visitor out of every code endpoint (site unlock, RSVP
  access, RSVP submit, code lookup) for 15 minutes, with a 429 and a "wait N
  minutes" message. It is per visitor (a salted hash of the IP, kept in a
  short-lived `settings` row), so one person guessing never locks out other
  guests. A correct code does not clear the count. The optional
  `CODE_GUESS_EXEMPT_IPS` Worker secret (comma-separated IPs) lists
  connections that are never counted or timed out, for the couple's testing.
- **Tokens**: preview-token links can be minted per host for limited access.
- **Credentials**: none stored in the repo. The CI pipeline auto-generates its
  own deploy token per build — GitHub secrets are not required.

### Cloudflare Access

One-time setup in the Cloudflare dashboard (the Zero Trust free plan is enough).
Access applications live in the same Cloudflare account as the
zone for your `SITE_DOMAIN`.

1. **Zero Trust → Settings**: note your team domain
   (`<team>.cloudflareaccess.com`) and enable a login method. The built-in
   *One-time PIN* emails a code; Google also works.
2. **Access → Applications → Add → Self-hosted**, named "Wedding planner":
   hostnames `plan.<SITE_DOMAIN>` and `v1`…`v5.<SITE_DOMAIN>`.
   Policy: *Allow*, include *Emails* = both partners. Copy the app's
   **Application Audience (AUD) tag**.
3. **Keep the AI connector reachable.** The `/mcp/<token>` link is its own
   credential, so AI clients must not hit the Access login. Preferred: give
   it a dedicated hostname outside Access. Attach it to the Worker as a
   Custom Domain (Worker → Domains) and set `MCP_PUBLIC_ORIGIN` to it (e.g.
   `https://mcp.example.com`). New links from Setup use that host, and the
   Worker serves only `/mcp` there (everything else is 404). Existing links
   keep working once you swap the host part, because the token is
   unchanged. Alternative: a Bypass (Everyone) application on the plan host
   for the paths `mcp`, `mcp/*`, `.well-known` and `.well-known/*`.
4. **Worker → Settings → Variables and Secrets**: add `ACCESS_TEAM_DOMAIN`
   and `ACCESS_AUD` as *Secrets* (the next deploy wipes plain-text dashboard
   vars), or put them under `[vars]` in `worker/wrangler.toml`.

Do step 4 last. As soon as both vars exist the password stops working, so
Access must already protect the hosts. To roll back, delete either var and
the password login (with its stored hash) works again.

Access does not cover the public apex guest site or its `/api/guest/*` calls
(never put the apex behind Access). The `?pt=` preview-token links also stop
working on Access-protected hosts, because Access blocks visitors before the
Worker checks the token.

### AI assistant access (MCP)

Either partner can connect their own AI assistant (Claude, ChatGPT, or any
MCP client) to read and edit the plan. `worker/src/mcp.js` is a stateless
Streamable-HTTP MCP server with no dependencies, at `POST /mcp/<token>` (or `/mcp` with
`Authorization: Bearer <token>`).

- **Links**: Setup → *AI assistant access* mints one link per person. The
  link is shown once; only its SHA-256 is stored (`settings.mcp_tokens`,
  excluded from the backup export). Revoke any link on its own; revocation is
  immediate. Links are independent of the portal password.
- **Tools**: ~50 tools — overview/timeline/budget/guests/suppliers/seating/
  wedding-day reads, plus create/update across the plan. Each tool is
  dispatched in-process through the normal `/api` route handler, so it gets
  identical validation.
- **Out of scope by design**: sending email, publishing the guest site,
  changing the live guest mode / RSVP window, passwords, deleting
  guests/households/suppliers, and RSVP import review.
- **Connecting**: Claude → Settings → Connectors → *Add custom connector* →
  paste the link. ChatGPT → Settings → Apps & Connectors → Advanced →
  Developer mode → *Create* → paste the link, "No authentication".

---

### Email assistant

The planner has its own mailbox. The couple email it (or forward things to
it); Claude reads each message, updates the plan through the same tools the
MCP server exposes, and replies. Code: `worker/src/assistant.js` (pipeline and
rules) and `worker/src/mailbox.js` (IMAP/SMTP over Worker TCP sockets, because
the domain's mail is hosted outside Cloudflare).

- **Checked every 15 minutes** by the existing cron; `POST /api/assistant/run`
  checks immediately and `GET /api/assistant/status` lists recent activity.
- **Only the allow-listed addresses count.** Mail from anyone else is logged
  and ignored, and replies go to the allow-listed addresses and nobody else.
  The model has no way to send email or choose recipients.
- **Cc/bcc with other people = a separate note.** If anyone outside the
  allow-list is on the email (or the mailbox was bcc'd), the plan is updated
  and the couple get a new "Filed: ..." email of their own. Nothing is ever
  sent on the original thread.
- **Confirm first** for marking payments paid, deletions and master settings:
  the change is queued with a code and runs only when one of the couple
  approves it in a reply on the same thread.
- **Morning brief:** at 08:00 UK time (`DAILY_BRIEF_TIME`) Claude writes the
  day's email from the plan and it is sent to the couple from the mailbox, so
  it can be replied to ("done the florist one"). If the model is unavailable
  the plain digest is sent instead.
- **Simulation:** `ASSISTANT_DRY_RUN=1` reads and replies but saves nothing.
- **One sender for everything:** guest emails and RSVP reminders go out from
  the same mailbox. There is no separate email provider.

Setup is Worker variables/secrets only (listed in `worker/wrangler.toml`),
plus migration `0011_assistant.sql`. Email settings are not stored in the
database and cannot be edited in the app; the Email & Reminders page shows
them read-only alongside the assistant's activity. Tests: `worker/test-assistant.mjs` runs
the real Worker against a fake mailbox and a fake Claude API.

### Assistant chat (in the app)

The same assistant, in the plan portal: **Assistant** in the nav, plus a chat
bubble on every planner page. Same Claude model (`ASSISTANT_MODEL`), same API
key (`ANTHROPIC_API_KEY`), same planner tools as the MCP server and the email
assistant. Code: `worker/src/chat.js` (conversations, the agent, questions,
check-ins), `worker/src/routes/chat.js`, `worker/src/push.js` (Web Push),
`worker/src/notify.js`; UI in `frontend/src/pages/Assistant.tsx` and
`frontend/src/components/chat/`. Migration `0014_assistant_chat.sql`.

- **Shared by both partners.** Any number of chats; both of you see every one,
  each message labelled with who wrote it (the Cloudflare Access email; a
  partner can set their display name on the Assistant page). Chats can be
  archived. New messages from your partner or the assistant show as unread.
- **It changes the plan** the same way the email assistant does. Marking a
  payment paid, deleting anything and changing master Setup appear as a
  **Confirm / Cancel** card under its message; the change only runs when one
  of you presses Confirm (the model cannot confirm its own proposals).
- **Attachments**: up to 5 PDFs or photos (4 MB each; big photos are shrunk in
  the browser). They go to Claude with that message only; just the file names
  are stored.
- **It asks you questions** (question cards with tap-to-answer options, or type
  your own answer; either of you can answer, once):
  - mid-conversation, when it needs something only you know (`ask_couple`);
  - by itself in a **daily check-in** (at `CHAT_CHECKIN_TIME`, default the
    brief's time): it reviews the plan read-only and posts a "Questions from
    your planner" chat only when there is something worth asking, never
    repeating a recent question. **Any questions for us?** on the Assistant
    page runs one on demand;
  - **once at launch**: the first cron run with this code does a fuller
    one-off review ("Getting started: a few questions"). It is recorded in
    `settings.chat_launch_checkin` and never repeats (retried up to 3 times
    only if the model fails);
  - **from the email assistant**: when an email needs an answer it also calls
    `ask_in_app`, so the question appears in an "Email: …" chat (with the
    email excerpt) and can be answered there instead of by reply.
  - **Skip** closes a question that doesn't matter without answering it. It
    shows as skipped (and by whom), and the check-ins are told never to ask
    it again.
  - **No pile-ups**: "Any questions for us?" opens the questions still
    waiting instead of asking more, and the daily check-in waits while any
    from the past 7 days are open. Only one check-in runs at a time
    (`settings.chat_checkin_lock`).
- **Notifications**: Web Push to every device that turned them on (Assistant →
  Notifications; on iPhone/iPad the planner must be added to the Home Screen
  first, iOS 16.4+). Questions ping both of you; any chat activity pings the
  other partner. The device that sent a message is never pinged about it.
  Anyone with no device that took the push gets a short email from the
  planner mailbox instead (chat activity at most once per chat per hour;
  questions every time; email-assistant questions push only, since the reply
  email already carries them). Push payloads are end-to-end encrypted
  (RFC 8291) and signed with the planner's own VAPID key (RFC 8292), generated
  on first use into `settings.push_vapid` (excluded from the backup). Only
  well-known push services (Google, Apple, Mozilla, Microsoft) are ever
  contacted.
- **Notification settings, per partner** (Assistant → Notifications):
  everything, or questions only; and optional **quiet hours** (UK time,
  may cross midnight). During quiet hours nothing is sent; what came in is
  held (`settings.chat_notify_held:<email>`, not in the backup) and goes out
  as one "While you were away: …" summary on the first cron run after they
  end. Stored in `settings.chat_notify_prefs`. In password mode there is one
  shared setting for both of you.
- **Usage & cost** (Assistant → Usage & cost): every model run (chat replies,
  check-ins, emails the email assistant handled, the AI-written morning
  brief, brief previews) is logged in `ai_usage` (migration 0015) with its
  tokens split as Anthropic bills them: uncached input, cache writes, cache
  reads, output. The page shows today, this month, the last 30 days and all
  time, by feature, by who asked and by month, in US dollars at Anthropic's
  list prices (`PRICES` in `worker/src/ai-usage.js`, dated; cache writes
  1.25× input, cache reads at each model's rate). History from before 0015 is
  backfilled from the stored token counts and costed at the full input price
  (an upper estimate, labelled on the page). It is an estimate: the Anthropic
  invoice is the final word. `GET /api/ai/usage`.
- **Replies run in the request** and are kept alive with `waitUntil`, so a
  reply still lands (for both of you) if the page is closed mid-way. A reply
  stuck for 10 minutes is marked failed. `CHAT_DAILY_LIMIT` (default 200)
  caps assistant replies per day.
- `ASSISTANT_DRY_RUN=1` applies here too: it replies but saves nothing.
- Without `ANTHROPIC_API_KEY`, chats still work between the two of you; nobody
  replies.

## Family payment portal

A read-only "which payments are due next" page for family who are helping
pay for the wedding, on its own host — `family.<SITE_DOMAIN>`
(override with the `FAMILY_HOST` Worker variable) — with its **own
authentication layer: Cloudflare Access (Zero Trust)**. Family never get the
plan password, and the plan session cookie is ignored on that host.

- **What family see**: the next payment (amount, what it's for, supplier,
  due date / days overdue), totals (due in the next 30 days, still to pay,
  overdue or paid so far), everything coming up after that, and the last
  five payments made. Never shown: references, notes, invoice links, the
  budget, guests or anything else.
- **Per-payment control**: each payment has **Show on family portal**
  (`payments.family_visible`, migration 0009, default on). Untick it for
  anything private. **Payments → Family view** previews exactly what family
  see (`GET /api/family/preview`, plan session required).
- **Who gets in**: the couple manage the list on **Payments → Family
  access** — add or remove an email address and it takes effect without
  opening Cloudflare (see [Managing family access](#managing-family-access)).
- **Isolation**: the family host is matched first in the fetch handler and
  only serves `GET /` — `/api`, `/mcp`, `/media` and the SPA bundle all 404
  there. The page is server-rendered with no JavaScript, a
  `default-src 'none'` CSP, `no-store` and `noindex`.
- **Auth** (`worker/src/access.js`): the Worker does not trust that a request
  reached it "through" Access — it re-verifies the `Cf-Access-Jwt-Assertion`
  JWT (or `CF_Authorization` cookie) itself: RS256 signature against the
  team's `/cdn-cgi/access/certs` keys (cached 10 min, refreshed on an
  unknown `kid`), issuer, audience, `exp`/`nbf`. **Fails closed**: until
  `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are set the host shows "Almost
  ready" (503) with no data.
- **Second lock** (`worker/src/family-access.js`): a valid Access identity is
  not enough. The signed-in email must be one of the couple or on the family
  list in D1 right now, otherwise the page answers 403 "Not on the list".

| Worker variable | Value |
|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` (Zero Trust → Settings → Custom pages / team domain) |
| `CF_ACCESS_AUD` | The Access application's *Application Audience (AUD) Tag* |
| `CF_API_TOKEN` | Family-list sync. Custom API token, account-scoped, with the single permission *Access: Apps and Policies → Edit* |
| `CF_ACCOUNT_ID` | Family-list sync. The Cloudflare account id |
| `CF_ACCESS_FAMILY_POLICY_ID` | Family-list sync. Id of the reusable "Family" Access policy |
| `FAMILY_HOST` | Optional. Defaults to `family.<SITE_DOMAIN>` (`SITE_DOMAIN` is set in `worker/wrangler.toml`) |

Set these as **Secrets** (Workers → your Worker → Settings →
Variables and Secrets) so `wrangler deploy` from Workers Builds keeps them.

### Turning it on (Cloudflare Zero Trust)

1. **Zero Trust → Settings → Authentication**: add a login method family can
   use — *One-time PIN* (emailed code, nothing to install) is simplest.
2. **Access → Policies → Add a policy**: a reusable policy named "Family",
   action **Allow**, *Include → Emails* → the couple's two addresses. (Never
   *Include → Everyone* or an email domain with one-time PIN — that lets any
   address in.)
3. **Access → Applications → Add → Self-hosted**: domain
   `family.<SITE_DOMAIN>` (whole host), attach the "Family" policy,
   session duration 1 month.
4. Copy the application's **AUD tag**; set `CF_ACCESS_AUD` and
   `CF_ACCESS_TEAM_DOMAIN` on the Worker.
5. Apply migrations 0009 and 0010 to live D1 (and their `d1_migrations` rows
   — see the handoff), then deploy.
6. **Workers → your Worker → Settings → Domains & Routes → Add
   custom domain** `family.<SITE_DOMAIN>` (creates the DNS record).
   Do this last, after the deploy, so the host is never served by a Worker
   without the family code.
7. Visit the family host in a private window: Access login → the plan.

### Managing family access

**Payments → Family access** lists who may open the family portal. Family
sign in at `family.<SITE_DOMAIN>` with a code emailed to the address
on the list — no password, nothing to install.

- **D1 is the source of truth** (`family_members`, migration 0010: `id`,
  `email` unique and lower-cased, `label`, `created_at`; at most 50
  addresses). The couple's own addresses are not stored there: they come
  from the plan's email settings (`couple_email` / `couple_email_2`, plus
  `ACCESS_ALLOWED_EMAILS` if set) and are always allowed.
- **Sync to Cloudflare**: after every add or remove the Worker reads the
  reusable "Family" Access policy and writes back its include list as one
  `{ "email": { "email": … } }` rule per address — the couple first, then
  family (`PUT /accounts/{account_id}/access/policies/{policy_id}`). It keeps
  the policy's name, Allow action and other settings, and refuses to send
  anything if the list would be empty, the couple's addresses are unknown,
  or the policy is not an Allow policy. It never sends *Everyone*.
- **If the sync fails** the change is still saved; the card shows "Saved,
  but not yet live in Cloudflare" with the last attempt time and a **Sync
  now** button. Without the three sync secrets it shows "Saved here — sync
  not set up" and nothing crashes; the Worker's own list check still applies.
- **Removing someone** stops new sign-in codes for that address (once
  synced), and the Worker's list check blocks them on their very next
  request. Their existing Cloudflare Access session is not revoked — it
  lasts until it expires (up to a month) — but it no longer opens the page.
- **Sync secrets**: create a custom API token in the Cloudflare dashboard
  (My Profile → API Tokens), scoped to this account, with only *Access: Apps
  and Policies → Edit*. Set it yourself with
  `npx wrangler secret put CF_API_TOKEN` from `worker/`; then
  `CF_ACCOUNT_ID` and `CF_ACCESS_FAMILY_POLICY_ID` the same way.
- **Privacy**: family addresses live only in live D1 and the Access policy.
  They are never exposed through the MCP tools, logs mask them
  (`m***@e***.com`), and the stored sync status holds counts only.

---

## Data model

Tables (see `worker/migrations/0001_init.sql`, `0002_guest_portal.sql`,
`0003_master_timeline.sql` and `0004_email.sql` for the canonical schema):

| Table | Purpose |
|---|---|
| `setup` | Couple names, wedding date, venues, budget ceiling/contingency, guest target, priorities, non-negotiables (single `main` row). |
| `stages` / `tasks` | Milestones and to-dos with deadlines recalculated from the wedding date. |
| `budget_categories` / `budget_items` | Budget tree with quoted/committed/paid amounts and contingency. |
| `payments` | Payment records linked to items/suppliers, with an optional `invoice_url` + `invoice_label` (OneDrive/SharePoint share link, http/https only) and `family_visible` (0009; 1 = shown on the family portal). |
| `family_members` | 0010. Email addresses of family who may open the family portal (`email` unique + lower-cased, optional `label`). The couple are implicit and not stored here. |
| `households` / `guests` | Guest management, RSVP state (attendance, dietary, accessibility), access codes. `guests.plus_one_allowed` / `plus_one_response` (0012) hold a plus-one offered without a name and the guest's answer; an accepted plus-one is a guest row linked by `plus_one_of`. |
| `suppliers` | Vendor records with venue/booking status, quotes, and an optional `deadline` ("confirm by") column for Master Timeline surfacing. |
| `decisions` | Decision log with options and costs. |
| `seating` / `events` | Seating plans and day-of events (events carry a `guest_count`; there is no per-event guest list table). `events` gained guest-presentation fields in 0007 (`guest_visible`, `start_time`, `end_time`, `guest_description`) — only explicitly visible rows surface on the guest site. |
| `appointments` | Couple-managed calendar appointments (fittings, tastings, walkthroughs) shown on the Master Timeline. |
| `email_campaigns` / `email_log` | One row per composed email send (digest / guest campaign / RSVP reminder), plus one row per recipient with per-email provider state. `dry_run` rows are simulation-mode sends (no real email). |
| `chat_conversations` / `chat_messages` / `chat_pending` / `chat_reads` | 0014. In-app assistant chats (kind `chat` / `checkin` / `email`), their messages (with question cards and changes made as JSON; attachments by name only), changes waiting for a Confirm press, and when each partner last read each chat. |
| `push_subscriptions` / `chat_email_notices` | 0014. Web Push endpoints per device (and who turned them on), and the per-chat email-fallback throttle. |
| `ai_usage` | 0015. One row per model run (source `chat` / `checkin` / `email` / `brief`, model, who it was for, uncached input / cache write / cache read / output tokens). Unique on (source, ref), so the backfill in the migration can be re-run safely. Priced when read. |
| `guest_settings` | Live-mode control: `rsvp_open`, `guest_mode`, go-live dates, preview-token list. Guest-website content (draft/published snapshots, published-at, view counter, meal options) lives in the generic `settings` table as JSON, |

Email configuration lives in the Worker's variables and secrets (see
`worker/wrangler.toml`) — not in D1 and never in this repo.

All columns are nullable/de-typed where sensible; migrations are append-only.

---

## API surface

REST-ish JSON over `POST`/`GET` (`worker/src/index.js` route table; typed client
in `frontend/src/api/client.ts`). Families:

- `/api/auth/*` — login, check/refresh session, logout.
- `/api/setup`, `/api/tasks`, `/api/stages` — plan core (auth required).
- `/api/budget/*`, `/api/payments`, `/api/suppliers`, `/api/categories`.
- `/api/guests/*` — households, guests, RSVP state, access codes.
- `/api/events/*`, `/api/seating/*`, `/api/decisions/*`.
- `/api/appointments/*` — Master Timeline appointments CRUD.
- `/api/timeline` — read-only aggregation of every dated item (tasks, payments,
  supplier deadlines, appointments, events, decisions, RSVP windows) into one
  sorted calendar payload.
- `/api/email/*` — config (GET, read-only), test send, morning brief preview +
  send, audience resolution, campaign create, campaign history + per-recipient
  log. Outbound email goes through the planner's mailbox over SMTP; a Cron
  trigger (`*/15 * * * *`) sends the brief on the first run at or after its
  UK time each day.
- `/api/assistant/*` — the email assistant's recent activity, and "check the
  mailbox now".
- `/api/chat/*` — the in-app assistant chat: `me` (who you are, AI and push
  status and your notification settings; PUT sets your display name and/or
  `notify`), `unread`, `conversations` (list / create / get / PATCH title or
  archive / POST `:id/messages`, which waits for the reply),
  `pending/:code/confirm|cancel`, `questions/:messageId/:questionId/skip`,
  `checkin` (points to open questions, or runs a check-in now).
- `/api/ai/usage` — AI usage and estimated cost (all sources).
- `/api/push/*` — Web Push: `subscriptions` (turn on for this device),
  `unsubscribe`, `test`.
- `/api/rsvp/import` — CSV response import with safe matching.
- `/api/guest/*` — public guest portal (`/api/guest/site` = the published v3
  site payload + window state and guest-visible events; `/api/guest/access`,
  `/api/guest/rsvp`, `/api/guest/home`, `/api/guest/site/unlock`,
  `/api/guest/qr-lookup`). Only published
  content is served; drafts require the couple session.
- `/api/guest-site` + `/api/guest-site/publish` — couple-only guest-website
  editor (GET draft/published/counters/events, PUT draft + meal options,
  POST publish).
- `/api/auth/*` — `status`, `init` (first-run password set), `login`,
  `logout`, `check`, `change-password`.
- `/api/rsvp/window` (GET / PUT) — couple-only live guest-site config: manual
  `guest_mode`, the go-live schedule, `go_public_date` and the RSVP open/close
  dates. Guests get the same window state inside the `/api/guest/*` payloads.
- `/api/mcp/tokens` — couple-only CRUD for AI assistant connection links
  (list / create → one-time URL / revoke).
- `/api/family/preview` — couple-only preview of the family portal page.
- `/api/family/members` (GET / POST / DELETE `:id`) + `POST /api/family/sync`
  — couple-only family access list; every change syncs to the Cloudflare
  Access "Family" policy and returns the sync state. Not exposed over MCP.
- `family.<apex>/` — the **family payment portal** (see
  [Family payment portal](#family-payment-portal)); authenticated by
  Cloudflare Access, not the session cookie.
- `/mcp/<token>` — the **remote MCP server** (see
  [AI assistant access](#ai-assistant-access-mcp)); not under `/api`, and
  authenticated by token rather than the session cookie.
- `*` catch-alls: SPA asset serving, static guest pages, and the preview leak
  screen.

Responses are uniform `{ success, data, error }` envelopes; JSON APIs auth via
the session cookie.

---

## Local development

Prereqs: Node ≥ 20 (this machine keeps one under `nodejs/node-v20.17.0-win-x64`).

```powershell
# Frontend
cd frontend
npm ci
npm run build          # → dist/

# Worker
cd ../worker
npm ci
npm run gen-assets      # embeds latest frontend dist into src/assets.js
npm run d1:migrate      # apply migrations to the local dev DB (fresh dev DB)
npx wrangler dev        # http://localhost:8787
```

The port can be customised; the local end-to-end suite defaults to
`http://127.0.0.1:8787`. A `wrangler-dev.log` capture flow is used to keep
console noise out of the terminal (file is gitignored).

### First-run password

From a fresh dev DB, the plan portal has no password until it is set once via
`POST /api/auth/init` (a deliberate bootstrap step — the SPA shows a
"set a password" flow; it refuses with 409 once a password exists). Changing
it later goes through `POST /api/auth/change-password`, which signs out every
other device. Live D1 was seeded similarly.

---

## Testing

Run everything with one command from a clean checkout, no setup:

```powershell
cd worker
npm install     # once
npm test
```

`npm test` (`worker/scripts/run-tests.mjs`) works the same in PowerShell, Git
Bash and CI. For each suite it uses a throwaway state dir in the OS temp
folder, applies the D1 migrations, starts `wrangler dev --local` with the vars
that suite needs, waits until the Worker answers, runs the suite, and always
stops the server and deletes the state, even on failure. It exits non-zero if
any suite fails. If `src/assets.js` is missing (fresh checkout) or older than
the frontend sources, it builds the frontend and generates it first, as the
deploy does.

| Suite | What it is |
| --- | --- |
| `test-family.mjs` | Family portal unit suite (no server) |
| `test-local.mjs` | End-to-end API suite, email in dry-run mode |
| `test-assistant.mjs` | Email assistant against a fake mailbox and Claude API |
| `test-chat.mjs` | In-app chat against a fake Claude API, a fake push service that decrypts every push, and fake SMTP |
| `test-push.mjs` | Web Push encryption + VAPID unit suite (no server) |

Options: `--port <n>` (or `TEST_PORT`, default 8787), `--only family,push,local,assistant,chat`,
`--keep-state`, `--startup-timeout <seconds>`. Example: `npm test -- --only local --port 8790`.
The runner refuses to start if the port is already in use.

`test-local` needs internet DNS: its v1–v5 preview-host checks call
`*.127.0.0.1.nip.io`, so offline or sandboxed runs fail those checks.

`worker/test-local.mjs` is an end-to-end suite (450 checks across 21 sections)
that runs against a local Worker with a clean dev DB:

The suite seeds a full plan (couple names, wedding date, venues, budget,
guests, suppliers, decisions), exercises the API, logs in, and asserts the
server-rendered guest pages (v1–v5 roots, eager/steady modes, preview gate,
countdown HTML, access codes, RSVP flow, imports, re-calc of deadlines). It
also drives the email pipeline end-to-end **in simulation mode** (config
validation, audience resolution by RSVP status, dry-run campaign sends with a
per-recipient log, digest preview/send, and RSVP-reminder emails). Fixtures
use fake names/venues/dates on purpose.

`worker/test-family.mjs` is a standalone unit suite for the family portal
(`node test-family.mjs`, 76 checks, no Worker needed): real RS256 tokens
against a mocked Access certs endpoint (bad signature / audience / issuer /
expiry / `alg:none` / key rotation), the page + host isolation and the
family-list check against a fake D1, and the Access policy sync through an
injected `fetch` (request body, failure path, never-empty rule). Fixtures use
`example.com` addresses only.

`worker/test-site.mjs` (`node test-site.mjs`, no Worker needed) checks that every
host, link and the session-cookie domain derive from `SITE_DOMAIN`.

`worker/test-brand.mjs` (`node test-brand.mjs`, no Worker needed) checks the
branding derived from `WEDDING_NAME` / `WEDDING_SHORT_NAME` / `WEDDING_HASHTAG`
(`worker/wrangler.toml` [vars]; read by `src/brand.js`): the configured strings,
the neutral "Wedding Planner" fallback with its one-time warning, and the
escaping of the `%WP_BRAND_*%` placeholders the Worker fills in when it serves
`index.html`, `manifest.webmanifest` and `sw.js`. `npm test` runs test-local
with a test brand and test-assistant with the brand unset.

> Changing `WEDDING_SHORT_NAME` renames everything built from its slug: the
> service-worker cache (`<slug>-wedding-v2`), so every installed phone drops
> its cached bundle once and re-downloads it, plus the guest-site storage keys
> (`<slug>-wedding-guest-code`, `…-guest-site-unlocked`), so guests re-enter
> their access code once. Pick it before the guest site goes live.

Refactor guards (the `index.js` split, see `worker/docs/index-split-map.md`).
`npm test` also runs these:
- `routes` (`scripts/route-table.mjs`): the per-method route sets, counted
  over the modules `index.js` actually imports (directly or not), must match
  `scripts/route-baseline.json`. A module that registers routes but is never
  imported fails. No two patterns may overlap, and the module layering must
  hold (no upward import, no route→route import, no cycle).
- `lint`: ESLint `no-undef`, so every module resolves every name it uses.
- `bundle` (`scripts/check-bundle.mjs`): the dry-run size stays within ±2 KiB
  of `scripts/bundle-baseline.json`, no `"sideEffects": false`, and every
  route registration is in the bundle as a `route(method, path, …)` call.
- test-local section 20: all routes answer without a session with the
  statuses in `scripts/route-probe-baseline.json`, and an unknown path gets
  404.
- `move-selftest` (`scripts/test-check-move.mjs`): `check-move` is run on a
  fixture repo and must reject every known way to slip a change through a
  "move" (code on an import line, import/export aliases, side-effect imports,
  names the target doesn't export, code hidden behind U+2028/U+2029/a bare CR,
  edited lines). It also checks that `fix-imports` edits only import lines.
- `move` (on `refactor/split-*` branches, or with `CHECK_MOVE=1`):
  `check-move` against the merge base with `origin/main`.

Run by hand for each move:
- `npm run check-move -- origin/main`: the move is verbatim, compared by
  top-level AST node rather than by line.
  - Every moved node equals its base node byte for byte, apart from an added
    `export ` prefix.
  - `index.js` keeps its other nodes unchanged and in order, and existing
    modules keep theirs.
  - Import/export statements stand alone on their lines. A new one may only
    be a plain named import of names exported by a scanned `src/**/*.js`
    module. In `index.js` it may also be a side-effect import of a `routes/`
    or `pages/` module.
  - `src/` contains no U+2028, U+2029 or bare CR.
  - A split PR changes only `worker/src/**/*.js`, `worker/scripts/`,
    `worker/docs/`, `worker/test-*.mjs` and `README.md`. It changes no
    `scripts/*baseline*.json`: re-record a baseline in its own non-split PR.
    It deletes nothing outside `src/`, and adds no comment between unmoved
    `index.js` nodes.
  - `move-selftest` also runs QA's fixtures verbatim from
    `worker/scripts/fixtures/qa/`.
- `CAPTURE_OUT=<dir> npm run capture` before and after, then
  `node scripts/capture-outputs.mjs --compare <a> <b>`: rendered outputs are
  identical.
- `npm run move-decls -- <target> <names>` does the cut itself, and
  `node scripts/fix-imports.mjs` then adds the imports each moved module needs.

`worker/test-log-safe.mjs` (`node test-log-safe.mjs`, no Worker needed) checks
that log redaction masks email addresses before they reach Workers Logs.

`worker/verify-live.mjs` is the post-deploy smoke check against the live site:
`LIVE_DOMAIN=<your domain> node verify-live.mjs` (or pass the domain as an
argument). Each host has an expected outcome (apex and its guest API public;
planner, `v1`–`v5` and family behind Cloudflare Access; `www` a 301 to the apex
with path and query kept; MCP host 401 without a token) and it exits non-zero on any mismatch. Optional: `LIVE_MCP_HOST`
(the host in the Worker's `MCP_PUBLIC_ORIGIN`; unset skips the MCP check) and `VERIFY_ATTEMPTS` (default 3).

---

## Deploying

### Push-to-deploy (Workers Builds)

The repo is connected to **Cloudflare Workers Builds**:

| Setting | Value |
|---|---|
| Repository | private GitHub repo (see handoff) |
| Branch | `main` |
| Root directory | `worker` |
| Build command | `npm ci && node test-family.mjs && node test-site.mjs && cd ../frontend && npm ci && npm run build && cd ../worker && npm run gen-assets` |
| Deploy command | `npx wrangler deploy` |

Every push to `main` first runs the two no-server unit suites
(`node test-family.mjs`, `node test-site.mjs`), then builds the frontend
(`npm run build` is `tsc && vite build`, so a type error fails it),
regenerates the asset bundle into the Worker, and deploys it to the live Worker — one deploy per push
(**one feature per deploy**). Workers Builds auto-generates its own API token,
so no GitHub secrets are involved. Note: Workers Builds ignores any `[build]`
block in `wrangler.toml` — the commands above are the source of truth.

> Workers Builds runs `npm ci` from the `worker` root directory, so both
> `frontend/package-lock.json` and `worker/package-lock.json` must be
> committed and up to date.

**Deploy gate.** The build command is a `&&` chain and Workers Builds only
runs the deploy command if the build command exits 0, so a failing
`test-family.mjs` / `test-site.mjs` check or a TypeScript error stops the
deploy and the live Worker keeps serving the previous version. The full
`npm test` run is **not** in the build: `test-local` and `test-assistant` need
`wrangler dev` (workerd) with a migrated temp DB, `test-local` also needs
internet DNS for its `*.127.0.0.1.nip.io` checks, and running workerd inside
the build container is unproven. **Pre-merge requirement:** run `npm test` from
`worker/` green before merging anything that touches the Worker (see
[Testing](#testing)); `main` auto-deploys, so a merge is a deploy. Only the two
unit suites and the frontend typecheck are enforced by the push-to-deploy build.

Branch (preview) builds use the same gated build command with the deploy command
`npx wrangler deploy --dry-run`: a branch gets the same red/green test check as
`main`, but nothing is uploaded and the live Worker is never touched. Set under
Worker → Settings → Build → Branch deploy settings; production's deploy command
stays `npx wrangler deploy`.

Monitoring: Cloudflare dashboards (Workers → Builds; logs under Workers →
Observability). Workers Logs is on (`[observability]` in `wrangler.toml`):
every console line is stored, and each cron run logs one `cron digest:` and
one `cron assistant:` line with states and counts only. Per-request invocation
logs are off, because request URLs carry tokens (`/mcp/<token>`, `?pt=`).
Every console line written during a request is still stored with its URL,
so a `/mcp/<token>` request writes no console line at all (`withQuietLogs`
in `src/log-safe.js`), and query strings are stripped (`redact_query_string`).
Error logs go through `src/log-safe.js`, which masks email addresses; never
log names, message bodies, tokens or secrets. Request counts and statuses
stay in Workers → Metrics. On deploy, asset hashes in the bundle change and
the live site serves the new bundle automatically.

Backups: D1 Time Travel covers the last 30 days automatically (restore with
`wrangler d1 time-travel restore`, the D1 API, or the dashboard). For
longer retention or an off-site copy, use the **Download full backup**
button on the Setup page — a complete archive of every table via
`/api/export/all` (passwords and API keys excluded). A known-good restore
point bookmark is recorded in the handoff.

### Manual deploy

Same result without CI (used for one-off fixes before the pipeline was wired):

```powershell
cd frontend; npm run build
cd ../worker; npm run gen-assets
npx wrangler deploy
```

After either path, run `LIVE_DOMAIN=<your domain> node verify-live.mjs` from
`worker/` (it retries, so a brief transient 5xx window right after deploy is
fine).

---

## Operating rules

These are deliberate project invariants — they keep the live data safe:

1. **Migrations are additive-only.** Never alter or drop existing columns/tables
   in a way that touches live rows; new features add new tables/columns.
2. **Never touch live guest/RSVP rows directly.** All guest mutations go
   through the app's matching + review flow (imports never silently overwrite).
3. **One feature per deploy.** Bundle unrelated changes into separate pushes so
   a failure is easy to isolate and roll back.
4. **No credentials in the repo.** Secrets live in the live D1 and the CI
   pipeline's generated tokens.
5. **No personal data in the repo.** Names/dates/venues belong in Setup (live
   D1), not in source. Keep new code parameterised the same way.

---

## Ongoing operations log

`demo-preview-handoff.txt` in the repo root is the running ops log — every
change to setup/DB/worker/frontend is recorded there (history, deployments,
gotchas, verification steps), without credentials or personal data.