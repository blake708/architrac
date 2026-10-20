# Spec: Settings — layout, Firm profile, Users & invitations, Modules

| | |
|---|---|
| **Release** | 0 |
| **Route** | `/app/settings` (redirects to `/app/settings/firm`), `/app/settings/firm`, `/app/settings/users`, `/app/settings/modules` |
| **Mockup** | `mockup/Settings.dc.html` (sections `firm` and `modules`; Users & invitations is not in the mockup — see Layout §5; invite button and access pills come from `mockup/Team.dc.html`) |
| **Status** | Draft |

## Purpose
Where an owner or admin sets up the firm: its name and contact details, who can sign in and with what role, and which add-on modules are turned on. Release 1 adds more sections to the same page frame (see `release-1/settings-rates-phases.md`).

## Who can see it
| Role | Access |
|---|---|
| Owner | View and edit every section. Only role that can invite, promote, demote or deactivate an **owner**. |
| Admin | View and edit every section. Can manage admin, project manager and staff users; cannot touch owners. |
| Project manager | none — `<AccessDenied>` (see app-shell spec) |
| Staff | none — `<AccessDenied>` |
| Client (portal) | none |

## Layout
Inside the app shell. Header page title: "Settings". Settings gear in header is active.

**1. Page-header band** (`<PageHeader>`): white, border-bottom `#DCDCDC`, padding 32px 32px 28px, `flex-wrap`.
- Left: eyebrow `{GROUP} · FIRM ADMINS ONLY` (IBM Plex Mono 12px `#4D4D4D`, group uppercase), H1 = section title (30px/500), description (max-width 680px, `#4D4D4D`, line-height 1.5).
- Right (gap 10px): "Unsaved changes" (12.5px `#9A3412`) when the form is dirty; "✓ Saved" (12.5px `#1D6234`, check icon) for 4 seconds after a successful save; **Save changes** button (38px, padding 0 16px, 600, white text) — background `#141414` and enabled when dirty, `#C4C4C4` and `disabled` when clean, and shows "Saving…" while pending. The right side is hidden on the Users section (its actions save immediately).

**2. Body**: `display:flex; flex-wrap:wrap; align-items:flex-start`.
- **Section nav** (`<nav aria-label="Settings sections">`): `flex:1 1 220px; max-width:260px`, padding 28px 0 28px 32px. Groups, each with a label (11px/600 uppercase `#666666`, padding-bottom 8px, margin-bottom 22px between groups) and a list of `<Link>`s (block, padding 9px 12px, 14px). Current link: weight 600, background `#FFFFFF`, color `#141414`, `box-shadow: inset 3px 0 0 #141414, 0 1px 2px rgba(20,20,20,.08)`, `aria-current="page"`. Others: weight 500, `#3A3A3A`, transparent.
- **Main** (`<main>`): `flex:999 1 640px; min-width:0`, column, gap 20px, padding 28px 32px 32px.

**Release 0 section nav** (sections for later releases are not shown until built):

| Group | Section | Route | Eyebrow group | Title | Description |
|---|---|---|---|---|---|
| Firm | Firm profile | `/app/settings/firm` | FIRM | Firm profile | Your firm's name, address and license details. These appear on letterhead, invoices, proposals and the client portal. |
| Firm | Users & access | `/app/settings/users` | FIRM | Users & access | Who can sign in to ArchiTrac and what each person can see and do. |
| Account | Modules & plan | `/app/settings/modules` | ACCOUNT | Modules & plan | Turn modules on or off for the whole firm. A module that's off is hidden from the menu. |

(Release 1 inserts a "Work" group between Firm and Account: Phases & fees, Roles & rates, Time & approvals. Mockup group order: Firm, Work, Money, Account.)

**3. Firm profile** (`<section aria-label="Firm profile">`, white card, border `#DCDCDC`, padding 22px 24px 24px, `flex-wrap` gap 24px):
- Left column: 120×120 logo box (dashed border `#AFAFAF`, striped background, "LOGO" in Plex Mono 12px) or the logo image if `logo_url` is set. Under it an "Upload logo" button — rendered **disabled** in Release 0 with `title="Coming soon"` (see Out of scope).
- Right: grid `repeat(auto-fit, minmax(240px, 1fr))`, gap 16px 20px. Each field: label (11px/600 uppercase `#4D4D4D`), input (38px, border `#D4D4D4`, padding 0 10px), hint (12.5px `#666666`). Fields in this order:

