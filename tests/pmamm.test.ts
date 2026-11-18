import { describe, expect, it } from "vitest";
import { buildMarketName, parsePriceCallName } from "../src/lib/pmamm";
import {
  parsePriceUpdateAccount,
  selectObservationAt,
  type PriceObservation,
} from "../src/lib/pyth";

const SOL_FEED =
  "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

/** Build a fake 134-byte PriceUpdateAccount buffer. */
function fakeAccount(price: number, conf: number, expo: number, publishTime: number): Buffer {
  const buf = Buffer.alloc(134);
  Buffer.from(SOL_FEED, "hex").copy(buf, 41);
  buf.writeBigInt64LE(BigInt(Math.round(price / Math.pow(10, expo))), 73);
  buf.writeBigUInt64LE(BigInt(Math.round(conf / Math.pow(10, expo))), 81);
  buf.writeInt32LE(expo, 89);
  buf.writeBigInt64LE(BigInt(publishTime), 93);
  return buf;
}

describe("on-chain Pyth pull-oracle parsing", () => {
  it("parses price/conf/publishTime from the account layout", () => {
    const parsed = parsePriceUpdateAccount(SOL_FEED, fakeAccount(74.68, 0.03, -8, 1794971403));
    expect(parsed?.publishTime).toBe(1794971403);
    expect(parsed?.id).toBe(SOL_FEED);
    expect(parsed?.price).toBeCloseTo(74.68, 6);
    expect(parsed?.conf).toBeCloseTo(0.03, 6);
  });

  it("rejects a feed-id mismatch and a short buffer", () => {
    const buf = fakeAccount(74.68, 0.03, -8, 1794971403);
    expect(parsePriceUpdateAccount("00".repeat(32), buf)).toBeNull();
    expect(parsePriceUpdateAccount(SOL_FEED, Buffer.alloc(50))).toBeNull();
  });
});

describe("selectObservationAt (first price at/after expiry)", () => {
  const obs = (publishTime: number): PriceObservation => ({
    price: 180,
    conf: 0.5,
    publishTime,
    id: SOL_FEED,
    observedAt: publishTime,
  });
  const endTs = 1_800_000_000;

  it("picks the earliest observation at/after expiry within the wait bound", () => {
    const picked = selectObservationAt(
      [obs(endTs + 900), obs(endTs + 60), obs(endTs - 30)],
      endTs,
      1800,
    );
    expect(picked?.publishTime).toBe(endTs + 60);
  });

  it("returns null when nothing was published after expiry yet", () => {
    expect(selectObservationAt([obs(endTs - 30)], endTs, 1800)).toBeNull();
  });

  it("returns null when the first post-expiry observation is past the wait bound", () => {
    expect(selectObservationAt([obs(endTs + 3600)], endTs, 1800)).toBeNull();
  });
});

describe("market name encoding", () => {
  it("round-trips through build + parse", () => {
    const endTs = 1_800_000_000;
    const name = buildMarketName("SOL", "above", 180, endTs);
    expect(name).toBe("PriceCall: SOL above 180 @ 2027-01-15T08:00:00Z");
    const parsed = parsePriceCallName(name);
    expect(parsed).toEqual({
      symbol: "SOL",
      direction: "above",
      strike: 180,
      iso: "2027-01-15T08:00:00Z",
    });
  });

  it("parses a name stored as bytes", () => {
    const bytes = Array.from(
      new TextEncoder().encode("PriceCall: BTC below 90000 @ 2026-12-05T16:00:00Z"),
    );
    expect(parsePriceCallName(bytes)).toEqual({
      symbol: "BTC",
      direction: "below",
      strike: 90000,
      iso: "2026-12-05T16:00:00Z",
    });
  });

  it("rejects non-PriceCall names", () => {
    expect(parsePriceCallName("Quickstart 2026-11-18")).toBeNull();
    expect(parsePriceCallName("PriceCall: nope")).toBeNull();
    expect(parsePriceCallName("")).toBeNull();
  });
});
