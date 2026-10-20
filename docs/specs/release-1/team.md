# Spec: Team

| | |
|---|---|
| **Release** | 1 |
| **Route** | `/app/team` (`?tab=people\|teams&team=<teamId>&q=…&person=<membershipId>`) |
| **Mockup** | `mockup/Team.dc.html` |
| **Status** | Draft |

## Purpose
The firm's people directory and team structure. Everyone looks people up here; owners/admins invite people, set each person's role, team, weekly hours and utilization target, and arrange teams (in the mockup a team's leader is the first reviewer of its members' timesheets — see Open question 4). Billing roles and rates are **edited in Settings → Roles & rates** (separate spec); this page only displays them.

## Who can see it
| Role | Access |
|---|---|
| Owner | Full: invite, edit any profile, change app role (including owner), move people, create/edit teams, deactivate. Sees rates, cost, multiplier. |
| Admin | Same as Owner except cannot grant/remove the `owner` app role. |
| Project manager | View directory and teams; sees everyone's utilization. No rates/cost. No edits. |
| Staff | View directory and teams; sees only their **own** utilization. No rates/cost. No edits. |
| Client (portal) | None. |

## Layout
`AppShell` with "TEAM" crumb. Top to bottom:
1. **PageHeader** — eyebrow `PEOPLE · TEAMS`, H1 "Team". Actions (owner/admin only): `New team` (secondary), `+ Invite person` (primary).
2. **KpiStrip** — owner/admin: People, Teams, Billable staff, Avg. multiplier. PM/staff: People, Teams.
3. **TabBar** — `People {count}` · `Teams {count}`. Switching tab closes the drawer.
4. **People tab**
   - Toolbar: `SearchInput` ("Search by name or role"), `SegmentedFilter` by team: All · {team names in `teams.sort_order`} · No team (only if anyone has `team_id` null).
   - `DataTable` (row = button, selected `#EAF0FB`), columns: Person (avatar 36 + full name + title) · Role · rate (role name; owner/admin also see rate line, mono) · Team (name + "Leads this team" / "Leader · {initials}") · Week (right, mono "40 h") · Utilization · 4 wks (110px bar + target tick + "84% / 80%") · Access (pill).
5. **Teams tab**
   - Info banner (blue `#E4EBF8`/`#1E3F7A`, info icon). Text if the two-step route is adopted (mockup): "Each person's timesheet goes to their team leader first, then to a principal. Moving someone to another team changes who reviews their time from the next timesheet on." If `timesheet.md`'s model stays (PMs approve their projects, admins approve all): "Teams group people for filtering and capacity. Timesheets are approved by each project's PM and by admins." Text is a constant chosen at build time per Open question 4.
   - Grid of team cards (`minmax(320px, 1fr)`): header = team name + "{n} people"; leader row = avatar + "TEAM LEADER" + name + "{h} h / week capacity"; member list = avatar 28, name, title (+ " · leader"), and a team `select` (owner/admin only; read-only text for others). Owner/admin also get a card menu `⋯` → Edit team / Archive team (not in mockup; needed to rename or change leader).
