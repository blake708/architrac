import { randomUUID } from "node:crypto";
import type { Pool } from "@neondatabase/serverless";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "./client";
import {
  activities,
  activityLog,
  companies,
  consultants,
  contacts,
  phaseTemplateRoles,
  projectPhaseRoles,
  projectContacts,
  projectMembers,
  projectPhases,
  projects,
  firmRoles,
  firmSettings,
  firms,
  invitations,
  memberships,
  overheadCategories,
  phaseTemplates,
  rates,
  teams,
  timeEntries,
  timesheetRows,
  reviewSteps,
  timesheetReviewSteps,
  timesheets,
} from "./schema";
import { type TenantDb, withFirm } from "./tenant";
import {
  type TestTime,
  addTestTime,
  createOwnerPool,
  createTestFirm,
  removeTestFirm,
  requireDbEnv,
  type TestFirm,
} from "./test-helpers";

// Proves the two firms can't see or change each other's data, for every
// firm-owned table. Runs against the real Neon database in .env.local.

let owner: Pool;
let A: TestFirm;
let B: TestFirm;
let BT: TestTime;

beforeAll(async () => {
  requireDbEnv();
  owner = createOwnerPool();
  A = await createTestFirm(owner, "A");
  B = await createTestFirm(owner, "B");
  await addTestTime(owner, A);
  BT = await addTestTime(owner, B);
});

afterAll(async () => {
  if (owner) {
    if (A) await removeTestFirm(owner, A);
    if (B) await removeTestFirm(owner, B);
    await owner.end();
  }
  await closeDb();
});

/** Drizzle wraps database errors; the Postgres message is on `cause`. */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "expected the database to refuse this").not.toBeNull();
  const e = err as { message?: string; cause?: { message?: string } };
  expect(`${e.message} ${e.cause?.message ?? ""}`).toMatch(pattern);
}

type TableCase = {
  table: string;
  /** Row ids (as firm ids) visible to the current firm. */
  visibleFirmIds: (db: TenantDb) => Promise<string[]>;
  /** Try to change Firm B's row; returns the rows actually changed. */
  updateB: (db: TenantDb) => Promise<unknown[]>;
  /** Read the field updateB tried to change, as Firm B. */
  readB: (db: TenantDb) => Promise<unknown>;
  /** Try to create a row that belongs to Firm B. */
  insertForB: (db: TenantDb) => Promise<unknown>;
};

