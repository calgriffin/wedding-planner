# #3 Splitting `worker/src/index.js`: module map

Status: **plan only, no code moved.** Revision 3: QA's rev-2 edits are applied (lib/text range, PR reorder so no module imports from `index.js`, an 8th check for undefined identifiers). Base: `main` @ dafb606, where
`worker/src/index.js` is 6,884 lines with 156 top-level declarations and 152
`route()` registrations. Line ranges below refer to that commit.

Goal: the same Worker, cut into domain modules, one small PR at a time, with
**no behaviour change** in any PR.

## 1. How the file is put together today

- **Shared helpers and building blocks (L1-712):** imports and constants,
  general helpers, auth (PBKDF2, sessions, Access JWT), DB settings helpers,
  shared calculations, seed data, and the router (`routes` registry, `route`,
  `matchRoute`, `dispatchInternal`).
- **Planner API routes (L713-3079):** one section per domain, registered as
  top-level `route()` side effects.
- **Guest site (L3080-4506):** the settings and live-mode model, site content,
  media (R2), the code-guess limit, unlock and access, RSVP submit, and the
  couple's admin routes (tags, questions, window, QR, reminders).
- **Email (L4507-5351):** config, HTML templates, sending and campaigns, the
  digest and brief, and the email and assistant routes.
- **Server-rendered guest pages (L5352-6571):** preview-ended, coming-soon,
  countdown, wedding-day and thank-you.
- **Static assets (L6572-6656), `handleFetch` (L6657-6853), and
  `export default { fetch, scheduled }` (L6854-6884).**

Already separate modules, and staying as they are: `site.js`, `brand.js`,
`log-safe.js`, `mcp.js`, `assistant.js`, `mailbox.js`, `family.js`,
`family-access.js`, `access.js` and the generated `assets.js`.

### Facts that shape the split

- **Routing is first-match** (`matchRoute`, L657). I checked all 152 patterns
  pairwise: **no two overlap**, so registration order cannot change which
  handler a request reaches. The proof is therefore the per-method route
  **set** plus the pairwise overlap check (section 4), not an ordered snapshot.
- **Routes register as import side effects.** `index.js` imports every route
  module for its side effect. A bundler that treats the package as
  side-effect-free would drop them, so PR 1 adds a guard (section 4).
- **Several shared helpers sit in the wrong section.** `safeJsonParse`,
  `escHtml`, `coupleNames`, `HOUSEHOLD_CODE_ALPHABET`/`makeHouseholdCode` and
  `newHouseholdCode` (L5304-5351) are defined inside the email-assistant
  section but used by the guest site, the pages and email. `fmtDate`,
  `humanTerm` and `daysUntil` (L4916-4933) sit inside the email templates,
  `escapeAttr` (L6625) inside static, and `csvEscape`/`toCSV` inside exports.
  These go to shared modules first. Left in place, they would turn the split
  into import cycles.
- **Module-level mutable state in `index.js`:** only `accessKeyCache` (L320,
  the Access JWKS cache) and the `routes` registry (router). Once-per-isolate
  warnings already live in `site.js` / `brand.js`, and the console gate in
  `log-safe.js`. ES modules are singletons, so each piece of state stays in
  exactly one module. No PR may copy it.

## 2. Target modules

The dependency direction is fixed:
**`lib/*` → `core/*` → `domain/*` → `routes/*` → `index.js`.**
No module imports `index.js`, and route modules never import each other.
Shared domain logic goes into `domain/*`.

### Shared code

| Module | Moves in (from `index.js`) | Lines | Shared state / needs |
|---|---|---|---|
| `lib/http.js` | `json`, `ok`, `err`, `readBody`, `uuid`, `now`, `int`, `nullableText`, `cleanLink`, `familyFlag`, `cleanLabel`, `b64url`, `sha256Hex` | 62-156 | none (pure) |
| `lib/text.js` | `safeJsonParse`, `escHtml`, `escapeAttr`, `coupleNames`, `fmtDate`, `humanTerm`, `daysUntil`, `csvEscape`, `toCSV` | 5325-5351, 4916-4933, 6625-6629, 2970-2982 | none (pure) |
| `core/config.js` | cookie, PBKDF2, login-lock and code-guess constants | 32-60 | none |
| `core/db.js` | `getSetting`, `setSetting` | 427-443 | env.DB |
| `core/setup.js` | `getSetup`, `isoDateOffset`, `recalcTaskDeadlines`, `recalcBudget*` | 444-546 | env.DB |
| `core/seed.js` | `SEED_TASKS`, `SEED_CATEGORIES`, `seedIfEmpty` | 547-641 | env.DB |
| `core/router.js` | `routes`, `route`, `matchRoute`, `dispatchInternal` | 642-709 (the health route goes to `routes/system.js`) | **`routes` registry (state)**; imports `seedIfEmpty` |
| `core/auth.js` | `hashPassword`, `verifyPassword`, auth secret, session sign/verify, cookie set/clear, `accessConfig`, `getAccessKey`, `verifyAccessJwt`, `readCookie`, `getSession`, `ACCESS_LOGOUT_PATH` | 157-426 | **`accessKeyCache` (state)**; `cookieDomainAttr` (site.js) |
| `core/codes.js` | `HOUSEHOLD_CODE_ALPHABET`, `makeHouseholdCode`, `newHouseholdCode`, `makeInvitationCode`, `normalizeAccessCode` | 5304-5324, 1913, 3105 | env.DB |

