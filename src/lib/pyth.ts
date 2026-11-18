/**
 * Pyth prices — read ON-CHAIN from the Pyth pull-oracle (push oracle
 * program) PriceUpdateAccounts on Solana devnet.
 *
 * Why on-chain, not Hermes:
 * - The Hermes REST price-updates endpoint (`/v2/updates/price/latest`,
 *   `/v2/updates/price/{t}`) returns HTTP 401 from this environment
 *   (verified via curl, Node fetch, and the browser fetcher, 18 Nov 2026).
 *   The price_feeds metadata endpoint works, but it carries no prices.
 * - The OLD Pyth push-oracle price accounts on devnet are stale since
 *   Aug 2024 (last publish slot ~322M vs ~523M now).
 * - The pull-oracle PriceUpdateAccounts ARE live on devnet (SOL updated
 *   minutes before the check; prices match other venues to <0.1%).
 *
 * Layout (PriceUpdateAccount, 134 bytes, verified live 18 Nov 2026):
 *   0..8    discriminator
 *   8..40   write authority
 *   40      verification level
 *   41..73  feed id (32 bytes — must match the requested feed)
 *   73..81  price (i64, scaled by exponent)
 *   81..89  confidence (u64, same scale)
 *   89..93  exponent (i32)
 *   93..101 publish time (i64 unix seconds)
 *   101..109 previous publish time (i64)
 *   ...     ema price / ema conf (not used here)
 *
 * The PDA for a feed is derived from the push-oracle program id with
 * seeds [shardId as u16 LE (2 bytes), feedId (32 bytes)], shard 0.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { ASSETS, PYTH_PUSH_ORACLE_PROGRAM_ID } from "./constants";

export interface PythPrice {
  /** Price in USD (float). */
  price: number;
  /** ± confidence interval in USD (float). */
  conf: number;
  /** Unix timestamp the price was published. */
  publishTime: number;
  /** Price feed id (hex). */
  id: string;
}

/** PDA of the pull-oracle PriceUpdateAccount for a feed id (hex, no 0x). */
export function pythPriceAccountPda(feedIdHex: string): PublicKey {
  const shard = Buffer.alloc(2);
  shard.writeUInt16LE(0, 0);
  const [pda] = PublicKey.findProgramAddressSync(
    [shard, Buffer.from(feedIdHex, "hex")],
    PYTH_PUSH_ORACLE_PROGRAM_ID,
  );
  return pda;
}

/** Parse a PriceUpdateAccount's data. Returns null on bad layout / feed mismatch. */
export function parsePriceUpdateAccount(
  feedIdHex: string,
  data: Buffer,
): PythPrice | null {
  if (!data || data.length < 109) return null;
  const feedId = data.subarray(41, 73).toString("hex");
  if (feedId !== feedIdHex.toLowerCase()) return null;
  const priceRaw = data.readBigInt64LE(73);
  const confRaw = data.readBigUInt64LE(81);
  const expo = data.readInt32LE(89);
  const publishTime = Number(data.readBigInt64LE(93));
  if (!Number.isFinite(publishTime) || publishTime <= 0) return null;
  const scale = Math.pow(10, expo);
  return {
    price: Number(priceRaw) * scale,
    conf: Number(confRaw) * scale,
    publishTime,
    id: feedIdHex,
  };
}

/** Read all configured assets' on-chain Pyth prices in ONE RPC call. */
export async function fetchOnChainPrices(
  connection: Connection,
): Promise<Record<string, PythPrice>> {
  const pdas = ASSETS.map((a) => pythPriceAccountPda(a.pythFeedId));
  const infos = await connection.getMultipleAccountsInfo(pdas);
  const out: Record<string, PythPrice> = {};
  infos.forEach((info, i) => {
    if (!info) return;
    const parsed = parsePriceUpdateAccount(ASSETS[i].pythFeedId, info.data);
    if (parsed) out[ASSETS[i].symbol] = parsed;
  });
  return out;
}

export interface PriceObservation extends PythPrice {
  /** When this process observed the price (unix seconds). */
  observedAt: number;
}

/**
 * Settlement rule: the first Pyth price published AT OR AFTER expiry,
 * within `maxAfterExpirySecs`. Returns it, or null when no observation
 * qualifies yet (the keeper keeps waiting / holds).
 */
export function selectObservationAt(
  observations: PriceObservation[],
  endTs: number,
  maxAfterExpirySecs: number,
): PriceObservation | null {
  const candidates = observations
    .filter((o) => o.publishTime >= endTs && o.publishTime - endTs <= maxAfterExpirySecs)
    .sort((a, b) => a.publishTime - b.publishTime);
  return candidates[0] ?? null;
}
