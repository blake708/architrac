import { type Page, expect, test } from "@playwright/test";
import { ownerPool } from "./support/clean";
import { FIRMS, PEOPLE } from "./support/people";
import { signInAs } from "./support/sign-in";

// Projects list and New project in the browser (projects-list spec). The
// fee split, health and permission rules are also Vitest tests in
// src/lib/calc/projects.test.ts and src/server/projects/projects.db.test.ts.
//
// Runs in order against "E2E Eta Architecture", which only this file uses.
// Setup (fixture F1 without time or invoices): client Palmetto Medical
// Properties; 2026-011 Pine Street Bistro (PM Eli, Kim on the team, $41,000
// in one phase); 2025-004 Westside Tire & Service (closed). The first test
// creates 2026-014 Medical Office Building through the form (PM Jo).

test.describe.configure({ mode: "serial" });

async function query<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const pool = ownerPool();
  const c = await pool.connect();
  try {
    const firm = await c.query<{ id: string }>("select id from firms where name = $1", [FIRMS.eta.name]);
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
  // A CI retry runs this again on the same firm: seed only once.
  const [{ n }] = await query<{ n: number }>("select count(*)::int as n from companies where firm_id = :firm");
  if (n > 0) return;
  const owner = membership(PEOPLE.etaOwner.email);
  await query(`
    with c as (
      insert into companies (firm_id, name, kind) values (:firm, 'Palmetto Medical Properties', 'client') returning id
    ), k as (
      insert into contacts (firm_id, company_id, first_name, last_name, email)
      select :firm, id, 'Ana', 'Reyes', 'ana@palmettomed.com' from c returning id
    ), b as (
      insert into projects (firm_id, number, name, client_company_id, project_type, principal_membership_id, pm_membership_id)
      select :firm, '2026-011', 'Pine Street Bistro', id, 'Restaurant', ${owner}, ${owner} from c returning id
    ), w as (
      insert into projects (firm_id, number, name, client_company_id, project_type, status, closed_on, principal_membership_id, pm_membership_id, construction_cost_cents)
      select :firm, '2025-004', 'Westside Tire & Service', id, 'Retail', 'closed'::project_status, date '2025-12-01', ${owner}, ${owner}, 64000000 from c returning id
    ), ph as (
      insert into project_phases (firm_id, project_id, code, name, sort_order, fee_type, fee_cents, budget_hours, status)
      select :firm, id, 'ALL', 'Full service', 1, 'fixed'::fee_type, 4100000, 300, 'current'::phase_status from b
      union all
      select :firm, id, 'ALL', 'Full service', 1, 'hourly'::fee_type, 0, 0, 'closed'::phase_status from w
      returning 1
    )
    insert into project_members (firm_id, project_id, membership_id, project_role)
    select :firm, b.id, m.id, m.role from b,
      (values (${owner}, 'PM'), (${membership(PEOPLE.etaStaff.email)}, 'Designer')) as m(id, role)
    where (select count(*) from ph) > 0 and (select count(*) from k) > 0
  `);
});

const row = (page: Page, number: string) => page.locator(`tr[data-project="${number}"]`);
const phaseRow = (page: Page, code: string) => page.locator(`tr[data-phase="${code}"]`);
const fee = (page: Page, code: string) => phaseRow(page, code).getByLabel(/ fee$/);
const create = (page: Page) => page.getByRole("button", { name: "Create project" });

async function fillDetails(page: Page, number: string) {
  await page.getByLabel("Project number *").fill(number);
  await page.getByLabel("Project name *").fill("Medical Office Building");
  await page.getByLabel("Client *").selectOption({ label: "Palmetto Medical Properties" });
  await page.getByLabel("Client contact").selectOption({ label: "Ana Reyes" });
  await page.getByLabel("Project type *").selectOption("Medical office");
  await page.getByLabel("Scope").selectOption({ label: "Ground-up" });
  await page.getByLabel("Principal in charge *").selectOption({ label: "Eli Owner" });
  await page.getByLabel("Project manager *").selectOption({ label: "Jo Rivera" });
  await page.getByLabel("Construction estimate").fill("6,200,000");
  // Typed by hand (the Google lookup is off in tests).
  await page.getByLabel("Street address").fill("40 Calhoun St");
  await page.getByLabel("Suite / unit").fill("Suite 200");
  await page.getByLabel("City").fill("Charleston");
  await page.getByLabel("State").fill("SC");
  await page.getByLabel("ZIP").fill("29401");
}