### Domain modules (shared logic, no routes)

| Module | Moves in | Lines | Needs |
|---|---|---|---|
| `domain/guests.js` | `pendingPlusOnes`, `plusOnePlaceholderName`, `isPlusOnePlaceholderName` | 1715-1740 | db |
| `domain/guest-settings.js` | `rsvpOpenFor`, `isRsvpOpen`, `loadGuestSettings`, `modeForHost`, `effectiveLiveMode`, `guestWindowPayload` | 3080-3202, 4266 | db, setup |
| `domain/guest-site.js` | `GUEST_SITE_DEFAULTS`, `DEFAULT_MEAL_OPTIONS`, `clampStr`, `sanitizeSiteContent`, `sanitizeMealOptions`, `loadGuestSite`, `buildGuestSitePayload`, `buildLockedSitePayload` | 3252-3359, 3486-3583 | db, setup, guest-settings |
| `domain/code-limit.js` | `codeGuessKey`, `codeGuessExempt`, `codeLockedResponse`, `codeGuessBlocked`, `codeGuessFailed` | 3584-3635 | db, config |
| `domain/rsvp.js` | `findHouseholdByCode`, `RSVP_*` constants, `rsvpText`, `rsvpPlusOneStatements` | 3661-3847 (helpers only) | db, codes |
| `domain/media.js` | `MEDIA_*`, `sniffImage`, `mediaKeyFromPath`, `mediaTypeFromKey`, `serveMedia` | 3360-3453 (minus the upload route) | env.MEDIA |
| `domain/email-config.js` | `EMAIL_AUDIENCES`, `EMAIL_NOT_CONFIGURED`, `loadEmailConfig`, `emailConfigSummary`, `textToHtml` | 4507-4556 | env; assistant.js `assistantConfig` |
| `domain/email-templates.js` | `EMAIL_UI`, `escUrl`, `bulletButton`, `sanitizeHtml`, `emailTextLink`, `URL_IN_TEXT`, `linkTypedUrl`, `plainToHtml`, `emailBodyShell`, `guestEmailShell`, `emailStat`/`Bullets`/`Section`/`NoteBox`, `buildDigestHtml` | 4557-4756 | `brand()`, `siteOrigin()` (pure renderers) |
| `domain/email-send.js` | `sendEmails`, `sendEmail`, `collectHouseholds`, `filterAudience`, `householdRecipient`, `personalise`, `recordCampaign`, `buildDigest` (4935-5064), `buildBrief`, `sendBriefToCouple`, `handleScheduledDigest` | 4757-5141 (minus `lib/text` 4916-4933) | env, mailbox.js, assistant.js, templates, log-safe |
| `domain/family.js` | `familyAccessPayload` | 1604 | db, family-access.js |
| `domain/mcp-links.js` | `publicMcpToken`, `mcpPublicOrigin`, `mcpPublicHost` | 834-856 | env, mcp.js |

### Route modules (each registers its routes at import)

| Module | Section | Lines | Routes |
|---|---|---|---|
| `routes/system.js` | `GET /api/health` (unauthenticated; today it sits at the end of the router section) | 710-711 | 1 |
| `routes/auth.js` | Auth | 713-829 | 6 |
| `routes/setup.js` | Setup + MCP connection links | 830-944 | 5 |
| `routes/dashboard.js` | Dashboard | 945-1153 | 4 |
| `routes/tasks.js` | Tasks | 1154-1285 | 7 |
| `routes/budget.js` | Budget categories/items + payments | 1286-1597 | 15 |
| `routes/family.js` | Family access list | 1598-1640 | 5 |
| `routes/guests.js` | Households + guests | 1641-1918 | 10 |
| `routes/suppliers.js` | Suppliers + decisions | 1919-2102 | 8 |
| `routes/seating.js` | Tables & seating | 2103-2298 | 12 |
| `routes/logistics.js` | Logistics, wedding day, events, timeline | 2299-2802 | 26 |
| `routes/rsvp-inbox.js` | RSVP inbox | 2803-2968 | 6 |
| `routes/exports.js` | CSV + full backup | 2969-3079 | 5 |
| `routes/guest-public.js` | Guest home, unlock, access, RSVP submit | 3203-3251, 3636-4028 | 5 |
| `routes/guest-site.js` | Website admin + photo upload | 3360-3583 | 5 |
| `routes/guest-admin.js` | Tags, questions, window, QR, reminders | 4029-4506 | 20 |
| `routes/email.js` | Email config/test/digest/campaigns + assistant status | 5142-5303 | 12 |

