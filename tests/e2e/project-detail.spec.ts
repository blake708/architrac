import { type Page, expect, test } from "@playwright/test";
import { ownerPool } from "./support/clean";
import { FIRMS, PEOPLE } from "./support/people";
import { signInAs } from "./support/sign-in";

// A project's page in the browser (docs/specs/release-1/project-detail.md).
// Who is sent what, and every edit rule, are also Vitest tests in
// src/server/projects/page.db.test.ts.
//
// Runs in order against "E2E Theta Partners", which only this file uses.
// Setup (fixture F2 without time, invoices or consultants; Close Out is hourly): 2026-014
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
        select :firm, p.id, v.code, v.name, v.ord, v.ft::fee_type, v.fee, v.hours, v.status::phase_status, v.pct, v.ends
        from p, (values
          ('PD', 'Pre-Design', 1, 'fixed', 930000, 62, 'closed', 10000, date '2026-08-28'),
          ('SD', 'Schematic Design', 2, 'fixed', 2790000, 186, 'closed', 10000, date '2026-09-30'),
          ('DD', 'Design Development', 3, 'fixed', 4650000, 310, 'current', 3000, date '2026-11-25'),
          ('CD', 'Construction Documents', 4, 'fixed', 6510000, 434, 'upcoming', 0, null::date),
          ('PRM', 'Permitting', 5, 'fixed', 930000, 62, 'upcoming', 0, null::date),
          ('CA', 'Construction Admin', 6, 'fixed', 2790000, 186, 'upcoming', 0, null::date),
          ('CO', 'Close Out', 7, 'hourly', 0, 0, 'upcoming', 0, null::date)
        ) as v(code, name, ord, ft, fee, hours, status, pct, ends)
        returning 1
      )
      insert into project_members (firm_id, project_id, membership_id, project_role)
      select :firm, p.id, m.id, m.role from p,
        (values (${owner}, 'Principal'), (${pm}, 'PM'), (${membership(PEOPLE.thStaff.email)}, 'Designer')) as m(id, role)
      where (select count(*) from ph) > 0 and (select count(*) from ravi) > 0 and (select count(*) from gc) > 0
    `);
  }
  // Roles and rates (Principal $185 for Bea, Designer $115 for Jay and Kat)
  // and an optional "Additional Services" template, once.
  const [{ r }] = await query<{ r: number }>("select count(*)::int as r from firm_roles where firm_id = :firm");
  if (r === 0) {
    await query(`
      with pr as (
        insert into firm_roles (firm_id, name, sort_order) values (:firm, 'Principal', 1) returning id
      ), de as (
        insert into firm_roles (firm_id, name, sort_order) values (:firm, 'Designer', 2) returning id
      ), rt as (
        insert into rates (firm_id, firm_role_id, bill_rate_cents, cost_rate_cents, effective_from)
        select :firm, id, 18500, 9500, date '2026-01-01' from pr
        union all select :firm, id, 11500, 4400, date '2026-01-01' from de
        returning 1
      ), opt as (
        insert into phase_templates (firm_id, code, name, description, is_optional, default_fee_type, sort_order)
        values (:firm, 'AS', 'Additional Services', 'Work beyond the base contract', true, 'fixed', 50) returning 1
      )
      update memberships set firm_role_id = case
          when id = ${membership(PEOPLE.thOwner.email)} then (select id from pr)
          else (select id from de) end
      where firm_id = :firm and (select count(*) from rt) > 0 and (select count(*) from opt) > 0
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

    await expect(tiles(page)).toContainText("Architectural fee$186,000Mixed fee types · 3.0% of construction");
    await expect(tiles(page)).toContainText("Billed$00% of fee · nothing outstanding");
    await expect(tiles(page)).toContainText("Hours0 hof 1,240 budgeted");
    await expect(tiles(page)).toContainText("Construction estimate$6.2M$310 / SF · 20,000 SF");

    // Owner/admin get the Project snapshot, not Hours vs budget.
    await expect(page.getByRole("region", { name: "Hours vs budget" })).toHaveCount(0);
    const snap = page.getByRole("region", { name: "Project snapshot" });
    const total = snap.getByTestId("snapshot-total");
    await expect(total).toContainText("0 / 1,240 h");
    await expect(total).toContainText("$186,000");
    // Hourly phases: no bar.
    const co = snap.locator('tbody[data-phase="CO"]');
    await expect(co.getByRole("img")).toHaveCount(0);
    await expect(co).toContainText("Hourly");
    // Every bar starts in the same place and is the same width.
    const boxes = await Promise.all(
      ["PD", "SD", "DD", "CD", "PRM", "CA"].map((c) => snap.locator(`tbody[data-phase="${c}"]`).getByRole("img").boundingBox()),
    );
    expect(new Set(boxes.map((b) => Math.round(b!.x))).size).toBe(1);
    expect(new Set(boxes.map((b) => Math.round(b!.width))).size).toBe(1);
    // No time yet: nothing billed, no cost, profit "Not started", projected from the budget.
    const cd = snap.locator('tbody[data-phase="CD"]');
    await expect(cd).toContainText("Not started");
    await expect(cd).toContainText(/\d+% margin/);

    // The overhead switch starts at the firm default (on), flips the cost column and the address, without a reload.
    const sw = snap.getByRole("switch", { name: "Include overhead" });
    await expect(sw).toHaveAttribute("aria-checked", "true");
    await expect(snap.getByTestId("cost-head")).toHaveText("Cost + overhead");
    await expect(snap).toContainText("60% of labor");
    let requests = 0;
    page.on("request", (r) => {
      if (r.url().includes(projectId)) requests++;
    });
    await sw.click();
    await expect(snap.getByTestId("cost-head")).toHaveText("Labor cost");
    await expect(page).toHaveURL(/overhead=off/);
    await expect(snap).toContainText("Overhead isn't included, so true profit is lower.");
    expect(requests).toBe(0);

    // Clicking a phase shows the note (no people yet).
    await cd.getByRole("button", { name: "Construction Documents" }).click();
    await expect(cd.getByRole("button", { name: "Construction Documents" })).toHaveAttribute("aria-expanded", "true");
    await expect(cd).toContainText("No time logged yet. Budget: 434 h at a planned");
    await page.reload();
    await expect(snap.getByTestId("cost-head")).toHaveText("Labor cost");

    // The tab bar only scrolls sideways.
    const nav = tabs(page).locator("ul");
    expect(await nav.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);

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
    await expect(toast(page)).toHaveText("MEP saved");
    await expect(mep).toContainText("Not billed through", { timeout: 15_000 });
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
    await expect(toast(page)).toHaveText("Holder Builders added");
    // The list refreshes from the server, which can be slow while every test runs.
    await expect(outside.locator('li[data-company="Holder Builders"]')).toContainText("General contractor", { timeout: 15_000 });

    // The Overview's activity shows what happened.
    await page.goto(url());
    await expect(page.getByTestId("activity")).toContainText("created MEP");
  });
});

