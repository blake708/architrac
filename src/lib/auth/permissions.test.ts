import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  type Action,
  type AppRole,
  ForbiddenError,
  can,
  requireCan,
  requireRole,
} from "./permissions";

// One block per row of the permission matrix in docs/ARCHITECTURE.md
// section 5, plus the Release 0 actions in the app-shell spec (rule 10).
// The expected answers are written out here on purpose, not imported, so a
// mistake in permissions.ts can't agree with itself.

const ROLES: AppRole[] = ["owner", "admin", "project_manager", "staff"];

/** Expected result per role. "pm" / "assigned" = only with that project flag. */
type Expect = boolean | "pm" | "assigned";
type Row = {
  row: string;
  actions: Action[];
  expected: Record<AppRole, Expect>;
};

const OA = { owner: true, admin: true, project_manager: false, staff: false };

const MATRIX: Row[] = [
  {
    row: "Firm settings, modules, integrations",
    actions: [
      "settings.view",
      "settings.edit",
      "modules.manage",
      "integrations.manage",
    ],
    expected: OA,
  },
  { row: "Users & invitations", actions: ["users.manage"], expected: OA },
  {
    row: "Users: manage owners (Release 0, owner only)",
    actions: ["users.manage_owners"],
    expected: {
      owner: true,
      admin: false,
      project_manager: false,
      staff: false,
    },
  },
  {
    row: "View/edit rates (bill & cost)",
    actions: ["rates.view", "rates.edit"],
    expected: OA,
  },
  {
    row: "See cost, profit, overhead",
    actions: ["financials.view"],
    expected: OA,
  },
  {
    row: "Create projects",
    actions: ["projects.create"],
    expected: { owner: true, admin: true, project_manager: true, staff: false },
  },
  {
    row: "Edit project phases & fees",
    actions: ["projects.edit_fees"],
    expected: { owner: true, admin: true, project_manager: "pm", staff: false },
  },
  {
    row: "View projects",
    actions: ["projects.view"],
    expected: {
      owner: true,
      admin: true,
      project_manager: true,
      staff: "assigned",
    },
  },
  {
    row: "Enter own time",
    actions: ["time.enter_own"],
    expected: { owner: true, admin: true, project_manager: true, staff: true },
  },
  {
    row: "Approve time",
    actions: ["time.approve"],
    expected: { owner: true, admin: true, project_manager: "pm", staff: false },
  },
  {
    row: "Create/send invoices: draft",
    actions: ["invoices.create_draft"],
    expected: { owner: true, admin: true, project_manager: "pm", staff: false },
  },
  {
    row: "Create/send invoices: send",
    actions: ["invoices.send"],
    expected: OA,
  },
  {
    row: "Record payments, QuickBooks sync",
    actions: ["payments.record", "quickbooks.sync"],
    expected: OA,
  },
  {
    row: "Contacts: view",
    actions: ["contacts.view"],
    expected: { owner: true, admin: true, project_manager: true, staff: true },
  },
  {
    row: "Contacts: edit",
    actions: ["contacts.edit"],
    expected: { owner: true, admin: true, project_manager: true, staff: false },
  },
  {
    row: "Delete (archive) firm",
    actions: ["firm.archive"],
    expected: {
      owner: true,
      admin: false,
      project_manager: false,
      staff: false,
    },
  },
];

const member = (appRole: AppRole) => ({ appRole, active: true });

describe.each(MATRIX)("permission matrix: $row", ({ actions, expected }) => {
  for (const action of actions) {
    for (const role of ROLES) {
      const want = expected[role];

      if (typeof want === "boolean") {
        it(`${role} ${want ? "can" : "cannot"} ${action}`, () => {
          expect(can(member(role), action)).toBe(want);
          // A project doesn't change an all-or-nothing rule.
          expect(
            can(member(role), action, {
              isProjectManager: true,
              isAssigned: true,
            }),
          ).toBe(want);
        });
      } else if (want === "pm") {
        it(`${role} can ${action} only on projects they manage`, () => {
          expect(can(member(role), action)).toBe(false);
          expect(can(member(role), action, { isAssigned: true })).toBe(false);
          expect(can(member(role), action, { isProjectManager: true })).toBe(
            true,
          );
        });
      } else {
        it(`${role} can ${action} only on projects they're assigned to`, () => {
          expect(can(member(role), action)).toBe(false);
          expect(can(member(role), action, { isProjectManager: true })).toBe(
            false,
          );
          expect(can(member(role), action, { isAssigned: true })).toBe(true);
        });
      }
    }
  }
});

describe("permission matrix coverage", () => {
  it("every action in permissions.ts is tested above", () => {
    const tested = new Set(MATRIX.flatMap((r) => r.actions));
    expect(ACTIONS.filter((a) => !tested.has(a))).toEqual([]);
  });
});

describe("can()", () => {
  it("a deactivated member can do nothing, even an owner", () => {
    const off = { appRole: "owner" as const, active: false };
    for (const action of ACTIONS) {
      expect(
        can(off, action, { isProjectManager: true, isAssigned: true }),
      ).toBe(false);
    }
  });

  it("no membership means no access", () => {
    expect(can(null, "time.enter_own")).toBe(false);
    expect(can(undefined, "contacts.view")).toBe(false);
  });
});

describe("requireRole()", () => {
  it("passes when the role is listed", () => {
    expect(() => requireRole(member("admin"), "owner", "admin")).not.toThrow();
  });

  it("throws ForbiddenError when the role isn't listed", () => {
    expect(() => requireRole(member("staff"), "owner", "admin")).toThrow(
      ForbiddenError,
    );
  });

  it("throws for a deactivated member", () => {
    expect(() =>
      requireRole({ appRole: "owner", active: false }, "owner"),
    ).toThrow(ForbiddenError);
  });

  it("throws when there is no membership", () => {
    expect(() => requireRole(null, "owner")).toThrow(ForbiddenError);
  });
});

describe("requireCan()", () => {
  it("passes when can() is true and throws when false", () => {
    expect(() =>
      requireCan(member("project_manager"), "time.approve", {
        isProjectManager: true,
      }),
    ).not.toThrow();
    expect(() => requireCan(member("project_manager"), "time.approve")).toThrow(
      ForbiddenError,
    );
  });
});
