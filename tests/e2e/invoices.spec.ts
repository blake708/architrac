import { type Page, expect, test } from "@playwright/test";
import { ownerPool } from "./support/clean";
import { FIRMS, PEOPLE } from "./support/people";
import { signInAs } from "./support/sign-in";

// The Invoices page and builder in the browser (docs/specs/release-1/
// invoicing.md, 1.8 B). Only what needs a page: starting from the central
// page, typing % complete, totals updating, submit and return. The math,
// permissions and time locking are Vitest tests in
// src/server/invoices/builder.db.test.ts.
//
// Runs in order against "E2E Kappa Billing", which only this file uses.
// Setup: 2026-014 Medical Office Building for Palmetto Medical Properties;
// principal Kay (owner), PM Jay; SD $27,900 at 0 %,
// DD $46,500 at 0 % with 2 h of Kim's time, Close Out hourly with Kim's
// approved 4 h at $115, and MEP (Coastal) at $18,000 + 10 % markup.

test.describe.configure({ mode: "serial" });

async function query<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
  const pool = ownerPool();
  const c = await pool.connect();
  try {
    const firm = await c.query<{ id: string }>("select id from firms where name = $1", [FIRMS.kappa.name]);
    await c.query("begin");
    await c.query("select set_config('app.firm_id', $1, true)", [firm.rows[0].id]);
    const r = await c.query<T>(sql.replaceAll(":firm", `'${firm.rows[0].id}'::uuid`));
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
  const [{ n }] = await query<{ n: number }>("select count(*)::int as n from projects where firm_id = :firm");
  if (n > 0) return; // a CI retry: already set up
  await query(`
    with c as (
      insert into companies (firm_id, name, kind) values (:firm, 'Palmetto Medical Properties', 'client') returning id
    ), ct as (
      insert into contacts (firm_id, company_id, first_name, last_name, email)
      select :firm, id, 'Pat', 'Payables', 'ap@palmetto.example' from c returning id, company_id
    ), p as (
      -- The project's client contact is the bill-to (a row inserted in this
      -- statement can't also be updated in it, so not the company's billing contact).
      insert into projects (firm_id, number, name, client_company_id, client_contact_id, project_type, principal_membership_id, pm_membership_id)
      select :firm, '2026-014', 'Medical Office Building', ct.company_id, ct.id, 'Medical office', ${membership(PEOPLE.kaOwner.email)}, ${membership(PEOPLE.kaPm.email)}
      from ct returning id
    )
    insert into project_phases (firm_id, project_id, code, name, sort_order, fee_type, fee_cents, status, percent_complete_bp)
    select :firm, p.id, v.code, v.name, v.ord, v.ft::fee_type, v.fee, 'current', v.pct
    from p, (values
      ('SD', 'Schematic Design', 2, 'fixed', 2790000, 0),
      ('DD', 'Design Development', 3, 'fixed', 4650000, 0),
      ('CO', 'Close Out', 7, 'hourly', 0, 0)
    ) as v(code, name, ord, ft, fee, pct)
  `);
  await query(`
    with r as (
      insert into firm_roles (firm_id, name, sort_order) values (:firm, 'Designer', 1) returning id
    ), s as (
      insert into timesheets (firm_id, membership_id, week_start, status, approved_at)
      values (:firm, ${membership(PEOPLE.kaStaff.email)}, date '2026-10-05', 'approved', now()) returning id
    ), a as (
      select id from activities where firm_id = :firm and applies_to = 'project' order by sort_order limit 1
    ), ph as (
      select id, project_id from project_phases where firm_id = :firm and code = 'CO'
    ), row as (
      insert into timesheet_rows (firm_id, timesheet_id, row_type, project_id, project_phase_id, activity_id, billable)
      select :firm, s.id, 'project', ph.project_id, ph.id, a.id, true from s, ph, a returning id, timesheet_id, project_id, project_phase_id, activity_id
    )
    insert into time_entries (firm_id, timesheet_id, timesheet_row_id, work_date, project_id, project_phase_id, activity_id, hours, billable, bill_rate_cents, cost_rate_cents, firm_role_id)
    select :firm, row.timesheet_id, row.id, date '2026-10-06', row.project_id, row.project_phase_id, row.activity_id, 4, true, 11500, 4400, r.id
    from row, r
  `);
  // 2 h on DD (fixed fee, so WIP not a line) and an MEP consultant: $18,000 + 10 %.
  await query(`
    with s as (
      select id from timesheets where firm_id = :firm limit 1
    ), ph as (
      select id, project_id from project_phases where firm_id = :firm and code = 'DD'
    ), a as (
      select id from activities where firm_id = :firm and applies_to = 'project' order by sort_order limit 1
    ), row as (
      insert into timesheet_rows (firm_id, timesheet_id, row_type, project_id, project_phase_id, activity_id, billable, sort_order)
      select :firm, s.id, 'project', ph.project_id, ph.id, a.id, true, 1 from s, ph, a
      returning id, timesheet_id, project_id, project_phase_id, activity_id
    ), te as (
      insert into time_entries (firm_id, timesheet_id, timesheet_row_id, work_date, project_id, project_phase_id, activity_id, hours, billable, bill_rate_cents, cost_rate_cents)
      select :firm, timesheet_id, id, date '2026-10-07', project_id, project_phase_id, activity_id, 2, true, 11500, 4400 from row
      returning 1
    ), mep as (
      insert into companies (firm_id, name, kind) values (:firm, 'Coastal MEP Engineers', 'consultant') returning id
    )
    insert into consultants (firm_id, project_id, company_id, discipline, fee_cents, markup_bp)
    select :firm, ph.project_id, mep.id, 'MEP', 1800000, 1000 from ph, mep where (select count(*) from te) > 0
  `);
});