| # | Label | Control | Column | Hint | Validation (Zod, server) |
|---|---|---|---|---|---|
| 1 | Firm name | text | `firms.name` | Legal name for invoices and contracts | required, trim, 2–120 |
| 2 | Display name | text, placeholder = firm name | `firms.display_name` * | Shown in the app and on letterhead | optional, ≤ 80; blank saves `null` |
| 3 | Address | text | `firms.address_line1` * | — | optional, ≤ 200 |
| 4 | Suite / unit | text | `firms.address_line2` * | — | optional, ≤ 100 |
| 5 | City | text | `firms.city` * | — | optional, ≤ 100 |
| 6 | State | select of 50 states + DC (2-letter codes, default `SC`) | `firms.state` * | — | optional, must be a valid code |
| 7 | ZIP | text, `inputmode="numeric"` | `firms.postal_code` * | — | optional, `^\d{5}(-\d{4})?$` |
| 8 | Main phone | `type="tel"` | `firms.phone` * | — | optional, 10 digits after removing non-digits; stored formatted `(843) 555-0100` |
| 9 | Website | text | `firms.website` * | — | optional; stored lowercase without `https://` and trailing `/`; must contain a dot, no spaces |
| 10 | Firm license / COA number | text | `firms.license_number` * | Printed on drawings and proposals | optional, ≤ 50 |
| 11 | Time zone | select | `firms.timezone` | Used for due dates and reminders | one of: Eastern `America/New_York`, Central `America/Chicago`, Mountain `America/Denver`, Arizona `America/Phoenix`, Pacific `America/Los_Angeles`, Alaska `America/Anchorage`, Hawaii `Pacific/Honolulu`. Option label: "Eastern (America/New_York)" |
| 12 | Fiscal year starts | select January…December | `firms.fiscal_year_start_month` | Used by Reports | integer 1–12 |

\* = column not yet in DATA_MODEL.md (see Open questions). The mockup has a single "City, state, ZIP" field; this spec splits it into fields 5–7 so the values can be printed and validated.

**4. Modules & plan** (column, gap 16px, max-width 1040px):
- **Plan card** (white, padding 20px 24px, `flex-wrap` gap 20px): three stat blocks, each label (11px/600 uppercase) + value (20px/600) + hint (12.5px):
  - "Plan" / "ArchiTrac Core" / "Projects, Contacts, Team, Time, Reports · {seats} seats"
  - "Modules on" / "{on} of 9" / "Billed monthly per seat"
  - "Monthly total" / "[Price]" / "Pricing not set yet"
  - Right: "Billing history" button — **not rendered** in Release 0.
- **Module cards**: grid `repeat(auto-fill, minmax(300px, 1fr))`, gap 16px. One card per module in the order of the seed table below. Card: white, padding 18px 20px, border 1px `#141414` when on / `#DCDCDC` when off. Header row: 40px icon box (on: bg `#141414` icon white; off: bg `#EBEBEB` icon `#4D4D4D`), name (13px/700 uppercase), price line under name ("On · [Price] per seat / month" or "Off · [Price] per seat / month"), switch on the right. Description paragraph below (line-height 1.5, `#3A3A3A`).
- **Switch** (`<Switch>`, shared): `<button role="switch" aria-checked aria-label="Turn on Build"|"Turn off Build">`, 40×22, radius 11px, track `#141414` on / `#C4C4C4` off, 16px white knob at left 21px on / 3px off, 120ms transition.

**5. Users & access** (not in mockup; built from shared components):
- **Invite card** (white, padding 20px 24px): H2 "Invite people" (13px/600 uppercase). Row (`flex-wrap`, gap 12px, align end): Email (input `type="email"`, flex 1 1 260px), Role (select, 200px), Title (input, optional, 200px, placeholder "e.g. Project Architect"), button "Send invite" (38px, `#141414`, white, 600). Under the row, a hint describing the selected role (text from the role table in Business rule 6).
- **People table** (white card, `overflow-x:auto`, table `min-width:760px`): header row 11px `#666666` on `#FAFAFA`. Columns: **Person** (32px initials avatar + name 500 + email 12px `#666666` under it), **Title**, **Role**, **Status** (pill), **Actions** (right-aligned "⋯" menu button, `aria-label="Actions for {name}"`).
- Rows: active and deactivated members first (sorted by last name), then pending invitations (sorted by `invited_at` desc). Invitation rows show the email in the Person cell, "Invited {Mon D}" under it, Title, the invited role, status "Invited".
- Status pills (22px tall, 10.5px/500 uppercase, letter-spacing .07em): Active `#E2F1E6`/`#1D6234`; Invited `#FCE7DF`/`#9A3412`; Expired `#EBEBEB`/`#4D4D4D`; Off `#EBEBEB`/`#4D4D4D`.
- Role cell: a `<select>` (Owner, Admin, Project manager, Staff) when I may change this person's role (rule 7); otherwise plain text. Role changes save on change (no Save button) and show a toast "Role updated".

