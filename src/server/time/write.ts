import { and, eq, inArray, isNull, max, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  activities,
  activityLog,
  overheadCategories,
  projectPhases,
  projects,
  timeEntries,
  timesheetRows,
  timesheets,
} from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { requireCan } from "@/lib/auth/permissions";
import {
  COPY_NO_SOURCE,
  MAX_DAY_HOURS,
  NOTE_MAX,
  NOTE_TOO_LONG,
  type TimesheetStatus,
  addDays,
  cleanNote,
  copyMessage,
  copyPlan,
  dayLimitMessage,
  isEditable,
  isIsoDate,
  isQuarterHours,
  rowTotal,
  submitProblems,
  weekStartOf,
} from "@/lib/calc/timesheet";
import { canRecallReview } from "@/lib/calc/review-route";
import { todayIn } from "@/lib/format";
import { archiveReview, loadReview, startReview } from "./review";
import { type TimeContext, type TimesheetView, WEEKS_AHEAD, findTimesheet, loadWeek } from "./week";

// Timesheet writes (timesheet spec, Actions). Every one: permission → Zod →
// load the caller's own timesheet (another person's is "not found") → check
// it's editable (rule 2) → write → activity_log → the updated week.

export const TIME_MESSAGES = {
  notFound: "That timesheet wasn't found.",
  locked: (status: TimesheetStatus) =>
    `This timesheet is ${status === "approved" ? "approved" : "submitted"} and can't be changed.`,
  badWeek: "That isn't a week you can change.",
  closedPhase: "That phase is closed. Pick an open phase.",
  badPhase: "That phase isn't on this project.",
  badActivity: "That activity can't be used on this row.",
  badProject: "That project isn't open for time.",
  badCategory: "That phase can't be used on this row.",
  pickFirst: "Pick a project, overhead or leave first.",
  noBillingChange: "Overhead and leave are always non-billable.",
  badHours: "Hours must be more than 0, at most 24, in quarter hours.",
  cantRecall: "This timesheet can't be recalled now.",
  noTimesheet: "Add your hours before submitting.",
  saveFailed: "Couldn't save. Try again.",
  noteTooLong: NOTE_TOO_LONG,
  noteNeedsHours: "Add hours to this day before adding a note.",
  noSource: COPY_NO_SOURCE,
} as const;

export type TimeResult =
  /** `message` is a toast to show (Copy last week). */
  | { ok: true; data: TimesheetView; message?: string }
  /** `data` is the week as it is now, so the page can reload it. */
  | { ok: false; error: string; data?: TimesheetView };

const weekInput = z.object({ weekStart: z.string().refine(isIsoDate) });
const uuid = z.uuid();

/** A refusal with a message for the person; the action returns it as an error. */
class TimeError extends Error {}

type Sheet = typeof timesheets.$inferSelect;

function checkWeek(ctx: TimeContext, weekStart: string) {
  const current = weekStartOf(todayIn(ctx.timezone), ctx.weekStartsOn);
  if (weekStartOf(weekStart, ctx.weekStartsOn) !== weekStart || weekStart > addDays(current, 7 * WEEKS_AHEAD))
    throw new TimeError(TIME_MESSAGES.badWeek);
}

/** The caller's timesheet for the week, created as a draft on the first write. Locked for this transaction. */
async function sheetForWeek(db: TenantDb, ctx: TimeContext, weekStart: string): Promise<Sheet> {
  checkWeek(ctx, weekStart);
  await db
    .insert(timesheets)
    .values({ firmId: ctx.firmId, membershipId: ctx.membershipId, weekStart })
    .onConflictDoNothing({ target: [timesheets.membershipId, timesheets.weekStart] })
    .returning({ id: timesheets.id })
    .then(async (created) => {
      if (created[0]) await log(db, ctx, "timesheet", created[0].id, "created", { weekStart });
    });
  const [sheet] = await db
    .select()
    .from(timesheets)
    .where(and(eq(timesheets.membershipId, ctx.membershipId), eq(timesheets.weekStart, weekStart)))
    .for("update");
  return sheet;
}

