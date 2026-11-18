import { describe, expect, it } from "vitest";
import {
  decideOutcome,
  disputeWindowEndsAt,
  isDisputeWindowOver,
} from "../src/lib/resolution";

describe("decideOutcome", () => {
  const endTs = 1_800_000_000;

  it("resolves YES when price is above the strike (direction above)", () => {
    const d = decideOutcome("above", 180, endTs, {
      price: 185,
      conf: 0.5,
      publishTime: endTs + 5,
    });
    expect(d).toEqual({
      kind: "resolve",
      side: "yes",
      price: 185,
      conf: 0.5,
      publishTime: endTs + 5,
    });
  });

  it("resolves NO when price is below the strike (direction above)", () => {
    const d = decideOutcome("above", 180, endTs, {
      price: 170,
      conf: 0.5,
      publishTime: endTs,
    });
    expect(d.kind).toBe("resolve");
    if (d.kind === "resolve") expect(d.side).toBe("no");
  });

  it("flips for direction below", () => {
    const d = decideOutcome("below", 180, endTs, {
      price: 170,
      conf: 0.5,
      publishTime: endTs,
    });
    expect(d.kind).toBe("resolve");
    if (d.kind === "resolve") expect(d.side).toBe("yes");
  });

  it("holds when there is no Pyth price at expiry", () => {
    const d = decideOutcome("above", 180, endTs, null);
    expect(d.kind).toBe("hold");
    if (d.kind === "hold") expect(d.reason).toMatch(/no Pyth price/);
  });

  it("holds when the price is too far from expiry (stale)", () => {
    const d = decideOutcome("above", 180, endTs, {
      price: 185,
      conf: 0.5,
      publishTime: endTs + 300, // 5 min late — max is 60s
    });
    expect(d.kind).toBe("hold");
    if (d.kind === "hold") expect(d.reason).toMatch(/manual review/);
  });

  it("holds when the strike lies inside the confidence band", () => {
    // price 180 ± 2 → band [178, 182]; strike 180 is inside it.
    const d = decideOutcome("above", 180, endTs, {
      price: 180,
      conf: 2,
      publishTime: endTs,
    });
    expect(d.kind).toBe("hold");
    if (d.kind === "hold") expect(d.reason).toMatch(/confidence band/);
  });

  it("resolves when the strike is just outside the confidence band", () => {
    // price 183 ± 2 → band [181, 185]; strike 180 is below the band.
    const d = decideOutcome("above", 180, endTs, {
      price: 183,
      conf: 2,
      publishTime: endTs,
    });
    expect(d.kind).toBe("resolve");
    if (d.kind === "resolve") expect(d.side).toBe("yes");
  });

  it("accepts a price published just before expiry", () => {
    const d = decideOutcome("above", 180, endTs, {
      price: 185,
      conf: 0.5,
      publishTime: endTs - 30,
    });
    expect(d.kind).toBe("resolve");
  });

  it("accepts an older price when the caller passes a wider bound", () => {
    // Same 5-min-late price as the stale test, but with a 30-min bound
    // (the keeper's pull-oracle settlement rule) it resolves.
    const d = decideOutcome(
      "above",
      180,
      endTs,
      { price: 185, conf: 0.5, publishTime: endTs + 300 },
      1800,
    );
    expect(d.kind).toBe("resolve");
    if (d.kind === "resolve") expect(d.side).toBe("yes");
  });
});

describe("dispute window", () => {
  it("ends 600s after the proposal and reports correctly", () => {
    expect(disputeWindowEndsAt(1000)).toBe(1600);
    expect(isDisputeWindowOver(1000, 1599)).toBe(false);
    expect(isDisputeWindowOver(1000, 1600)).toBe(true);
  });
});
