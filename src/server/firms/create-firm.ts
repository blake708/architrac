import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { activityLog, firmSettings, firms, memberships } from "@/db/schema";
import { type TenantDb, withFirm } from "@/db/tenant";
import { TIMEZONE_VALUES } from "@/lib/timezones";
import { type ClerkUserFacts, upsertUserIn } from "@/server/auth/users";

// Creating a firm (app-shell spec, business rule 6). The server action in
// actions.ts wires this to Clerk; tests call it with fake Clerk functions.

export const FIRM_NAME_MESSAGE = "Firm name must be 2–120 characters";
export const CREATE_FAILED_MESSAGE =
  "We couldn't create your firm. Nothing was saved. Try again.";

export const createFirmSchema = z.object({
  name: z
    .string({ error: FIRM_NAME_MESSAGE })
    .trim()
    .min(2, { error: FIRM_NAME_MESSAGE })
    .max(120, { error: FIRM_NAME_MESSAGE }),
  timezone: z.enum(TIMEZONE_VALUES, {
    error: "Pick a time zone from the list",
  }),
  fiscalYearStartMonth: z.coerce
    .number({ error: "Pick a month" })
    .int({ error: "Pick a month" })
    .min(1, { error: "Pick a month" })
    .max(12, { error: "Pick a month" }),
});

export type CreateFirmInput = z.infer<typeof createFirmSchema>;
type Field = keyof CreateFirmInput;

export type CreateFirmResult =
  | { ok: true; data: { firmId: string; clerkOrgId: string } }
  | { ok: false; error?: string; fieldErrors?: Partial<Record<Field, string>> };

export type CreateFirmDeps = {
  loadUser: () => Promise<ClerkUserFacts>;
  createOrg: (name: string) => Promise<string>;
  deleteOrg: (clerkOrgId: string) => Promise<void>;
};

/** "The Middleton Group, PLLC" → "the-middleton-group-pllc" */
export function slugify(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug || "firm";
}

function randomSuffix(): string {
  return randomBytes(3).toString("hex").slice(0, 4);
}

/** Insert the firm row; if the slug is taken, retry with a random suffix. */
async function insertFirm(
  db: TenantDb,
  firmId: string,
  clerkOrgId: string,
  input: CreateFirmInput,
) {
  const base = slugify(input.name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    const [row] = await db
      .insert(firms)
      .values({
        id: firmId,
        name: input.name,
        slug,
        clerkOrgId,
        timezone: input.timezone,
        fiscalYearStartMonth: input.fiscalYearStartMonth,
      })
      .onConflictDoNothing({ target: firms.slug })
      .returning({ id: firms.id });
    if (row) return;
  }
  throw new Error("Could not find a free slug for the firm");
}

export async function createFirmCore(
  raw: unknown,
  deps: CreateFirmDeps,
  now: Date = new Date(),
): Promise<CreateFirmResult> {
  // 0. Check the input before touching Clerk.
  const parsed = createFirmSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<Field, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as Field;
      fieldErrors[field] ??= issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const input = parsed.data;

  let clerkOrgId: string;
  try {
    const user = await deps.loadUser();

    // 1. Create the Clerk organization (this person becomes its admin).
    clerkOrgId = await deps.createOrg(input.name);

    // 2. Everything in our database, in one transaction. We pick the firm id
    //    up front so row-level security lets us write the new firm's rows.
    const firmId = randomUUID();
    try {
      await withFirm(firmId, async (db) => {
        await insertFirm(db, firmId, clerkOrgId, input);
        await db.insert(firmSettings).values({
          firmId,
          overheadRateBp: 6000,
          includeOverheadDefault: true,
          weekStartsOn: 1,
          timesheetIncrementMinutes: 15,
          timesheetLockDay: 1,
          invoicePrefix: `${now.getFullYear()}-`,
          nextInvoiceNumber: 1,
          defaultPaymentTermsDays: 30,
          modulesEnabled: [],
        });
        const me = await upsertUserIn(db, user);
        await db.insert(memberships).values({
          firmId,
          userId: me.id,
          appRole: "owner",
          title: "Principal",
          employmentType: "full_time",
          weeklyCapacityHours: "40",
          targetUtilizationBp: 8000,
          active: true,
          createdBy: me.id,
        });
        await db.insert(activityLog).values({
          firmId,
          actorUserId: me.id,
          entityType: "firm",
          entityId: firmId,
          action: "created",
          changes: { name: { to: input.name } },
        });
      });
    } catch (err) {
      // 3. The database step failed: remove the Clerk org so nothing is half-made.
      console.error("createFirm: database step failed", err);
      await deps.deleteOrg(clerkOrgId).catch((cleanupErr: unknown) => {
        console.error(
          `createFirm: could not delete Clerk org ${clerkOrgId}; remove it in the Clerk dashboard`,
          cleanupErr,
        );
      });
      return { ok: false, error: CREATE_FAILED_MESSAGE };
    }
    return { ok: true, data: { firmId, clerkOrgId } };
  } catch (err) {
    // Loading the user or creating the Clerk org failed: nothing was saved.
    console.error("createFirm: Clerk step failed", err);
    return { ok: false, error: CREATE_FAILED_MESSAGE };
  }
}
