import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "@neondatabase/serverless";

// Helpers for database tests only. They connect as the OWNER role so they can
// set up and remove test data. The code under test always uses the app role.

export function requireDbEnv() {
  const missing = ["DATABASE_URL", "DATABASE_URL_OWNER"].filter(
    (k) => !process.env[k],
  );
  if (missing.length > 0) {
    throw new Error(
      `Database tests need ${missing.join(" and ")} in .env.local. See docs/GETTING_STARTED.md (milestone 0.2).`,
    );
  }
}

export function createOwnerPool() {
  return new Pool({ connectionString: process.env.DATABASE_URL_OWNER });
}

/** Run SQL as the owner with one firm selected (works whether or not the owner bypasses RLS). */
export async function asFirm<T>(
  pool: Pool,
  firmId: string,
  fn: (c: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.firm_id', $1, true)", [firmId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

export type TestFirm = {
  label: string;
  firmId: string;
  clerkOrgId: string;
  userId: string;
  membershipId: string;
  teamId: string;
  activityLogId: string;
  invitationId: string;
  /** A "Designer" role ($115 bill / $44 cost from 2026-01-01). */
  firmRoleId: string;
  rateId: string;
  /** The owner's pay ($104,000, 25% burden). Starts in 2099 so no other test's cost changes. */
  payId: string;
  /** From the firm defaults (seed_firm_defaults). */
  phaseTemplateId: string;
  overheadCategoryId: string;
  activityId: string;
  /** A client company with one contact (its billing contact). */
  companyId: string;
  /** An active project for that client, with one phase and the owner as PM. */
  projectId: string;
  projectPhaseId: string;
  projectMemberId: string;
  projectContactId: string;
  /** A consultant on that project (the client company, for simplicity). */
  consultantId: string;
  /** Role mixes: Designer 100% on the SD template and on the project's SD phase. */
  templateRoleId: string;
  phaseRoleId: string;
  contactId: string;
};

/**
 * Create a firm with one user, membership, team, firm_settings row,
 * activity_log row, the default setup lists, and one role with a rate.
 */
export async function createTestFirm(
  pool: Pool,
  label: string,
): Promise<TestFirm> {
  const suffix = randomUUID().slice(0, 8);
  const clerkOrgId = `org_test_${suffix}`;

  const firm = await pool.query<{ id: string }>(
    "insert into firms (name, slug, clerk_org_id) values ($1, $2, $3) returning id",
    [
      `Test ${label} ${suffix}`,
      `test-${label.toLowerCase()}-${suffix}`,
      clerkOrgId,
    ],
  );
  const firmId = firm.rows[0].id;

  const user = await pool.query<{ id: string }>(
    "insert into users (clerk_user_id, email, first_name, last_name) values ($1, $2, $3, 'Test') returning id",
    [`user_test_${suffix}`, `test-${suffix}@example.com`, label],
  );
  const userId = user.rows[0].id;

  return asFirm(pool, firmId, async (c) => {
    await c.query(
      "insert into firm_settings (firm_id, invoice_number_format) values ($1, $2)",
      [firmId, `${label}-{###}`],
    );
    const team = await c.query<{ id: string }>(
      "insert into teams (firm_id, name) values ($1, $2) returning id",
      [firmId, `${label} team`],
    );
    const teamId = team.rows[0].id;
    const membership = await c.query<{ id: string }>(
      "insert into memberships (firm_id, user_id, app_role, title, team_id) values ($1, $2, 'owner', $3, $4) returning id",
      [firmId, userId, `${label} principal`, teamId],
    );
    const membershipId = membership.rows[0].id;
    await c.query("update teams set leader_membership_id = $1 where id = $2", [
      membershipId,
      teamId,
    ]);
    const log = await c.query<{ id: string }>(
      "insert into activity_log (firm_id, actor_user_id, entity_type, entity_id, action) values ($1, $2, 'team', $3, 'created') returning id",
      [firmId, userId, teamId],
    );
    const invite = await c.query<{ id: string }>(
      "insert into invitations (firm_id, email, app_role, title, invited_by) values ($1, $2, 'staff', 'Designer', $3) returning id",
      [firmId, `invitee-${suffix}@example.com`, userId],
    );
    await c.query("select seed_firm_defaults($1)", [firmId]);
    const role = await c.query<{ id: string }>(
      "insert into firm_roles (firm_id, name, sort_order) values ($1, 'Designer', 1) returning id",
      [firmId],
    );
    const firmRoleId = role.rows[0].id;
    const rate = await c.query<{ id: string }>(
      "insert into rates (firm_id, firm_role_id, bill_rate_cents, cost_rate_cents, effective_from) values ($1, $2, 11500, 4400, '2026-01-01') returning id",
      [firmId, firmRoleId],
    );
    const pay = await c.query<{ id: string }>(
      "insert into membership_pay (firm_id, membership_id, pay_type, amount_cents, burden_bp, effective_from) values ($1, $2, 'salary', 10400000, 2500, '2099-01-01') returning id",
      [firmId, membershipId],
    );
    const company = await c.query<{ id: string }>(
      "insert into companies (firm_id, name, kind) values ($1, $2, 'client') returning id",
      [firmId, `${label} Client Co`],
    );
    const contact = await c.query<{ id: string }>(
      "insert into contacts (firm_id, company_id, first_name, last_name, email) values ($1, $2, 'Bill', 'Payer', 'bill@example.com') returning id",
      [firmId, company.rows[0].id],
    );
    await c.query("update companies set billing_contact_id = $1 where id = $2", [
      contact.rows[0].id,
      company.rows[0].id,
    ]);
    const project = await c.query<{ id: string }>(
      "insert into projects (firm_id, number, name, client_company_id, project_type, principal_membership_id, pm_membership_id) values ($1, '2026-001', $2, $3, 'Office', $4, $4) returning id",
      [firmId, `${label} Project`, company.rows[0].id, membershipId],
    );
    const projectId = project.rows[0].id;
    const phase = await c.query<{ id: string }>(
      "insert into project_phases (firm_id, project_id, code, name, sort_order, fee_type, fee_cents, status) values ($1, $2, 'SD', 'Schematic Design', 1, 'fixed', 1000000, 'current') returning id",
      [firmId, projectId],
    );
    const member = await c.query<{ id: string }>(
      "insert into project_members (firm_id, project_id, membership_id, firm_role_id) values ($1, $2, $3, $4) returning id",
      [firmId, projectId, membershipId, firmRoleId],
    );
    const link = await c.query<{ id: string }>(
      "insert into project_contacts (firm_id, project_id, company_id, role) values ($1, $2, $3, 'Owner') returning id",
      [firmId, projectId, company.rows[0].id],
    );
    const consultant = await c.query<{ id: string }>(
      "insert into consultants (firm_id, project_id, company_id, discipline, fee_cents, markup_bp) values ($1, $2, $3, 'MEP', 100000, 1000) returning id",
      [firmId, projectId, company.rows[0].id],
    );
    const sdTemplate = await c.query<{ id: string }>(
      "select id from phase_templates where firm_id = $1 and code = 'SD'",
      [firmId],
    );
    const templateRole = await c.query<{ id: string }>(
      "insert into phase_template_roles (firm_id, phase_template_id, firm_role_id, share_bp) values ($1, $2, $3, 10000) returning id",
      [firmId, sdTemplate.rows[0].id, firmRoleId],
    );
    const phaseRole = await c.query<{ id: string }>(
      "insert into project_phase_roles (firm_id, project_phase_id, firm_role_id, share_bp, rate_cents, hours) values ($1, $2, $3, 10000, 11500, 87) returning id",
      [firmId, phase.rows[0].id, firmRoleId],
    );
    const pick = async (q: string) =>
      (await c.query<{ id: string }>(q, [firmId])).rows[0].id;
    return {
      companyId: company.rows[0].id,
      contactId: contact.rows[0].id,
      projectId,
      projectPhaseId: phase.rows[0].id,
      projectMemberId: member.rows[0].id,
      projectContactId: link.rows[0].id,
      consultantId: consultant.rows[0].id,
      templateRoleId: templateRole.rows[0].id,
      phaseRoleId: phaseRole.rows[0].id,
      firmRoleId,
      rateId: rate.rows[0].id,
      payId: pay.rows[0].id,
      phaseTemplateId: await pick(
        "select id from phase_templates where firm_id = $1 and code = 'SD'",
      ),
      overheadCategoryId: await pick(
        "select id from overhead_categories where firm_id = $1 and name = 'Marketing'",
      ),
      activityId: await pick(
        "select id from activities where firm_id = $1 and name = 'Design'",
      ),
      invitationId: invite.rows[0].id,
      label,
      firmId,
      clerkOrgId,
      userId,
      membershipId,
      teamId,
      activityLogId: log.rows[0].id,
    };
  });
}

/** Remove a test firm and everything in it. Only tests hard-delete; the app role can't. */
export async function removeTestFirm(pool: Pool, firm: TestFirm) {
  await asFirm(pool, firm.firmId, async (c) => {
    await c.query(
      "update teams set leader_membership_id = null where firm_id = $1",
      [firm.firmId],
    );
    await c.query(
      "update companies set primary_contact_id = null, billing_contact_id = null where firm_id = $1",
      [firm.firmId],
    );
    for (const t of ["notifications", "timesheet_review_steps", "review_steps", "invoice_excluded_entries", "payments", "invoice_lines", "time_entries", "invoices", "timesheet_rows", "timesheets", "project_type_benchmarks", "project_phase_roles", "phase_template_roles", "consultants", "project_contacts", "project_members", "project_phases", "projects"])
      await c.query(`delete from ${t} where firm_id = $1`, [firm.firmId]);
    await c.query("delete from contacts where firm_id = $1", [firm.firmId]);
    await c.query("delete from companies where firm_id = $1", [firm.firmId]);
    await c.query("delete from membership_pay where firm_id = $1", [firm.firmId]);
    await c.query("delete from rates where firm_id = $1", [firm.firmId]);
    await c.query("delete from activities where firm_id = $1", [firm.firmId]);
    await c.query("delete from overhead_categories where firm_id = $1", [firm.firmId]);
    await c.query("delete from phase_templates where firm_id = $1", [firm.firmId]);
    await c.query("delete from activity_log where firm_id = $1", [firm.firmId]);
    await c.query("delete from invitations where firm_id = $1", [firm.firmId]);
    await c.query("delete from memberships where firm_id = $1", [firm.firmId]);
    await c.query("delete from firm_roles where firm_id = $1", [firm.firmId]);
    await c.query("delete from teams where firm_id = $1", [firm.firmId]);
    await c.query("delete from firm_settings where firm_id = $1", [
      firm.firmId,
    ]);
  });
  await pool.query("delete from firms where id = $1", [firm.firmId]);
  await pool.query("delete from users where id = $1", [firm.userId]);
}

/** Remove a firm made by the code under test (e.g. createFirm), and its rows. */
export async function removeFirmById(pool: Pool, firmId: string) {
  await asFirm(pool, firmId, async (c) => {
    await c.query(
      "update companies set primary_contact_id = null, billing_contact_id = null where firm_id = $1",
      [firmId],
    );
    for (const t of ["notifications", "timesheet_review_steps", "review_steps", "invoice_excluded_entries", "payments", "invoice_lines", "time_entries", "invoices", "timesheet_rows", "timesheets", "project_type_benchmarks", "project_phase_roles", "phase_template_roles", "consultants", "project_contacts", "project_members", "project_phases", "projects"])
      await c.query(`delete from ${t} where firm_id = $1`, [firmId]);
    await c.query("delete from contacts where firm_id = $1", [firmId]);
    await c.query("delete from companies where firm_id = $1", [firmId]);
    await c.query("delete from membership_pay where firm_id = $1", [firmId]);
    await c.query("delete from rates where firm_id = $1", [firmId]);
    await c.query("delete from activities where firm_id = $1", [firmId]);
    await c.query("delete from overhead_categories where firm_id = $1", [firmId]);
    await c.query("delete from phase_templates where firm_id = $1", [firmId]);
    await c.query("delete from activity_log where firm_id = $1", [firmId]);
    await c.query("delete from invitations where firm_id = $1", [firmId]);
    await c.query("delete from memberships where firm_id = $1", [firmId]);
    await c.query("delete from firm_roles where firm_id = $1", [firmId]);
    await c.query("delete from firm_settings where firm_id = $1", [firmId]);
  });
  await pool.query("delete from firms where id = $1", [firmId]);
}

/** Remove a user row by Clerk id. Remove their memberships first. */
export async function removeUserByClerkId(pool: Pool, clerkUserId: string) {
  await pool.query("delete from users where clerk_user_id = $1", [clerkUserId]);
}

export type TestMember = {
  userId: string;
  clerkUserId: string;
  email: string;
  membershipId: string;
};

/**
 * Add a person to a test firm. Remove with removeTestUsers after the firm's
 * memberships are gone (removeTestFirm does that).
 */
export async function addTestMember(
  pool: Pool,
  firm: TestFirm,
  p: {
    firstName: string;
    lastName: string;
    role: "owner" | "admin" | "project_manager" | "staff";
    active?: boolean;
    title?: string;
  },
): Promise<TestMember> {
  const suffix = randomUUID().slice(0, 8);
  const clerkUserId = `user_test_${suffix}`;
  const email = `${p.firstName.toLowerCase()}-${suffix}@example.com`;
  const user = await pool.query<{ id: string }>(
    "insert into users (clerk_user_id, email, first_name, last_name, initials) values ($1, $2, $3, $4, $5) returning id",
    [
      clerkUserId,
      email,
      p.firstName,
      p.lastName,
      p.firstName[0] + p.lastName[0],
    ],
  );
  const userId = user.rows[0].id;
  const membershipId = await asFirm(pool, firm.firmId, async (c) => {
    const m = await c.query<{ id: string }>(
      "insert into memberships (firm_id, user_id, app_role, active, title) values ($1, $2, $3, $4, $5) returning id",
      [firm.firmId, userId, p.role, p.active ?? true, p.title ?? null],
    );
    return m.rows[0].id;
  });
  return { userId, clerkUserId, email, membershipId };
}

/** Remove user rows made by addTestMember (or by the code under test). */
export async function removeTestUsers(pool: Pool, userIds: string[]) {
  await pool.query("delete from users where id = any($1::uuid[])", [userIds]);
}

export type TestTime = {
  timesheetId: string;
  rowId: string;
  entryId: string;
  reviewRowId: string;
  routeStepId: string;
  notificationId: string;
};

/**
 * A draft timesheet for the firm's owner (week of Oct 12, 2026) with one row
 * on the project's SD phase (Design) and 2 h on Monday, plus one review row
 * (any principal) and the firm's default route step. removeTestFirm cleans it up.
 */
export async function addTestTime(pool: Pool, firm: TestFirm): Promise<TestTime> {
  return asFirm(pool, firm.firmId, async (c) => {
    const activity = await c.query<{ id: string }>(
      "select id from activities where firm_id = $1 and applies_to = 'project' order by sort_order limit 1",
      [firm.firmId],
    );
    const sheet = await c.query<{ id: string }>(
      "insert into timesheets (firm_id, membership_id, week_start) values ($1, $2, '2026-10-12') returning id",
      [firm.firmId, firm.membershipId],
    );
    const row = await c.query<{ id: string }>(
      "insert into timesheet_rows (firm_id, timesheet_id, row_type, project_id, project_phase_id, activity_id, billable) values ($1, $2, 'project', $3, $4, $5, true) returning id",
      [firm.firmId, sheet.rows[0].id, firm.projectId, firm.projectPhaseId, activity.rows[0].id],
    );
    const entry = await c.query<{ id: string }>(
      "insert into time_entries (firm_id, timesheet_id, timesheet_row_id, work_date, project_id, project_phase_id, activity_id, hours, billable) values ($1, $2, $3, '2026-10-12', $4, $5, $6, 2, true) returning id",
      [firm.firmId, sheet.rows[0].id, row.rows[0].id, firm.projectId, firm.projectPhaseId, activity.rows[0].id],
    );
    const review = await c.query<{ id: string }>(
      "insert into timesheet_review_steps (firm_id, timesheet_id, step_no, kind) values ($1, $2, 1, 'any_principal') returning id",
      [firm.firmId, sheet.rows[0].id],
    );
    const step = await c.query<{ id: string }>(
      "select id from review_steps where firm_id = $1 and archived_at is null order by sort_order limit 1",
      [firm.firmId],
    );
    const note = await c.query<{ id: string }>(
      "insert into notifications (firm_id, membership_id, kind, title) values ($1, $2, 'review_waiting', 'Test') returning id",
      [firm.firmId, firm.membershipId],
    );
    return {
      notificationId: note.rows[0].id,
      timesheetId: sheet.rows[0].id,
      rowId: row.rows[0].id,
      entryId: entry.rows[0].id,
      reviewRowId: review.rows[0].id,
      routeStepId: step.rows[0].id,
    };
  });
}

export type TestInvoices = {
  /** A draft on the firm's project with one SD phase-fee line and the test entry reserved and excluded. */
  draftId: string;
  draftLineId: string;
  excludedId: string;
  /** A sent invoice (number "{label}-100") with one $10,000 line and a $4,000 check. */
  sentId: string;
  sentLineId: string;
  paymentId: string;
};

/**
 * Invoices for a test firm (needs addTestTime first). removeTestFirm
 * cleans them up.
 */
export async function addTestInvoices(pool: Pool, firm: TestFirm, time: TestTime): Promise<TestInvoices> {
  return asFirm(pool, firm.firmId, async (c) => {
    const sent = await c.query<{ id: string }>(
      `insert into invoices (firm_id, project_id, client_company_id, number, status, issue_date, due_date, period_end,
         subtotal_cents, total_cents, amount_paid_cents, sent_at)
       values ($1, $2, $3, $4, 'partially_paid', '2026-09-16', '2026-10-16', '2026-09-30', 1000000, 1000000, 400000, now()) returning id`,
      [firm.firmId, firm.projectId, firm.companyId, `${firm.label}-100`],
    );
    const sentLine = await c.query<{ id: string }>(
      `insert into invoice_lines (firm_id, invoice_id, project_phase_id, line_type, description, rate_cents, amount_cents, percent_complete_bp)
       values ($1, $2, $3, 'phase_fee', 'Schematic Design · 100% complete', 1000000, 1000000, 10000) returning id`,
      [firm.firmId, sent.rows[0].id, firm.projectPhaseId],
    );
    const payment = await c.query<{ id: string }>(
      "insert into payments (firm_id, invoice_id, received_on, amount_cents, method, reference) values ($1, $2, '2026-10-01', 400000, 'check', '1042') returning id",
      [firm.firmId, sent.rows[0].id],
    );
    const draft = await c.query<{ id: string }>(
      `insert into invoices (firm_id, project_id, client_company_id, issue_date, due_date, period_start, period_end)
       values ($1, $2, $3, '2026-10-16', '2026-11-15', '2026-10-01', '2026-10-31') returning id`,
      [firm.firmId, firm.projectId, firm.companyId],
    );
    const draftLine = await c.query<{ id: string }>(
      `insert into invoice_lines (firm_id, invoice_id, project_phase_id, line_type, description, rate_cents, amount_cents)
       values ($1, $2, $3, 'adjustment', 'Retainer applied', -50000, -50000) returning id`,
      [firm.firmId, draft.rows[0].id, firm.projectPhaseId],
    );
    const excluded = await c.query<{ id: string }>(
      "insert into invoice_excluded_entries (firm_id, invoice_id, time_entry_id) values ($1, $2, $3) returning id",
      [firm.firmId, draft.rows[0].id, time.entryId],
    );
    return {
      draftId: draft.rows[0].id,
      draftLineId: draftLine.rows[0].id,
      excludedId: excluded.rows[0].id,
      sentId: sent.rows[0].id,
      sentLineId: sentLine.rows[0].id,
      paymentId: payment.rows[0].id,
    };
  });
}