## Data shown
| UI element | Source (table.column or calculation) | Notes / format |
|---|---|---|
| Firm profile fields | `firms.*` per table above | |
| Logo | `firms.logo_url` | |
| Seats | `count(memberships) where firm_id = me and active` | TMG seed: 14 |
| Modules on | count of the 9 module keys present in `firm_settings.modules_enabled` | TMG seed: 8 of 9 |
| Module card on/off | `'<key>' = any(firm_settings.modules_enabled)` | |
| People rows | `memberships` ⨝ `users` (`first_name`, `last_name`, `email`, `initials`), `memberships.title`, `.app_role`, `.active` | Status: `active` → Active, else Off |
| Invitation rows | `invitations` * where `status in ('pending','expired')` | `invited_at` formatted "Oct 20" |

## Actions
| Action | What happens | Validation | Permission |
|---|---|---|---|
| Pick a section | Navigate to its route. If the current form is dirty, `confirm("Discard unsaved changes?")` first (also on browser unload via `beforeunload`). | — | owner, admin |
| Edit a Firm field | Form becomes dirty | client + server Zod | owner, admin |
| Save changes (Firm) | Server action `updateFirmProfile`: update `firms`, write `activity_log` (`entity_type 'firm'`, `action 'updated'`, `changes` = before/after of changed fields only). If `name` or `display_name` changed, update the Clerk organization `name` to the display name ?? name. `router.refresh()` so the header firm name updates. | Zod schema in table; errors shown under each field, focus first error | owner, admin |
| Toggle a module | Card flips; form becomes dirty | — | owner, admin |
| Save changes (Modules) | Server action `updateModules(keys: ModuleKey[])`: set `firm_settings.modules_enabled` to the sorted list of on keys; `activity_log` (`entity_type 'firm_settings'`, `changes: { modules_enabled: { before, after } }`); `router.refresh()` so the rail updates | every key in `MODULE_KEYS` | owner, admin |
| Send invite | Server action `inviteUser`: insert `invitations` row (pending); Clerk `organizations.createOrganizationInvitation({ organizationId, emailAddress, inviterUserId, role: clerkRoleFor(app_role), redirectUrl: APP_URL + '/sign-up' })`; store `clerk_invitation_id`; `activity_log` (`entity_type 'invitation'`, `created`). Clear the form, toast "Invite sent to {email}". If Clerk fails, mark the row `revoked` and show the error. | email valid, lower-cased; not an active member of this firm ("{email} is already a member"); no pending invite for it ("Already invited — use Resend"); role allowed (rule 7); title ≤ 80 | owner, admin |
| Resend invite | Revoke the Clerk invitation, create a new one, update `clerk_invitation_id`, `invited_at = now()`, `status = 'pending'` | invitation pending or expired | owner, admin (owner-role invites: owner only) |
| Revoke invite | Clerk `revokeOrganizationInvitation`; `status = 'revoked'`; row disappears | pending | same as Resend |
| Change role | Server action `changeRole(membershipId, appRole)`: update `memberships.app_role`, update Clerk membership role (rule 8 of app-shell), `activity_log` (`status_changed`) | rule 7 | owner, admin |
| Deactivate | Confirm dialog "Turn off access for {name}? They won't be able to sign in to {Firm}. Their time and history stay." → `memberships.active = false`, Clerk `deleteOrganizationMembership`, `activity_log` | rule 7; not myself | owner, admin |
| Reactivate | Opens the invite form prefilled with their email, current role and title | — | owner, admin |

