import { type Page, expect, test } from "@playwright/test";
import { ownerPool } from "./support/clean";
import { FIRMS, PEOPLE } from "./support/people";
import { signInAs } from "./support/sign-in";

// Team page in the browser (docs/specs/release-1/team.md). What each role
// is sent, invites, edits, moves and team rules are also Vitest tests in
// src/server/team/team.db.test.ts; these check the page.
//
// Runs in order against "E2E Epsilon Partners", which only this file uses.
// Setup: Designer and Principal roles with rates; "Medical studio" led by
// Jamie (PM) with Kim (staff); targets 80%.

test.describe.configure({ mode: "serial" });

const INVITEE = "architrac-e2e-teaminvite+clerk_test@example.com";

async function query<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = ownerPool();
  const c = await pool.connect();
  try {
    const firm = await c.query<{ id: string }>(
      "select id from firms where name = $1",
      [FIRMS.epsilon.name],
    );
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

test.beforeAll(async () => {
  // A CI retry runs this again on the same firm: seed only once.
  const [{ n }] = await query<{ n: number }>(
    "select count(*)::int as n from firm_roles where firm_id = :firm",
  );
  if (n > 0) return;
  const membership = (email: string) =>
    `(select m.id from memberships m join users u on u.id = m.user_id where m.firm_id = :firm and u.email = '${email}')`;
  await query(`
    with d as (
      insert into firm_roles (firm_id, name, sort_order) values (:firm, 'Designer', 2) returning id
    ), p as (
      insert into firm_roles (firm_id, name, sort_order) values (:firm, 'Principal', 1) returning id
    ), r as (
      insert into rates (firm_id, firm_role_id, bill_rate_cents, cost_rate_cents, effective_from)
      select :firm, id, 11500, 4400, date '2026-01-01' from d
      union all
      select :firm, id, 18500, 9500, date '2026-01-01' from p
      returning 1
    ), t as (
      insert into teams (firm_id, name, leader_membership_id, sort_order)
      values (:firm, 'Medical studio', ${membership(PEOPLE.epsPm.email)}, 1) returning id
    )
    update memberships set
      team_id = case when id in (${membership(PEOPLE.epsPm.email)}, ${membership(PEOPLE.epsStaff.email)}) then (select id from t) else null end,
      firm_role_id = case when id = ${membership(PEOPLE.epsOwner.email)} then (select id from p) else (select id from d) end,
      target_utilization_bp = 8000,
      title = case when id = ${membership(PEOPLE.epsStaff.email)} then 'Designer' else title end
    where firm_id = :firm and (select count(*) from r) > 0
  `);
  await query(
    "insert into teams (firm_id, name, sort_order) values (:firm, 'Commercial studio', 2)",
  );
});

const main = (page: Page) => page.locator("body");
const personRow = (page: Page, name: string) =>
  main(page).locator(`tr[data-person="${name}"]`);
const toast = (page: Page) => page.getByTestId("toast").last();

test.describe("what each role sees", () => {
  test("owner: four KPIs, rates and 0% utilization before timesheets", async ({ page }) => {
    await signInAs(page, "epsOwner", "/app/team");
    const summary = page.getByRole("region", { name: "Team summary" });
    await expect(summary).toContainText("Billable staff");
    await expect(summary).toContainText("Avg. multiplier");
    const kim = personRow(page, "Kim Lee");
    await expect(kim).toContainText("$115 / h");
    await expect(kim).toContainText("Leader · JR");
    await expect(kim.getByTestId("utilization")).toContainText("0% / 80%");
    await expect(personRow(page, "Jamie Reyes")).toContainText("Leads this team");
  });

  test("staff: two KPIs, no $ anywhere, only their own utilization", async ({ page }) => {
    await signInAs(page, "epsStaff", "/app/team");
    const summary = page.getByRole("region", { name: "Team summary" });
    await expect(summary).not.toContainText("Billable staff");
    await expect(main(page).locator("table")).not.toContainText("$");
    await expect(personRow(page, "Kim Lee").getByTestId("utilization")).toContainText("0% / 80%");
    await expect(personRow(page, "Jamie Reyes").getByTestId("utilization")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Invite person" })).toHaveCount(0);
  });

  test("PM: everyone's utilization; team selects are plain text", async ({ page }) => {
    await signInAs(page, "epsPm", "/app/team");
    await expect(personRow(page, "Erin Owner").getByTestId("utilization")).toBeVisible();
    await page.getByRole("tab", { name: /Teams/ }).click();
    await expect(page.getByRole("combobox", { name: /Team for/ })).toHaveCount(0);
  });
});

test.describe("finding people", () => {
  test("team filter, search and the person panel stay in the address", async ({ page }) => {
    await signInAs(page, "epsOwner", "/app/team");
    await page.getByRole("button", { name: "Medical studio", exact: true }).click();
    await expect(page).toHaveURL(/team=/);
    await expect(main(page).locator("tr[data-person]")).toHaveCount(2);
    await page.getByRole("button", { name: "All", exact: true }).click();

    await page.getByPlaceholder("Search by name or role").fill("principal");
    await expect(main(page).locator("tr[data-person]")).toHaveCount(1);
    await expect(personRow(page, "Erin Owner")).toBeVisible();
    await page.getByPlaceholder("Search by name or role").fill("");

    await personRow(page, "Kim Lee").click();
    await expect(page).toHaveURL(/person=/);
    const panel = page.getByRole("dialog", { name: "Kim Lee" });
    await expect(panel).toContainText("$115 bill / $44 cost");
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Kim Lee" })).toBeVisible();
  });
});

test.describe("managing people", () => {
  test("invite with a profile: Invited row on the right team", async ({ page }) => {
    await signInAs(page, "epsOwner", "/app/team");
    await page.getByRole("button", { name: "Invite person" }).click();
    const d = page.getByRole("dialog", { name: "Invite person" });
    await d.getByLabel("Email").fill(INVITEE);
    await d.getByLabel("First name").fill("Nia");
    await d.getByLabel("Last name").fill("New");
    await d.getByLabel("Billing role").selectOption({ label: "Designer" });
    await d.getByLabel("Team").selectOption({ label: "Commercial studio" });
    await d.getByLabel("Weekly hours").fill("24");
    await d.getByRole("button", { name: "Send invite" }).click();
    // The invite goes through Clerk, which can be slow on CI.
    await expect(toast(page)).toHaveText(`Invite sent to ${INVITEE}`, { timeout: 15_000 });
    const nia = personRow(page, "Nia New");
    await expect(nia).toContainText("Invited");
    await expect(nia).toContainText("Commercial studio");
    await expect(nia).toContainText("24 h");
  });

  test('inviting someone already on the team says "Already on the team"', async ({ page }) => {
    await signInAs(page, "epsOwner", "/app/team");
    await page.getByRole("button", { name: "Invite person" }).click();
    const d = page.getByRole("dialog", { name: "Invite person" });
    await d.getByLabel("Email").fill(PEOPLE.epsStaff.email);
    await d.getByLabel("First name").fill("Kim");
    await d.getByLabel("Last name").fill("Lee");
    await d.getByRole("button", { name: "Send invite" }).click();
    await expect(d.getByText("Already on the team")).toBeVisible({ timeout: 15_000 });
  });

  test("edit profile: phone and principal show in the panel", async ({ page }) => {
    await signInAs(page, "epsOwner", "/app/team");
    await personRow(page, "Kim Lee").click();
    await page.getByRole("button", { name: "Edit profile" }).click();
    const d = page.getByRole("dialog", { name: "Edit profile" });
    await d.getByLabel("Phone").fill("843.555.0199");
    await d.getByLabel(/Principal/).check();
    await d.getByRole("button", { name: "Save profile" }).click();
    await expect(toast(page)).toHaveText("Kim Lee saved");
    const panel = page.getByRole("dialog", { name: "Kim Lee" });
    await expect(panel).toContainText("(843) 555-0199");
    await expect(panel).toContainText("Principal · final timesheet approval");
  });
});

test.describe("teams", () => {
  test("moving Kim to Commercial studio updates the cards", async ({ page }) => {
    await signInAs(page, "epsOwner", "/app/team?tab=teams");
    const medical = page.getByRole("region", { name: "Medical studio" });
    await expect(medical.getByTestId("team-count")).toHaveText("2 people");
    await page.getByRole("combobox", { name: "Team for Kim Lee" }).selectOption({ label: "Commercial studio" });
    await expect(toast(page)).toHaveText("Kim Lee moved to Commercial studio.");
    await expect(medical.getByTestId("team-count")).toHaveText("1 person");
    const [row] = await query<{ name: string }>(
      `select t.name from memberships m join users u on u.id = m.user_id join teams t on t.id = m.team_id
       where m.firm_id = :firm and u.email = $1`,
      [PEOPLE.epsStaff.email],
    );
    expect(row.name).toBe("Commercial studio");
  });

  test("a team with people can't be archived", async ({ page }) => {
    await signInAs(page, "epsOwner", "/app/team?tab=teams");
    await page.getByRole("button", { name: "Actions for Medical studio" }).click();
    await page.getByRole("menuitem", { name: "Archive team" }).click();
    await expect(toast(page)).toHaveText("Move its 1 person first.");
  });

  test("new team with a leader", async ({ page }) => {
    await signInAs(page, "epsOwner", "/app/team?tab=teams");
    await page.getByRole("button", { name: "New team" }).click();
    const d = page.getByRole("dialog", { name: "New team" });
    await d.getByLabel("Team name").fill("Interiors");
    await d.getByLabel("Team leader").selectOption({ label: "Erin Owner" });
    await d.getByRole("button", { name: "Create team" }).click();
    await expect(toast(page)).toHaveText("Interiors created");
    const card = page.getByRole("region", { name: "Interiors" });
    await expect(card).toContainText("Erin Owner");
  });
});
