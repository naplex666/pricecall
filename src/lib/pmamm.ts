/**
 * pm-AMM client factory + PriceCall market parsing.
 *
 * PriceCall markets are the pm-AMM binary markets whose name starts with
 * "PriceCall:" — the name encodes the market's terms so any client (and the
 * keeper) can parse them without an off-chain database:
 *
 *   PriceCall: SOL above 180 @ 2026-12-01T16:00:00Z
 *   PriceCall: BTC below 90000 @ 2026-12-05T16:00:00Z
 *
 * Format: `PriceCall: <SYMBOL> <above|below> <strike> @ <ISO expiry>`
 */
import { PublicKey } from "@solana/web3.js";
import { PmAmmClient, type MarketAccount } from "@pm-amm/sdk";
import {
  BUILDER_PUBKEY,
  DEVNET_RPC,
  MARKET_NAME_PREFIX,
  PROGRAM_ID,
  USDC_MINT,
} from "./constants";
import { createHttpConnection } from "./httpConfirm";
import { decodeName } from "./format";
import type { Direction } from "./resolution";

export interface PriceCallMarket {
  pda: PublicKey;
  account: MarketAccount;
  symbol: string;
  direction: Direction;
  strike: number;
  endTs: number;
  /** True when the builder wallet created it (keeper auto-resolves these). */
  seeded: boolean;
}

const NAME_RE = /^PriceCall: ([A-Z]+) (above|below) ([0-9.]+) @ (.+)$/;

export function parsePriceCallName(name: number[] | string): {
  symbol: string;
  direction: Direction;
  strike: number;
  iso: string;
} | null {
  const text = decodeName(name);
  const m = NAME_RE.exec(text);
  if (!m) return null;
  return {
    symbol: m[1],
    direction: m[2] as Direction,
    strike: Number(m[3]),
    iso: m[4],
  };
}

export function buildMarketName(
  symbol: string,
  direction: Direction,
  strike: number,
  endTs: number,
): string {
  const iso = new Date(endTs * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  return `${MARKET_NAME_PREFIX} ${symbol} ${direction} ${strike} @ ${iso}`;
}

/** Read-only pm-AMM client over an HTTP-confirm connection. */
export function createReadOnlyClient(rpc = DEVNET_RPC): PmAmmClient {
  const connection = createHttpConnection(rpc, "confirmed");
  return PmAmmClient.readOnly(connection, PROGRAM_ID, USDC_MINT);
}

/** All PriceCall markets on devnet (live + recently resolved), newest first. */
export async function listPriceCallMarkets(
  client: PmAmmClient,
): Promise<PriceCallMarket[]> {
  const all = await client.fetchAllMarkets(443);
  const out: PriceCallMarket[] = [];
  for (const { publicKey, account } of all) {
    const parsed = parsePriceCallName(account.name);
    if (!parsed) continue;
    out.push({
      pda: publicKey,
      account,
      symbol: parsed.symbol,
      direction: parsed.direction,
      strike: parsed.strike,
      endTs: account.endTs.toNumber(),
      seeded: account.authority.equals(BUILDER_PUBKEY),
    });
  }
  out.sort((a, b) => b.endTs - a.endTs);
  return out;
}