/** A row on the caller's own timesheet, with its timesheet locked. Others' rows are "not found". */
async function ownRow(db: TenantDb, ctx: TimeContext, rowId: string) {
  const [found] = await db
    .select({ sheetId: timesheetRows.timesheetId })
    .from(timesheetRows)
    .where(and(eq(timesheetRows.id, rowId), isNull(timesheetRows.archivedAt)));
  if (!found) throw new TimeError(TIME_MESSAGES.notFound);
  const [sheet] = await db.select().from(timesheets).where(eq(timesheets.id, found.sheetId)).for("update");
  if (!sheet || sheet.membershipId !== ctx.membershipId) throw new TimeError(TIME_MESSAGES.notFound);
  const [row] = await db.select().from(timesheetRows).where(eq(timesheetRows.id, rowId));
  return { sheet, row };
}

function mustBeEditable(sheet: Sheet) {
  if (!isEditable(sheet.status)) throw new TimeError(TIME_MESSAGES.locked(sheet.status));
}

function log(db: TenantDb, ctx: TimeContext, entityType: string, entityId: string, action: string, changes?: Record<string, unknown>) {
  return db.insert(activityLog).values({ firmId: ctx.firmId, actorUserId: ctx.userId, entityType, entityId, action, changes });
}

/** Copy the row's selection onto its hours, so reports read time_entries alone (rule 3). */
async function syncEntries(db: TenantDb, row: typeof timesheetRows.$inferSelect) {
  await db
    .update(timeEntries)
    .set({
      projectId: row.projectId,
      projectPhaseId: row.projectPhaseId,
      overheadCategoryId: row.overheadCategoryId,
      activityId: row.activityId,
      billable: row.billable,
    })
    .where(and(eq(timeEntries.timesheetRowId, row.id), isNull(timeEntries.archivedAt)));
}

/**
 * Run one write in the firm's transaction and return the week. A refusal
 * rolls everything back and returns the message, plus the week as it is now
 * so the page can put back what it showed (a cell over 24 h, a locked sheet).
 */
async function run(
  ctx: TimeContext,
  write: (db: TenantDb, setWeek: (w: string) => void) => Promise<{ weekStart: string; message?: string }>,
): Promise<TimeResult> {
  let week: string | null = null;
  try {
    return await withFirm(ctx.firmId, async (db) => {
      const done = await write(db, (w) => (week = w));
      return { ok: true as const, data: await loadWeek(db, ctx, done.weekStart), message: done.message };
    });
  } catch (err) {
    if (!(err instanceof TimeError)) console.error("timesheet write failed", err);
    const error = err instanceof TimeError ? err.message : TIME_MESSAGES.saveFailed;
    const data = week ? await withFirm(ctx.firmId, (db) => loadWeek(db, ctx, week!)).catch(() => undefined) : undefined;
    return { ok: false, error, data };
  }
}

export type TimeActor = TimeContext & {
  member: { appRole: "owner" | "admin" | "project_manager" | "staff"; active: boolean };
};

function allowed(actor: TimeActor) {
  requireCan(actor.member, "time.enter_own");
}

// ---------- Load ----------

export async function loadWeekCore(actor: TimeActor, weekStart: string) {
  allowed(actor);
  return withFirm(actor.firmId, (db) => loadWeek(db, actor, weekStart));
}

// ---------- Rows ----------

/** Add row: an unset row at the bottom. */
export async function addRowCore(actor: TimeActor, raw: unknown): Promise<TimeResult> {
  allowed(actor);
  const parsed = weekInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: TIME_MESSAGES.badWeek };
  return run(actor, async (db, setWeek) => {
    setWeek(parsed.data.weekStart);
    const sheet = await sheetForWeek(db, actor, parsed.data.weekStart);
    mustBeEditable(sheet);
    const [{ last }] = await db
      .select({ last: max(timesheetRows.sortOrder) })
      .from(timesheetRows)
      .where(and(eq(timesheetRows.timesheetId, sheet.id), isNull(timesheetRows.archivedAt)));
    const [row] = await db
      .insert(timesheetRows)
      .values({ firmId: actor.firmId, timesheetId: sheet.id, sortOrder: (last ?? 0) + 1 })
      .returning({ id: timesheetRows.id });
    await log(db, actor, "timesheet_row", row.id, "created", { timesheetId: sheet.id });
    return { weekStart: sheet.weekStart };
  });
}

const pick = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), projectId: uuid }),
  z.object({ kind: z.literal("overhead") }),
  z.object({ kind: z.literal("leave"), categoryId: uuid }),
]);
const updateRowInput = z.object({
  rowId: uuid,
  change: z.discriminatedUnion("type", [
    z.object({ type: z.literal("pick"), pick }),
    /** Project rows: a phase. Overhead rows: an overhead category. */
    z.object({ type: z.literal("phase"), id: uuid.nullable() }),
    z.object({ type: z.literal("activity"), id: uuid.nullable() }),
    z.object({ type: z.literal("billable"), value: z.boolean() }),
  ]),
});