6. **Person DetailDrawer** (420px, top-right): avatar 52, name, title, "{team} · team leader" or "{team} · reports to {leader initials}"; `dl` rows; **Access** section (replaces the mockup's "Permissions" checkboxes, see Out of scope); footer `Edit profile` (owner/admin) and `View timesheets` link.
7. **FormModal**s: Invite person, Edit profile, New/Edit team.

## Data shown
| UI element | Source (table.column or calculation) | Notes / format |
|---|---|---|
| KPI People | count(memberships) where active (incl. invited) | note "{n} invited, not yet signed in" |
| KPI Teams | count(teams) not archived | note "Each with a leader who reviews time" |
| KPI Billable staff | count of active memberships whose current bill rate (rule 2) > 0 | note "{Σ weekly_capacity_hours} h / week capacity". Owner/admin only |
| KPI Avg. multiplier | rule 3 | "2.54×"; note "Bill ÷ cost · rates are set in Settings" with link `/app/settings/roles-rates`. Owner/admin only |
| Avatar / initials | `users.initials`, `users.avatar_url` (image if set) | fallback colour: rule 8 |
| Name | `users.first_name` + `users.last_name` | invited: invite name |
| Title | `memberships.title` | |
| Role | `memberships.firm_role_id` → `firm_roles.name` | "No role" in orange if null |
| Rate line | rule 2 → "$115 / h"; bill rate 0 → "Not billable"; none found → "No rate set" (orange) | owner/admin only; stripped server-side otherwise |
| Team | `memberships.team_id` → `teams.name`; sub-line rule 7 | "No team" if null |
| Week | `memberships.weekly_capacity_hours` | "40 h", "24 h" |
| Utilization | rule 4 | "88% / 85%"; "—" when target is 0/null or invited |
| Access pill | rule 6 | |
| Drawer: Email | `users.email` (invited: invite email) | `mailto:` link |
| Drawer: Phone | **Data model addition needed** (`memberships.phone`) | "—" if empty |
| Drawer: Role · rates | role name + "· $115 bill / $44 cost" | owner/admin only; others see role name only |
| Drawer: Weekly hours | "{capacity} h · utilization target {target}%" | `target_utilization_bp / 100` |
| Drawer: Employment | `memberships.employment_type` | "Full time", "Part time", "Contract" |
| Drawer: License | **Data model addition needed** (`memberships.license_note`) | "Licensed architect · SC, NC" |
| Drawer: With firm since | **Data model addition needed** (`memberships.start_date`) | year only, "2016" |
| Drawer Access section | `memberships.app_role` (select for owner/admin, text otherwise); derived lines "Team leader · {team}" and "Principal · final timesheet approval" (rule 9) | |
| Team card count / capacity | members = active memberships with `team_id` = team; capacity = Σ their `weekly_capacity_hours` | "5 people", "184 h / week capacity" |
| Team leader | `teams.leader_membership_id` → user name | "No leader set" (orange) if null |

## Actions
| Action | What happens | Validation | Permission |
|---|---|---|---|
| Search | filters by name, title, role name (case-insensitive substring); `?q=` | | all |
| Team filter | `?team=<id>` / `none` | | all |
| Open person | `?person=<membershipId>`; drawer opens | | all |
| Invite person | Modal: email*, first name*, last name*, title, app role* (default staff), billing role, team, employment type* (default full_time), weekly hours* (default 40), utilization target % (default 80). Creates membership in `invited` state and sends a Clerk organization invitation. On acceptance (Clerk webhook) the membership links to the user and becomes active. | email valid and not already a member of this firm; weekly hours 0–80 in 0.25 steps; target 0–100 → stored ×100 as bp | owner, admin (only owner may invite as owner) |
| Resend / revoke invite | Drawer buttons for invited people; revoke archives the membership and revokes the Clerk invitation | | owner, admin |
| Edit profile | Modal with the invite fields (email read-only) plus phone, license, start date. Saves membership; writes `activity_log` | same as invite | owner, admin |
| Change app role | Select in drawer Access section; saves immediately with toast; updates Clerk org role mapping | rule 10 | owner (any); admin (not to/from owner) |
| Move person (Teams tab select) | Updates `memberships.team_id`; toast "{Name} moved to {team}. Their next timesheet goes to {leader}." | rule 11 | owner, admin |
| New team / Edit team | Modal: name*, leader (select of active members). Setting a leader also sets that person's `team_id` to this team | name unique per firm (case-insensitive), ≤ 60 chars; leader cannot already lead another team | owner, admin |
| Archive team | sets `teams.archived_at` | blocked if it has members: "Move its {n} people first." | owner, admin |
| Deactivate person | In Edit profile: sets `memberships.active = false`, removes Clerk org membership; person disappears from list (owner/admin can tick "Show inactive") | rule 10; blocked if they lead a team | owner, admin |
| View timesheets | others' drawer: link to their latest submitted/approved timesheet detail `/app/time/approvals/<timesheetId>` (`timesheet-approval.md`), hidden if they have none; own drawer: link `/app/time/history` | | others: owner, admin (+ the person's team leader if the two-step route is adopted); own: everyone |

