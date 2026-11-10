import { expect, test } from "@playwright/test";
import { ownerPool } from "./support/clean";
import { FIRMS, PEOPLE } from "./support/people";
import { signInAs } from "./support/sign-in";

// The weekly timesheet in the browser (docs/specs/release-1/timesheet.md).
// Every server rule is also a Vitest test in src/server/time/time.db.test.ts.
//
// Runs in order against "E2E Iota Time", which only this file uses. Setup:
// project 2026-014 Medical Office Building with Schematic Design (closed) and
// Design Development (current); Kit (staff) is on Bo's team (Bo leads it).
// Uses the past week of Oct 12, 2026, which is wiped first.

test.describe.configure({ mode: "serial" });

const WEEK = "2026-10-12";

async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const pool = ownerPool();
  const c = await pool.connect();
  try {
    const firm = await c.query<{ id: string }>("select id from firms where name = $1", [FIRMS.iota.name]);
    await c.query("begin");
    await c.query("select set_config('app.firm_id', $1, true)", [firm.rows[0].id]);
    const r = await c.query<T>(sql.replaceAll(":firm", `'${firm.rows[0].id}'::uuid`), params);
    await c.query("commit");
    return r.rows;
  } finally {
    c.release();
    await pool.end();
  }
}

const membership = (email: string) =>
  `(select m.id from memberships m join users u on u.id = m.user_id where m.firm_id = :firm and u.email = '${email}')`;

test.beforeAll(async () => {
  for (const t of ["timesheet_review_steps", "time_entries", "timesheet_rows", "timesheets"]) await query(`delete from ${t} where firm_id = :firm`);
  const [{ n }] = await query<{ n: number }>("select count(*)::int as n from projects where firm_id = :firm");
  if (n > 0) return;
  const owner = membership(PEOPLE.ioOwner.email);
  const staff = membership(PEOPLE.ioStaff.email);
  await query(`
    with c as (
      insert into companies (firm_id, name, kind) values (:firm, 'Palmetto Medical Properties', 'client') returning id
    ), p as (
      insert into projects (firm_id, number, name, client_company_id, project_type, principal_membership_id, pm_membership_id)
      select :firm, '2026-014', 'Medical Office Building', id, 'Medical office', ${owner}, ${owner} from c returning id
    ), ph as (
      insert into project_phases (firm_id, project_id, code, name, sort_order, fee_type, fee_cents, status)
      select :firm, p.id, v.code, v.name, v.ord, 'fixed', 1000000, v.status::phase_status
      from p, (values ('SD', 'Schematic Design', 1, 'closed'), ('DD', 'Design Development', 2, 'current')) as v(code, name, ord, status)
      returning id
    ), t as (
      insert into teams (firm_id, name, leader_membership_id) values (:firm, 'Studio', ${owner}) returning id
    )
    update memberships set team_id = (select id from t) where id in (${owner}, ${staff})
  `);
});

test("/app/time opens this week; a mid-week date goes to its week", async ({ page }) => {
  await signInAs(page, "ioStaff", "/app/time");
  await expect(page).toHaveURL(/\/app\/time\/week\/\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole("button", { name: "This week" })).toHaveAttribute("aria-pressed", "true");

  await page.goto("/app/time/week/2026-10-14");
  await expect(page).toHaveURL(`/app/time/week/${WEEK}`);
  await expect(page.getByText("Week of Oct 12 – Oct 18, 2026 · Due Mon Oct 19, 9:00 AM")).toBeVisible();
  await expect(page.getByText("No time this week yet")).toBeVisible();
  // Viewing creates nothing.
  expect(await query("select id from timesheets where firm_id = :firm")).toHaveLength(0);
  // Staff who don't lead a team or approve as a principal have no Approvals tab.
  await expect(page.getByRole("link", { name: /^Approvals/ })).toHaveCount(0);
});

