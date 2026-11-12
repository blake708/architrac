// Who can do what. One place for every permission rule, so pages, server
// actions and route handlers all ask the same question: can(member, action).
//
// The rules copy the permission matrix in docs/ARCHITECTURE.md section 5.
// Hiding a button is not security: every server action and page calls
// can() / requireRole() on the server.

export const APP_ROLES = [
  "owner",
  "admin",
  "project_manager",
  "staff",
] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const ROLE_LABELS: Record<AppRole, string> = {
  owner: "Owner",
  admin: "Admin",
  project_manager: "Project manager",
  staff: "Staff",
};

/** The parts of a membership the rules need. */
export type Member = { appRole: AppRole; active: boolean };

/**
 * Facts about one project, for the rules that depend on it.
 * Projects arrive in Release 1; until then callers pass these flags directly.
 */
export type ProjectScope = {
  /** This person is the project's PM (or its principal in charge). */
  isProjectManager?: boolean;
  /** This person is assigned to the project (on its team). */
  isAssigned?: boolean;
};

/**
 * What a role gets for one action:
 * - true / false: always / never
 * - "own_projects": only on projects where they are the PM
 * - "assigned": only on projects they are assigned to
 */
type Grant = boolean | "own_projects" | "assigned";
type Rule = Record<AppRole, Grant>;

const OWNER_ADMIN: Rule = {
  owner: true,
  admin: true,
  project_manager: false,
  staff: false,
};
const OWNER_ONLY: Rule = {
  owner: true,
  admin: false,
  project_manager: false,
  staff: false,
};
const EVERYONE: Rule = {
  owner: true,
  admin: true,
  project_manager: true,
  staff: true,
};

const RULES = {
  // Firm settings, modules, integrations
  "settings.view": OWNER_ADMIN,
  "settings.edit": OWNER_ADMIN,
  "modules.manage": OWNER_ADMIN,
  "integrations.manage": OWNER_ADMIN,
  // Users & invitations
  "users.manage": OWNER_ADMIN,
  "users.manage_owners": OWNER_ONLY,
  // View/edit rates (bill & cost)
  "rates.view": OWNER_ADMIN,
  "rates.edit": OWNER_ADMIN,
  // See cost, profit, overhead
  "financials.view": OWNER_ADMIN,
  // Create projects
  "projects.create": { ...OWNER_ADMIN, project_manager: true },
  // Edit project phases & fees
  "projects.edit_fees": { ...OWNER_ADMIN, project_manager: "own_projects" },
  // Edit a project's details, team, consultants and linked companies
  // (project-detail): PMs on projects they manage or are principal on.
  "projects.edit": { ...OWNER_ADMIN, project_manager: "own_projects" },
  // See and set a person's bill-rate override on a project
  "projects.rate_override": OWNER_ADMIN,
  // See a project's fee, billed and health (projects-list): PMs only on
  // projects they manage or are principal on; staff never.
  "projects.view_fees": { ...OWNER_ADMIN, project_manager: "own_projects" },
  // View projects
  "projects.view": {
    owner: true,
    admin: true,
    project_manager: true,
    staff: "assigned",
  },
  // Enter own time
  "time.enter_own": EVERYONE,
  // Approving time follows each sheet's review (timesheet-approval spec,
  // decision #23): whoever its current step waits on. These two are the
  // role-based parts: owner/admin can step in for an approver (rule 3f) and
  // reopen an approved sheet (rule 5).
  "time.approve_for": OWNER_ADMIN,
  "time.reopen": OWNER_ADMIN,
  // See invoices (the Invoices page; PMs only their own projects' invoices).
  "invoices.view": { ...OWNER_ADMIN, project_manager: "own_projects" },
  // Create/send invoices (PM: draft only, own projects)
  "invoices.create_draft": { ...OWNER_ADMIN, project_manager: "own_projects" },
  // Return to draft, send, resend (decision #26): owner/admin, or a PM on a
  // project where they are the Principal in Charge. Callers pass
  // isProjectManager = "is this project's Principal in Charge".
  "invoices.review": { ...OWNER_ADMIN, project_manager: "own_projects" },
  "invoices.send": OWNER_ADMIN,
  // Void a sent invoice (rule 16). Never a PM, even a Principal in Charge (#26).
  "invoices.void": OWNER_ADMIN,
  // Record payments, QuickBooks sync
  "payments.record": OWNER_ADMIN,
  "quickbooks.sync": OWNER_ADMIN,
  // Contacts
  "contacts.view": EVERYONE,
  "contacts.edit": { ...OWNER_ADMIN, project_manager: true },
  "contacts.archive": OWNER_ADMIN,
  // Delete (archive) firm
  "firm.archive": OWNER_ONLY,
} satisfies Record<string, Rule>;

export type Action = keyof typeof RULES;
export const ACTIONS = Object.keys(RULES) as Action[];

/**
 * Can this member do this action? Deactivated members can do nothing.
 * Project-dependent rules ("own projects", "assigned") are false unless the
 * matching ProjectScope flag is true.
 */
export function can(
  member: Member | null | undefined,
  action: Action,
  project?: ProjectScope,
): boolean {
  if (!member || !member.active) return false;
  const grant: Grant = RULES[action][member.appRole];
  if (grant === "own_projects") return project?.isProjectManager === true;
  if (grant === "assigned") return project?.isAssigned === true;
  return grant;
}

/** Thrown when someone tries something their role doesn't allow. */
export class ForbiddenError extends Error {
  constructor(message = "You don't have access to this.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** Throws ForbiddenError unless the member is active and has one of the roles. */
export function requireRole(
  member: Member | null | undefined,
  ...roles: AppRole[]
): void {
  if (!member || !member.active || !roles.includes(member.appRole)) {
    throw new ForbiddenError();
  }
}

/** Throws ForbiddenError unless can(member, action, project) is true. */
export function requireCan(
  member: Member | null | undefined,
  action: Action,
  project?: ProjectScope,
): void {
  if (!can(member, action, project)) throw new ForbiddenError();
}
