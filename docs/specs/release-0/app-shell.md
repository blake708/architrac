# Spec: App shell (menu rail, top header, sign-in & onboarding)

| | |
|---|---|
| **Release** | 0 |
| **Route** | Layout `src/app/(app)/app/layout.tsx` wrapping every `/app/**` page; `/sign-in/[[...sign-in]]`, `/sign-up/[[...sign-up]]`, `/onboarding/create-firm`, `/api/webhooks/clerk` |
| **Mockup** | Shared chrome in every page; reference `mockup/Home.dc.html` (rail + header with search/notifications) and `mockup/Settings.dc.html` (rail JS `RAIL()`, `MODS`, active gear) |
| **Status** | Draft |

## Purpose
The frame around every signed-in screen: the left menu rail, the dark top header, and the sign-in / sign-up / create-firm flow that gets a person into a firm. It also decides what happens when a page doesn't exist, the person isn't allowed, or a module is turned off.

## Who can see it
| Role | Access |
|---|---|
| Owner | Full shell. Settings gear visible. |
| Admin | Full shell. Settings gear visible. |
| Project manager | Full shell. No Settings gear. |
| Staff | Full shell. No Settings gear. |
| Client (portal) | none (portal gets its own shell, later release) |
| Signed out | Only `/sign-in`, `/sign-up`. Any `/app/**` or `/onboarding/**` URL redirects to `/sign-in?redirect_url=<original>` |

## Layout
Whole page: `display:flex`, `min-height:100vh`, background `#F2F2F2`, font Barlow 14px `#141414`; numbers/codes use IBM Plex Mono. All corners `border-radius:2px` (avatar is round). Hex values in this spec are copied from the mockup so they can be matched to tokens; in code use the tokens in `src/styles/tokens.css`, adding a token if one is missing.

**1. Menu rail** (`<MenuRail>`, `<nav aria-label="Main menu">`), left column, background `#000000`, text `#BDBDBD`, `display:flex; flex-direction:column; gap:2px`, width transition 140ms.

| | Expanded (default) | Collapsed |
|---|---|---|
| Width | 216px | 64px |
| Padding | 14px 12px | 14px 10px |
| Logo row (link to `/app`, `aria-label="ArchiTrac home"`) | 40px tall, 26px house icon + "ARCHITRAC" 13px/700/letter-spacing .16em, `#F2F2F2`, margin-bottom 8px | icon only, centered |
| Nav item (`<Link>`) | 40px tall, full width, padding 0 12px, gap 12px, 20px icon (stroke 1.75) + label; label 12px uppercase, letter-spacing .08em, ellipsis | 44px wide, centered icon, no label; `title` = label for tooltip |
| Group label "Modules" | 10.5px/600, uppercase, letter-spacing .12em, `#8A8A8A`, padding 16px 12px 6px | replaced by a 1px divider `#2A2A2A`, margin 10px 8px |
| Collapse toggle (bottom, `margin-top:auto`) | 38px, `#8A8A8A` 12px/500, icon + "Collapse menu" | icon only, rotated 180°, `aria-label="Expand menu"` |

Item colors: normal `#C4C4C4`, weight 500, transparent background. Current item: `#FFFFFF`, weight 600, background `#2A2A2A`, `box-shadow: inset 2px 0 0 #FFFFFF`, `aria-current="page"`. Every item link has `aria-label` = label.

Item order (icons are the SVG paths in `Settings.dc.html` → `ICONS`; copy them into `src/components/shell/icons.ts`):

| # | Label | Key | Route | Shown when |
|---|---|---|---|---|
| 1 | Home | home | `/app` | always |
| 2 | Projects | projects | `/app/projects` | always |
| 3 | Contacts | contacts | `/app/contacts` | always |
| 4 | Team | team | `/app/team` | always |
| 5 | Time | time | `/app/time` | always |
| 6 | Reports | reports | `/app/reports` | always |
| — | "Modules" group label | | | at least one module below is shown |
| 7 | Build | build | `/app/build` | `'build' = any(firm_settings.modules_enabled)` |
| 8 | Workload | workload | `/app/workload` | `'workload'` enabled |
| 9 | Accounting | accounting | `/app/accounting` | `'accounting'` enabled |
| 10 | Marketing | marketing | `/app/marketing` | `'marketing'` enabled |
| 11 | Knowledge | knowledge | `/app/knowledge` | `'knowledge'` enabled |
| 12 | Website | website | `/app/website` | `'website'` enabled |
| 13 | Hiring | hiring | `/app/hiring` | `'hiring'` enabled |