test("add a row, pick a project, type hours", async ({ page }) => {
  await signInAs(page, "ioStaff", `/app/time/week/${WEEK}`);
  await page.getByRole("button", { name: "Add row" }).first().click();
  const project = page.getByLabel("Project for new row");
  await expect(project).toBeFocused();
  // Day cells stay off until a choice is made.
  await expect(page.getByLabel(/, Mon Oct 12$/).first()).toBeDisabled();

  await project.selectOption({ label: "2026-014 · Medical Office Building" });
  const phase = page.getByLabel("Phase for 2026-014 Medical Office Building");
  await expect(phase.locator("option:checked")).toHaveText("Design Development · current");
  await expect(phase.getByRole("option", { name: "Schematic Design · closed" })).toBeDisabled();
  const activity = page.getByLabel("Activity for 2026-014 Medical Office Building");
  await expect(activity.locator("option:checked")).toHaveText("Activity…");
  await expect(activity).toHaveClass(/border-orange/);

  const mon = page.getByLabel("2026-014 Medical Office Building, Mon Oct 12");
  await mon.fill("1:30");
  await mon.blur();
  await expect(mon).toHaveValue("1.5");

  const tue = page.getByLabel("2026-014 Medical Office Building, Tue Oct 13");
  await tue.fill("1.13");
  await tue.blur();
  await expect(tue).toHaveValue("1.25");
  await expect(page.getByText("Rounded to 1.25")).toBeVisible();

  const wed = page.getByLabel("2026-014 Medical Office Building, Wed Oct 14");
  await wed.fill("abc");
  await wed.blur();
  await expect(page.getByText("Enter hours like 1.5 or 1:30.")).toBeVisible();
  await wed.fill("0.1");
  await wed.blur();
  await expect(wed).toHaveValue("");

  await expect(page.getByRole("status").filter({ hasText: /^Saved / })).toBeVisible({ timeout: 15_000 });
  const saved = await query<{ hours: string }>(
    "select hours from time_entries where firm_id = :firm and archived_at is null order by work_date",
  );
  expect(saved.map((e) => Number(e.hours))).toEqual([1.5, 1.25]);

  // Hours with no activity block submit.
  await expect(page.getByTestId("submit-blocker")).toHaveText("1 row needs a phase and an activity before you can submit.");
  await expect(page.getByRole("button", { name: "Submit for approval" })).toHaveAttribute("aria-disabled", "true");
});

test("a day can't pass 24 hours", async ({ page }) => {
  await signInAs(page, "ioStaff", `/app/time/week/${WEEK}`);
  await page.getByRole("button", { name: "Add row" }).first().click();
  await page.getByLabel("Project for new row").selectOption({ label: "OH · Overhead" });
  const oh = page.getByLabel("Overhead, Thu Oct 15");
  await expect(oh).toBeEnabled();
  await oh.fill("20");
  await oh.blur();
  const mob = page.getByLabel("2026-014 Medical Office Building, Thu Oct 15");
  await mob.fill("5");
  await mob.blur();
  await expect(page.getByText("Oct 15 would total 25 h. A day can't exceed 24 h.")).toBeVisible();
  await expect(mob).toHaveValue("");
  // Clear it again for the next test.
  await oh.fill("");
  await oh.blur();
  await expect(page.getByRole("status").filter({ hasText: /^Saved / })).toBeVisible({ timeout: 15_000 });
});

