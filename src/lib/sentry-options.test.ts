import type { ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";
import { scrub, sentryOptions } from "./sentry-options";

describe("Sentry privacy", () => {
  it("strips request bodies, cookies, headers and query strings", () => {
    const event = {
      type: undefined,
      message: "boom",
      request: {
        url: "https://app.example.com/app/settings/rates",
        method: "POST",
        data: { billRateCents: 17500, salaryCents: 9000000 },
        cookies: { __session: "secret" },
        headers: { authorization: "Bearer secret" },
        query_string: "token=secret",
      },
    } as ErrorEvent;

    const out = scrub(event);

    expect(out.request).toEqual({
      url: "https://app.example.com/app/settings/rates",
      method: "POST",
    });
    expect(JSON.stringify(out)).not.toContain("secret");
    expect(JSON.stringify(out)).not.toContain("17500");
  });

  it("never sends personal data by default", () => {
    expect(sentryOptions.sendDefaultPii).toBe(false);
  });
});