async function activeActivity(db: TenantDb, id: string) {
  const [a] = await db.select().from(activities).where(and(eq(activities.id, id), eq(activities.active, true)));
  return a ?? null;
}

/** Choose project / overhead / leave, change phase, activity or billing. */
export async function updateRowCore(actor: TimeActor, raw: unknown): Promise<TimeResult> {
  allowed(actor);
  const parsed = updateRowInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: TIME_MESSAGES.saveFailed };
  const { rowId, change } = parsed.data;
  return run(actor, async (db, setWeek) => {
    const { sheet, row } = await ownRow(db, actor, rowId);
    setWeek(sheet.weekStart);
    mustBeEditable(sheet);
    const next = { ...row };

    if (change.type === "pick") {
      const p = change.pick;
      next.projectId = null;
      next.projectPhaseId = null;
      next.overheadCategoryId = null;
      next.activityId = null;
      if (p.kind === "project") {
        const [project] = await db
          .select()
          .from(projects)
          .where(and(eq(projects.id, p.projectId), eq(projects.status, "active"), isNull(projects.archivedAt)));
        if (!project) throw new TimeError(TIME_MESSAGES.badProject);
        // The project's current phase (lowest sort order), else none.
        const [current] = await db
          .select({ id: projectPhases.id })
          .from(projectPhases)
          .where(and(eq(projectPhases.projectId, project.id), eq(projectPhases.status, "current"), isNull(projectPhases.archivedAt)))
          .orderBy(projectPhases.sortOrder)
          .limit(1);
        Object.assign(next, { rowType: "project", projectId: project.id, projectPhaseId: current?.id ?? null, billable: true });
      } else if (p.kind === "overhead") {
        Object.assign(next, { rowType: "overhead", billable: false });
      } else {
        const [category] = await db
          .select()
          .from(overheadCategories)
          .where(and(eq(overheadCategories.id, p.categoryId), eq(overheadCategories.isLeave, true), eq(overheadCategories.active, true)));
        if (!category) throw new TimeError(TIME_MESSAGES.badCategory);
        const acts = await db
          .select({ id: activities.id })
          .from(activities)
          .where(and(eq(activities.overheadCategoryId, category.id), eq(activities.active, true)));
        Object.assign(next, {
          rowType: "leave",
          overheadCategoryId: category.id,
          activityId: acts.length === 1 ? acts[0].id : null,
          billable: false,
        });
      }
    } else if (!row.rowType) {
      throw new TimeError(TIME_MESSAGES.pickFirst);
    } else if (change.type === "phase") {
      if (row.rowType === "project") {
        if (change.id) {
          const [phase] = await db
            .select({ id: projectPhases.id, projectId: projectPhases.projectId, status: projectPhases.status, projectStatus: projects.status })
            .from(projectPhases)
            .innerJoin(projects, eq(projects.id, projectPhases.projectId))
            .where(and(eq(projectPhases.id, change.id), isNull(projectPhases.archivedAt)));
          if (!phase || phase.projectId !== row.projectId) throw new TimeError(TIME_MESSAGES.badPhase);
          if (phase.status === "closed" || phase.projectStatus === "closed") throw new TimeError(TIME_MESSAGES.closedPhase);
        }
        next.projectPhaseId = change.id;
      } else if (row.rowType === "overhead") {
        if (change.id) {
          const [category] = await db
            .select()
            .from(overheadCategories)
            .where(and(eq(overheadCategories.id, change.id), eq(overheadCategories.isLeave, false), eq(overheadCategories.active, true)));
          if (!category) throw new TimeError(TIME_MESSAGES.badCategory);
        }
        next.overheadCategoryId = change.id;
        // The activity belongs to the old phase: clear it.
        if (next.activityId) {
          const a = await activeActivity(db, next.activityId);
          if (!a || a.overheadCategoryId !== change.id) next.activityId = null;
        }
      } else {
        throw new TimeError(TIME_MESSAGES.badCategory);
      }
    } else if (change.type === "activity") {
      if (change.id) {
        const a = await activeActivity(db, change.id);
        const fits =
          a &&
          (row.rowType === "project"
            ? a.appliesTo === "project"
            : a.appliesTo === "overhead" && a.overheadCategoryId === row.overheadCategoryId && row.overheadCategoryId !== null);
        if (!fits) throw new TimeError(TIME_MESSAGES.badActivity);
      }
      next.activityId = change.id;
    } else {
      if (row.rowType !== "project") throw new TimeError(TIME_MESSAGES.noBillingChange);
      next.billable = change.value;
    }

    const [saved] = await db
      .update(timesheetRows)
      .set({
        rowType: next.rowType,
        projectId: next.projectId,
        projectPhaseId: next.projectPhaseId,
        overheadCategoryId: next.overheadCategoryId,
        activityId: next.activityId,
        billable: next.billable,
      })
      .where(eq(timesheetRows.id, row.id))
      .returning();
    await syncEntries(db, saved);
    const changes: Record<string, { before: unknown; after: unknown }> = {};
    for (const k of ["rowType", "projectId", "projectPhaseId", "overheadCategoryId", "activityId", "billable"] as const)
      if (row[k] !== saved[k]) changes[k] = { before: row[k], after: saved[k] };
    if (Object.keys(changes).length) await log(db, actor, "timesheet_row", row.id, "updated", changes);
    return { weekStart: sheet.weekStart };
  });
}