const total = (page: Page) => page.getByTestId("invoice-total");

test("staff don't see Invoices and can't open the page", async ({ page }) => {
  await signInAs(page, "kaStaff", "/app/invoices");
  await expect(page.getByRole("heading", { name: "You don't have access to this page" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Invoices" })).toHaveCount(0);
});

test("the PM starts an invoice from the Invoices page and bills DD at 30 %", async ({ page }) => {
  await signInAs(page, "kaPm", "/app/invoices");
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "Invoices" }).waitFor();
  await page.getByRole("button", { name: "New invoice" }).first().click();
  const dialog = page.getByRole("dialog", { name: "New invoice" });
  await dialog.getByLabel("Find a project").fill("medical");
  await dialog.getByRole("button", { name: /Medical Office Building/ }).click();
  // The builder's first load compiles in dev mode: allow it time.
  await expect(page).toHaveURL(/\/app\/invoices\/[0-9a-f-]+\/edit$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /2026-014 Medical Office Building/ })).toBeVisible();
  // Bill-to shows where Send will email it.
  await expect(page.getByTestId("email-to")).toHaveText("Emails to ap@palmetto.example");
  // Kim's approved 4 h at $115 on Close Out is already on it.
  await expect(total(page)).toHaveText("$460");
  // Its time entries open in a dialog.
  await page.locator('[data-phase="Close Out"]').getByRole("button", { name: "Show time entries (1)" }).click();
  const entries = page.getByRole("dialog", { name: "Close Out · time entries" });
  await expect(entries.getByRole("checkbox", { name: /Bill Kim Lane 4\.00 h/ })).toBeChecked();
  // Unticking saves and the dialog stays open; ticking puts it back.
  const kim = entries.getByRole("checkbox", { name: /Bill Kim Lane/ });
  await kim.uncheck();
  await expect(total(page)).toHaveText("$0");
  await expect(entries).toBeVisible();
  await kim.check();
  await expect(total(page)).toHaveText("$460");
  await expect(entries).toBeVisible();
  await entries.getByRole("button", { name: "Done" }).click();
  await expect(entries).toHaveCount(0);

  const dd = page.getByLabel("% complete for Design Development");
  await dd.fill("30");
  await dd.press("Enter");
  await expect(total(page)).toHaveText("$14,410");
  await expect(page.locator('tr[data-phase="Design Development"]')).toContainText("$13,950");
  // WIP: the 2 h on DD at $115.
  await expect(page.locator('tr[data-phase="Design Development"] [data-col="wip"]')).toContainText("$230");

  // MEP at 50 % of $19,800 (fee + markup) adds $9,900.
  const mep = page.getByLabel("% complete for MEP · Coastal MEP Engineers");
  await mep.fill("50");
  await mep.press("Enter");
  await expect(total(page)).toHaveText("$24,310");

  // Back on the list, the draft shows and the project is marked.
  await page.goto("/app/invoices");
  await expect(page.getByRole("table", { name: "Invoices" })).toContainText("2026-014");
  await page.getByRole("button", { name: "New invoice" }).first().click();
  await expect(page.getByRole("dialog", { name: "New invoice" })).toContainText("Draft open");
});

test("a % below what's billed shows an error; a retainer credit lowers the total", async ({ page }) => {
  await signInAs(page, "kaPm", "/app/invoices");
  await page.getByRole("link", { name: "Draft" }).click();
  await expect(total(page)).toHaveText("$24,310");
  const sd = page.getByLabel("% complete for Schematic Design");
  await sd.fill("101");
  await sd.press("Enter");
  await expect(page.getByText("Enter a % from 0 to 100, up to 2 decimals.")).toBeVisible();

  await page.getByRole("button", { name: "Add adjustment" }).click();
  await page.getByLabel("Description").fill("Retainer applied");
  await page.getByLabel("Amount").fill("-1,000");
  await page.getByRole("button", { name: "Add line" }).click();
  await expect(total(page)).toHaveText("$23,310");
});

test("the PM submits it for review and can no longer edit it", async ({ page }) => {
  await signInAs(page, "kaPm", "/app/invoices");
  await page.getByRole("link", { name: "Draft" }).click();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByTestId("invoice-status")).toHaveText("In review");
  await expect(page.getByRole("button", { name: "Recalculate" })).toHaveCount(0);
});

test("the owner returns it to draft with a note", async ({ page }) => {
  await signInAs(page, "kaOwner", "/app/invoices");
  await page.getByRole("link", { name: "Draft" }).click();
  await page.getByRole("button", { name: "Return to draft" }).click();
  const dialog = page.getByRole("dialog", { name: "Return to draft" });
  await dialog.getByLabel("Note").fill("Hold DD until the client meeting");
  await dialog.getByRole("button", { name: "Return to draft" }).click();
  await expect(page.getByTestId("invoice-status")).toHaveText("Draft");
});

test("deleting the draft frees its time for the next one", async ({ page }) => {
  await signInAs(page, "kaOwner", "/app/invoices");
  await page.getByRole("link", { name: "Draft" }).click();
  await page.getByRole("button", { name: "Delete draft" }).click();
  await page.getByRole("dialog", { name: "Delete this draft?" }).getByRole("button", { name: "Delete draft" }).click();
  await expect(page).toHaveURL(/\/app\/invoices$/);
  await expect(page.getByText("No invoices yet")).toBeVisible();
  const [{ n }] = await query<{ n: number }>("select count(*)::int as n from time_entries where firm_id = :firm and invoice_id is not null");
  expect(n).toBe(0);
});