### Pages, static assets and the entry point

| Module | Moves in | Lines |
|---|---|---|
| `pages/preview-ended.js` | `previewEndedPage`, `comingSoonPage` | 5352-5764 |
| `pages/countdown.js` | `countdownPage` | 5765-6208 |
| `pages/wedding-day.js` | `weddingDayPage` | 6209-6408 |
| `pages/thank-you.js` | `thankYouPage` | 6409-6571 |
| ~~`static.js`~~ | `ASSET_TYPES`, `serveAsset`, `injectOpenGraph` **stay in `index.js`** (decided during PR 4, see below) | 6572-6656 |
| `index.js` (what stays) | imports of the route modules **in today's order**, `ASSET_TYPES`, `serveAsset`, `injectOpenGraph`, `handleFetch`, `export default { fetch, scheduled }` | 6572-6884 |

**Decision (PR 4): no `static.js`.** `ASSET_TYPES`, `serveAsset` and
`injectOpenGraph` stay in `index.js` and are handled in the final tidy PR.
There are two reasons:
- `serveAsset` needs `import { assets } from './assets.js'`, and
  `check-move` refuses the generated `assets.js` as an import target by
  design, because the checker can't inspect it. A carve-out for that one file
  isn't worth it for three nodes.
- At the `src/` root, `injectOpenGraph`'s `getSetup` import from `core/` would
  also be an upward import.

`index.js` keeps the invariants it has today, unchanged:

- `fetch()` starts with the `isSecretPath` → `withQuietLogs` gate (#9) **before
  anything else**.
- `handleFetch` and `scheduled` call `configureSite(env, …)` then
  `configureBrand(env)` first (#4, #12).
- Nothing at module top level logs or touches `env`. Imports only define and
  register.

## 3. PR order (17 PRs, lowest risk first)

Pure moves without routes are batched. Each large route domain gets its own
PR: logistics, guest-admin, budget and guests.

1. **Proof tooling + `lib/http.js` + `lib/text.js`**: the pure helpers,
   including the misplaced ones, plus all the checks in section 4 (harness,
   move checker, route probe, route set/overlap, side-effects guard).
2. **`core/config`, `db`, `setup`, `seed`, `codes`, `router`** +
   `routes/system.js` (`/api/health`) + **`domain/guest-settings`** +
   **`domain/guests`**: data helpers, the registry, and the two small domain
   modules later PRs depend on. `buildDigest` (PR 5) needs
   `loadGuestSettings`/`isRsvpOpen`, and `domain/rsvp` / `routes/guest-public`
   need `plusOnePlaceholderName`. Moving them here means no later PR has to
   import from `index.js`.
3. **`core/auth.js` + `routes/auth.js`**: sessions, PBKDF2, Access JWT and
   their 6 routes.
4. **`pages/*`**: the HTML builders, where the rendered-output diff gives the
   strongest proof. (Asset serving stays in `index.js`: see the PR 4
   decision in section 2.)
5. **`domain/email-*`** (config, templates, send, digest, brief) +
   **`routes/email.js`**.
6. **Guest domain modules**: `guest-site`, `code-limit`, `rsvp`, `media`
   (no routes; `guest-settings` and `guests` already moved in PR 2).
7. **`routes/guest-public.js`** (5 routes, kept as one module).
8. **`routes/guest-site.js`** (5).
9. **`routes/guest-admin.js`** (20), alone.
10. **Small planner routes**: `family`, `exports`, `rsvp-inbox`, `setup` +
    `domain/mcp-links` + `domain/family`.
11. **`routes/dashboard.js` + `routes/tasks.js`**.
12. **`routes/suppliers.js` + `routes/seating.js`**.
13. **`routes/guests.js`** (10), alone.
14. **`routes/budget.js`** (15), alone.
15. **`routes/logistics.js`** (26), alone.
16. **`index.js` tidy**: only route imports, `handleFetch` and
    `export default` remain.
17. **Remove the temporary proof scaffolding**, if QA wants it removed. The
    checks stay in `npm test` otherwise.

Every PR is a pure move: functions are cut and pasted verbatim, with only
`import`/`export` lines added, no renames and no edits inside bodies. Other
work that touches `index.js` waits between merges (the chief of staff
sequences it). Every PR rebases on the latest `main` first.

## 4. Proving no behaviour change, per PR

PR 1 commits the tooling. Every later PR must pass all eight checks before it
goes to QA:

1. **`npm test` green** (all suites, including the #9 `mcp unauthorized` 1×
   log-count check and the brand and site configured/fallback tests).
2. **Route set and overlap check** (`scripts/route-table.mjs`). It statically
   collects every `route(method, pattern, {auth})` across `worker/src` and
   compares the **per-method sets** (pattern plus auth flag) with a committed
   baseline of 152. It fails on any pairwise-overlapping pattern pair, which is
   what makes order irrelevant. The same script enforces the layering: no
   upward import, no route module importing another, no cycle.
3. **Runtime route probe** (in test-local, against `wrangler dev`). Without a
   session, it calls every one of the 152 routes with its method and a
   placeholder for each `:param`. Each must return the same status as today,
   recorded in a committed baseline (`401` for authenticated routes, the
   existing status for public ones). An unknown `/api/*` path must return
   `404`. This proves at runtime that every route module is imported and
   registered.
4. **Rendered outputs byte-identical.** The #12 capture harness is committed
   as `worker/scripts/capture-outputs.mjs`. It captures the apex in all 5
   modes, v1-v5, preview-ended, the plan shell, manifest, `sw.js`, the
   digest, campaign preview, RSVP reminder, backup header and MCP
   `serverInfo`. It also captures normalised JSON from the main list
   endpoints: tasks, budget, guests, households, seating, timeline and the
   guest-site payloads. It runs before and after on the same seeded data, and
   only the ids, timestamps and random codes it normalises may differ.
5. **Verbatim move checker** (`scripts/check-move.mjs <base>`). Every line
   removed from `index.js` must appear unchanged, in the same order, in
   exactly one new module. The only change it allows on a moved line is an
   added `export ` prefix on a declaration. Every other added line must be an
   `import`/`export` statement or a blank line. This catches edits hidden
   inside a move.
6. **Side-effects guard.** A test fails if any `package.json` in the Worker's
   build declares `"sideEffects": false`. A dry-run bundle check also asserts
   that every route module's first route pattern is present in the bundled
   `index.js`, so no route module can be tree-shaken away.
7. **Bundle size** from `wrangler deploy --dry-run` within ±2 KiB of the
   base (1785.05 KiB now). Wrangler bundles everything into one script, so a
   pure move barely changes it.
8. **No undefined identifiers** (ESLint `no-undef` over `worker/src`, with
   Worker and ES globals). Every module must resolve every name it uses. This
   is a static check, so it catches a missing import on a rarely hit path:
   exactly the #9 `redactError` ReferenceError, which the dry run and the
   suites both missed.

After each merge: the automatic Verify live run (18/18) and the next cron
lines in Workers Logs, checked for no errors.

## 5. Risks and how each is handled

| Risk | Handling |
|---|---|
| **Circular imports.** Today's file hides cycles: guest ↔ email ↔ "assistant" helpers, pages → static, dashboard → guests. | PR 1 moves the misplaced shared helpers out first. The one-way layering above is enforced by `route-table.mjs`: it fails if a module imports a module from a higher layer, or one route module imports another. |
| **TDZ / evaluation order.** Hoisted functions in one file become imports; a top-level `const` that calls an imported function during evaluation would break under a cycle. | No cycles allowed (above). Top-level code only defines constants and calls `route()`. |
| **Route registration and first-match.** | 0 overlapping patterns, so order can't change matching. The per-method route set, the overlap check and the runtime probe (every route answers as today, unknown path 404) enforce this. Imports keep today's order anyway. |
| **Route modules dropped by the bundler** (`sideEffects: false`). | Side-effects guard and the bundle check (section 4.6). |
| **Module-level state duplicated.** `accessKeyCache`, the `routes` registry, the once-warnings in `site.js`/`brand.js`, the console gate. | Each stays owned by exactly one module and is imported, never redefined. Review checklist: `grep -n "^let \|new Map(" worker/src` shows no new copies. |
| **The `isSecretPath`/`withQuietLogs` gate** must stay the first thing in `fetch()` (#9). Moving code could put a log line or an `env` read before it. | `index.js` keeps `export default { fetch }` exactly as it is now. The `mcp unauthorized` 1× log-count check in `run-tests` (#9) runs on every PR, so a regression fails the suite. |
| **`configureSite` / `configureBrand` called late.** | They stay at the top of `handleFetch`/`scheduled`. The brand and site tests (configured and fallback) run in every PR. |
| **Merge conflicts with parallel work** on `index.js`. | Small PRs merged quickly, rebased each time. The chief of staff holds other `index.js` changes during the series. |
| **Hidden `this` or closure use** in moved functions. | Verbatim moves only, with no edits inside bodies. The diff for each PR must be "lines removed in index.js = lines added in the new module", plus import/export lines. `scripts/check-move.mjs` checks this on every PR. |
