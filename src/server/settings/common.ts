import type { Actor } from "@/lib/auth/user-management";
import type { FirmSession } from "@/lib/auth/session";
import { firmDisplayName } from "@/lib/settings/firm-profile";

// Shared by the settings server actions (settings-firm spec).

/** Who is asking, and in which firm. Built from the session on the server. */
export type SettingsActor = {
  firmId: string;
  /** Display name ?? legal name, used in messages. */
  firmName: string;
  clerkOrgId: string;
  /** Our users.id */
  userId: string;
  clerkUserId: string;
  member: Actor;
};

export function actorFrom({
  firm,
  user,
  membership,
}: FirmSession): SettingsActor {
  return {
    firmId: firm.id,
    firmName: firmDisplayName(firm),
    clerkOrgId: firm.clerkOrgId,
    userId: user.id,
    clerkUserId: user.clerkUserId,
    member: {
      membershipId: membership.id,
      appRole: membership.appRole,
      active: membership.active,
    },
  };
}

/** What every settings action returns. */
export type ActionResult<F extends string = never, D = undefined> =
  | { ok: true; data: D }
  | { ok: false; error?: string; fieldErrors?: Partial<Record<F, string>> };

export const FORBIDDEN_MESSAGE = "You don't have access to this.";
export const SAVE_FAILED_MESSAGE =
  "Couldn't save. Nothing was changed. Try again.";

export const forbidden = { ok: false, error: FORBIDDEN_MESSAGE } as const;

/** The readable part of a Clerk API error, if there is one. */
export function clerkErrorMessage(err: unknown): string {
  const e = err as { errors?: { longMessage?: string; message?: string }[] };
  const first = e?.errors?.[0];
  return (
    first?.longMessage ??
    first?.message ??
    (err instanceof Error ? err.message : "Something went wrong.")
  );
}

/** Clerk says the thing is already gone (404): fine for revoke and remove. */
export function isClerkNotFound(err: unknown): boolean {
  return (err as { status?: number })?.status === 404;
}

/** Postgres unique-index violation (also when wrapped by Drizzle). */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}
