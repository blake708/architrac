import { type Page, expect, test } from "@playwright/test";
import { ownerPool } from "./support/clean";
import { FIRMS, PEOPLE } from "./support/people";
import { signInAs } from "./support/sign-in";

// A project's page in the browser (docs/specs/release-1/project-detail.md).
// Who is sent what, and every edit rule, are also Vitest tests in
// src/server/projects/page.db.test.ts.
//
// Runs in order against "E2E Theta Partners", which only this file uses.
// Setup (fixture F2 without time, invoices or consultants): 2026-014
// Medical Office Building for Palmetto Medical Properties; principal Bea
// (owner), PM Jay; Kat (staff) on the team, Abe (staff) not. Coastal MEP
// Engineers (consultant, contact Ravi) and Holder Builders (contractor)
// are in Contacts.

test.describe.configure({ mode: "serial" });

async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const pool = ownerPool();
  const c = await pool.connect();
  try {
    const firm = await c.query<{ id: string }>("select id from firms where name = $1", [FIRMS.theta.name]);
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

let projectId = "";
const url = (tab = "") => `/app/projects/${projectId}${tab}`;

test.beforeAll(async () => {
  const [{ n }] = await query<{ n: number }>("select count(*)::int as n from projects where firm_id = :firm");
  if (n === 0) {
    const owner = membership(PEOPLE.thOwner.email);
    const pm = membership(PEOPLE.thPm.email);
    await query(`
      with c as (
        insert into companies (firm_id, name, kind) values (:firm, 'Palmetto Medical Properties', 'client') returning id
      ), mep as (
        insert into companies (firm_id, name, kind) values (:firm, 'Coastal MEP Engineers', 'consultant') returning id
      ), ravi as (
        insert into contacts (firm_id, company_id, first_name, last_name, title, email)
        select :firm, id, 'Ravi', 'Kumar', 'Principal', 'ravi@coastalmep.com' from mep returning id
      ), gc as (
        insert into companies (firm_id, name, kind) values (:firm, 'Holder Builders', 'contractor') returning id
      ), p as (
        insert into projects (firm_id, number, name, client_company_id, project_type, square_feet, construction_cost_cents,
          start_date, principal_membership_id, pm_membership_id, address_line1, city, state)
        select :firm, '2026-014', 'Medical Office Building', id, 'Medical office', 20000, 620000000,
          date '2026-08-03', ${owner}, ${pm}, '40 Calhoun St', 'Charleston', 'SC' from c returning id
      ), ph as (
        insert into project_phases (firm_id, project_id, code, name, sort_order, fee_type, fee_cents, budget_hours, status, percent_complete_bp, end_date)
        select :firm, p.id, v.code, v.name, v.ord, 'fixed'::fee_type, v.fee, v.hours, v.status::phase_status, v.pct, v.ends
        from p, (values
          ('PD', 'Pre-Design', 1, 930000, 62, 'closed', 10000, date '2026-08-28'),
          ('SD', 'Schematic Design', 2, 2790000, 186, 'closed', 10000, date '2026-09-30'),
          ('DD', 'Design Development', 3, 4650000, 310, 'current', 3000, date '2026-11-25'),
          ('CD', 'Construction Documents', 4, 6510000, 434, 'upcoming', 0, null::date),
          ('PRM', 'Permitting', 5, 930000, 62, 'upcoming', 0, null::date),
          ('CA', 'Construction Admin', 6, 2790000, 186, 'upcoming', 0, null::date),
          ('CO', 'Close Out', 7, 0, 0, 'upcoming', 0, null::date)
        ) as v(code, name, ord, fee, hours, status, pct, ends)
        returning 1
      )
      insert into project_members (firm_id, project_id, membership_id, project_role)
      select :firm, p.id, m.id, m.role from p,
        (values (${owner}, 'Principal'), (${pm}, 'PM'), (${membership(PEOPLE.thStaff.email)}, 'Designer')) as m(id, role)
      where (select count(*) from ph) > 0 and (select count(*) from ravi) > 0 and (select count(*) from gc) > 0
    `);
  }
  const [p] = await query<{ id: string }>("select id from projects where firm_id = :firm and number = '2026-014'");
  projectId = p.id;
});

const tiles = (page: Page) => page.getByRole("region", { name: "Project summary" });
const toast = (page: Page) => page.getByTestId("toast").last();
const tabs = (page: Page) => page.getByRole("navigation", { name: "Project sections" });

test.describe("owner", () => {
  test("header, stepper, tiles and hours", async ({ page }) => {
    await signInAs(page, "thOwner", url());
    await expect(page.getByTestId("project-meta")).toHaveText("2026-014 · MEDICAL OFFICE · 20,000 SF", { useInnerText: true });
    await expect(page.getByRole("heading", { name: "Medical Office Building" })).toBeVisible();
    await expect(page.getByText("Palmetto Medical Properties · 40 Calhoun St, Charleston, SC")).toBeVisible();
    await expect(page.getByTestId("project-health")).toHaveText("On track");

    const steps = page.getByRole("list", { name: "Project phases" }).getByRole("listitem");
    await expect(steps).toHaveCount(7);
    await expect(steps.nth(0)).toContainText("Done · Aug 28");
    await expect(steps.nth(2)).toHaveAttribute("aria-current", "step");
    await expect(steps.nth(2)).toContainText("Now · to Nov 25");

    await expect(tiles(page)).toContainText("Architectural fee$186,000Fixed fee · 3.0% of construction");
    await expect(tiles(page)).toContainText("Billed$00% of fee · nothing outstanding");
    await expect(tiles(page)).toContainText("Hours0 hof 1,240 budgeted");
    await expect(tiles(page)).toContainText("Construction estimate$6.2M$310 / SF · 20,000 SF");

    const hours = page.getByRole("region", { name: "Hours vs budget" });
    await expect(hours.locator("tfoot")).toContainText("0 / 1,240 h");
    await expect(hours.locator("tfoot")).toContainText("1,240 h");
    await hours.getByRole("button", { name: "Show hours by person for Schematic Design" }).click();
    await expect(hours.getByText("No time logged yet")).toBeVisible();

    // Release 1 shows only these tabs.
    await expect(tabs(page).getByRole("link")).toHaveText(["Overview", "Phases & fees", "Team"]);
  });

  test("Phases & fees: the fee table and consultants", async ({ page }) => {
    await signInAs(page, "thOwner", url("/phases"));
    const pd = page.locator('tr[data-phase="PD"]');
    await expect(pd).toContainText("$9,300");
    await expect(pd).toContainText("5%");
    await expect(pd).toContainText("Closed");
    await expect(page.getByTestId("phase-fee-total")).toHaveText("$186,000");

    const card = page.getByRole("region", { name: "Consultants" });
    await expect(card).toContainText("No consultants on this project.");
    await card.getByRole("button", { name: "Add consultant" }).click();
    const d = page.getByRole("dialog", { name: "Add consultant" });
    await d.getByLabel("Consultant *").selectOption({ label: "Coastal MEP Engineers" });
    await d.getByLabel("Contact").selectOption({ label: "Ravi Kumar" });
    await d.getByLabel("Discipline *").selectOption("MEP");
    await d.getByLabel("Fee").fill("36,800");
    await expect(d.getByLabel("Markup %")).toHaveValue("10"); // the firm default
    await d.getByRole("button", { name: "Add consultant" }).click();
    await expect(toast(page)).toHaveText("MEP added");
    const mep = card.locator('tr[data-consultant="MEP"]');
    await expect(mep).toContainText("$36,800");
    await expect(mep).toContainText("$40,480");
    await expect(page.getByTestId("consultant-client-total")).toHaveText("$40,480");

    await mep.getByRole("button", { name: "Edit MEP" }).click();
    const e = page.getByRole("dialog", { name: "Edit consultant" });
    await e.getByLabel("Billed through to the client").uncheck();
    await e.getByRole("button", { name: "Save consultant" }).click();
    await expect(mep).toContainText("Not billed through");
  });

  test("Team: add a person with a rate override; add a contractor", async ({ page }) => {
    await signInAs(page, "thOwner", url("/team"));
    const team = page.getByRole("list", { name: "Firm team" });
    await expect(team.getByRole("listitem")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Remove Jay Ross" })).toBeDisabled();

    await page.getByRole("button", { name: "Add person" }).click();
    const d = page.getByRole("dialog", { name: "Add person" });
    await d.getByLabel("Person *").selectOption({ label: "Abe Pratt" });
    await d.getByLabel("Project role *").selectOption("Interior designer");
    await d.getByLabel("Bill rate override ($/h)").fill("185");
    await d.getByRole("button", { name: "Add person" }).click();
    await expect(toast(page)).toHaveText("Abe Pratt added");
    const abe = team.locator('li[data-member="Abe Pratt"]');
    await expect(abe).toContainText("AP · Interior designer");
    await expect(abe).toContainText("Rate override $185/h");

    const outside = page.getByRole("list", { name: "Client and consultants" });
    await expect(outside).toContainText("Coastal MEP Engineers");
    await expect(outside).toContainText("Ravi Kumar · Principal");
    await page.getByRole("button", { name: "Add company" }).click();
    const l = page.getByRole("dialog", { name: "Add company" });
    await l.getByLabel("Company *").selectOption({ label: "Holder Builders · Contractor" });
    await l.getByLabel("Role on this project").fill("General contractor");
    await l.getByRole("button", { name: "Add company" }).click();
    await expect(outside.locator('li[data-company="Holder Builders"]')).toContainText("General contractor");

    // The Overview's activity shows what happened.
    await page.goto(url());
    await expect(page.getByTestId("activity")).toContainText("created MEP");
  });
});

test.describe("other roles", () => {
  test("the PM: no rate overrides anywhere", async ({ page }) => {
    await signInAs(page, "thPm", url("/team"));
    await expect(page.getByRole("list", { name: "Firm team" })).not.toContainText("Rate override");
    await page.getByRole("button", { name: "Edit Abe Pratt" }).click();
    await expect(page.getByLabel("Bill rate override ($/h)")).toHaveCount(0);
  });

  test("staff on the team: basic view; Phases & fees is not found", async ({ page }) => {
    await signInAs(page, "thStaff", url());
    await expect(page.getByRole("heading", { name: "Medical Office Building" })).toBeVisible();
    await expect(tabs(page).getByRole("link")).toHaveText(["Overview", "Team"]);
    await expect(page.getByTestId("project-health")).toHaveCount(0);
    await expect(tiles(page)).not.toContainText("Architectural fee");
    await expect(page.getByRole("region", { name: "Hours vs budget" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit project" })).toHaveCount(0);
    expect(await page.content()).not.toMatch(/feeCents|18600000|rateOverrideCents/);
    await page.goto(url("/phases"));
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });

  test("staff not on the team: not found", async ({ page }) => {
    // Abe was added in the Team test; take him off again.
    await query(
      `update project_members set archived_at = now() where firm_id = :firm and membership_id = ${membership(PEOPLE.thOutsider.email)}`,
    );
    await signInAs(page, "thOutsider", url());
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
  });
});

test.describe("closing", () => {
  test("Edit project → Closed asks first, then the list shows it as closed", async ({ page }) => {
    await signInAs(page, "thOwner", url());
    await page.getByRole("button", { name: "Edit project" }).click();
    const d = page.getByRole("dialog", { name: "Edit project" });
    await expect(d.getByLabel("Project name *")).toHaveValue("Medical Office Building");
    await expect(d.getByLabel("City")).toHaveValue("Charleston");
    await d.getByLabel("Status").selectOption("closed");
    await d.getByRole("button", { name: "Save project" }).click();
    const confirm = page.getByRole("dialog", { name: "Close 2026-014?" });
    await expect(confirm).toContainText("No new time can be logged on this project.");
    await confirm.getByRole("button", { name: "Close project" }).click();
    await expect(toast(page)).toHaveText("2026-014 saved");
    await expect(page.getByTestId("project-health")).toHaveText("Closed");

    const [row] = await query<{ status: string; closed_on: string | null }>(
      "select status, closed_on from projects where firm_id = :firm and number = '2026-014'",
    );
    expect(row.status).toBe("closed");
    expect(row.closed_on).not.toBeNull();
    const logs = await query("select 1 from activity_log where firm_id = :firm and action = 'status_changed'");
    expect(logs).toHaveLength(1);

    await page.goto("/app/projects?status=closed");
    await expect(page.locator('tr[data-project="2026-014"]')).toBeVisible();
  });
});
