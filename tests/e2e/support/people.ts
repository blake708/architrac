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
  /**
   * For settings.spec.ts, which changes things (profile, modules, people).
   * Its own people, so other test files never see those changes.
   */
  gamma: {
    name: `${E2E_PREFIX}Gamma Group`,
    modules: ALL_MODULES,
    createdBy: "gammaOwner",
  },
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
  gammaOwner: {
    email: "architrac-e2e-gowner+clerk_test@example.com",
    firstName: "Gail",
    lastName: "Gowner",
    memberships: [{ firm: "gamma", role: "owner" }],
  },
  gammaAdmin: {
    email: "architrac-e2e-gadmin+clerk_test@example.com",
    firstName: "Glen",
    lastName: "Gadmin",
    memberships: [{ firm: "gamma", role: "admin" }],
  },
  gammaPm: {
    email: "architrac-e2e-gpm+clerk_test@example.com",
    firstName: "Pam",
    lastName: "Manager",
    memberships: [{ firm: "gamma", role: "project_manager" }],
  },
  gammaJr: {
    email: "architrac-e2e-jr+clerk_test@example.com",
    firstName: "Jo",
    lastName: "Rivers",
    memberships: [{ firm: "gamma", role: "staff" }],
  },
} satisfies Record<string, Person>;
export type PersonKey = keyof typeof PEOPLE;

export const E2E_EMAILS = Object.values(PEOPLE).map((p) => p.email);