test.describe("owner", () => {
  test("New project: number, fee split, edits, cap check, then create", async ({ page }) => {
    await signInAs(page, "etaOwner", "/app/projects/new");
    const year = new Date().getFullYear();
    await expect(page.getByLabel("Project number *")).toHaveValue(year === 2026 ? "2026-012" : `${year}-001`);
    for (const group of ["Project", "Client", "People", "Site address", "Size & schedule"])
      await expect(page.getByRole("group", { name: group, exact: true })).toBeVisible();
    await fillDetails(page, "2026-014");

    // Rule 6–7, example A: the seed split.
    await page.getByLabel("Total fee *").fill("186,000");
    await page.getByLabel("Total budget hours").fill("1240");
    const codes = ["PD", "SD", "DD", "CD", "PRM", "CA", "CO"];
    const fees = await Promise.all(codes.map((c) => fee(page, c).inputValue()));
    expect(fees).toEqual(["9,300", "27,900", "46,500", "65,100", "9,300", "27,900", "0"]);
    const hours = await Promise.all(codes.map((c) => phaseRow(page, c).getByLabel(/budget hours$/).inputValue()));
    expect(hours).toEqual(["62", "186", "310", "434", "62", "186", "0"]);

    // Example B: the leftover cent goes to CD.
    await page.getByLabel("Total fee *").fill("1000.01");
    await expect(fee(page, "CD")).toHaveValue("350.01");
    await expect(page.getByTestId("fee-sum")).toHaveText("$1,000.01");

    // Example C: CA edited to $20,000.
    await page.getByLabel("Total fee *").fill("186000");
    await fee(page, "CA").fill("20000");
    await expect(phaseRow(page, "CA").getByRole("img", { name: "edited" })).toBeVisible();
    await expect(fee(page, "CD")).toHaveValue("68,352.97");
    await expect(page.getByTestId("fee-sum")).toHaveText("$186,000");

    // Edits past the total block Create until "Use $X as total".
    await fee(page, "CA").fill("200000");
    await expect(create(page)).toBeDisabled();
    const useTotal = page.getByRole("button", { name: /^Use \$[\d,.]+ as total$/ });
    await useTotal.click();
    await expect(create(page)).toBeEnabled();

    // Back to the template split.
    await page.getByRole("button", { name: "Reset to template split" }).click();
    await page.getByLabel("Total fee *").fill("186,000");
    await expect(fee(page, "CA")).toHaveValue("27,900");

    // A Not-to-exceed phase with no cap is refused on Create; nothing saved.
    await phaseRow(page, "CO").getByLabel(/fee type$/).selectOption("nte");
    await create(page).click();
    await expect(page.getByText("Not-to-exceed phases need a cap")).toBeVisible();
    expect(await query("select 1 from projects where firm_id = :firm and number = '2026-014'")).toHaveLength(0);

    // Close Out unchecked, status Active → 6 phases, PD current.
    await phaseRow(page, "CO").getByRole("checkbox").uncheck();
    await create(page).click();
    await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("toast").last()).toHaveText("Project 2026-014 created");
    await expect(page.getByRole("heading", { name: "Medical Office Building" })).toBeVisible();

    const phases = await query<{ sort_order: number; status: string }>(
      "select ph.sort_order, ph.status from project_phases ph join projects p on p.id = ph.project_id where p.firm_id = :firm and p.number = '2026-014' order by ph.sort_order",
    );
    expect(phases.map((p) => p.sort_order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(phases.map((p) => p.status)).toEqual(["current", "upcoming", "upcoming", "upcoming", "upcoming", "upcoming"]);
    const team = await query<{ project_role: string }>(
      "select pm.project_role from project_members pm join projects p on p.id = pm.project_id where p.firm_id = :firm and p.number = '2026-014' order by 1",
    );
    expect(team.map((t) => t.project_role)).toEqual(["PM", "Principal"]);
    const logs = await query(
      "select 1 from activity_log a join projects p on p.id = a.entity_id where p.firm_id = :firm and p.number = '2026-014' and a.action = 'created'",
    );
    expect(logs).toHaveLength(1);
    const [site] = await query<{ address_line1: string; address_line2: string; city: string; state: string; postal_code: string }>(
      "select address_line1, address_line2, city, state, postal_code from projects where firm_id = :firm and number = '2026-014'",
    );
    expect(site).toEqual({ address_line1: "40 Calhoun St", address_line2: "Suite 200", city: "Charleston", state: "SC", postal_code: "29401" });
  });

  test("a number already used is refused", async ({ page }) => {
    const [client] = await query<{ id: string }>("select id from companies where firm_id = :firm and name = 'Palmetto Medical Properties'");
    // Opening from a client's Contacts panel picks the client.
    await signInAs(page, "etaOwner", `/app/projects/new?client=${client.id}`);
    await expect(page.getByLabel("Client *")).toHaveValue(client.id);
    await fillDetails(page, "2026-014");
    await create(page).click();
    await expect(page.getByText("Number already used")).toBeVisible();
  });

  test("the list: tabs, KPIs, the MOB row, search and sort", async ({ page }) => {
    await signInAs(page, "etaOwner", "/app/projects");
    const tab = (name: RegExp) => page.getByRole("tab", { name });
    await expect(tab(/^Active/)).toContainText("2");
    await expect(tab(/^On hold/)).toContainText("0");
    await expect(tab(/^Closed/)).toContainText("1");
    await expect(tab(/^All/)).toContainText("3");
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect(page.locator("tbody tr").first()).toHaveAttribute("data-project", "2026-014");

    const kpis = page.getByRole("region", { name: "Project totals" });
    await expect(kpis).toContainText("Active fees$227,000");
    await expect(kpis).toContainText("Billed to date$0");
    await expect(kpis).toContainText("0% of active fees");
    await expect(kpis).toContainText("Left to bill$227,000");
    await expect(kpis).toContainText("Flagged0");

    const mob = row(page, "2026-014");
    await expect(mob).toContainText("$186,000");
    await expect(mob).toContainText("0%");
    await expect(mob).toContainText("$6.2M");
    await expect(mob).toContainText("Pre-Design");
    await expect(mob).toContainText("Ground-up");
    await expect(mob).toContainText("On track");

    await page.getByPlaceholder("Search by name, number or client").fill("palmetto");
    await expect(page).toHaveURL(/q=palmetto/);
    await expect(page.locator("tbody tr")).toHaveCount(2); // both active projects are Palmetto's
    await page.getByPlaceholder("Search by name, number or client").fill("zzz");
    await expect(page.getByText('No projects match "zzz".')).toBeVisible();
    await tab(/^All/).click();
    await page.getByPlaceholder("Search by name, number or client").fill("2025-004");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(row(page, "2025-004")).toBeVisible();

    await tab(/^Active/).click();
    await page.getByPlaceholder("Search by name, number or client").fill("");
    await page.getByRole("button", { name: /Sort:/ }).click();
    await expect(page.getByRole("button", { name: /Sort:/ })).toContainText("Largest fee");
    await expect(page).toHaveURL(/sort=fee/);
    await expect(page.locator("tbody tr").first()).toHaveAttribute("data-project", "2026-014");
    await page.reload();
    await expect(page.getByRole("button", { name: /Sort:/ })).toContainText("Largest fee");
  });
});

test.describe("other roles", () => {
  test("PM: no KPIs; money only on their own project", async ({ page }) => {
    await signInAs(page, "etaPm", "/app/projects");
    await expect(row(page, "2026-014")).toContainText("$186,000");
    await expect(page.getByRole("region", { name: "Project totals" })).toHaveCount(0);
    const bistro = row(page, "2026-011");
    await expect(bistro).toBeVisible();
    await expect(bistro).not.toContainText("$41,000");
    await expect(bistro).not.toContainText("On track");
  });

  test("staff: only assigned projects, no money sent, no New project", async ({ page }) => {
    await signInAs(page, "etaStaff", "/app/projects");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(row(page, "2026-011")).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Fee" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Health" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "New project" })).toHaveCount(0);
    // The server never sent fees (the page's data travels inside the HTML).
    expect(await page.content()).not.toMatch(/feeCents|billedCents|4100000/);

    const [mob] = await query<{ id: string }>("select id from projects where firm_id = :firm and number = '2026-014'");
    await page.goto(`/app/projects/${mob.id}`);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();

    await page.goto("/app/projects/new");
    await expect(page.getByRole("heading", { name: "You don't have access to create projects." })).toBeVisible();
  });
});
