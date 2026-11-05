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
  for (const t of ["time_entries", "timesheet_rows", "timesheets"]) await query(`delete from ${t} where firm_id = :firm`);
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

test("submit goes to the team leader, locks the week, and recall reopens it", async ({ page }) => {
  await signInAs(page, "ioStaff", `/app/time/week/${WEEK}`);
  await page.getByLabel("Activity for 2026-014 Medical Office Building").selectOption({ index: 1 });
  await expect(page.getByTestId("submit-blocker")).toHaveCount(0);
  // Short of 40: a warning only.
  await expect(page.getByText(/hours short of 40/)).toBeVisible();
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Timesheet submitted.")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("With team leader", { exact: true })).toBeVisible();
  await expect(page.getByText(/to BM for review, then a principal approves/)).toBeVisible();
  // The empty overhead row was dropped; inputs are read-only.
  await expect(page.getByLabel("Overhead, Thu Oct 15")).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  const [sheet] = await query<{ status: string }>("select status from timesheets where firm_id = :firm");
  expect(sheet.status).toBe("submitted");

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
  await page.getByRole("button", { name: "Notes for 2026-014 Medical Office Building" }).click();
  const mon = page.getByLabel("Note for 2026-014 Medical Office Building, Mon Oct 12");
  await mon.fill("Owner meeting");
  await mon.press("Enter");
  await expect(page.getByLabel("Note for 2026-014 Medical Office Building, Wed Oct 14")).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: /^Saved / })).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await query<{ note: string | null }>("select note from time_entries where firm_id = :firm and work_date = '2026-10-12' and archived_at is null"))[0]?.note)
    .toBe("Owner meeting");
});

test.describe("firm settings: due Friday 5 PM, notes required", () => {
  test.afterAll(async () => {
    await query("update firm_settings set timesheet_lock_day = 1, timesheet_due_time = '09:00', billable_notes_required = false where firm_id = :firm");
  });

  test("an owner changes them in Settings and the timesheet follows", async ({ browser }) => {
    const owner = await browser.newPage();
    await signInAs(owner, "ioOwner", "/app/settings/time");
    await owner.getByLabel("Due day").selectOption({ label: "Friday" });
    await owner.getByLabel("Due time").selectOption({ label: "5:00 PM" });
    await owner.getByLabel("Notes on billable time").selectOption({ label: "Required" });
    await expect(owner.getByTestId("due-example")).toContainText("is due Fri");
    await expect(owner.getByTestId("due-example")).toContainText("at 5:00 PM.");
    await expect
      .poll(async () => (await query<{ d: number; t: string; n: boolean }>(
        "select timesheet_lock_day as d, timesheet_due_time::text as t, billable_notes_required as n from firm_settings where firm_id = :firm",
      ))[0])
      .toEqual({ d: 5, t: "17:00:00", n: true });
    await owner.close();

    const page = await browser.newPage();
    await signInAs(page, "ioStaff", `/app/time/week/${WEEK}`);
    await expect(page.getByText("Week of Oct 12 – Oct 18, 2026 · Due Fri Oct 16, 5:00 PM")).toBeVisible();
    // Mon has a note; Tue (1.25 h, billable) doesn't.
    await expect(page.getByTestId("submit-blocker")).toHaveText("1 billable day needs a note before you can submit.");
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
