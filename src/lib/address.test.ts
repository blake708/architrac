import { describe, expect, it } from "vitest";
import { addressFromComponents, suggestionsFrom } from "./address";

const c = (longText: string, types: string[], shortText = longText) => ({ longText, shortText, types });

describe("addressFromComponents", () => {
  it("a street address with ZIP+4", () => {
    expect(
      addressFromComponents([
        c("1120", ["street_number"]),
        c("Harbor View Road", ["route"], "Harbor View Rd"),
        c("Charleston", ["locality", "political"]),
        c("Charleston County", ["administrative_area_level_2", "political"]),
        c("South Carolina", ["administrative_area_level_1", "political"], "SC"),
        c("United States", ["country", "political"], "US"),
        c("29412", ["postal_code"]),
        c("1234", ["postal_code_suffix"]),
      ]),
    ).toEqual({ addressLine1: "1120 Harbor View Rd", city: "Charleston", state: "SC", postalCode: "29412-1234" });
  });

  it("a unit becomes line 2", () => {
    const r = addressFromComponents([
      c("200", ["subpremise"]),
      c("40", ["street_number"]),
      c("Calhoun Street", ["route"], "Calhoun St"),
      c("Charleston", ["locality"]),
      c("South Carolina", ["administrative_area_level_1"], "SC"),
      c("29401", ["postal_code"]),
    ]);
    expect(r.addressLine1).toBe("40 Calhoun St");
    expect(r.addressLine2).toBe("Suite 200");
  });

  it("no locality: falls back to the township", () => {
    const r = addressFromComponents([
      c("9", ["street_number"]),
      c("Main St", ["route"]),
      c("Mount Pleasant Township", ["administrative_area_level_3"]),
      c("Pennsylvania", ["administrative_area_level_1"], "PA"),
    ]);
    expect(r.city).toBe("Mount Pleasant Township");
    expect(r.postalCode).toBe("");
    expect("addressLine2" in r).toBe(false);
  });
});

describe("suggestionsFrom", () => {
  it("keeps place predictions, at most 5", () => {
    const one = (id: string) => ({
      placePrediction: {
        placeId: id,
        text: { text: "x" },
        structuredFormat: { mainText: { text: `${id} Main St` }, secondaryText: { text: "Charleston, SC, USA" } },
      },
    });
    const body = { suggestions: [one("1"), { queryPrediction: {} }, one("2"), one("3"), one("4"), one("5"), one("6")] };
    const r = suggestionsFrom(body);
    expect(r).toHaveLength(5);
    expect(r[0]).toEqual({ placeId: "1", main: "1 Main St", secondary: "Charleston, SC, USA" });
  });
  it("bad replies give no suggestions", () => {
    expect(suggestionsFrom(null)).toEqual([]);
    expect(suggestionsFrom({ error: { message: "x" } })).toEqual([]);
  });
});
