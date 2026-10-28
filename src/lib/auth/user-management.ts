import { type AppRole, type Member, can } from "./permissions";

// Settings → Users & access: who may change whom (settings-firm spec,
// business rules 6 and 7). Pure functions so the page and the server actions
// ask the same questions; the server always asks again before writing.

/** Role help text, shown under the invite form's role select. */
export const ROLE_HELP: Record<AppRole, string> = {
  owner: "Everything, including billing, modules and managing other owners.",
  admin: "Everything except managing owners. Sees rates, cost and profit.",
  project_manager:
    "Runs their projects. Sees budgets and hours on their projects, not cost rates or salaries.",
  staff: "Logs time and sees the projects they're on.",
};

export const ONLY_OWNER_MESSAGE = "Only an owner can do that.";
export const NOT_YOURSELF_MESSAGE = "You can't change your own access.";
export const needsOwnerMessage = (firmName: string) =>
  `${firmName} needs at least one owner.`;

/** Me: the signed-in person's membership. */
export type Actor = Member & { membershipId: string };

/** The roles I may give someone (invite or role select). */
export function assignableRoles(me: Member): AppRole[] {
  if (can(me, "users.manage_owners"))
    return ["owner", "admin", "project_manager", "staff"];
  if (can(me, "users.manage")) return ["admin", "project_manager", "staff"];
  return [];
}

/** May I touch someone (or an invitation) who has this role? */
export function canManageRole(me: Member, role: AppRole): boolean {
  if (role === "owner") return can(me, "users.manage_owners");
  return can(me, "users.manage");
}

type Target = { membershipId: string; appRole: AppRole };

/**
 * Why I can't change this member's role or turn them off, or null if I can.
 * Doesn't know about the last-owner rule (that needs a count; see below).
 */
export function memberChangeBlocked(me: Actor, them: Target): string | null {
  if (!can(me, "users.manage")) return "You don't have access to this.";
  if (me.membershipId === them.membershipId) return NOT_YOURSELF_MESSAGE;
  if (!canManageRole(me, them.appRole)) return ONLY_OWNER_MESSAGE;
  return null;
}

/** Why I can't change this member to `role`, or null if I can. */
export function roleChangeBlocked(
  me: Actor,
  them: Target,
  role: AppRole,
): string | null {
  return (
    memberChangeBlocked(me, them) ??
    (canManageRole(me, role) ? null : ONLY_OWNER_MESSAGE)
  );
}

/**
 * The firm must always keep an active owner. True if this change would take
 * away the last one: an active owner being demoted or turned off while they
 * are the only active owner.
 */
export function removesLastOwner(
  them: { appRole: AppRole; active: boolean },
  activeOwnerCount: number,
  change: { role: AppRole } | { deactivate: true },
): boolean {
  if (them.appRole !== "owner" || !them.active) return false;
  const staysOwner = "role" in change && change.role === "owner";
  return !staysOwner && activeOwnerCount <= 1;
}

/** Clerk's org role for an app role (app-shell spec, business rule 8). */
export function clerkRoleFor(role: AppRole): "org:admin" | "org:member" {
  return role === "owner" || role === "admin" ? "org:admin" : "org:member";
}