## Business rules
1. **Settings guard.** Every settings route and server action calls `requireRole(['owner','admin'])`.
2. **Module keys** (constant `MODULE_KEYS` in `src/lib/modules.ts`, order = card order): `schedule, build, workload, accounting, marketing, knowledge, code, website, hiring` → 9 total. Rail modules are these minus `schedule` and `code`.
3. **Modules on count** = `MODULE_KEYS.filter(k => modules_enabled.includes(k)).length`. Example, TMG seed (all but `code`): 8 → "8 of 9".
4. **Save model.** Firm profile and Modules are one form each; nothing is written until Save changes. After save: dirty = false, "Saved" shows. If the server returns errors, dirty stays true and nothing is written (all-or-nothing).
5. **Normalization examples:** phone "843.555.0100" → `(843) 555-0100`; website "https://www.TMG-Arch.com/" → `www.tmg-arch.com`; display name "" → `null` (app falls back to `name`).
6. **App roles** (labels and help text used in the role select and hint):

| app_role | Label | Help text |
|---|---|---|
| owner | Owner | Everything, including billing, modules and managing other owners. |
| admin | Admin | Everything except managing owners. Sees rates, cost and profit. |
| project_manager | Project manager | Runs their projects. Sees budgets and hours on their projects, not cost rates or salaries. |
| staff | Staff | Logs time and sees the projects they're on. |

7. **Who may change whom.** Let *me* = current membership, *them* = target membership or invitation.
   - Only an owner may: invite with role Owner, change anyone to or from Owner, deactivate an Owner, resend/revoke an Owner invitation.
   - Nobody may change their own role or deactivate themselves (the select is plain text on my own row; "Deactivate" is absent).
   - The firm must always have ≥ 1 active owner: demoting or deactivating the last active owner fails with "{Firm} needs at least one owner."
   - The Role select for an admin viewer lists Admin, Project manager, Staff only; on an owner's row it is plain text and the Actions menu is empty.
8. **Invitation lifecycle** (`invitations.status`): `pending` → `accepted` (webhook `organizationMembership.created`, see app-shell rule 7) | `revoked` (Revoke) | `expired` (Clerk webhook `organizationInvitation.*` with status expired, or Clerk status on read). Accepted rows are hidden from the table. Accepting when a deactivated membership exists sets `active = true` and applies the invited role and title.
9. **Invite email** is sent by Clerk using its organization invitation template. Firm display name is the Clerk org name, so the email reads "{Firm} invited you to join".

## States
- **Empty state:** Users table always has at least me. If no invitations: no invitation rows. Firm profile with only `name` set: other inputs empty with hints.
- **Loading state:** route `loading.tsx` renders the section nav immediately and a card skeleton in Main. Buttons in flight show "Saving…" / "Sending…" and are disabled.
- **Error state:** server error on save: red banner at top of Main (`#FDECEC` bg, `#B42318` text) "Couldn't save. Nothing was changed. Try again." Field errors under fields in `#B42318` 12.5px, inputs get border `#B42318` and `aria-invalid`.
- **Permission-denied state:** PM/staff opening any `/app/settings/**` see `<AccessDenied>` inside the shell. An admin calling a server action on an owner gets error "Only an owner can do that." shown as a toast.

## Out of scope (for this release)
- Logo upload (needs file storage decision) — button rendered disabled; Release 2 with `documents`.
- Letterhead & templates section — Release 2.
- Phases & fees, Roles & rates, Time & approvals — Release 1 (`release-1/settings-rates-phases.md`).
- Billing & invoices, Integrations — Release 1/2 with Accounting.
- Security & data (2-step sign-in, SSO, idle timeout, export, audit log) — later; 2FA/SSO are configured in the Clerk dashboard meanwhile.
- Pricing, "Billing history", per-seat billing — Release 5 (`subscriptions`).
- Team page's fine-grained permissions (Principal, Approve team time, Accounting access, Firm admin checkboxes) — Release 1 Team spec.