The module keys `schedule` and `code` (Settings → Modules & plan) never get a rail item.

**2. Right column**: `flex:1 1 0; min-width:0; flex-direction:column`, containing the header then the page.

**3. Top header** (`<TopHeader>`, `<header>`): background `#141414`, text `#F2F2F2`, padding 10px 32px, `display:flex; flex-wrap:wrap; align-items:center; gap:16px`. Left to right:
- **Firm switcher** (`<FirmSwitcher>`): button 36px tall, padding 0 10px 0 4px, border 1px `#3A3A3A`. Contains a 28px tile (background `#F2F2F2`, text `#141414`, 12px/700) showing the first letter of the firm's display name (or `<img>` of `firms.logo_url` if set), the firm display name (600), and a 14px chevron. Click opens a menu (see Actions).
- **Page title** (`<PageTitle>`): uppercase, weight 500, letter-spacing .08em. Optional breadcrumb parent before it: parent link in `#BDBDBD` followed by " / " (mockup `Proposal.dc.html`). Each page passes `title` and optional `parent={label, href}`.
- **Right cluster** (`margin-left:auto`, gap 12px):
  - Global search (34px, bg `#2A2A2A`, 200px input, placeholder "Search everything") — **placeholder: NOT rendered in Release 0.**
  - Notifications bell (34px, unread dot `#F08A4B`) — **placeholder: NOT rendered in Release 0.**
  - Settings gear: 34px link to `/app/settings`, color `#BDBDBD`, `aria-label="Settings"`. When pathname starts with `/app/settings`: bg `#2A2A2A`, color `#FFFFFF`, `box-shadow: inset 0 -2px 0 #FFFFFF`, `aria-current="page"`. Owner/admin only.
  - Avatar: 32px circle, bg `#3A3A3A`, `#FFFFFF` 11px/600 showing `users.initials` (or `users.avatar_url` image). Button that opens the account menu.

Put the two placeholders behind constants in `src/lib/features.ts`: `FEATURES = { globalSearch: false, notifications: false }`. When false the element is not rendered (no empty slot).

**4. Page area**: each page renders its own white page-header band and `<main>`. The shell only provides the container. Shared component for the band: `<PageHeader eyebrow title description actions>` (white, border-bottom `#DCDCDC`, padding 32px 32px 28px, eyebrow IBM Plex Mono 12px `#4D4D4D`, H1 30px/500).

**5. Onboarding pages** (no rail, no header): centered card 440px max on `#F2F2F2`, ArchiTrac logo row above it. `/sign-in` and `/sign-up` render Clerk `<SignIn/>` / `<SignUp/>` with appearance variables `colorPrimary:#141414`, `borderRadius:2px`, `fontFamily:Barlow`.

## Data shown
| UI element | Source (table.column or calculation) | Notes / format |
|---|---|---|
| Firm switcher name | `firms.display_name` ?? `firms.name` for the active firm | `display_name` is a data model addition (see settings-firm spec) |
| Firm switcher tile | `firms.logo_url` else first letter of the name, uppercase | |
| Firm switcher menu list | `memberships` where `user_id` = me and `active` = true, joined to `firms` | sorted by firm name; current firm has a check mark |
| Rail module items | `firm_settings.modules_enabled` | text[]; unknown keys ignored |
| Collapsed state | cookie `architrac_rail_min` (`'1'` / `'0'`) | read on the server so first paint is correct |
| Settings gear visible | `memberships.app_role in ('owner','admin')` | |
| Avatar | `users.initials`, `users.avatar_url` | |
| Account menu header | `users.first_name + ' ' + users.last_name`, `users.email`, role label from `memberships.app_role` | role labels: Owner, Admin, Project manager, Staff |
| Page title | prop from the page | |

