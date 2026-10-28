import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { Webhook } from "svix";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/db/client";
import {
  createOwnerPool,
  createTestFirm,
  removeTestFirm,
  removeUserByClerkId,
  requireDbEnv,
  type TestFirm,
} from "@/db/test-helpers";
import { handleClerkWebhook } from "./clerk-webhook";

// The Clerk webhook against the real database. Requests are signed with a
// test secret exactly the way Clerk (via Svix) signs them.
// App-shell spec acceptance tests 20 and 21, plus business rule 7.

const SECRET = `whsec_${randomBytes(24).toString("base64")}`;

let owner: Pool;
let firm: TestFirm;
const clerkUserId = `user_test_${randomUUID().slice(0, 8)}`;
const email = `${clerkUserId}@example.com`;

beforeAll(async () => {
  requireDbEnv();
  vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", SECRET);
  owner = createOwnerPool();
  firm = await createTestFirm(owner, "Webhook");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (owner) {
    if (firm) await removeTestFirm(owner, firm);
    await removeUserByClerkId(owner, clerkUserId);
    await owner.end();
  }
  await closeDb();
});

function signedRequest(payload: object, secret = SECRET): NextRequest {
  const body = JSON.stringify(payload);
  const id = `msg_${randomUUID()}`;
  const now = new Date();
  const signature = new Webhook(secret).sign(id, now, body);
  return new NextRequest("http://localhost:3000/api/webhooks/clerk", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "svix-id": id,
      "svix-timestamp": Math.floor(now.getTime() / 1000).toString(),
      "svix-signature": signature,
    },
  });
}

const userEvent = (type: "user.created" | "user.updated", first: string) => ({
  type,
  object: "event",
  data: {
    id: clerkUserId,
    object: "user",
    first_name: first,
    last_name: "Tester",
    image_url: "https://img.clerk.com/default.png",
    has_image: false,
    primary_email_address_id: "idn_1",
    email_addresses: [{ id: "idn_1", email_address: email }],
  },
});

const membershipEvent = (
  type: "organizationMembership.created" | "organizationMembership.deleted",
  orgId: string,
  userId: string,
) => ({
  type,
  object: "event",
  data: {
    id: `orgmem_${randomUUID().slice(0, 8)}`,
    object: "organization_membership",
    role: "org:member",
    organization: { id: orgId, object: "organization", name: "x" },
    public_user_data: { user_id: userId, identifier: email },
  },
});

async function userRow() {
  const r = await owner.query<{
    id: string;
    first_name: string;
    initials: string;
    avatar_url: string | null;
  }>("select * from users where clerk_user_id = $1", [clerkUserId]);
  return r.rows[0];
}

async function membershipsFor(userId: string) {
  const c = await owner.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.firm_id', $1, true)", [firm.firmId]);
    const r = await c.query<{ app_role: string; active: boolean }>(
      "select app_role, active from memberships where firm_id = $1 and user_id = $2",
      [firm.firmId, userId],
    );
    await c.query("commit");
    return r.rows;
  } finally {
    c.release();
  }
}

describe("Clerk webhook", () => {
  it("returns 400 and writes nothing when the signature is wrong", async () => {
    const wrongSecret = `whsec_${randomBytes(24).toString("base64")}`;
    const res = await handleClerkWebhook(
      signedRequest(userEvent("user.created", "Bad"), wrongSecret),
    );
    expect(res.status).toBe(400);
    expect(await userRow()).toBeUndefined();
  });

  it("returns 400 when the signature headers are missing", async () => {
    const res = await handleClerkWebhook(
      new NextRequest("http://localhost:3000/api/webhooks/clerk", {
        method: "POST",
        body: JSON.stringify(userEvent("user.created", "Bad")),
      }),
    );
    expect(res.status).toBe(400);
    expect(await userRow()).toBeUndefined();
  });

  it("user.created makes a user row; user.updated changes the name but not the initials", async () => {
    let res = await handleClerkWebhook(
      signedRequest(userEvent("user.created", "Pat")),
    );
    expect(res.status).toBe(200);
    expect(await userRow()).toMatchObject({
      first_name: "Pat",
      initials: "PT",
      avatar_url: null,
    });

    res = await handleClerkWebhook(
      signedRequest(userEvent("user.updated", "Robin")),
    );
    expect(res.status).toBe(200);
    expect(await userRow()).toMatchObject({
      first_name: "Robin",
      initials: "PT",
    });
  });

  it("organizationMembership.created delivered twice makes exactly one membership, as Staff", async () => {
    const user = await userRow();
    const event = membershipEvent(
      "organizationMembership.created",
      firm.clerkOrgId,
      clerkUserId,
    );
    expect((await handleClerkWebhook(signedRequest(event))).status).toBe(200);
    expect((await handleClerkWebhook(signedRequest(event))).status).toBe(200);

    expect(await membershipsFor(user.id)).toEqual([
      { app_role: "staff", active: true },
    ]);
  });

  it("organizationMembership.deleted turns the membership off; being re-added turns it back on", async () => {
    const user = await userRow();
    const deleted = membershipEvent(
      "organizationMembership.deleted",
      firm.clerkOrgId,
      clerkUserId,
    );
    expect((await handleClerkWebhook(signedRequest(deleted))).status).toBe(200);
    expect((await handleClerkWebhook(signedRequest(deleted))).status).toBe(200);
    expect(await membershipsFor(user.id)).toEqual([
      { app_role: "staff", active: false },
    ]);

    const created = membershipEvent(
      "organizationMembership.created",
      firm.clerkOrgId,
      clerkUserId,
    );
    expect((await handleClerkWebhook(signedRequest(created))).status).toBe(200);
    expect(await membershipsFor(user.id)).toEqual([
      { app_role: "staff", active: true },
    ]);
  });

  it("never downgrades an existing owner", async () => {
    // The test firm's own user is its owner. Clerk sends this event right
    // after create-firm makes the org.
    const ownerClerkId = (
      await owner.query<{ clerk_user_id: string }>(
        "select clerk_user_id from users where id = $1",
        [firm.userId],
      )
    ).rows[0].clerk_user_id;
    const event = membershipEvent(
      "organizationMembership.created",
      firm.clerkOrgId,
      ownerClerkId,
    );
    expect((await handleClerkWebhook(signedRequest(event))).status).toBe(200);
    expect(await membershipsFor(firm.userId)).toEqual([
      { app_role: "owner", active: true },
    ]);
  });

  it("ignores a membership for an org that has no firm (yet)", async () => {
    const event = membershipEvent(
      "organizationMembership.created",
      `org_unknown_${randomUUID().slice(0, 8)}`,
      clerkUserId,
    );
    expect((await handleClerkWebhook(signedRequest(event))).status).toBe(200);
  });
});