## Acceptance tests
- [ ] Given I am an owner, when I open `/app/settings`, then I am redirected to `/app/settings/firm` and "Firm profile" is current in the section nav.
- [ ] Given I am a project manager, when I open `/app/settings/modules`, then I see "You don't have access to this page", and calling `updateModules` directly returns a permission error.
- [ ] Given the Firm profile is clean, then Save changes is disabled; when I type in Main phone, then "Unsaved changes" shows and Save is enabled.
- [ ] Given I enter phone "843.555.0100" and website "https://www.TMG-Arch.com/", when I save, then `firms.phone = '(843) 555-0100'`, `firms.website = 'www.tmg-arch.com'`, and "Saved" shows.
- [ ] Given I clear Firm name, when I save, then I see "Firm name is required", focus is on Firm name, and `firms.name` is unchanged.
- [ ] Given I enter ZIP "2940", when I save, then I see "Enter a 5-digit ZIP" and nothing is saved.
- [ ] Given I change Display name to "TMG", when I save, then the header firm switcher shows "TMG", the Clerk org name is "TMG", and one `activity_log` row has `changes.display_name.after = 'TMG'`.
- [ ] Given I have unsaved changes, when I click "Modules & plan" in the section nav, then I am asked "Discard unsaved changes?" and cancelling keeps me on Firm profile.
- [ ] Given the TMG seed, when I open Modules & plan, then 9 cards show in order Schedule, Build, Workload, Accounting, Marketing, Knowledge, Code, Website, Hiring, Code is off, and the plan card says "8 of 9" and "14 seats".
- [ ] Given Hiring is on, when I switch it off and save, then `modules_enabled` no longer contains `hiring`, the Hiring rail item disappears without a full reload, and the card border is `#DCDCDC`.
- [ ] Given I toggle Code on and then off again, then the form is still dirty until saved (mockup behavior), and saving writes the same array as before.
- [ ] Given I am an admin, when I open the Role select in the invite form, then it lists Admin, Project manager, Staff and not Owner.
- [ ] Given I invite "new.designer@example.com" as Staff with title "Designer", then an `invitations` row (pending, staff, Designer) exists, Clerk received an invitation, and an "Invited" row shows in the table.
- [ ] Given "kl@tmg.example" is an active member, when I invite that email, then I see "kl@tmg.example is already a member" and no invitation is created.
- [ ] Given a pending invitation for staff, when the invitee signs up through the link, then a `memberships` row with `app_role = 'staff'` and title "Designer" exists and the invitation is `accepted`.
- [ ] Given a pending invitation, when I click Revoke, then the Clerk invitation is revoked, the row disappears, and `invitations.status = 'revoked'`.
- [ ] Given I am an admin, when I view an owner's row, then the role is plain text and there is no Actions menu.
- [ ] Given I am the only active owner, then my own row has no role select and no Deactivate; and if another owner tries to demote me while I'm the last owner, they see "{Firm} needs at least one owner."
- [ ] Given I deactivate JR, then `memberships.active = false` for JR, JR's Clerk org membership is removed, JR's status pill reads "Off", and JR's time entries still exist.
- [ ] Given firm A and firm B, when an admin of firm A requests firm B's people list via the server action with firm B's id, then no rows are returned (RLS).
- [ ] Given a 375px viewport, then the section nav stacks above Main and the people table scrolls horizontally inside its card without page scroll.

## Open questions
1. *Data model addition needed:* `firms.display_name text null`, `address_line1`, `address_line2`, `city`, `state` (2-letter), `postal_code`, `phone`, `website`, `license_number` (all `text null`). Same address column names as `companies` for consistency.
2. *Data model addition needed:* `invitations` table — `id`, `firm_id`, `email citext`, `app_role app_role`, `title text null`, `firm_role_id uuid null`, `status enum invitation_status ('pending','accepted','revoked','expired')`, `clerk_invitation_id text`, `invited_by uuid → users`, `invited_at timestamptz`, `accepted_at timestamptz null`, `membership_id uuid null`; partial unique index on (`firm_id`, `email`) where `status = 'pending'`; RLS policy + cross-firm test like every firm-owned table. **Conflict:** `release-1/team.md` proposes instead putting invite state on `memberships` (`status`, `invited_email`, nullable `user_id`). Pick one before Release 0 is built; this spec recommends the separate table so `memberships.user_id` stays required. Needed because Clerk has no app role and the person has no `users` row until they accept.
3. *Data model addition needed:* `firm_settings.modules_enabled` valid keys must include `schedule` and `code` (mockup has 9 modules; DATA_MODEL lists 7). Default for a **new** firm: this spec uses `'{}'` (nothing on) vs DATA_MODEL's all-7 default — pick one. TMG seed = `{schedule,build,workload,accounting,marketing,knowledge,website,hiring}` (mockup: all on except Code).
4. Mockup says Workload "Uses Schedule". Should turning Workload on force Schedule on (and block turning Schedule off while Workload is on)? This spec does not enforce it.
5. Should admins be allowed to turn modules on/off once modules are billed per seat, or owner only? Spec: both, until pricing exists.
6. Logo storage provider (Vercel Blob, S3, Cloudflare R2) — needed before "Upload logo" is enabled.
7. Fine-grained Team permissions (mockup Team drawer: Principal, Approve team time, Accounting access, Firm admin) don't map 1:1 to `app_role`. Decide in the Release 1 Team spec whether these become extra membership flags.
