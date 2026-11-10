import { describe, expect, it } from "vitest";
import { ROUTE_EDIT_MESSAGES, reviewRouteSchema, routeProblem, routeWords } from "./review-route";

describe("routeProblem", () => {
  it("needs at least one step", () => {
    expect(routeProblem([])).toBe(ROUTE_EDIT_MESSAGES.needsStep);
  });

  it("each kind once, each named person once, and a person must be picked", () => {
    expect(
      routeProblem([
        { kind: "any_principal", membershipId: null },
        { kind: "any_principal", membershipId: null },
      ]),
    ).toBe(ROUTE_EDIT_MESSAGES.duplicateKind);
    expect(
      routeProblem([
        { kind: "person", membershipId: "a" },
        { kind: "person", membershipId: "a" },
      ]),
    ).toBe(ROUTE_EDIT_MESSAGES.duplicatePerson);
    expect(routeProblem([{ kind: "person", membershipId: null }])).toBe(ROUTE_EDIT_MESSAGES.pickPerson);
  });

  it("two different named people and every kind once is fine", () => {
    expect(
      routeProblem([
        { kind: "team_leader", membershipId: null },
        { kind: "person", membershipId: "a" },
        { kind: "person", membershipId: "b" },
        { kind: "principal_in_charge", membershipId: null },
        { kind: "any_principal", membershipId: null },
      ]),
    ).toBeNull();
  });
});

describe("reviewRouteSchema", () => {
  it("refuses unknown kinds and more than 10 steps", () => {
    expect(reviewRouteSchema.safeParse({ steps: [{ kind: "pm", membershipId: null }] }).success).toBe(false);
    const eleven = Array.from({ length: 11 }, () => ({ kind: "team_leader", membershipId: null }));
    expect(reviewRouteSchema.safeParse({ steps: eleven }).success).toBe(false);
  });
});

describe("routeWords", () => {
  it("reads the route for the activity log", () => {
    expect(
      routeWords(
        [
          { kind: "team_leader", membershipId: null },
          { kind: "person", membershipId: "mw" },
          { kind: "principal_in_charge", membershipId: null },
        ],
        (id) => (id === "mw" ? "Morgan Wells" : "?"),
      ),
    ).toBe("Team leader → Morgan Wells → Principal in Charge");
  });
});
