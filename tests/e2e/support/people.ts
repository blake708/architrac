// The throwaway people and firms the signed-in browser tests use.
// global-setup.ts creates them in the Clerk DEVELOPMENT instance and the dev
// database before the tests; global-teardown.ts removes them afterwards.
//
// "+clerk_test" emails are Clerk's test addresses: no real email is sent.

export const E2E_PREFIX = "E2E ";

/** Every module that gets a rail item (TMG's seed list: all but Code). */
export const ALL_MODULES = [
  "build",
  "workload",
  "accounting",
  "marketing",
  "knowledge",
  "website",
  "hiring",
];

export const FIRMS = {
  /** All modules on. Sorts first, so it's the owner's default firm. */
  alpha: { name: `${E2E_PREFIX}Alpha Architects`, modules: ALL_MODULES },
  /** No modules on. */
  beta: { name: `${E2E_PREFIX}Beta Studio`, modules: [] as string[] },
} as const;
export type FirmKey = keyof typeof FIRMS;

type Person = {
  email: string;
  firstName: string;
  lastName: string;
  /** Firms and roles. Empty = signed up but no firm yet. */
  memberships: {
    firm: FirmKey;
    role: "owner" | "admin" | "project_manager" | "staff";
    active?: boolean;
  }[];
};

export const PEOPLE = {
  owner: {
    email: "architrac-e2e-owner+clerk_test@example.com",
    firstName: "Olive",
    lastName: "Owner",
    memberships: [
      { firm: "alpha", role: "owner" },
      { firm: "beta", role: "owner" },
    ],
  },
  admin: {
    email: "architrac-e2e-admin+clerk_test@example.com",
    firstName: "Adam",
    lastName: "Admin",
    memberships: [{ firm: "beta", role: "admin" }],
  },
  staff: {
    email: "architrac-e2e-staff+clerk_test@example.com",
    firstName: "Sam",
    lastName: "Staff",
    memberships: [{ firm: "beta", role: "staff" }],
  },
  deactivated: {
    email: "architrac-e2e-off+clerk_test@example.com",
    firstName: "Dee",
    lastName: "Deactivated",
    memberships: [{ firm: "beta", role: "staff", active: false }],
  },
  noFirm: {
    email: "architrac-e2e-nofirm+clerk_test@example.com",
    firstName: "Nora",
    lastName: "Newfirm",
    memberships: [],
  },
} satisfies Record<string, Person>;
export type PersonKey = keyof typeof PEOPLE;

export const E2E_EMAILS = Object.values(PEOPLE).map((p) => p.email);