const cases: TableCase[] = [
  {
    table: "firms",
    visibleFirmIds: (db) =>
      db
        .select({ f: firms.id })
        .from(firms)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(firms)
        .set({ name: "hacked" })
        .where(eq(firms.id, B.firmId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: firms.name })
        .from(firms)
        .where(eq(firms.id, B.firmId))
        .then((r) => r[0]?.v),
    // A firm row other than your own counts as "another firm".
    insertForB: (db) =>
      db.insert(firms).values({
        name: "x",
        slug: `x-${randomUUID()}`,
        clerkOrgId: randomUUID(),
      }),
  },
  {
    table: "firm_settings",
    visibleFirmIds: (db) =>
      db
        .select({ f: firmSettings.firmId })
        .from(firmSettings)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(firmSettings)
        .set({ invoicePrefix: "hacked" })
        .where(eq(firmSettings.firmId, B.firmId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: firmSettings.invoicePrefix })
        .from(firmSettings)
        .where(eq(firmSettings.firmId, B.firmId))
        .then((r) => r[0]?.v),
    insertForB: (db) => db.insert(firmSettings).values({ firmId: B.firmId }),
  },
  {
    table: "memberships",
    visibleFirmIds: (db) =>
      db
        .select({ f: memberships.firmId })
        .from(memberships)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(memberships)
        .set({ title: "hacked" })
        .where(eq(memberships.id, B.membershipId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: memberships.title })
        .from(memberships)
        .where(eq(memberships.id, B.membershipId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(memberships).values({ firmId: B.firmId, userId: A.userId }),
  },
  {
    table: "teams",
    visibleFirmIds: (db) =>
      db
        .select({ f: teams.firmId })
        .from(teams)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(teams)
        .set({ name: "hacked" })
        .where(eq(teams.id, B.teamId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: teams.name })
        .from(teams)
        .where(eq(teams.id, B.teamId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(teams).values({ firmId: B.firmId, name: "sneaky" }),
  },
  {
    table: "activity_log",
    visibleFirmIds: (db) =>
      db
        .select({ f: activityLog.firmId })
        .from(activityLog)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(activityLog)
        .set({ action: "hacked" })
        .where(eq(activityLog.id, B.activityLogId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: activityLog.action })
        .from(activityLog)
        .where(eq(activityLog.id, B.activityLogId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(activityLog).values({
        firmId: B.firmId,
        entityType: "team",
        entityId: B.teamId,
        action: "created",
      }),
  },
  {
    table: "invitations",
    visibleFirmIds: (db) =>
      db
        .select({ f: invitations.firmId })
        .from(invitations)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(invitations)
        .set({ title: "hacked" })
        .where(eq(invitations.id, B.invitationId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: invitations.title })
        .from(invitations)
        .where(eq(invitations.id, B.invitationId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(invitations).values({
        firmId: B.firmId,
        email: `sneaky-${randomUUID()}@example.com`,
        appRole: "owner",
      }),
  },
  {
    table: "firm_roles",
    visibleFirmIds: (db) =>
      db
        .select({ f: firmRoles.firmId })
        .from(firmRoles)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(firmRoles)
        .set({ name: "hacked" })
        .where(eq(firmRoles.id, B.firmRoleId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: firmRoles.name })
        .from(firmRoles)
        .where(eq(firmRoles.id, B.firmRoleId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(firmRoles).values({ firmId: B.firmId, name: "Sneaky" }),
  },
  {
    table: "rates",
    visibleFirmIds: (db) =>
      db
        .select({ f: rates.firmId })
        .from(rates)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(rates)
        .set({ costRateCents: 1 })
        .where(eq(rates.id, B.rateId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: rates.costRateCents })
        .from(rates)
        .where(eq(rates.id, B.rateId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(rates).values({
        firmId: B.firmId,
        firmRoleId: B.firmRoleId,
        billRateCents: 1,
        costRateCents: 1,
        effectiveFrom: "2030-01-01",
      }),
  },
  {
    table: "phase_templates",
    visibleFirmIds: (db) =>
      db
        .select({ f: phaseTemplates.firmId })
        .from(phaseTemplates)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(phaseTemplates)
        .set({ name: "hacked" })
        .where(eq(phaseTemplates.id, B.phaseTemplateId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: phaseTemplates.name })
        .from(phaseTemplates)
        .where(eq(phaseTemplates.id, B.phaseTemplateId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db
        .insert(phaseTemplates)
        .values({ firmId: B.firmId, code: "ZZ", name: "Sneaky" }),
  },
  {
    table: "overhead_categories",
    visibleFirmIds: (db) =>
      db
        .select({ f: overheadCategories.firmId })
        .from(overheadCategories)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(overheadCategories)
        .set({ name: "hacked" })
        .where(eq(overheadCategories.id, B.overheadCategoryId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: overheadCategories.name })
        .from(overheadCategories)
        .where(eq(overheadCategories.id, B.overheadCategoryId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db
        .insert(overheadCategories)
        .values({ firmId: B.firmId, name: "Sneaky" }),
  },
  {
    table: "activities",
    visibleFirmIds: (db) =>
      db
        .select({ f: activities.firmId })
        .from(activities)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(activities)
        .set({ name: "hacked" })
        .where(eq(activities.id, B.activityId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: activities.name })
        .from(activities)
        .where(eq(activities.id, B.activityId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db
        .insert(activities)
        .values({ firmId: B.firmId, name: "Sneaky", appliesTo: "project" }),
  },
  {
    table: "companies",
    visibleFirmIds: (db) =>
      db
        .select({ f: companies.firmId })
        .from(companies)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(companies)
        .set({ name: "hacked" })
        .where(eq(companies.id, B.companyId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: companies.name })
        .from(companies)
        .where(eq(companies.id, B.companyId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(companies).values({ firmId: B.firmId, name: "Sneaky", kind: "client" }),
  },
  {
    table: "contacts",
    visibleFirmIds: (db) =>
      db
        .select({ f: contacts.firmId })
        .from(contacts)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(contacts)
        .set({ firstName: "hacked" })
        .where(eq(contacts.id, B.contactId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: contacts.firstName })
        .from(contacts)
        .where(eq(contacts.id, B.contactId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(contacts).values({ firmId: B.firmId, firstName: "Sneaky" }),
  },
  {
    table: "projects",
    visibleFirmIds: (db) =>
      db
        .select({ f: projects.firmId })
        .from(projects)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(projects)
        .set({ name: "hacked" })
        .where(eq(projects.id, B.projectId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: projects.name })
        .from(projects)
        .where(eq(projects.id, B.projectId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(projects).values({ firmId: B.firmId, number: "X-1", name: "Sneaky", clientCompanyId: B.companyId, projectType: "Office", principalMembershipId: B.membershipId, pmMembershipId: B.membershipId }),
  },
  {
    table: "project_phases",
    visibleFirmIds: (db) =>
      db
        .select({ f: projectPhases.firmId })
        .from(projectPhases)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(projectPhases)
        .set({ name: "hacked" })
        .where(eq(projectPhases.id, B.projectPhaseId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: projectPhases.name })
        .from(projectPhases)
        .where(eq(projectPhases.id, B.projectPhaseId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(projectPhases).values({ firmId: B.firmId, projectId: B.projectId, code: "X", name: "Sneaky", sortOrder: 9, feeType: "fixed" }),
  },
  {
    table: "project_members",
    visibleFirmIds: (db) =>
      db
        .select({ f: projectMembers.firmId })
        .from(projectMembers)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(projectMembers)
        .set({ projectRole: "hacked" })
        .where(eq(projectMembers.id, B.projectMemberId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: projectMembers.projectRole })
        .from(projectMembers)
        .where(eq(projectMembers.id, B.projectMemberId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(projectMembers).values({ firmId: B.firmId, projectId: B.projectId, membershipId: B.membershipId, projectRole: "PA" }),
  },
  {
    table: "project_contacts",
    visibleFirmIds: (db) =>
      db
        .select({ f: projectContacts.firmId })
        .from(projectContacts)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(projectContacts)
        .set({ role: "hacked" })
        .where(eq(projectContacts.id, B.projectContactId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: projectContacts.role })
        .from(projectContacts)
        .where(eq(projectContacts.id, B.projectContactId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(projectContacts).values({ firmId: B.firmId, projectId: B.projectId, companyId: B.companyId }),
  },
  {
    table: "consultants",
    visibleFirmIds: (db) =>
      db
        .select({ f: consultants.firmId })
        .from(consultants)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(consultants)
        .set({ discipline: "hacked" })
        .where(eq(consultants.id, B.consultantId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: consultants.discipline })
        .from(consultants)
        .where(eq(consultants.id, B.consultantId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(consultants).values({ firmId: B.firmId, projectId: B.projectId, companyId: B.companyId, discipline: "Sneaky" }),
  },
  {
    table: "phase_template_roles",
    visibleFirmIds: (db) =>
      db
        .select({ f: phaseTemplateRoles.firmId })
        .from(phaseTemplateRoles)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(phaseTemplateRoles)
        .set({ shareBp: 1 })
        .where(eq(phaseTemplateRoles.id, B.templateRoleId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: phaseTemplateRoles.shareBp })
        .from(phaseTemplateRoles)
        .where(eq(phaseTemplateRoles.id, B.templateRoleId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(phaseTemplateRoles).values({ firmId: B.firmId, phaseTemplateId: B.phaseTemplateId, firmRoleId: B.firmRoleId, shareBp: 1 }),
  },
  {
    table: "project_phase_roles",
    visibleFirmIds: (db) =>
      db
        .select({ f: projectPhaseRoles.firmId })
        .from(projectPhaseRoles)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db
        .update(projectPhaseRoles)
        .set({ shareBp: 1 })
        .where(eq(projectPhaseRoles.id, B.phaseRoleId))
        .returning(),
    readB: (db) =>
      db
        .select({ v: projectPhaseRoles.shareBp })
        .from(projectPhaseRoles)
        .where(eq(projectPhaseRoles.id, B.phaseRoleId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(projectPhaseRoles).values({ firmId: B.firmId, projectPhaseId: B.projectPhaseId, firmRoleId: B.firmRoleId, shareBp: 1 }),
  },
  {
    table: "timesheets",
    visibleFirmIds: (db) =>
      db
        .select({ f: timesheets.firmId })
        .from(timesheets)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db.update(timesheets).set({ rejectionNote: "hacked" }).where(eq(timesheets.id, BT.timesheetId)).returning(),
    readB: (db) =>
      db
        .select({ v: timesheets.rejectionNote })
        .from(timesheets)
        .where(eq(timesheets.id, BT.timesheetId))
        .then((r) => r[0]?.v),
    insertForB: (db) => db.insert(timesheets).values({ firmId: B.firmId, membershipId: B.membershipId, weekStart: "2026-10-19" }),
  },
  {
    table: "timesheet_rows",
    visibleFirmIds: (db) =>
      db
        .select({ f: timesheetRows.firmId })
        .from(timesheetRows)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) => db.update(timesheetRows).set({ sortOrder: 99 }).where(eq(timesheetRows.id, BT.rowId)).returning(),
    readB: (db) =>
      db
        .select({ v: timesheetRows.sortOrder })
        .from(timesheetRows)
        .where(eq(timesheetRows.id, BT.rowId))
        .then((r) => r[0]?.v),
    insertForB: (db) => db.insert(timesheetRows).values({ firmId: B.firmId, timesheetId: BT.timesheetId }),
  },
  {
    table: "time_entries",
    visibleFirmIds: (db) =>
      db
        .select({ f: timeEntries.firmId })
        .from(timeEntries)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) => db.update(timeEntries).set({ hours: "24" }).where(eq(timeEntries.id, BT.entryId)).returning(),
    readB: (db) =>
      db
        .select({ v: timeEntries.hours })
        .from(timeEntries)
        .where(eq(timeEntries.id, BT.entryId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(timeEntries).values({ firmId: B.firmId, timesheetId: BT.timesheetId, timesheetRowId: BT.rowId, workDate: "2026-10-13", hours: "1" }),
  },
  {
    table: "review_steps",
    visibleFirmIds: (db) =>
      db
        .select({ f: reviewSteps.firmId })
        .from(reviewSteps)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) => db.update(reviewSteps).set({ sortOrder: 99 }).where(eq(reviewSteps.id, BT.routeStepId)).returning(),
    readB: (db) =>
      db
        .select({ v: reviewSteps.sortOrder })
        .from(reviewSteps)
        .where(eq(reviewSteps.id, BT.routeStepId))
        .then((r) => r[0]?.v),
    insertForB: (db) => db.insert(reviewSteps).values({ firmId: B.firmId, sortOrder: 5, kind: "any_principal" }),
  },
  {
    table: "timesheet_review_steps",
    visibleFirmIds: (db) =>
      db
        .select({ f: timesheetReviewSteps.firmId })
        .from(timesheetReviewSteps)
        .then((r) => r.map((x) => x.f)),
    updateB: (db) =>
      db.update(timesheetReviewSteps).set({ stepNo: 99 }).where(eq(timesheetReviewSteps.id, BT.reviewRowId)).returning(),
    readB: (db) =>
      db
        .select({ v: timesheetReviewSteps.stepNo })
        .from(timesheetReviewSteps)
        .where(eq(timesheetReviewSteps.id, BT.reviewRowId))
        .then((r) => r[0]?.v),
    insertForB: (db) =>
      db.insert(timesheetReviewSteps).values({ firmId: B.firmId, timesheetId: BT.timesheetId, stepNo: 2, kind: "any_principal" }),
  },
];

describe("database role", () => {
  it("the app connects as a role that cannot bypass row-level security", async () => {
    const result = await getDb().execute<{
      rolbypassrls: boolean;
      rolsuper: boolean;
    }>(
      sql`select rolbypassrls, rolsuper from pg_roles where rolname = current_user`,
    );
    expect(result.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });

  it("withFirm rejects a firm id that isn't a uuid", async () => {
    await expect(withFirm("not-a-uuid", async () => 1)).rejects.toThrow();
  });
});

describe.each(cases)("$table: firm isolation", (c) => {
  it("Firm A sees its own row and not Firm B's", async () => {
    const ids = await withFirm(A.firmId, c.visibleFirmIds);
    expect(ids).toContain(A.firmId);
    expect(ids).not.toContain(B.firmId);
    expect(new Set(ids)).toEqual(new Set([A.firmId]));
  });

  it("Firm A cannot update Firm B's row", async () => {
    const before = await withFirm(B.firmId, c.readB);
    const changed = await withFirm(A.firmId, c.updateB);
    expect(changed).toHaveLength(0);
    expect(await withFirm(B.firmId, c.readB)).toEqual(before);
    expect(before).not.toBe("hacked");
  });

  it("Firm A cannot create a row for another firm", async () => {
    await expectDbError(withFirm(A.firmId, c.insertForB), /row-level security/);
  });

  it("returns nothing when no firm is selected", async () => {
    const ids = await getDb().transaction((tx) => c.visibleFirmIds(tx));
    expect(ids).toEqual([]);
  });
});

describe("other guards", () => {
  it("a time entry can't hang off another firm's timesheet, row or phase", async () => {
    const at = (await withFirm(A.firmId, (db) => db.select().from(timesheets)))[0];
    await expectDbError(
      withFirm(A.firmId, (db) =>
        db.insert(timeEntries).values({ firmId: A.firmId, timesheetId: at.id, timesheetRowId: BT.rowId, workDate: "2026-10-14", hours: "1" }),
      ),
      /foreign key/,
    );
    await expectDbError(
      withFirm(A.firmId, (db) =>
        db.insert(timesheetRows).values({ firmId: A.firmId, timesheetId: at.id, rowType: "project", projectId: B.projectId, projectPhaseId: B.projectPhaseId }),
      ),
      /foreign key/,
    );
  });

  it("hours must be over 0, at most 24 and in quarter hours", async () => {
    const at = (await withFirm(A.firmId, (db) => db.select().from(timesheetRows)))[0];
    for (const hours of ["1.3", "0", "24.25"])
      await expectDbError(
        withFirm(A.firmId, (db) =>
          db.insert(timeEntries).values({ firmId: A.firmId, timesheetId: at.timesheetId, timesheetRowId: at.id, workDate: "2026-10-15", hours }),
        ),
        /time_entries_hours_range/,
      );
  });

  it("a membership can't point at another firm's team", async () => {
    await expectDbError(
      withFirm(A.firmId, (db) =>
        db
          .update(memberships)
          .set({ teamId: B.teamId })
          .where(eq(memberships.id, A.membershipId)),
      ),
      /foreign key/,
    );
  });

  it("a membership can't point at another firm's role", async () => {
    await expectDbError(
      withFirm(A.firmId, (db) =>
        db
          .update(memberships)
          .set({ firmRoleId: B.firmRoleId })
          .where(eq(memberships.id, A.membershipId)),
      ),
      /foreign key/,
    );
  });

  it("a project can't use another firm's client or people", async () => {
    const base = { firmId: A.firmId, number: "X-2", name: "X", projectType: "Office" };
    await expectDbError(
      withFirm(A.firmId, (db) =>
        db.insert(projects).values({ ...base, clientCompanyId: B.companyId, principalMembershipId: A.membershipId, pmMembershipId: A.membershipId }),
      ),
      /foreign key/,
    );
    await expectDbError(
      withFirm(A.firmId, (db) =>
        db.insert(projects).values({ ...base, clientCompanyId: A.companyId, principalMembershipId: A.membershipId, pmMembershipId: B.membershipId }),
      ),
      /foreign key/,
    );
  });

  it("a phase or team row can't hang off another firm's project", async () => {
    await expectDbError(
      withFirm(A.firmId, (db) =>
        db.insert(projectPhases).values({ firmId: A.firmId, projectId: B.projectId, code: "X", name: "X", sortOrder: 1, feeType: "fixed" }),
      ),
      /foreign key/,
    );
    await expectDbError(
      withFirm(A.firmId, (db) =>
        db.insert(projectMembers).values({ firmId: A.firmId, projectId: A.projectId, membershipId: B.membershipId, projectRole: "PA" }),
      ),
      /foreign key/,
    );
    await expectDbError(
      withFirm(A.firmId, (db) =>
        db.insert(projectContacts).values({ firmId: A.firmId, projectId: A.projectId, companyId: B.companyId }),
      ),
      /foreign key/,
    );
  });

  it("a consultant can't use another firm's project, company or contact", async () => {
    const base = { firmId: A.firmId, discipline: "MEP" };
    for (const v of [
      { ...base, projectId: B.projectId, companyId: A.companyId },
      { ...base, projectId: A.projectId, companyId: B.companyId },
      { ...base, projectId: A.projectId, companyId: A.companyId, contactId: B.contactId },
    ])
      await expectDbError(withFirm(A.firmId, (db) => db.insert(consultants).values(v)), /foreign key/);
  });

  it("a role mix can't use another firm's role, template or phase", async () => {
    for (const q of [
      (db: Parameters<Parameters<typeof withFirm>[1]>[0]) =>
        db.insert(phaseTemplateRoles).values({ firmId: A.firmId, phaseTemplateId: A.phaseTemplateId, firmRoleId: B.firmRoleId, shareBp: 1 }),
      (db: Parameters<Parameters<typeof withFirm>[1]>[0]) =>
        db.insert(phaseTemplateRoles).values({ firmId: A.firmId, phaseTemplateId: B.phaseTemplateId, firmRoleId: A.firmRoleId, shareBp: 1 }),
      (db: Parameters<Parameters<typeof withFirm>[1]>[0]) =>
        db.insert(projectPhaseRoles).values({ firmId: A.firmId, projectPhaseId: B.projectPhaseId, firmRoleId: A.firmRoleId, shareBp: 1 }),
    ])
      await expectDbError(withFirm(A.firmId, q), /foreign key/);
  });

  it("a contact can't belong to another firm's company", async () => {
    await expectDbError(
      withFirm(A.firmId, (db) =>
        db.insert(contacts).values({ firmId: A.firmId, firstName: "X", companyId: B.companyId }),
      ),
      /foreign key/,
    );
  });

  it("a company's billing contact can't be another firm's contact", async () => {
    await expectDbError(
      withFirm(A.firmId, (db) =>
        db.update(companies).set({ billingContactId: B.contactId }).where(eq(companies.id, A.companyId)),
      ),
      /foreign key/,
    );
  });

  it("an activity can't point at another firm's overhead phase", async () => {
    await expectDbError(
      withFirm(A.firmId, (db) =>
        db.insert(activities).values({
          firmId: A.firmId,
          name: "Sneaky",
          appliesTo: "overhead",
          overheadCategoryId: B.overheadCategoryId,
        }),
      ),
      /foreign key/,
    );
  });

  it("a role's rate periods can't overlap", async () => {
    // A's Designer rate runs from 2026-01-01 with no end date.
    await expectDbError(
      withFirm(A.firmId, (db) =>
        db.insert(rates).values({
          firmId: A.firmId,
          firmRoleId: A.firmRoleId,
          billRateCents: 12000,
          costRateCents: 4400,
          effectiveFrom: "2026-11-01",
        }),
      ),
      /rates_role_no_overlap/,
    );
  });

  it("new firms get the default setup lists", async () => {
    const counts = await withFirm(A.firmId, async (db) => ({
      phases: (await db.select().from(phaseTemplates)).length,
      activities: (await db.select().from(activities)).length,
      categories: (await db.select().from(overheadCategories)).length,
    }));
    // 7 phases; 13 project + 13 overhead + 3 leave + 1 holiday activities;
    // 4 overhead phases + PTO + Holiday.
    expect(counts).toEqual({ phases: 7, activities: 30, categories: 6 });
  });

  it("the app can't hard-delete rows", async () => {
    await expectDbError(
      withFirm(A.firmId, (db) =>
        db.delete(teams).where(eq(teams.id, A.teamId)),
      ),
      /permission denied/,
    );
  });

  it("Firm A can update its own rows (the rules don't block normal work)", async () => {
    const changed = await withFirm(A.firmId, (db) =>
      db
        .update(teams)
        .set({ sortOrder: 5 })
        .where(eq(teams.id, A.teamId))
        .returning(),
    );
    expect(changed).toHaveLength(1);
  });

  it("firm_id_for_clerk_org finds a firm from its Clerk organization", async () => {
    const result = await getDb().execute<{ id: string | null }>(
      sql`select firm_id_for_clerk_org(${A.clerkOrgId}) as id`,
    );
    expect(result.rows[0].id).toBe(A.firmId);
  });
});
