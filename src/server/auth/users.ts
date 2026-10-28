import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { type TenantDb, withoutFirm } from "@/db/tenant";

// Our copy of each person who can sign in. Clerk owns the login; we keep
// name, email and avatar so the app can show them without calling Clerk.

export type User = typeof users.$inferSelect;

/** The facts about a person we copy from Clerk. */
export type ClerkUserFacts = {
  clerkUserId: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
};

/** "Blake" + "Middleton" → "BM". Falls back to the email's first letter. */
export function initialsFor(
  firstName: string,
  lastName: string,
  email = "",
): string {
  const initials = `${firstName.trim().charAt(0)}${lastName.trim().charAt(0)}`;
  return (initials || email.charAt(0)).toUpperCase();
}

/**
 * Pull our fields out of a Clerk user object (webhook JSON shape).
 * Returns null if the user has no primary email yet (we need one).
 */
export function userFactsFromClerkJson(data: {
  id: string;
  first_name: string | null;
  last_name: string | null;
  image_url: string;
  has_image: boolean;
  primary_email_address_id: string | null;
  email_addresses: { id: string; email_address: string }[];
}): ClerkUserFacts | null {
  const primary = data.email_addresses.find(
    (e) => e.id === data.primary_email_address_id,
  );
  if (!primary) return null;
  return {
    clerkUserId: data.id,
    email: primary.email_address,
    firstName: data.first_name ?? "",
    lastName: data.last_name ?? "",
    // Clerk always sends a default image; only keep a real uploaded photo,
    // so the app shows initials otherwise.
    avatarUrl: data.has_image ? data.image_url : null,
  };
}

/**
 * Create or update the user row, inside an existing transaction.
 * Safe to run twice. Initials are only set when the row is first created.
 */
export async function upsertUserIn(
  db: TenantDb,
  facts: ClerkUserFacts,
): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({
      clerkUserId: facts.clerkUserId,
      email: facts.email,
      firstName: facts.firstName,
      lastName: facts.lastName,
      initials: initialsFor(facts.firstName, facts.lastName, facts.email),
      avatarUrl: facts.avatarUrl,
    })
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: {
        email: facts.email,
        firstName: facts.firstName,
        lastName: facts.lastName,
        avatarUrl: facts.avatarUrl,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

/** Create or update the user row in its own transaction. */
export function upsertUser(facts: ClerkUserFacts): Promise<User> {
  return withoutFirm((db) => upsertUserIn(db, facts));
}

export async function findUserByClerkId(
  clerkUserId: string,
): Promise<User | null> {
  const [row] = await withoutFirm((db) =>
    db.select().from(users).where(eq(users.clerkUserId, clerkUserId)),
  );
  return row ?? null;
}
