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
    with r as (
      insert into firm_roles (firm_id, name, sort_order) values (:firm, 'Architect', 1) returning id
    ), x as (
      insert into rates (firm_id, firm_role_id, bill_rate_cents, cost_rate_cents, effective_from)
      select :firm, id, 15000, 6000, date '2026-01-01' from r returning firm_role_id
    )
    update memberships set firm_role_id = (select firm_role_id from x) where id = ${owner}
  `);
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
const share = (page: Page, code: string) => phaseRow(page, code).getByLabel(/ share$/);
const create = (page: Page) => page.getByRole("button", { name: "Create project" });
const next = (page: Page) => page.getByRole("button", { name: "Next: fees" });
const back = (page: Page) => page.getByRole("button", { name: "Back" });
const pick = (page: Page, name: string) =>
  page.getByRole("group", { name: "Phases to include" }).getByRole("checkbox", { name: new RegExp(`\\b${name}\\b`) });
const ALL = ["PD", "SD", "DD", "CD", "PRM", "CA", "CO"];

async function fillDetails(page: Page, number: string) {
  await page.getByLabel("Project number *").fill(number);
  await page.getByLabel("Project name *").fill("Medical Office Building");
  await page.getByLabel("Client *").selectOption({ label: "Palmetto Medical Properties" });
  await page.getByLabel("Client contact").selectOption({ label: "Ana Reyes" });
  await page.getByLabel("Project type *").selectOption("Medical office");
  await page.getByLabel("Scope").selectOption({ label: "Ground-up" });
  await page.getByLabel("Principal in charge *").selectOption({ label: "Eli Owner" });
  await page.getByLabel("Project manager *").selectOption({ label: "Jo Rivera" });
  await page.getByLabel("Square feet").fill("20000");
  await page.getByLabel("Construction estimate").fill("6,200,000");
  // Typed by hand (the Google lookup is off in tests).
  await page.getByLabel("Street address").fill("40 Calhoun St");
  await page.getByLabel("Suite / unit").fill("Suite 200");
  await page.getByLabel("City").fill("Charleston");
  await page.getByLabel("State").fill("SC");
  await page.getByLabel("ZIP").fill("29401");
}

test.describe("owner", () => {
  test("Settings → Phases: project type ranges", async ({ page }) => {
    await signInAs(page, "etaOwner", "/app/settings/phases");
    const card = page.getByRole("region", { name: "Project type ranges" });
    await card.getByRole("button", { name: "Add range" }).click();
    await card.getByLabel("Range 1 project type").fill("Medical office");
    await card.getByLabel("Range 1 scope").selectOption({ label: "Ground-up" });
    await card.getByLabel("Range 1 cost per SF low").fill("330");
    await card.getByLabel("Range 1 cost per SF high").fill("290");
    await card.getByLabel("Range 1 fee % low").fill("2.8");
    await card.getByLabel("Range 1 fee % high").fill("3.4");
    await card.getByRole("button", { name: "Save ranges" }).click();
    await expect(card.getByText("High must be at least low")).toBeVisible();
    await card.getByLabel("Range 1 cost per SF low").fill("290");
    await card.getByLabel("Range 1 cost per SF high").fill("330");
    await card.getByRole("button", { name: "Save ranges" }).click();
    await expect(page.getByTestId("toast").last()).toHaveText("Project type ranges saved");
    const [r] = await query<{ cost_per_sf_low_cents: string; fee_high_bp: number; scope_kind: string }>(
      "select cost_per_sf_low_cents, fee_high_bp, scope_kind from project_type_benchmarks where firm_id = :firm and archived_at is null",
    );
    expect(r).toEqual({ cost_per_sf_low_cents: "29000", fee_high_bp: 340, scope_kind: "ground_up" });
    await page.reload();
    await expect(card.getByLabel("Range 1 cost per SF low")).toHaveValue("290");
  });

  test("New project: number, fee split, edits, cap check, then create", async ({ page }) => {
    await signInAs(page, "etaOwner", "/app/projects/new");
    const year = new Date().getFullYear();
    await expect(page.getByLabel("Project number *")).toHaveValue(year === 2026 ? "2026-012" : `${year}-001`);
    for (const group of ["Project", "Client", "People", "Site address", "Size & schedule"])
      await expect(page.getByRole("group", { name: group, exact: true })).toBeVisible();

    // Step 1: details on the left, phases on the right. Next checks the details first.
    await expect(page.getByTestId("step")).toContainText("Step 1 of 2");
    await next(page).click();
    await expect(page.getByText("Enter a project name")).toBeVisible();
    await expect(page.getByTestId("step")).toContainText("Step 1 of 2");
    await fillDetails(page, "2026-014");
    for (const c of ALL) await expect(pick(page, c)).toBeChecked();
    for (const c of ALL) await pick(page, c).uncheck();
    await next(page).click();
    await expect(page.getByText("Include at least one phase")).toBeVisible();
    for (const c of ALL) await pick(page, c).check();
    await next(page).click();
    await expect(page.getByTestId("step")).toContainText("Step 2 of 2");

    // The estimate: no similar past projects yet, so the Settings range
    // (added in the Settings test): $290–$330/SF × 20,000 SF, fee 2.8–3.4%.
    const est = page.getByRole("region", { name: "Estimate" });
    await expect(est.getByTestId("estimate-source")).toHaveText("From Settings → Phases: ground-up medical office");
    await expect(est.getByTestId("estimate-construction")).toContainText("$5.8M–$6.6M");
    await expect(est.getByRole("button", { name: "Use $6.2M" })).toHaveCount(0); // an estimate was typed
    await expect(est.getByTestId("estimate-fee")).toContainText("2.8%–3.4% of construction");
    await expect(est.getByTestId("estimate-fee")).toContainText("typical $192,200 (3.1% of your $6.2M estimate)");
    await est.getByRole("button", { name: "Use $192,200" }).click();
    await expect(page.getByLabel("Total fee *")).toHaveValue("192,200");
    await expect(est.getByTestId("estimate-position")).toHaveText("Your total fee is within the range.");

    // Example A: the seed split; hours = fee ÷ the $150/h blended bill rate.
    await page.getByLabel("Total fee *").fill("186,000");
    const codes = ["PD", "SD", "DD", "CD", "PRM", "CA", "CO"];
    const values = (label: RegExp) => Promise.all(codes.map((c) => phaseRow(page, c).getByLabel(label).inputValue()));
    expect(await values(/ fee$/)).toEqual(["9,300", "27,900", "46,500", "65,100", "9,300", "27,900", "0"]);
    expect(await values(/ share$/)).toEqual(["5", "15", "25", "35", "5", "15", "0"]);
    expect(await values(/budget hours$/)).toEqual(["62", "186", "310", "434", "62", "186", "0"]);
    await expect(page.getByTestId("hours-total")).toHaveText("1240");
    await expect(page.getByTestId("share-sum")).toHaveText("100%");
    await expect(page.getByTestId("hours-note")).toContainText("$150/h");

    // Example B: the leftover cent goes to CD.
    await page.getByLabel("Total fee *").fill("1000.01");
    await expect(fee(page, "CD")).toHaveValue("350.01");
    await expect(page.getByTestId("fee-sum")).toHaveText("$1,000.01");

    // Example C: CA's fee edited to $20,000 → its share shows 10.75%.
    await page.getByLabel("Total fee *").fill("186000");
    await fee(page, "CA").fill("20000");
    await fee(page, "CA").blur();
    await expect(phaseRow(page, "CA").getByRole("img", { name: "edited" })).toBeVisible();
    await expect(share(page, "CA")).toHaveValue("10.75");
    await expect(fee(page, "CD")).toHaveValue("68,352.97");
    await expect(page.getByTestId("fee-sum")).toHaveText("$186,000");
    await expect(page.getByTestId("share-sum")).toHaveText("100%");

    // A % edit sets the fee; the others rebalance to 100%.
    await share(page, "CA").fill("20");
    await share(page, "CA").blur();
    await expect(fee(page, "CA")).toHaveValue("37,200");
    await expect(page.getByTestId("share-sum")).toHaveText("100%");
    await expect(phaseRow(page, "CA").getByLabel(/budget hours$/)).toHaveValue("248");

    // Hourly phases: 0%, $0, hours typed in; the rest still make 100%.
    await phaseRow(page, "PRM").getByLabel(/fee type$/).selectOption("hourly");
    await expect(share(page, "PRM")).toHaveValue("0");
    await expect(fee(page, "PRM")).toHaveValue("0");
    await expect(fee(page, "PRM")).toBeDisabled();
    await expect(page.getByTestId("share-sum")).toHaveText("100%");
    await phaseRow(page, "PRM").getByLabel(/budget hours$/).fill("40");
    await phaseRow(page, "PRM").getByLabel(/budget hours$/).blur();
    await phaseRow(page, "PRM").getByLabel(/fee type$/).selectOption("fixed");

    // Unchecked phases leave the table; the rest still make 100%. Back keeps everything typed.
    await back(page).click();
    await expect(page.getByLabel("Project name *")).toHaveValue("Medical Office Building");
    await pick(page, "PD").uncheck();
    await next(page).click();
    await expect(phaseRow(page, "PD")).toHaveCount(0);
    await expect(page.getByTestId("share-sum")).toHaveText("100%");
    await expect(page.getByLabel("Total fee *")).toHaveValue("186000");
    await back(page).click();
    await pick(page, "PD").check();
    await next(page).click();

    // Edits past the total block Create until "Use $X as total".
    await fee(page, "CA").fill("200000");
    await fee(page, "CA").blur();
    await expect(create(page)).toBeDisabled();
    await page.getByRole("button", { name: /^Use \$[\d,.]+ as total$/ }).click();
    await expect(create(page)).toBeEnabled();

    // Back to the template split.
    await page.getByRole("button", { name: "Reset to template split" }).click();
    await page.getByLabel("Total fee *").fill("186,000");
    await expect(fee(page, "CA")).toHaveValue("27,900");
    await expect(share(page, "CA")).toHaveValue("15");

    // A Not-to-exceed phase with no cap is refused on Create; nothing saved.
    await phaseRow(page, "CO").getByLabel(/fee type$/).selectOption("nte");
    await create(page).click();
    await expect(page.getByText("Not-to-exceed phases need a cap")).toBeVisible();
    expect(await query("select 1 from projects where firm_id = :firm and number = '2026-014'")).toHaveLength(0);

    // Close Out unchecked, status Active → 6 phases, PD current.
    await back(page).click();
    await pick(page, "CO").uncheck();
    await next(page).click();
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
    await next(page).click();
    await create(page).click();
    // The server sends you back to step 1 with the field marked.
    await expect(page.getByText("Number already used")).toBeVisible();
    await expect(page.getByTestId("step")).toContainText("Step 1 of 2");
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

test.describe("new project extras", () => {
  test("a custom phase, roles typed as hours, and a consultant", async ({ page }) => {
    await signInAs(page, "etaOwner", "/app/projects/new");
    await fillDetails(page, "2026-020");
    await page.getByLabel("Status").selectOption({ label: "Pursuit" }); // keeps the list counts above unchanged
    for (const c of ALL) await pick(page, c).uncheck();
    await pick(page, "SD").check();
    await next(page).click();
    await page.getByLabel("Total fee *").fill("10,000");

    // A custom phase: code, name and fee typed in; Create waits for a name.
    await page.getByRole("button", { name: "Add custom phase" }).click();
    await expect(create(page)).toBeDisabled();
    await page.getByLabel("New phase name").fill("Feasibility study");
    await page.getByLabel("Feasibility study code").fill("FS");
    await fee(page, "FS").fill("2,000");
    await fee(page, "FS").blur();
    await expect(page.getByTestId("share-sum")).toHaveText("100%");
    await expect(fee(page, "SD")).toHaveValue("8,000");

    // Roles under FS: type hours and the share follows (hours × bill rate ÷ fee).
    const [role] = await query<{ name: string; bill: string }>(
      `select r.name, rt.bill_rate_cents as bill from firm_roles r join rates rt on rt.firm_role_id = r.id
       where r.firm_id = :firm and r.archived_at is null and r.is_billable and rt.effective_to is null and rt.bill_rate_cents > 0
       order by r.sort_order, r.created_at limit 1`,
    );
    const fs = page.locator('tr[data-roles-for="FS"]');
    await fs.getByRole("button", { name: "Add role to Feasibility study" }).click();
    await fs.getByLabel("Feasibility study role 1").selectOption({ label: role.name });
    await expect(fs.getByLabel(`Feasibility study ${role.name} share`)).toHaveValue("100");
    await fs.getByLabel(`Feasibility study ${role.name} hours`).fill("5");
    const bp = Math.round((5 * Number(role.bill) * 10_000) / 200_000);
    await expect(fs.getByLabel(`Feasibility study ${role.name} share`)).toHaveValue(String(bp / 100));
    await expect(fs.getByRole("alert")).toContainText("they need to make 100%");
    await expect(create(page)).toBeDisabled();
    await fs.getByLabel(`Feasibility study ${role.name} share`).fill("100");
    await fs.getByLabel(`Feasibility study ${role.name} share`).blur();
    await expect(fs.getByRole("alert")).toHaveCount(0);

    // A consultant, added as a new company; 10% markup by default.
    await page.getByRole("button", { name: "Add consultant" }).click();
    await page.getByLabel("Consultant 1 discipline").fill("MEP");
    await page.getByLabel("Consultant 1 company").selectOption({ label: "+ New consultant…" });
    await page.getByLabel("New consultant name").fill("Lowcountry MEP");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page.getByLabel("Consultant 1 company")).toHaveValue(/[0-9a-f-]{36}/);
    await page.getByLabel("Consultant 1 fee").fill("4,000");
    await expect(page.getByLabel("Consultant 1 markup")).toHaveValue("10");
    await expect(page.getByTestId("consultant-1-to-client")).toHaveText("$4,400");
    await expect(page.getByTestId("total-to-client")).toContainText("Architectural fee $10,000 + consultants $4,400 = $14,400 to the client");

    // A second consultant row left empty blocks Create and is marked.
    await page.getByRole("button", { name: "Add consultant" }).click();
    await create(page).click();
    await expect(page.locator('tr[data-consultant="2"]').getByRole("alert")).toHaveText("Pick a discipline");
    await page.getByRole("button", { name: "Remove consultant 2" }).click();

    await create(page).click();
    await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f-]{36}$/);
    const phases = await query<{ code: string; fee_cents: string }>(
      "select ph.code, ph.fee_cents from project_phases ph join projects p on p.id = ph.project_id where p.firm_id = :firm and p.number = '2026-020' order by ph.sort_order",
    );
    expect(phases).toEqual([
      { code: "SD", fee_cents: "800000" },
      { code: "FS", fee_cents: "200000" },
    ]);
    const cons = await query<{ discipline: string; fee_cents: string; markup_bp: number; name: string }>(
      "select c.discipline, c.fee_cents, c.markup_bp, co.name from consultants c join projects p on p.id = c.project_id join companies co on co.id = c.company_id where p.firm_id = :firm and p.number = '2026-020'",
    );
    expect(cons).toEqual([{ discipline: "MEP", fee_cents: "400000", markup_bp: 1000, name: "Lowcountry MEP" }]);
  });
});