/** Remove row: archives the row and its hours (the page confirms first when it has hours). */
export async function removeRowCore(actor: TimeActor, raw: unknown): Promise<TimeResult> {
  allowed(actor);
  const parsed = z.object({ rowId: uuid }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: TIME_MESSAGES.saveFailed };
  return run(actor, async (db, setWeek) => {
    const { sheet, row } = await ownRow(db, actor, parsed.data.rowId);
    setWeek(sheet.weekStart);
    mustBeEditable(sheet);
    const now = new Date();
    const gone = await db
      .update(timeEntries)
      .set({ archivedAt: now })
      .where(and(eq(timeEntries.timesheetRowId, row.id), isNull(timeEntries.archivedAt)))
      .returning({ hours: timeEntries.hours });
    await db.update(timesheetRows).set({ archivedAt: now }).where(eq(timesheetRows.id, row.id));
    await log(db, actor, "timesheet_row", row.id, "archived", { hours: gone.reduce((a, e) => a + Number(e.hours), 0) });
    return { weekStart: sheet.weekStart };
  });
}

// ---------- Hours ----------

const setHoursInput = z.object({
  rowId: uuid,
  workDate: z.string().refine(isIsoDate),
  /** Null or 0 clears the day. */
  hours: z
    .number()
    .nullable()
    .refine((h) => h === null || h === 0 || (h > 0 && h <= MAX_DAY_HOURS && isQuarterHours(h)), TIME_MESSAGES.badHours),
});

/** Type hours: upserts or clears the entry for (row, day) (rules 6–8). */
export async function setHoursCore(actor: TimeActor, raw: unknown): Promise<TimeResult> {
  allowed(actor);
  const parsed = setHoursInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: TIME_MESSAGES.badHours };
  const { rowId, workDate } = parsed.data;
  const hours = parsed.data.hours || null;
  return run(actor, async (db, setWeek) => {
    const { sheet, row } = await ownRow(db, actor, rowId);
    setWeek(sheet.weekStart);
    mustBeEditable(sheet);
    if (workDate < sheet.weekStart || workDate > addDays(sheet.weekStart, 6)) throw new TimeError(TIME_MESSAGES.badWeek);
    if (!row.rowType) throw new TimeError(TIME_MESSAGES.pickFirst);

    const [existing] = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.timesheetRowId, row.id), eq(timeEntries.workDate, workDate), isNull(timeEntries.archivedAt)));

    if (hours === null) {
      if (existing) {
        await db.update(timeEntries).set({ archivedAt: new Date() }).where(eq(timeEntries.id, existing.id));
        await log(db, actor, "time_entry", existing.id, "archived", { hours: { before: Number(existing.hours), after: null } });
      }
      return { weekStart: sheet.weekStart };
    }

    // No hours on a closed phase or project (rule 4).
    if (row.projectPhaseId) {
      const [phase] = await db
        .select({ status: projectPhases.status, projectStatus: projects.status })
        .from(projectPhases)
        .innerJoin(projects, eq(projects.id, projectPhases.projectId))
        .where(eq(projectPhases.id, row.projectPhaseId));
      if (phase?.status === "closed" || phase?.projectStatus === "closed") throw new TimeError(TIME_MESSAGES.closedPhase);
    }

    // A day can't pass 24 h across all rows (rule 7).
    const [{ other }] = await db
      .select({ other: sql<string>`coalesce(sum(${timeEntries.hours}), 0)` })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.timesheetId, sheet.id),
          eq(timeEntries.workDate, workDate),
          isNull(timeEntries.archivedAt),
          ne(timeEntries.timesheetRowId, row.id),
        ),
      );
    const dayTotal = Number(other) + hours;
    if (dayTotal > MAX_DAY_HOURS) throw new TimeError(dayLimitMessage(workDate, dayTotal));

    const selection = {
      projectId: row.projectId,
      projectPhaseId: row.projectPhaseId,
      overheadCategoryId: row.overheadCategoryId,
      activityId: row.activityId,
      billable: row.billable,
    };
    if (existing) {
      if (Number(existing.hours) !== hours) {
        await db.update(timeEntries).set({ hours: String(hours), ...selection }).where(eq(timeEntries.id, existing.id));
        await log(db, actor, "time_entry", existing.id, "updated", { hours: { before: Number(existing.hours), after: hours } });
      }
    } else {
      const [entry] = await db
        .insert(timeEntries)
        .values({ firmId: actor.firmId, timesheetId: sheet.id, timesheetRowId: row.id, workDate, hours: String(hours), ...selection })
        .returning({ id: timeEntries.id });
      await log(db, actor, "time_entry", entry.id, "created", { workDate, hours });
    }
    return { weekStart: sheet.weekStart };
  });
}

