import { describe, expect, it } from "vitest";
import { NO_EMAIL, invoiceRecipients, parseMoney, parsePercent, sendProblems } from "./builder";

describe("parsePercent", () => {
  it("reads up to two decimals as basis points", () => {
    expect(parsePercent("30")).toBe(3000);
    expect(parsePercent("30.25")).toBe(3025);
    expect(parsePercent("30.5%")).toBe(3050);
    expect(parsePercent("100")).toBe(10000);
    expect(parsePercent("0")).toBe(0);
  });

  it("refuses anything else", () => {
    for (const t of ["", "abc", "100.01", "101", "30.255", "-5"]) expect(parsePercent(t), t).toBeNull();
  });
});

describe("parseMoney", () => {
  it("reads dollars and cents, with minus or brackets", () => {
    expect(parseMoney("$5,520.00")).toBe(552_000);
    expect(parseMoney("5520")).toBe(552_000);
    expect(parseMoney("-200")).toBe(-20_000);
    expect(parseMoney("(1,860.5)")).toBe(-186_050);
  });

  it("refuses anything else", () => {
    for (const t of ["", "abc", "1.234", "$"]) expect(parseMoney(t), t).toBeNull();
  });
});

describe("invoiceRecipients (decision #32)", () => {
  it("the billing email first, copying the contact", () => {
    expect(invoiceRecipients("ap@client.com", "pat@client.com")).toEqual({ to: "ap@client.com", cc: "pat@client.com" });
  });
  it("no copy to the same address", () => {
    expect(invoiceRecipients("ap@client.com", "AP@client.com")).toEqual({ to: "ap@client.com", cc: null });
  });
  it("the contact alone when there's no billing email", () => {
    expect(invoiceRecipients(null, "pat@client.com")).toEqual({ to: "pat@client.com", cc: null });
    expect(invoiceRecipients(" ", null)).toEqual({ to: null, cc: null });
  });
});

describe("sendProblems (rule 14)", () => {
  const ok = { totalCents: 1, lineCount: 1, hasToAddress: true, negativeFixedLine: false, hasClient: true };
  it("nothing to fix", () => expect(sendProblems(ok)).toEqual([]));
  it("lists each problem", () => {
    expect(sendProblems({ totalCents: 0, lineCount: 0, hasToAddress: false, negativeFixedLine: true, hasClient: false })).toEqual([
      "Add at least one line.",
      NO_EMAIL,
      "A fixed-fee line can't be negative.",
      "The project needs a client.",
    ]);
    expect(sendProblems({ ...ok, totalCents: -5 })).toEqual(["The total must be more than $0."]);
  });
});
