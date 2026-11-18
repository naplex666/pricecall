/**
 * Keeper resolution logic — pure functions, no chain / network access.
 * One source of truth, used by the keeper and unit-tested directly.
 *
 * A price market asks "will <asset> be ABOVE <strike> at expiry?" (direction
 * "above") or "BELOW <strike>" (direction "below"). YES wins when the
 * condition holds at expiry.
 *
 * Safety gates (all must pass before an outcome is proposed):
 * 1. A Pyth price update must exist whose publish_time is within
 *    `maxAgeSecs` of the market's endTs (default 60s). Older / missing
 *    price → HOLD (manual review). The keeper supplies the first price
 *    published at/after expiry and passes a wider bound for it
 *    (MAX_WAIT_AFTER_EXPIRY_SECS) — the settlement rule is "first Pyth
 *    price at/after expiry", disclosed in the README.
 * 2. The strike must lie OUTSIDE the price's confidence band
 *    [price - conf, price + conf]. If the strike is inside the band, the
 *    true price could be on either side of the strike → HOLD (manual
 *    review). Resolving anyway would be a coin flip dressed as an oracle.
 * 3. A dispute window (DISPUTE_WINDOW_SECS) runs after the outcome is
 *    proposed, during which the proposal is visible and anyone can object
 *    (v1: objection = the keeper operator does not resolve; the window is a
 *    public record in keeper-state.json + the UI). Only after the window
 *    closes with no hold does the keeper call resolveMarket.
 */
import {
  DISPUTE_WINDOW_SECS,
  MAX_PRICE_AGE_AT_EXPIRY_SECS,
} from "./constants";

export type Direction = "above" | "below";
export type Side = "yes" | "no";

export interface PriceAtExpiry {
  price: number;
  conf: number;
  publishTime: number;
}

export type Decision =
  | { kind: "resolve"; side: Side; price: number; conf: number; publishTime: number }
  | { kind: "hold"; reason: string; price: number | null; publishTime: number | null };

/** Decide the outcome of a price market from the Pyth price at expiry. */
export function decideOutcome(
  direction: Direction,
  strike: number,
  endTs: number,
  atExpiry: PriceAtExpiry | null,
  maxAgeSecs: number = MAX_PRICE_AGE_AT_EXPIRY_SECS,
): Decision {
  if (!atExpiry) {
    return {
      kind: "hold",
      reason: "no Pyth price update at/after expiry — manual review required",
      price: null,
      publishTime: null,
    };
  }
  const age = Math.abs(atExpiry.publishTime - endTs);
  if (age > maxAgeSecs) {
    return {
      kind: "hold",
      reason: `Pyth price at expiry is ${age}s from endTs (max ${maxAgeSecs}s) — manual review required`,
      price: atExpiry.price,
      publishTime: atExpiry.publishTime,
    };
  }
  const lo = atExpiry.price - atExpiry.conf;
  const hi = atExpiry.price + atExpiry.conf;
  if (strike >= lo && strike <= hi) {
    return {
      kind: "hold",
      reason: `strike $${strike} lies inside the Pyth confidence band [$${lo.toFixed(2)}, $${hi.toFixed(2)}] — outcome is not decidable, manual review required`,
      price: atExpiry.price,
      publishTime: atExpiry.publishTime,
    };
  }
  const above = atExpiry.price > strike;
  const yesWins = direction === "above" ? above : !above;
  return {
    kind: "resolve",
    side: yesWins ? "yes" : "no",
    price: atExpiry.price,
    conf: atExpiry.conf,
    publishTime: atExpiry.publishTime,
  };
}

/** Unix timestamp (seconds) at which a proposal made at `proposedAtSecs` may be executed. */
export function disputeWindowEndsAt(
  proposedAtSecs: number,
  windowSecs: number = DISPUTE_WINDOW_SECS,
): number {
  return proposedAtSecs + windowSecs;
}

export function isDisputeWindowOver(
  proposedAtSecs: number,
  nowSecs: number,
  windowSecs: number = DISPUTE_WINDOW_SECS,
): boolean {
  return nowSecs >= disputeWindowEndsAt(proposedAtSecs, windowSecs);
}
