/**
 * PriceCall constants — DEVNET ONLY.
 *
 * pm-AMM program + mock USDC: from https://predict-pm-amm.dev/hackathon.md
 * (same program ID runs on devnet and mainnet; the mint is what differs —
 * this file only ever uses the devnet mock-USDC mint).
 * Pyth feed IDs: verified live 18 Nov 2026 against
 * https://hermes.pyth.network/v2/price_feeds (Crypto.SOL/USD etc.).
 */
import { PublicKey } from "@solana/web3.js";

export const DEVNET_RPC = "https://api.devnet.solana.com";
export const PROGRAM_ID = new PublicKey(
  "GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y",
);
export const USDC_MINT = new PublicKey(
  "3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ", // devnet mock USDC (mUSDC), 6 dp
);
export const FAUCET_URL = "https://pm-amm-devnet.vercel.app/api/faucet";
export const REFERENCE_APP = "https://pm-amm-devnet.vercel.app";

/** Every market created through PriceCall carries this name prefix. */
export const MARKET_NAME_PREFIX = "PriceCall:";

export interface PriceAsset {
  symbol: "SOL" | "BTC" | "ETH";
  name: string;
  /** Pyth Hermes v2 price feed id (hex, no 0x). Verified live 18 Nov 2026. */
  pythFeedId: string;
  /** Rough default strike step shown in the create form. */
  strikeStep: number;
}

export const ASSETS: PriceAsset[] = [
  {
    symbol: "SOL",
    name: "Solana",
    pythFeedId:
      "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    strikeStep: 5,
  },
  {
    symbol: "BTC",
    name: "Bitcoin",
    pythFeedId:
      "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    strikeStep: 1000,
  },
  {
    symbol: "ETH",
    name: "Ethereum",
    pythFeedId:
      "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    strikeStep: 50,
  },
];

export const assetBySymbol = (symbol: string): PriceAsset | undefined =>
  ASSETS.find((a) => a.symbol === symbol);

/** How often the UI polls chain + Pyth (ms). Public devnet RPC rate-limits hard — never below 15s. */
export const POLL_INTERVAL_MS = 15_000;

/** Expiry presets offered in the create form (seconds). The on-chain minimum
 * is 300s, but exactly 300s fails with InvalidDuration when the chain clock
 * runs slightly ahead of local time — the shortest preset keeps a margin. */
export const EXPIRY_PRESETS = [
  { label: "10 min (test)", secs: 600 },
  { label: "1 hour", secs: 3600 },
  { label: "1 day", secs: 86_400 },
  { label: "1 week", secs: 604_800 },
];

/** Keeper dispute window (seconds) between proposing an outcome and resolving on-chain. */
export const DISPUTE_WINDOW_SECS = 600;

/** Pyth pull-oracle (push oracle) program — same id on devnet + mainnet. */
export const PYTH_PUSH_ORACLE_PROGRAM_ID = new PublicKey(
  "pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT",
);

/** A Pyth price is usable for resolution only if its publish time is this close to expiry. */
export const MAX_PRICE_AGE_AT_EXPIRY_SECS = 60;

/** Keeper: how long after expiry to wait for the first fresh Pyth observation (seconds). */
export const MAX_WAIT_AFTER_EXPIRY_SECS = 1800;

/** A Pyth price is stale for display if older than this (seconds). */
export const MAX_DISPLAY_PRICE_AGE_SECS = 120;