// ---------- Notes ----------

const setNoteInput = z.object({
  rowId: uuid,
  workDate: z.string().refine(isIsoDate),
  note: z.string().nullable(),
});

/** Edit note: saved on the day's entry, so only on a day with hours (rule 10h). */
export async function setNoteCore(actor: TimeActor, raw: unknown): Promise<TimeResult> {
  allowed(actor);
  const parsed = setNoteInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: TIME_MESSAGES.saveFailed };
  const note = cleanNote(parsed.data.note);
  if (note && note.length > NOTE_MAX) return { ok: false, error: TIME_MESSAGES.noteTooLong };
  return run(actor, async (db, setWeek) => {
    const { sheet, row } = await ownRow(db, actor, parsed.data.rowId);
    setWeek(sheet.weekStart);
    mustBeEditable(sheet);
    const [entry] = await db
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.timesheetRowId, row.id), eq(timeEntries.workDate, parsed.data.workDate), isNull(timeEntries.archivedAt)));
    if (!entry) {
      // Clearing a note on an empty day is nothing to do.
      if (!note) return { weekStart: sheet.weekStart };
      throw new TimeError(TIME_MESSAGES.noteNeedsHours);
    }
    if (entry.note !== note) {
      await db.update(timeEntries).set({ note }).where(eq(timeEntries.id, entry.id));
      await log(db, actor, "time_entry", entry.id, "updated", { note: { before: entry.note, after: note } });
    }
    return { weekStart: sheet.weekStart };
  });
}

// ---------- Copy last week ----------

/** Copy last week: adds last week's rows (no hours or notes) after this week's (rule 13). */
export async function copyLastWeekCore(actor: TimeActor, raw: unknown): Promise<TimeResult> {
  allowed(actor);
  const parsed = weekInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: TIME_MESSAGES.badWeek };
  const { weekStart } = parsed.data;
  return run(actor, async (db, setWeek) => {
    setWeek(weekStart);
    checkWeek(actor, weekStart);
    const lastWeek = addDays(weekStart, -7);
    const current = await findTimesheet(db, actor.membershipId, weekStart);
    if (current) mustBeEditable(current);
    // Nothing to copy: say so without starting a timesheet.
    if (!(await findTimesheet(db, actor.membershipId, lastWeek))) return { weekStart, message: COPY_NO_SOURCE };

    const sheet = await sheetForWeek(db, actor, weekStart);
    mustBeEditable(sheet);
    const [source, here] = [await loadWeek(db, actor, lastWeek), await loadWeek(db, actor, weekStart)];
    const projectIds = [...new Set(source.rows.flatMap((r) => (r.projectId ? [r.projectId] : [])))];
    const active = new Set(
      projectIds.length
        ? (
            await db
              .select({ id: projects.id })
              .from(projects)
              .where(and(inArray(projects.id, projectIds), eq(projects.status, "active"), isNull(projects.archivedAt)))
          ).map((p) => p.id)
        : [],
    );
    const plan = copyPlan(
      source.rows.map((r) => ({ ...r, projectActive: r.projectId ? active.has(r.projectId) : true })),
      here.rows,
    );

    let sortOrder = here.rows.reduce((m, r) => Math.max(m, r.sortOrder), 0);
    for (const r of plan.copy) {
      sortOrder += 1;
      const [created] = await db
        .insert(timesheetRows)
        .values({
          firmId: actor.firmId,
          timesheetId: sheet.id,
          sortOrder,
          rowType: r.rowType,
          projectId: r.projectId,
          projectPhaseId: r.projectPhaseId,
          overheadCategoryId: r.overheadCategoryId,
          activityId: r.activityId,
          billable: r.billable,
        })
        .returning({ id: timesheetRows.id });
      await log(db, actor, "timesheet_row", created.id, "created", { timesheetId: sheet.id, copiedFromRowId: r.id });
    }
    return { weekStart, message: copyMessage({ ...plan, copied: plan.copy.length }) };
  });
}