test("submit goes to the Principal in Charge, locks the week, and recall reopens it", async ({ page }) => {
  await signInAs(page, "ioStaff", `/app/time/week/${WEEK}`);
  await page.getByLabel("Activity for 2026-014 Medical Office Building").selectOption({ index: 1 });
  await expect(page.getByTestId("submit-blocker")).toHaveCount(0);
  // Short of 40: a warning only.
  await expect(page.getByText(/hours short of 40/)).toBeVisible();
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Timesheet submitted.")).toBeVisible({ timeout: 15_000 });
  // Default route: Principal in Charge only. Bo (BM) is the PIC.
  await expect(page.getByText("With BM", { exact: true })).toBeVisible();
  await expect(page.getByText(/You can recall it until someone approves\./)).toBeVisible();
  // The empty overhead row was dropped; inputs are read-only.
  await expect(page.getByLabel("Overhead, Thu Oct 15")).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  const [sheet] = await query<{ status: string }>("select status from timesheets where firm_id = :firm");
  expect(sheet.status).toBe("submitted");
  const rows = await query<{ kind: string }>(
    "select kind from timesheet_review_steps where firm_id = :firm and archived_at is null",
  );
  expect(rows.map((r) => r.kind)).toEqual(["principal_in_charge"]);

  await page.getByRole("button", { name: "Recall timesheet" }).click();
  await expect(page.getByText("Draft", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("2026-014 Medical Office Building, Mon Oct 12")).toBeEditable();
});

test("History lists the week", async ({ page }) => {
  await signInAs(page, "ioStaff", "/app/time/history");
  const row = page.getByRole("link", { name: /Oct 12 – Oct 18, 2026/ });
  await expect(row).toContainText("2.75 h");
  await row.click();
  await expect(page).toHaveURL(`/app/time/week/${WEEK}`);
});

test("a note saves on a day with hours; days without hours are off", async ({ page }) => {
  await signInAs(page, "ioStaff", `/app/time/week/${WEEK}`);
  // The note icon sits under each day with hours; Wed has none, so no icon.
  await expect(page.getByRole("button", { name: "Add note, Wed Oct 14, 2026-014 Medical Office Building" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add note, Mon Oct 12, 2026-014 Medical Office Building" }).click();
  const box = page.getByRole("dialog", { name: "Note, Mon Oct 12, 2026-014 Medical Office Building" });
  await box.getByLabel("Note").fill("Owner meeting");
  await box.getByRole("button", { name: "Save" }).click();
  await expect(box).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Note, Mon Oct 12, 2026-014 Medical Office Building" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Saved / })).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await query<{ note: string | null }>("select note from time_entries where firm_id = :firm and work_date = '2026-10-12' and archived_at is null"))[0]?.note)
    .toBe("Owner meeting");
});

test.describe("firm settings: due Friday 5 PM, which notes are required", () => {
  test.afterAll(async () => {
    await query("update firm_settings set timesheet_lock_day = 1, timesheet_due_time = '09:00', timesheet_notes_rule = 'optional' where firm_id = :firm");
  });

  test("an owner changes them in Settings and the timesheet follows", async ({ browser }) => {
    const owner = await browser.newPage();
    await signInAs(owner, "ioOwner", "/app/settings/time");
    // Pick until the page has loaded its script: a choice made before then is
    // reset when the page becomes interactive.
    await expect(async () => {
      await owner.getByLabel("Due day").selectOption({ label: "Friday" });
      await expect(owner.getByTestId("due-example")).toContainText("is due Fri", { timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await owner.getByLabel("Due time").selectOption({ label: "5:00 PM" });
    await owner.getByLabel("Notes on billable time").selectOption({ label: "Required on all phases" });
    await expect(owner.getByTestId("due-example")).toContainText("at 5:00 PM.");
    await expect
      .poll(async () => (await query<{ d: number; t: string; n: string }>(
        "select timesheet_lock_day as d, timesheet_due_time::text as t, timesheet_notes_rule::text as n from firm_settings where firm_id = :firm",
      ))[0])
      .toEqual({ d: 5, t: "17:00:00", n: "all" });
    await owner.close();

    const page = await browser.newPage();
    await signInAs(page, "ioStaff", `/app/time/week/${WEEK}`);
    await expect(page.getByText("Week of Oct 12 – Oct 18, 2026 · Due Fri Oct 16, 5:00 PM")).toBeVisible();
    // Mon has a note; Tue (1.25 h, billable) doesn't.
    await expect(page.getByTestId("submit-blocker")).toHaveText("1 billable day needs a note before you can submit.");
    // Hourly phases only: Design Development is a fixed fee, so no note is needed.
    await query("update firm_settings set timesheet_notes_rule = 'hourly' where firm_id = :firm");
    await page.reload();
    await expect(page.getByTestId("submit-blocker")).toHaveCount(0);
    await page.close();
  });

  test("staff can't open the Settings page", async ({ page }) => {
    await signInAs(page, "ioStaff", "/app/settings/time");
    await expect(page.getByLabel("Due day")).toHaveCount(0);
  });
});

test("Copy last week adds last week's rows without hours", async ({ page }) => {
  await signInAs(page, "ioStaff", "/app/time/week/2026-10-19");
  await expect(page.getByText("Add a row, or copy last week's rows.")).toBeVisible();
  await page.getByRole("button", { name: "Copy last week" }).last().click();
  await expect(page.getByText("Copied 1 row.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("2026-014 Medical Office Building, Mon Oct 19")).toHaveValue("");
  // Copying again doesn't duplicate it.
  await page.getByRole("button", { name: "Copy last week" }).first().click();
  await expect(page.getByText("Last week's rows are already on this timesheet.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("2026-014 Medical Office Building, Mon Oct 19")).toHaveCount(1);
});

test("when the network drops, saving retries, then Retry saves it", async ({ page }) => {
  test.setTimeout(90_000);
  await signInAs(page, "ioStaff", "/app/time/week/2026-10-19");
  const cell = page.getByLabel("2026-014 Medical Office Building, Tue Oct 20");
  await expect(cell).toBeEnabled();
  // Server actions are POSTs with a Next-Action header: drop them.
  await page.route("**/*", (route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"] ? route.abort("internetdisconnected") : route.continue(),
  );
  await cell.fill("3");
  await cell.blur();
  await expect(page.getByText("Couldn't save. Retrying…")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Couldn't save. Check your connection.")).toBeVisible({ timeout: 30_000 });
  await page.unroute("**/*");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Saved / })).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await query<{ hours: string }>("select hours from time_entries where firm_id = :firm and work_date = '2026-10-20' and archived_at is null"))[0]?.hours)
    .toBe("3.00");
});

// ---------- Approvals (timesheet-approval spec, 1.7 B) ----------

/** A sheet for Kit already in review, waiting on Bo (the PIC), with 8 h Mon–Fri. */
async function sheetInReview(week: string) {
  const staff = membership(PEOPLE.ioStaff.email);
  const owner = membership(PEOPLE.ioOwner.email);
  await query(`
    insert into rates (firm_id, membership_id, bill_rate_cents, cost_rate_cents, effective_from)
    select :firm, ${staff}, 11000, 4400, '2026-01-01'
    where not exists (select 1 from rates where firm_id = :firm and membership_id = ${staff})
  `);
  const [{ id }] = await query<{ id: string }>(`
    with s as (
      insert into timesheets (firm_id, membership_id, week_start, status, submitted_at)
      values (:firm, ${staff}, '${week}', 'submitted', now()) returning id
    ), p as (
      select pr.id as project_id, ph.id as phase_id from projects pr join project_phases ph on ph.project_id = pr.id
      where pr.firm_id = :firm and pr.number = '2026-014' and ph.status = 'current'
    ), r as (
      insert into timesheet_rows (firm_id, timesheet_id, row_type, project_id, project_phase_id, billable, sort_order)
      select :firm, s.id, 'project', p.project_id, p.phase_id, true, 0 from s, p returning id, timesheet_id, project_id, project_phase_id
    ), e as (
      insert into time_entries (firm_id, timesheet_id, timesheet_row_id, work_date, project_id, project_phase_id, hours, billable)
      select :firm, r.timesheet_id, r.id, '${week}'::date + d, r.project_id, r.project_phase_id, 8, true from r, generate_series(0, 4) d
    ), v as (
      insert into timesheet_review_steps (firm_id, timesheet_id, step_no, kind, approver_membership_id)
      select :firm, s.id, 1, 'principal_in_charge', ${owner} from s
    )
    select id from s
  `);
  return id;
}

test("Approvals: the owner approves Kit's week from the queue and the rates lock", async ({ page }) => {
  const id = await sheetInReview("2026-09-28");
  await signInAs(page, "ioOwner", "/app/time/approvals");
  await expect(page.getByRole("link", { name: /^Approvals/ })).toHaveAttribute("aria-current", "page");
  const card = page.getByRole("region", { name: "Week of Sep 28 – Oct 4" });
  await expect(card.getByText("Step 1 of 1 · Principal in Charge")).toBeVisible();
  await expect(card.getByRole("img", { name: "Mon to Fri: 8, 8, 8, 8, 8 hours" })).toBeVisible();
  await card.getByRole("button", { name: "Approve Kit Lowe" }).click();
  await expect(page.getByText("Approved Kit Lowe's timesheet.")).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await query<{ status: string }>(`select status from timesheets where id = '${id}'`))[0].status)
    .toBe("approved");
  const rates = await query<{ bill: string }>(`select bill_rate_cents as bill from time_entries where timesheet_id = '${id}'`);
  expect(rates.every((r) => r.bill === "11000")).toBe(true);
});

test("Approvals: the owner returns a week with a note, from the detail page", async ({ page }) => {
  const id = await sheetInReview("2026-09-21");
  await signInAs(page, "ioOwner", `/app/time/approvals/${id}`);
  await expect(page.getByRole("heading", { name: "Kit Lowe" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Review" })).toContainText("Principal in Charge · BM");
  // Owner/admin see rates.
  await expect(page.getByRole("columnheader", { name: "Bill rate" })).toBeVisible();
  await page.getByRole("button", { name: "Return" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Return timesheet" }).click();
  await expect(dialog.getByText(/Add a note so \w+ knows what to change\./)).toBeVisible();
  await dialog.getByLabel("What needs to change?").fill("Split Monday between SD and DD.");
  await dialog.getByRole("button", { name: "Return timesheet" }).click();
  await expect(page).toHaveURL(/\/app\/time\/approvals$/, { timeout: 15_000 });
  const [sheet] = await query<{ status: string; rejection_note: string }>(`select status, rejection_note from timesheets where id = '${id}'`);
  expect(sheet).toEqual({ status: "rejected", rejection_note: "Split Monday between SD and DD." });
});

test("Approvals: staff who review nothing get 404", async ({ page }) => {
  await signInAs(page, "ioStaff", "/app/time/approvals");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

// ---------- Notifications and week overview (1.7 C) ----------

test("the bell shows unread notifications; opening one marks it read and goes to its link", async ({ page }) => {
  const owner = membership(PEOPLE.ioOwner.email);
  await query(`delete from notifications where firm_id = :firm`);
  await query(`
    insert into notifications (firm_id, membership_id, kind, title, body, link)
    values (:firm, ${owner}, 'review_waiting', 'Kit Lowe''s timesheet is waiting for you', 'Week of Oct 12 – 18 · 40 h', '/app/time/approvals')
  `);
  await signInAs(page, "ioOwner", "/app/projects");
  const bell = page.getByRole("button", { name: "Notifications, 1 unread" });
  await expect(bell).toBeVisible();
  await bell.click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  await panel.getByRole("button", { name: /Kit Lowe's timesheet is waiting for you/ }).click();
  await expect(page).toHaveURL(/\/app\/time\/approvals$/);
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  const [n] = await query<{ read: boolean }>(`select read_at is not null as read from notifications where firm_id = :firm`);
  expect(n.read).toBe(true);
});

test("week overview: Kit hasn't submitted Oct 12, so the owner sends a reminder", async ({ page }) => {
  await query(`delete from activity_log where firm_id = :firm and action = 'reminder_sent'`);
  // People only show for weeks after they joined; the test users joined recently.
  await query(`update memberships set created_at = '2026-01-01' where firm_id = :firm`);
  await signInAs(page, "ioOwner", `/app/time/approvals/week/${WEEK}`);
  await expect(page.getByRole("link", { name: "Week overview" })).toHaveAttribute("aria-current", "page");
  const row = page.getByRole("row", { name: "Kit Lowe" });
  await expect(row.getByText("Not submitted").or(row.getByText("Draft"))).toBeVisible();
  await row.getByRole("button", { name: "Send reminder to Kit Lowe" }).click();
  await expect(row.getByRole("button", { name: /^Reminder sent / })).toBeDisabled({ timeout: 15_000 });
  const staff = membership(PEOPLE.ioStaff.email);
  const notes = await query<{ title: string }>(`select title from notifications where firm_id = :firm and membership_id = ${staff} and kind = 'timesheet_reminder'`);
  expect(notes.map((x) => x.title)).toEqual(["Your timesheet for Oct 12 – 18 is overdue"]);
});