test.describe("phases", () => {
  const row = (page: Page, code: string) => page.locator(`tr[data-phase="${code}"]`);

  test("Settings: a default role mix for Schematic Design", async ({ page }) => {
    await signInAs(page, "thOwner", "/app/settings/phases");
    await page.getByRole("button", { name: "Roles for Schematic Design" }).click();
    const panel = page.getByRole("dialog", { name: "Roles · Schematic Design" });
    await panel.getByRole("button", { name: "Add role" }).click();
    await panel.getByLabel("Role 1").selectOption({ label: "Principal" });
    await panel.getByLabel("Principal share").fill("20");
    await expect(panel.getByRole("button", { name: "Save roles" })).toBeDisabled(); // 20% isn't 100%
    await panel.getByRole("button", { name: "Add role" }).click(); // the rest (80%) goes to the next role
    await expect(panel.getByTestId("mix-total")).toHaveText("100%");
    await panel.getByRole("button", { name: "Save roles" }).click();
    await expect(page.getByTestId("toast").last()).toHaveText("Roles saved for Schematic Design");
    await expect(page.getByRole("button", { name: "Roles for Schematic Design" })).toHaveText("Roles (2)");
  });

  test("New project: the template's mix sets SD's hours", async ({ page }) => {
    await signInAs(page, "thOwner", "/app/projects/new");
    await page.getByLabel("Total fee *").fill("186,000");
    const sd = page.locator('tr[data-phase="SD"]');
    // $27,900: 20% Principal = $5,580 ÷ $185 = 30.25 h; 80% Designer = $22,320 ÷ $115 = 194 h
    const sdRoles = page.getByRole("table", { name: "Roles for Schematic Design" });
    await expect(sdRoles).toContainText("Principal20%$185/h$5,58030.25");
    await expect(sdRoles).toContainText("Designer80%$115/h$22,320194");
    await expect(sd.getByLabel(/budget hours$/)).toHaveValue("224.25");
    await page.getByRole("button", { name: "Edit roles for Schematic Design" }).click();
    const panel = page.getByRole("dialog", { name: /Roles · SD/ });
    await expect(panel.getByTestId("mix-hours")).toHaveText("224.25");
    await panel.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Add roles for Design Development" })).toBeVisible();
  });

  test("Redistribute: $200,000 with PD and SD locked", async ({ page }) => {
    await signInAs(page, "thOwner", url("/phases"));
    await page.getByRole("button", { name: "Redistribute fee" }).click();
    const d = page.getByRole("dialog", { name: "Redistribute fee" });
    await expect(d.getByLabel("Lock PD")).toBeChecked();
    await expect(d.getByLabel("Lock SD")).toBeChecked();
    await d.getByLabel("New total fee").fill("30,000");
    await expect(d.getByRole("alert")).toHaveText("New total is less than the $37,200 in locked phases");
    await d.getByLabel("New total fee").fill("200,000");
    await expect(d.getByTestId("preview-DD")).toHaveText("$46,500 → $50,875");
    await expect(d.getByTestId("preview-CD")).toHaveText("$65,100 → $71,225");
    await expect(d.getByTestId("preview-PRM")).toHaveText("$9,300 → $10,175");
    await expect(d.getByTestId("preview-CA")).toHaveText("$27,900 → $30,525");
    await expect(d.getByTestId("preview-PD")).toHaveText("$9,300");
    await d.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByTestId("toast").last()).toHaveText("Fee redistributed");
    await expect(page.getByTestId("phase-fee-total")).toHaveText("$200,000");
  });

  test("Edit one phase: details on the left, roles on the right", async ({ page }) => {
    await signInAs(page, "thOwner", url("/phases"));
    await row(page, "DD").getByRole("button", { name: "Edit Design Development" }).click();
    const panel = page.getByRole("dialog", { name: "Edit DD · Design Development" });
    const details = panel.getByRole("region", { name: "Phase details" });
    const roles = panel.getByRole("region", { name: "Roles" });

    // Quarter hours are checked before saving; then back to working it out.
    await details.getByLabel("Budget hours").fill("310.3");
    await panel.getByRole("button", { name: "Save phase" }).click();
    await expect(details.getByText("Use quarter hours")).toBeVisible();
    await details.getByRole("button", { name: "Work it out from the fee" }).click();

    // Complete at 30% offers a one-click fix.
    await details.getByLabel("Status").selectOption("complete");
    await expect(details.getByText("DD is complete at 30%. Set to 100%?")).toBeVisible();
    await details.getByRole("button", { name: "Set to 100%" }).click();
    await expect(details.getByLabel("% complete")).toHaveValue("100");
    await details.getByLabel("Status").selectOption("current");

    // A role mix on the right sets the hours: $50,875 at $115 = 442.39 → 442.5 h.
    await roles.getByRole("button", { name: "Add role" }).click();
    await roles.getByLabel("Role 1").selectOption({ label: "Designer" });
    await expect(roles.getByTestId("mix-total")).toHaveText("100%");
    await expect(roles.getByTestId("mix-hours")).toHaveText("442.5");
    await expect(details.getByLabel("Budget hours")).toHaveValue("442.5");
    await panel.getByRole("button", { name: "Save phase" }).click();
    await expect(page.getByTestId("toast").last()).toHaveText("DD saved");
    await expect(row(page, "DD")).toContainText("442.5");
    await expect(page.getByRole("table", { name: /^Roles for/ })).toHaveCount(0); // no roles table under phases

    // Clicking the hours shows budget vs used by role; Edit phase from there.
    await row(page, "DD").getByRole("button", { name: "Hours for Design Development" }).click();
    const hours = page.getByRole("dialog", { name: "Hours · DD Design Development" });
    await expect(hours).toContainText("0 of 442.5 budgeted hours used");
    await expect(hours.locator('tr[data-role="Designer"]')).toHaveText(/Designer\s*100%\s*442\.5\s*0\s*442\.5/);
    await hours.getByRole("button", { name: "Edit phase" }).click();
    await expect(page.getByRole("dialog", { name: "Edit DD · Design Development" })).toBeVisible();
  });

  test("Edit CD's fee; a duplicate code is refused", async ({ page }) => {
    await signInAs(page, "thOwner", url("/phases"));
    await row(page, "CD").getByRole("button", { name: "Edit Construction Documents" }).click();
    const panel = page.getByRole("dialog", { name: "Edit CD · Construction Documents" });
    await panel.getByLabel("Code *").fill("dd");
    await panel.getByRole("button", { name: "Save phase" }).click();
    await expect(panel.getByText("Another phase already uses this code")).toBeVisible();
    await panel.getByLabel("Code *").fill("CD");
    await panel.getByLabel("Fee", { exact: true }).fill("70,000");
    await expect(panel).toContainText("Project fee becomes $198,775");
    await panel.getByRole("button", { name: "Save phase" }).click();
    await expect(page.getByTestId("toast").last()).toHaveText("CD saved");
    await expect(page.getByTestId("phase-fee-total")).toHaveText("$198,775");
    const [log] = await query<{ changes: { feeCents: { before: number; after: number } } }>(
      "select a.changes from activity_log a join project_phases p on p.id = a.entity_id where a.firm_id = :firm and p.code = 'CD' and a.action = 'updated' order by a.created_at desc limit 1",
    );
    expect(log.changes.feeCents).toEqual({ before: 7_122_500, after: 7_000_000 });
  });

  test("↑/↓ reorder saves right away", async ({ page }) => {
    await signInAs(page, "thOwner", url("/phases"));
    const order = () => page.locator("tbody tr[data-phase]").evaluateAll((rs) => rs.map((r) => r.getAttribute("data-phase")));
    await expect.poll(order).toEqual(["PD", "SD", "DD", "CD", "PRM", "CA", "CO"]);
    // Each click saves, then the table reloads; that can take a while on CI.
    const slow = { timeout: 15_000 };
    await row(page, "CA").getByRole("button", { name: "Move Construction Admin up" }).click();
    await expect.poll(order, slow).toEqual(["PD", "SD", "DD", "CD", "CA", "PRM", "CO"]);
    await expect(row(page, "CA").getByRole("button", { name: "Move Construction Admin down" })).toBeEnabled(slow);
    await row(page, "CA").getByRole("button", { name: "Move Construction Admin down" }).click();
    await expect.poll(order, slow).toEqual(["PD", "SD", "DD", "CD", "PRM", "CA", "CO"]);
    await expect(page.getByRole("region", { name: "Architectural fee by phase" }).getByRole("alert")).toHaveCount(0);
  });

  test("someone else saved first: the save is refused", async ({ page }) => {
    await signInAs(page, "thOwner", url("/phases"));
    await row(page, "PRM").getByRole("button", { name: "Edit Permitting" }).click();
    const panel = page.getByRole("dialog", { name: "Edit PRM · Permitting" });
    await panel.getByLabel("Name *").fill("Permits");
    // Another session saves meanwhile.
    await query("update project_phases set updated_at = now() + interval '1 minute' where firm_id = :firm and code = 'CA'");
    await panel.getByRole("button", { name: "Save phase" }).click();
    await expect(panel.getByText("Someone else changed these phases. Reload to see their changes.")).toBeVisible();
    const [prm] = await query<{ name: string }>("select name from project_phases where firm_id = :firm and code = 'PRM'");
    expect(prm.name).toBe("Permitting");
    await query("update project_phases set updated_at = now() where firm_id = :firm and code = 'CA'");
  });

  test("Add phase from a template; archive Close Out", async ({ page }) => {
    await signInAs(page, "thOwner", url("/phases"));
    await page.getByRole("button", { name: "Add phase" }).click();
    const d = page.getByRole("dialog", { name: "Add phase" });
    await d.getByLabel("Start from").selectOption({ label: "AS · Additional Services" });
    await expect(d.getByLabel("Description")).toHaveValue("Work beyond the base contract");
    await expect(d.getByLabel("Additional service")).toBeChecked();
    await d.getByLabel("Code *").fill("AS1");
    await d.getByLabel("Fee", { exact: true }).fill("5,000");
    await expect(d).toContainText("Total fee becomes $203,775");
    await d.getByRole("button", { name: "Add phase" }).click();
    await expect(page.getByTestId("toast").last()).toHaveText("AS1 added");
    await expect(row(page, "AS1")).toContainText("Not started");
    await expect(row(page, "AS1")).toContainText("Additional service");
    await expect(page.getByTestId("phase-fee-total")).toHaveText("$203,775");

    await row(page, "CO").getByRole("button", { name: "Edit Close Out" }).click();
    await page.getByRole("dialog", { name: "Edit CO · Close Out" }).getByRole("button", { name: "Archive phase" }).click();
    await page.getByRole("dialog", { name: "Archive CO?" }).getByRole("button", { name: "Archive" }).click();
    await expect(page.getByTestId("toast").last()).toHaveText("CO archived");
    await expect(row(page, "CO")).toHaveCount(0);
    await expect(page.getByRole("list", { name: "Project phases" }).getByRole("listitem")).toHaveCount(7); // 6 + AS1
  });
});

test.describe("other roles", () => {
  test("the PM: Hours vs budget, never cost or profit", async ({ page }) => {
    await signInAs(page, "thPm", url());
    const hours = page.getByRole("region", { name: "Hours vs budget" });
    await expect(hours.getByTestId("hours-total")).toContainText("$203,775");
    await expect(hours.locator('tbody[data-phase="CD"]')).toContainText("$70,000");
    await hours.getByRole("button", { name: "Schematic Design" }).click();
    await expect(hours.getByText("No time logged yet")).toBeVisible();
    await expect(page.getByRole("region", { name: "Project snapshot" })).toHaveCount(0);
    expect(await page.content()).not.toMatch(/Cost \+ overhead|Labor cost|Profit|Include overhead|costCents|plannedRate/);
  });

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
    await expect(page.getByRole("region", { name: "Project snapshot" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit project" })).toHaveCount(0);
    expect(await page.content()).not.toMatch(/feeCents|rateOverrideCents|rateCents|budgetHours/);
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