## Business rules
1. List = memberships of the current firm with `active = true` (plus `active = false` when "Show inactive"). Sort: team `sort_order`, then team leader first, then last name. "No team" people last.
2. Current rate: use the `rates` lookup rule from DATA_MODEL with D = today (firm timezone): person override effective today → else role rate effective today → else none. Use `lookupRate(rates, membership, today)` from `src/lib/calc/rates.ts` (defined in `timesheet-approval.md`); do not re-implement.
3. Avg. multiplier = mean over billable people (bill > 0 and cost > 0) of `bill_rate_cents / cost_rate_cents`, shown to 2 decimals + "×". Example (mockup): 12 billable people — Principal 18500/9500 = 1.947, PM 15000/6200 = 2.419, 6 Designers 11500/4400 = 2.614 each, Interior 12000/5200 = 2.308, Intern 7500/2400 = 3.125, 2 PAs 14500/5800 = 2.5 → sum 30.481 / 12 = **2.54×**.
4. Utilization · 4 wks. Weeks = the 4 most recent **completed** weeks before the week containing today (week start = `firm_settings.week_starts_on`). `billable_hours = Σ time_entries.hours` where `billable = true`, `project_id is not null`, `work_date` in those weeks, and the parent timesheet `status in (submitted, approved)` (plus the leader-approved stage, see Open questions). `utilization = billable_hours / (weekly_capacity_hours × 4)`, rounded half-up to a whole percent. Target = `target_utilization_bp / 100`. Example: KL, capacity 40, billable 141 h → 141 / 160 = 88.1% → "88% / 85%". EW, capacity 24, billable 72 h → 72 / 96 = **75%**. Calculation lives in `src/lib/calc/utilization.ts`.
5. Utilization bar: fill width = min(utilization, 100)%; target tick 2px `#141414` at target%. Below target (util < target): fill = orange hatched `repeating-linear-gradient(135deg,#C2410C 0 1.5px,#F6CDB9 1.5px 5px)` and text `#9A3412`; else fill `#2F5BAA`, text `#141414`. Target 0/null or capacity 0 → text "—", no bar fill, no tick.
6. Access pill (first match): invited → "Invited" (`#FCE7DF`/`#9A3412`); app_role owner → "Owner" (`#141414`/`#FFFFFF`); admin → "Admin" (same black); leads a team → "Team leader" (`#E4EBF8`/`#1E3F7A`); project_manager → "Project manager" (`#E4EBF8`/`#1E3F7A`); staff → "Member" (`#EBEBEB`/`#4D4D4D`).
7. Team sub-line: if `teams.leader_membership_id` = this membership → "Leads this team"; else "Leader · {leader initials}"; leader null → "No leader set".
8. Avatar fallback colour: index = (charCode(initials[0]) + charCode(initials[1])) mod 6 into `#141414, #2A2A2A, #3A3A3A, #4D4D4D, #5C5C5C, #666666`; white text.
9. "Principal" = membership flagged as a principal (see Open questions). Principals give final timesheet approval.
10. A firm must always have ≥ 1 active owner: demoting or deactivating the last owner is blocked ("{Firm} needs at least one owner."). Nobody can change their own app role.
11. Moving a person: blocked if they lead their current team ("Assign a new leader to {team} first."). If the two-step route is adopted, timesheets already submitted keep their current reviewer and the new team leader reviews from the next submission (requires the snapshot field in Open question 4); the toast then reads "{Name} moved to {team}. Their next timesheet goes to {leader}.", otherwise just "{Name} moved to {team}."
12. Rates, cost and multiplier are never sent to PM/staff: the server omits these fields (not just the UI). Staff receive utilization only for their own membership.

## States
- **Empty (only the owner exists):** People table shows one row plus callout "Invite your team to start tracking time." with `Invite person`. Teams tab with no teams: "No teams yet. Teams decide who reviews timesheets." + `New team` (owner/admin).
- **No results:** "No people match "{q}"" + `Clear search and filters`.
- **Loading:** KPI skeletons; 8 skeleton rows; 3 skeleton team cards.
- **Error:** banner "Couldn't load the team." + `Retry`.
- **Not enough history:** if a person has no timesheets in the 4 weeks, show "0% / {target}%" (it is real data, not missing).
- **Permission denied:** PM/staff calling invite/edit/move actions get 403 + toast "Only owners and admins can change the team."

## Out of scope (for this release)
- **Roles & rates editing** (the hidden "Roles & rates" tab in the mockup code, rate inputs, multiplier flags) — Settings spec, Release 1.
- **Permissions checkboxes** ("Principal", "Approve team time", "Accounting access", "Firm admin") — replaced in R1 by the single app-role select plus derived lines; fine-grained permissions are an open question.
- **PTO balance** drawer row — no leave-balance tables in any release yet; hide.
- **Forward-looking utilization / scheduled hours / capacity planning** (people × weeks) — Workload, Release 3 (needs `tasks`, `pursuits`). This page shows only past utilization from timesheets.
- **Hiring pipeline / openings** — Release 5.