## Actions
| Action | What happens | Validation | Permission |
|---|---|---|---|
| Click rail item | Client navigation to the route | — | all |
| Toggle collapse | Flip state, write cookie `architrac_rail_min` (path `/`, 1 year, SameSite=Lax), also write `localStorage['architrac.railMin']` for parity with mockup; no page reload | — | all |
| Open firm switcher | Menu lists firms (see Data shown) | — | all |
| Pick another firm | Client calls Clerk `setActive({ organization: firm.clerk_org_id })`, then `router.push('/app')` + `router.refresh()` | firm must be in my active memberships | all |
| Open avatar menu | Menu: name/email/role header, "Your account" → `/app/account` (Clerk `<UserProfile/>`), "Sign out" | — | all |
| Sign out | Clerk `signOut({ redirectUrl: '/sign-in' })` | — | all |
| Click Settings gear | Navigate `/app/settings` (redirects to `/app/settings/firm`) | — | owner, admin |
| Submit create firm | See Business rule 6 | Firm name 2–120 chars after trim; timezone in allowed list; month 1–12 | any signed-in user with no active firm |
| Mobile menu button | Opens rail as drawer (see rule 9) | — | all |

## Business rules
1. **Firm context.** Every `/app/**` request runs `getSession()` / `requireSession()` (`src/lib/auth/session.ts`; built in 0.3): Clerk `auth()` → `orgId`, `userId` → `firms` by `clerk_org_id` → `users` by `clerk_user_id` → `memberships` by (`firm_id`, `user_id`). Returns `{ firm, settings, user, membership }` (or a status saying where to send the person). All firm-owned queries go through the tenant-scoped helper `src/db/tenant.ts`, which sets the firm for row-level security from `firm.id` (see ARCHITECTURE → Multi-tenancy). Only the `firms` lookup by `clerk_org_id` and the `users` lookup run before the firm is known.
2. **Routing guard (middleware + layout).**
   - Signed out → `/sign-in?redirect_url=<path>`.
   - Signed in, no active Clerk org: if the user belongs to ≥1 Clerk org → `/onboarding/choose-firm`, which calls `setActive` on the first by firm name and continues to `/app`; if none → `/onboarding/create-firm`. (Built in 0.3. Preferring the most recently used firm can come with the firm switcher in 0.5.)
   - Signed in, org active, but no `memberships` row yet → run `ensureMembership()` (rule 7) once; if it still finds none → `/onboarding/create-firm`.
   - Membership `active = false` → redirect to `/onboarding/access-off` (outside the shell, so no rail), which shows "Your access to [Firm] has been turned off. Ask an owner or admin if this is a mistake." with only the Sign out button. A redirect is used instead of rendering inside the layout so no page data loads for a deactivated member.
3. **Module visibility.** `isModuleOn(settings, key) = settings.modules_enabled.includes(key)`. Rail shows a module item only if on. The "Modules" label shows only if at least one of the 7 rail modules is on. Worked example (TMG seed `{schedule,build,workload,accounting,marketing,knowledge,website,hiring}`): rail shows 6 core + label + 7 modules = 14 rows. If Blake turns off Hiring, Hiring disappears after save, with no reload of the whole app needed (`router.refresh()`).
4. **Module route guard.** Each module page calls `requireModule(key)`. If off → render `<ModuleOff module="Build">`: H1 "Build is turned off", text "Build isn't turned on for [Firm].", and for owner/admin a button "Turn on in Settings" → `/app/settings/modules`; others see "Ask an owner or admin to turn it on." HTTP status 200, rail unchanged.
5. **Current item.** `/app` is current only on exact match. Any other item is current when `pathname === route || pathname.startsWith(route + '/')`.
6. **Create firm** (server action `createFirm`), in this order:
   1. Clerk `organizations.createOrganization({ name, createdBy: userId })`.
   2. In one DB transaction: insert `firms` (`name`, `slug` = kebab-case of name + `-` + 4 random chars if taken, `clerk_org_id`, `timezone`, `fiscal_year_start_month`); insert `firm_settings` with defaults (`overhead_rate_bp 6000`, `include_overhead_default true`, `week_starts_on 1`, `timesheet_increment_minutes 15`, `timesheet_lock_day 1`, `invoice_prefix '<current year>-'`, `next_invoice_number 1`, `default_payment_terms_days 30`, `modules_enabled '{}'`); upsert `users` for me; insert `memberships` (`app_role 'owner'`, `title 'Principal'`, `employment_type 'full_time'`, `weekly_capacity_hours 40`, `target_utilization_bp 8000`, `active true`); write `activity_log` (`entity_type 'firm'`, `action 'created'`).
   3. If the transaction fails, delete the Clerk org, then show the error.
   4. Client calls `setActive({ organization })` and goes to `/app`.
   New firms start with **no modules on**; they turn them on in Settings.
