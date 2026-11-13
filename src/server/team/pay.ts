import { and, eq, isNull } from "drizzle-orm";
import { activityLog, membershipPay, memberships } from "@/db/schema";
import { withFirm } from "@/db/tenant";
import { can } from "@/lib/auth/permissions";
import { planRateChange } from "@/lib/calc/rates";
import { PAY_MESSAGES, payEarliestMessage, savePaySchema } from "@/lib/team/pay";
import { fieldErrorsOf } from "@/lib/team/profile";
import { type ActionResult, SAVE_FAILED_MESSAGE, type SettingsActor } from "@/server/settings/common";

// Team → person drawer → Pay (ADR 0008). Owners and admins only (CLAUDE.md
// rule 4). Effective-dated like role rates: the same start date updates the
// open period; a later date closes it the day before and starts a new one.
// The activity log says pay changed but never how much, because the log is
// read more widely than pay is.

export type PayResult = ActionResult<string, { membershipId: string }>;

class Refused extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

export async function savePayCore(actor: SettingsActor, raw: unknown): Promise<PayResult> {
  if (!can(actor.member, "rates.edit")) return { ok: false, error: PAY_MESSAGES.forbidden };
  const parsed = savePaySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error.issues) };
  const v = parsed.data;
  const log = (entityId: string, action: string, changes: Record<string, unknown>) => ({
    firmId: actor.firmId,
    actorUserId: actor.userId,
    entityType: "membership_pay",
    entityId,
    action,
    changes: { membership_id: v.membershipId, ...changes },
  });

  try {
    await withFirm(actor.firmId, async (db) => {
      const [person] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.id, v.membershipId), isNull(memberships.archivedAt)))
        .for("update");
      if (!person) throw new Refused(PAY_MESSAGES.notFound);

      const values = { payType: v.payType, amountCents: v.amountCents, burdenBp: v.burdenBp };
      const [open] = await db
        .select()
        .from(membershipPay)
        .where(and(eq(membershipPay.membershipId, v.membershipId), isNull(membershipPay.effectiveTo)));
      if (!open) {
        const [row] = await db
          .insert(membershipPay)
          .values({ firmId: actor.firmId, membershipId: v.membershipId, ...values, effectiveFrom: v.effectiveFrom, createdBy: actor.userId })
          .returning({ id: membershipPay.id });
        await db.insert(activityLog).values(log(row.id, "created", { effective_from: v.effectiveFrom }));
        return;
      }

      const plan = planRateChange(open, v.effectiveFrom);
      if (plan.kind === "reject") throw new Refused(payEarliestMessage(plan.earliest), "effectiveFrom");
      if (plan.kind === "update") {
        await db.update(membershipPay).set({ ...values, updatedAt: new Date() }).where(eq(membershipPay.id, open.id));
        await db.insert(activityLog).values(log(open.id, "updated", { pay: "changed" }));
        return;
      }
      // Close first: the no-overlap rule checks each statement.
      await db
        .update(membershipPay)
        .set({ effectiveTo: plan.closeCurrentOn, updatedAt: new Date() })
        .where(eq(membershipPay.id, open.id));
      const [row] = await db
        .insert(membershipPay)
        .values({ firmId: actor.firmId, membershipId: v.membershipId, ...values, effectiveFrom: v.effectiveFrom, createdBy: actor.userId })
        .returning({ id: membershipPay.id });
      await db.insert(activityLog).values([
        log(open.id, "updated", { effective_to: { before: null, after: plan.closeCurrentOn } }),
        log(row.id, "created", { effective_from: v.effectiveFrom }),
      ]);
    });
    return { ok: true, data: { membershipId: v.membershipId } };
  } catch (err) {
    if (err instanceof Refused)
      return err.field ? { ok: false, fieldErrors: { [err.field]: err.message } } : { ok: false, error: err.message };
    console.error("savePay failed", err);
    return { ok: false, error: SAVE_FAILED_MESSAGE };
  }
}