// ---------- Submit and recall ----------

/** Submit / Resubmit (rules 10 and 18). */
export async function submitTimesheetCore(actor: TimeActor, raw: unknown, now: Date = new Date()): Promise<TimeResult> {
  allowed(actor);
  const parsed = weekInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: TIME_MESSAGES.badWeek };
  return run(actor, async (db, setWeek) => {
    const { weekStart } = parsed.data;
    setWeek(weekStart);
    checkWeek(actor, weekStart);
    const existing = await findTimesheet(db, actor.membershipId, weekStart);
    if (!existing) throw new TimeError(TIME_MESSAGES.noTimesheet);
    const [sheet] = await db.select().from(timesheets).where(eq(timesheets.id, existing.id)).for("update");
    mustBeEditable(sheet);

    const view = await loadWeek(db, actor, weekStart, now);
    const problems = submitProblems(view.rows, {
      dates: view.dates,
      today: view.today,
      notesRule: actor.notesRule,
    });
    if (problems.length) throw new TimeError(problems[0]);

    // Empty rows are dropped on submit.
    const empty = view.rows.filter((r) => rowTotal(r) === 0).map((r) => r.id);
    for (const id of empty) await db.update(timesheetRows).set({ archivedAt: now }).where(eq(timesheetRows.id, id));

    // The firm's route becomes this sheet's review, or a principal's own
    // sheet is approved now with its rates frozen (rule 18; #22, #23).
    const started = await startReview(db, actor, sheet.id);
    if (!started.ok) throw new TimeError(started.message);
    const approved = started.status === "approved";
    await db
      .update(timesheets)
      .set({
        status: started.status,
        submittedAt: now,
        approvedAt: approved ? now : null,
        approvedBy: approved ? actor.userId : null,
        rejectionNote: null,
      })
      .where(eq(timesheets.id, sheet.id));
    await log(db, actor, "timesheet", sheet.id, "status_changed", {
      status: { before: sheet.status, after: started.status },
      ...(approved ? { auto: true } : { reviewRows: started.rows }),
      droppedRows: empty.length,
    });
    return { weekStart };
  });
}

/** Recall: back to draft while no reviewer has acted (rule 14). */
export async function recallTimesheetCore(actor: TimeActor, raw: unknown): Promise<TimeResult> {
  allowed(actor);
  const parsed = weekInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: TIME_MESSAGES.badWeek };
  return run(actor, async (db, setWeek) => {
    const { weekStart } = parsed.data;
    setWeek(weekStart);
    const existing = await findTimesheet(db, actor.membershipId, weekStart);
    if (!existing) throw new TimeError(TIME_MESSAGES.notFound);
    const [sheet] = await db.select().from(timesheets).where(eq(timesheets.id, existing.id)).for("update");
    if (!canRecallReview(sheet.status, await loadReview(db, sheet.id))) throw new TimeError(TIME_MESSAGES.cantRecall);
    await archiveReview(db, sheet.id, new Date());
    await db.update(timesheets).set({ status: "draft", submittedAt: null }).where(eq(timesheets.id, sheet.id));
    await log(db, actor, "timesheet", sheet.id, "status_changed", { status: { before: sheet.status, after: "draft" } });
    return { weekStart };
  });
}