7. **User/membership sync.** Webhook `POST /api/webhooks/clerk` verifies the Svix signature (`CLERK_WEBHOOK_SIGNING_SECRET`), then:
   - `user.created` / `user.updated` → upsert `users` (`clerk_user_id`, `email`, `first_name`, `last_name`, `avatar_url`; `initials` = first letter of first + last name, uppercase, only set on create).
   - `organizationMembership.created` → `ensureMembership(clerkOrgId, clerkUserId)`: find `invitations` row (pending, same firm, same email) and create/reactivate `memberships` with its `app_role` and `title`; mark invitation `accepted`. If no invitation is found, create with `app_role 'staff'`. An existing membership's role is never changed (so the owner isn't downgraded when Clerk reports the creator joining). *0.3 builds the no-invitation path only; the `invitations` lookup arrives with that table in 0.6.*
   - `organizationMembership.deleted` → `memberships.active = false`.
   All handlers are idempotent (safe to receive twice). The layout calls `ensureMembership` too (rule 2), so a person who lands before the webhook arrives still gets in; that path never reactivates a deactivated membership.
   - The webhook does **not** create firms (`organization.created` is ignored). The create-firm action (rule 6) is the only path, so it can save time zone and fiscal year and roll back the Clerk org on failure without racing the webhook. *Decided by Blake, 0.3.*
8. **Clerk role mapping.** `owner`/`admin` ↔ Clerk `org:admin`; `project_manager`/`staff` ↔ `org:member`. `memberships.app_role` is the source of truth; Clerk role is kept in sync when the app role changes.
9. **Responsive.**
   - ≥ 768px: rail inline, honors the cookie.
   - < 768px: rail hidden. Header gets a 34px menu button (hamburger, `aria-label="Open menu"`, `aria-expanded`) as its first item. It opens the rail as an overlay drawer, 216px expanded, with a scrim `rgba(0,0,0,.4)`. The drawer closes on navigation, scrim click or Esc, and focus returns to the button. The collapse toggle is hidden in the drawer. Header padding is 10px 16px; firm name `max-width:140px`, ellipsis.
   - Header wraps (`flex-wrap`) rather than scroll; there is never horizontal page scroll at 360px width.
10. **Permissions helper.** `can(membership, action)` in `src/lib/auth/permissions.ts`. Release 0 actions: `settings.view`, `settings.edit`, `users.manage`, `modules.manage` → owner/admin. `users.manage_owners` → owner only. Every page and server action checks on the server; hiding UI is not security.

## States
- **Empty state:** new firm with no modules → rail has 6 core items and no "Modules" label. Core pages in Release 0 render `<ComingSoon title="Projects" release="1">` ("Projects arrives in Release 1.").
- **Loading state:** `loading.tsx` inside the shell shows a page-header skeleton (grey bars `#EBEBEB`) while rail and header stay put. The firm switcher menu shows "Loading firms…" while fetching.
- **Error state:** `error.tsx` inside the shell: H1 "Something went wrong", text "Try again. If it keeps happening, send Blake this code: {digest}.", button "Try again" (`reset()`). Create-firm errors show inline above the button: "We couldn't create your firm. Nothing was saved. Try again."
- **Permission-denied state:** `<AccessDenied>` inside the shell: H1 "You don't have access to this page", text "Ask an owner or admin of [Firm] if you need it.", link "Go to Home". **404:** `src/app/(app)/app/not-found.tsx` inside the shell: H1 "Page not found", text "This page doesn't exist or was moved.", link "Go to Home". Outside `/app`, root `not-found.tsx` with logo only and link to `/`.

## Out of scope (for this release)
- Global search (header) — later release; hidden in Release 0.
- Notifications bell and panel — later release; hidden in Release 0.
- "Add" badge on modules that are off (mockup shows off modules dimmed with an ADD tag) — not built; off modules are hidden (see Open questions).
- Client portal shell — Release 2.
- "Create another firm" from the firm switcher — not in Release 0.
- Logo upload (tile uses initial letter) — see settings-firm spec.

