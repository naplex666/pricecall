import { describe, expect, it } from "vitest";
import { BN } from "@anchor-lang/core";
import type { MarketAccount } from "@pm-amm/sdk";
import { marketState, minOutput, quoteSwap } from "../src/lib/pm-amm-helpers";

/** Q64.64 fixed-point encoding of a plain number. */
const q = (n: number) => new BN(n).mul(new BN(2).pow(new BN(64)));

function makeMarket(over: Partial<MarketAccount> = {}): MarketAccount {
  const now = Math.floor(Date.now() / 1000);
  return {
    authority: null as never,
    marketId: 1,
    collateralMint: null as never,
    yesMint: null as never,
    noMint: null as never,
    vault: null as never,
    startTs: new BN(now - 60),
    endTs: new BN(now + 3600),
    lZero: q(1_000_000),
    reserveYes: q(50_000_000),
    reserveNo: q(50_000_000),
    lastAccrualTs: new BN(now - 60),
    cumYesPerShare: new BN(0),
    cumNoPerShare: new BN(0),
    totalYesDistributed: new BN(0),
    totalNoDistributed: new BN(0),
    totalLpShares: new BN(0),
    resolved: false,
    winningSide: 0,
    bump: 0,
    name: [80],
    initialPriceBps: 5000,
    group: null as never,
    ...over,
  } as MarketAccount;
}

describe("marketState + quoteSwap (synthetic 50/50 market)", () => {
  it("prices a 50/50 market at ~50%", () => {
    const s = marketState(makeMarket());
    expect(s.price).toBeGreaterThan(0.49);
    expect(s.price).toBeLessThan(0.51);
    expect(s.expired).toBe(false);
    expect(s.resolved).toBe(false);
  });

  it("quotes a YES buy with the 2% fee taken and a positive output", () => {
    const m = makeMarket();
    const quote = quoteSwap(m, "usdcToYes", 5_000_000);
    expect(quote.out).toBeGreaterThan(0);
    expect(quote.fee).toBe(100_000); // 2% of 5,000,000
    expect(quote.avgPrice).toBeGreaterThan(0);
    expect(minOutput(quote)).toBeLessThan(quote.out); // 1% slippage
    expect(minOutput(quote)).toBeGreaterThan(0.98 * quote.out);
  });

  it("quotes NO buys and YES<->NO swaps (free of fee)", () => {
    const m = makeMarket();
    const no = quoteSwap(m, "usdcToNo", 5_000_000);
    expect(no.out).toBeGreaterThan(0);
    expect(no.fee).toBe(100_000);
    const flip = quoteSwap(m, "yesToNo", 1_000_000);
    expect(flip.out).toBeGreaterThan(0);
    expect(flip.fee).toBe(0);
  });

  it("refuses quotes on expired markets", () => {
    const now = Math.floor(Date.now() / 1000);
    const m = makeMarket({ endTs: new BN(now - 10) });
    expect(() => quoteSwap(m, "usdcToYes", 5_000_000)).toThrow(/expired/);
  });

  it("reports a resolved market with a pinned price", () => {
    const m = makeMarket({ resolved: true, winningSide: 1 });
    const s = marketState(m);
    expect(s.resolved).toBe(true);
    expect(s.winner).toBe("yes");
    expect(s.price).toBe(1);
  });
});
