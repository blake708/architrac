import { describe, expect, it, vi } from "vitest";
import { detailsCore, suggestCore } from "./google";

const session = "7f1c2a7e-3b9a-4c1e-9f3a-2d6e8b0c4a11";
const reply = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, status: ok ? 200 : 403, json: async () => body }) as Response);

describe("address lookup", () => {
  it("sends the key in a header, US only, and maps suggestions", async () => {
    const f = reply({ suggestions: [{ placePrediction: { placeId: "abc", structuredFormat: { mainText: { text: "40 Calhoun St" }, secondaryText: { text: "Charleston, SC" } } } }] });
    const r = await suggestCore({ query: "40 calh", session }, "KEY", f);
    expect(r).toEqual([{ placeId: "abc", main: "40 Calhoun St", secondary: "Charleston, SC" }]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("KEY");
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("KEY");
    expect(JSON.parse(init.body as string)).toMatchObject({ includedRegionCodes: ["us"], sessionToken: session });
  });

  it("does nothing without a key, for short input, or when Google refuses", async () => {
    const f = reply({});
    expect(await suggestCore({ query: "40 calh", session }, undefined, f)).toEqual([]);
    expect(await suggestCore({ query: "40", session }, "KEY", f)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
    expect(await suggestCore({ query: "40 calh", session }, "KEY", reply({}, false))).toEqual([]);
  });

  it("details ask only for address parts and fill the fields", async () => {
    const f = reply({ addressComponents: [
      { longText: "40", shortText: "40", types: ["street_number"] },
      { longText: "Calhoun Street", shortText: "Calhoun St", types: ["route"] },
      { longText: "Charleston", shortText: "Charleston", types: ["locality"] },
      { longText: "South Carolina", shortText: "SC", types: ["administrative_area_level_1"] },
      { longText: "29401", shortText: "29401", types: ["postal_code"] },
    ] });
    expect(await detailsCore({ placeId: "abc", session }, "KEY", f)).toEqual({
      addressLine1: "40 Calhoun St", city: "Charleston", state: "SC", postalCode: "29401",
    });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe("addressComponents");
    expect(await detailsCore({ placeId: "../evil", session }, "KEY", f)).toBeNull();
  });
});