## Acceptance tests
- [ ] Given I am signed out, when I open `/app/projects`, then I am redirected to `/sign-in?redirect_url=%2Fapp%2Fprojects`.
- [ ] Given I signed up and have no firm, when I land on `/app`, then I am redirected to `/onboarding/create-firm`.
- [ ] Given I am on create-firm, when I submit "The Middleton Group" with timezone America/New_York and January, then a `firms` row, a `firm_settings` row with `overhead_rate_bp = 6000` and `modules_enabled = '{}'`, and a `memberships` row with `app_role = 'owner'` exist, and I land on `/app`.
- [ ] Given I submit create-firm with name "A", then I see "Firm name must be 2–120 characters" and no Clerk org is created.
- [ ] Given the DB insert fails during create-firm, then the Clerk org is deleted and no `firms` row exists.
- [ ] Given `modules_enabled = '{}'`, when the shell renders, then the rail shows exactly Home, Projects, Contacts, Team, Time, Reports and no "Modules" label.
- [ ] Given `modules_enabled = '{schedule,build,workload,accounting,marketing,knowledge,website,hiring}'`, when the shell renders, then the rail shows 6 core items, the "Modules" label, then Build, Workload, Accounting, Marketing, Knowledge, Website, Hiring in that order, and no Schedule or Code item.
- [ ] Given Build is off, when I open `/app/build`, then I see "Build is turned off" and, as staff, no "Turn on in Settings" button.
- [ ] Given Build is off and I am an admin, when I open `/app/build`, then I see a "Turn on in Settings" link to `/app/settings/modules`.
- [ ] Given the rail is expanded, when I click "Collapse menu", then the rail is 64px wide, labels are hidden, the toggle's aria-label is "Expand menu", and cookie `architrac_rail_min=1` is set.
- [ ] Given cookie `architrac_rail_min=1`, when I load any `/app` page, then the server-rendered HTML already has the 64px rail (no flash of the wide rail).
- [ ] Given I am on `/app/projects/123`, then the Projects item has `aria-current="page"` and Home does not.
- [ ] Given I am staff, then the Settings gear is not rendered, and when I open `/app/settings/firm`, then I see "You don't have access to this page".
- [ ] Given I am an owner on `/app/settings/firm`, then the gear has `aria-current="page"`.
- [ ] Given Release 0 feature flags, then no search input and no notifications button are in the header.
- [ ] Given I belong to two firms, when I pick the second in the firm switcher, then the header shows the second firm's name and the rail reflects that firm's `modules_enabled`.
- [ ] Given my membership has `active = false`, when I open `/app`, then I see "Your access to [Firm] has been turned off" and no rail items.
- [ ] Given a viewport of 375px, then the rail is hidden, a menu button is shown, and opening it shows the drawer; pressing Esc closes it and focus returns to the menu button.
- [ ] Given I open `/app/does-not-exist`, then I see "Page not found" inside the shell with a link to Home.
- [ ] Given the Clerk webhook `organizationMembership.created` is delivered twice for the same user, then exactly one `memberships` row exists.
- [ ] Given a webhook request with a bad Svix signature, then the endpoint returns 400 and writes nothing.

## Open questions
1. **Modules that are off:** you asked for them hidden; the mockup (`RAIL()` + Settings copy "A module that's off still shows in the menu with an Add prompt") shows them dimmed with an "ADD" badge as an upsell. This spec hides them. Confirm, or switch to the mockup's behavior.
2. **Rail preference across devices:** cookie/localStorage is per browser. If it should follow the person to every device: *Data model addition needed: `users.preferences jsonb` (e.g. `{ "railMin": true }`).*
3. ~~**Open sign-up**~~ **Decided (0.3):** Clerk sign-up mode is **Invite only** (called "Restricted" on older Clerk screens) until Release 1 ships. Setup steps in `docs/GETTING_STARTED.md` → Setting up Clerk.
4. **Rail order of core items:** confirm Reports stays in core (the Settings plan card lists "Projects, Contacts, Team, Time, Reports" as Core, which matches).
5. Data model additions this spec depends on (defined in settings-firm spec): `firms.display_name`, `invitations` table, `schedule` and `code` as valid `modules_enabled` keys.