## Acceptance tests
- [ ] Given the seed firm, when an owner opens `/app/team`, then KPIs read People 14 ("1 invited, not yet signed in"), Teams 4, Billable staff 12 ("464 h / week capacity"), Avg. multiplier 2.54×.
- [ ] Given a staff user, when they open `/app/team`, then only People and Teams KPIs show, the Role · rate column shows role names with no "$", and the server payload contains no rate or cost fields.
- [ ] Given a staff user KL, then KL's own row shows utilization and every other row shows "—" in the utilization column; given a PM, then every row shows utilization.
- [ ] Given KL has capacity 40, target 8500 bp, and 141 billable hours in submitted/approved timesheets across the 4 completed weeks, then the row shows "88% / 85%" with a blue bar and tick at 85%.
- [ ] Given DS has 126.5 billable hours in the window (79%), target 85%, then the text is orange and the bar is hatched.
- [ ] Given billable hours on a draft timesheet or non-billable entries or overhead entries, then they are excluded from utilization.
- [ ] Given today is Sunday 2026-10-18 and week starts Monday, then the utilization window is 2026-09-14 to 2026-10-11.
- [ ] Given OK has target 0, then the utilization cell shows "—" and no tick.
- [ ] Given team filter "Medical studio", then only its 5 members show and the URL has `team=<id>`.
- [ ] Given search "project arch", then TC and SG are shown.
- [ ] Given the Teams tab as owner, when KL is moved to Commercial studio, then `memberships.team_id` updates, an `activity_log` row is written, the toast confirms the move (naming TC as next reviewer if the two-step route is adopted), and the Medical studio card count drops by 1.
- [ ] Given JR leads Medical studio, when an owner tries to move JR, then it is blocked with "Assign a new leader to Medical studio first."
- [ ] Given a PM on the Teams tab, then member team selects are rendered as plain text.
- [ ] Given an owner invites "new@firm.com" as staff on Commercial studio, then a membership in invited state exists, a Clerk invitation was requested, and the row shows the "Invited" pill.
- [ ] Given an email already a member of the firm, when invited again, then the form shows "Already on the team".
- [ ] Given an admin, when they try to set someone's app role to owner, then the action returns 403.
- [ ] Given the firm has one owner, when that owner is demoted or deactivated, then it is blocked with "needs at least one owner".
- [ ] Given a team with members, when an owner archives it, then it is blocked with "Move its {n} people first."
- [ ] Given a person row is clicked, then the drawer opens with `person=<id>` in the URL and reloading keeps it open.
- [ ] Given staff viewing another person's drawer, then "View timesheets" is not shown; viewing their own, it links to `/app/time/history`.

## Open questions
1. **Data model addition needed:** invitation state on memberships — e.g. `memberships.status enum (invited, active, inactive)` replacing `active`, `memberships.invited_email citext`, `invited_at`, and `user_id` nullable until the invite is accepted (today `user_id` is required and `users.clerk_user_id` is required, so an invited person cannot be stored).
2. **Data model addition needed:** `memberships.phone text`, `memberships.license_note text`, `memberships.start_date date` for the drawer rows (Phone, License, With firm since).
3. **Data model addition needed:** `memberships.is_principal boolean default false` — who gives final timesheet approval (TMG: Blake and Laura). Alternative: derive from `firm_roles.name = 'Principal'` (fragile).
4. **Approval model conflict (decide once for Time, Team and Home):** the mockup routes timesheets team leader → principal; `timesheet.md` follows "PMs approve their projects, admins approve all". If the two-step route is adopted, **Data model addition needed:** `leader_approved` in enum `timesheet_status`, `timesheets.leader_approved_at`, `leader_approved_by`, and `timesheets.reviewer_membership_id` (team leader snapshot at submission, so a move takes effect "from the next timesheet on"). Utilization (rule 4) counts `submitted` and `approved` either way, plus `leader_approved` if added.
5. Should fine-grained permissions ("Accounting access", "Approve team time") exist beyond the four app roles? Mockup shows a bookkeeper with "Accounting" access who is not an admin.
6. Should PMs see rates? CLAUDE.md says owner/admin only; confirm for team leaders who are PMs.
7. Should people be able to edit their own phone/license in R1, or only owners/admins?
