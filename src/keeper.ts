/**
 * PriceCall keeper — Pyth auto-resolution for seeded markets.
 *
 * Price source: Pyth pull-oracle PriceUpdateAccounts read ON-CHAIN from
 * Solana devnet (see lib/pyth.ts). The keeper polls them every 10s and
 * records observations. Settlement rule (disclosed in the README): the
 * FIRST Pyth price published at/after expiry, within
 * MAX_WAIT_AFTER_EXPIRY_SECS. After the outcome is proposed it waits out
 * the dispute window, then resolves on-chain with the builder key.
 *
 * Run: `npm run build:keeper && npm run keeper`
 * Env:
 *   BUILDER_KEY_PATH  path to the devnet builder keypair JSON
 *                     (default: ../quickstart/devnet-wallet.json)
 *   RPC_URL           Solana RPC (default: devnet public)
 *   POLL_SECS         price-poll interval (default: 10)
 *   DISPUTE_WINDOW_SECS  override the 10-min dispute window (smoke tests use 60)
 *   MAX_WAIT_AFTER_EXPIRY_SECS  how long to wait for a fresh Pyth
 *                     observation after expiry (default: 1800)
 *   DRY_RUN=1         propose + log, never send a resolve transaction
 *   STATE_PATH        where proposals are persisted (default: ./keeper-state.json)
 *   ONCE=1            run a single pass and exit (useful for smoke tests)
 *
 * DEVNET ONLY. The builder key never leaves this process; it is read from
 * disk per run and never logged. All transactions confirm via HTTP polling
 * (websocket confirmation is broken on this VM — see lib/httpConfirm.ts).
 */
import fs from "fs";
import { Connection, Keypair } from "@solana/web3.js";
import { AnchorProvider, Wallet } from "@anchor-lang/core";
import { PmAmmClient } from "@pm-amm/sdk";
import {
  ASSETS,
  BUILDER_PUBKEY,
  DEVNET_RPC,
  DISPUTE_WINDOW_SECS,
  MAX_WAIT_AFTER_EXPIRY_SECS,
  PROGRAM_ID,
  USDC_MINT,
} from "./lib/constants";
import { createHttpConnection } from "./lib/httpConfirm";
import { listPriceCallMarkets, type PriceCallMarket } from "./lib/pmamm";
import {
  fetchOnChainPrices,
  selectObservationAt,
  type PriceObservation,
} from "./lib/pyth";
import {
  decideOutcome,
  disputeWindowEndsAt,
  isDisputeWindowOver,
  type Side,
} from "./lib/resolution";

const log = (...args: unknown[]) =>
  console.log(new Date().toISOString(), "[keeper]", ...args);

interface Proposal {
  side: Side;
  price: number;
  conf: number;
  publishTime: number;
  proposedAt: number;
}

interface KeeperState {
  proposals: Record<string, Proposal>;
  holds: Record<string, { reason: string; at: number }>;
  resolved: Record<string, { side: Side; signature: string; at: number }>;
}

function loadState(path: string): KeeperState {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8")) as KeeperState;
  } catch {
    return { proposals: {}, holds: {}, resolved: {} };
  }
}

function saveState(path: string, state: KeeperState): void {
  fs.writeFileSync(path, JSON.stringify(state, null, 2));
}

function loadBuilderKeypair(path: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

interface KeeperOpts {
  dryRun: boolean;
  disputeWindowSecs: number;
  maxWaitAfterExpirySecs: number;
}

async function settleMarket(
  m: PriceCallMarket,
  observations: PriceObservation[],
  sendClient: PmAmmClient,
  state: KeeperState,
  statePath: string,
  opts: KeeperOpts,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const key = m.pda.toBase58();
  if (state.resolved[key]) return;
  const observation = selectObservationAt(
    observations,
    m.endTs,
    opts.maxWaitAfterExpirySecs,
  );
  if (!observation) {
    if (now > m.endTs + opts.maxWaitAfterExpirySecs) {
      const reason =
        `no fresh Pyth observation within ${opts.maxWaitAfterExpirySecs}s after expiry ` +
        `— manual review required`;
      log(`HOLD ${key}: ${reason}`);
      state.holds[key] = { reason, at: now };
      saveState(statePath, state);
    } else {
      log(
        `WAITING ${key}: no Pyth observation at/after expiry yet ` +
          `(${now - m.endTs}s since expiry, waiting up to ${opts.maxWaitAfterExpirySecs}s).`,
      );
    }
    return;
  }
  const decision = decideOutcome(
    m.direction,
    m.strike,
    m.endTs,
    observation,
    opts.maxWaitAfterExpirySecs,
  );
  if (decision.kind === "hold") {
    log(`HOLD ${key}: ${decision.reason}`);
    state.holds[key] = { reason: decision.reason, at: now };
    saveState(statePath, state);
    return;
  }
  const existing = state.proposals[key];
  if (!existing) {
    state.proposals[key] = {
      side: decision.side,
      price: decision.price,
      conf: decision.conf,
      publishTime: decision.publishTime,
      proposedAt: now,
    };
    saveState(statePath, state);
    log(
      `PROPOSED ${key}: ${decision.side.toUpperCase()} wins ` +
        `(Pyth $${decision.price} ±$${decision.conf} published ${decision.publishTime}, ` +
        `strike $${m.strike}). Dispute window ends ` +
        `${new Date(disputeWindowEndsAt(now, opts.disputeWindowSecs) * 1000).toISOString()} (${opts.disputeWindowSecs}s).`,
    );
    return;
  }
  if (!isDisputeWindowOver(existing.proposedAt, now, opts.disputeWindowSecs)) {
    log(
      `DISPUTE ${key}: proposed ${existing.side.toUpperCase()}, ` +
        `${disputeWindowEndsAt(existing.proposedAt, opts.disputeWindowSecs) - now}s left in window.`,
    );
    return;
  }
  if (opts.dryRun) {
    log(`DRY-RUN ${key}: would resolve ${existing.side.toUpperCase()} (skipped).`);
    return;
  }
  log(`RESOLVING ${key} as ${existing.side.toUpperCase()}…`);
  const sig = await sendClient.send.resolveMarket(m.pda, existing.side);
  state.resolved[key] = { side: existing.side, signature: sig, at: now };
  delete state.proposals[key];
  saveState(statePath, state);
  log(`RESOLVED ${key}: ${sig}`);
}

async function main(): Promise<void> {
  const builderKeyPath =
    process.env.BUILDER_KEY_PATH ?? "../quickstart/devnet-wallet.json";
  const rpcUrl = process.env.RPC_URL ?? DEVNET_RPC;
  const pollSecs = Number(process.env.POLL_SECS ?? 10);
  const disputeWindowSecs = Number(
    process.env.DISPUTE_WINDOW_SECS ?? DISPUTE_WINDOW_SECS,
  );
  const maxWaitAfterExpirySecs = Number(
    process.env.MAX_WAIT_AFTER_EXPIRY_SECS ?? MAX_WAIT_AFTER_EXPIRY_SECS,
  );
  const dryRun = process.env.DRY_RUN === "1";
  const once = process.env.ONCE === "1";
  const statePath = process.env.STATE_PATH ?? "./keeper-state.json";

  const connection: Connection = createHttpConnection(rpcUrl, "confirmed");
  const readClient = PmAmmClient.readOnly(connection, PROGRAM_ID, USDC_MINT);
  const kp = loadBuilderKeypair(builderKeyPath);
  if (!kp.publicKey.equals(BUILDER_PUBKEY)) {
    throw new Error(
      `builder key mismatch: ${kp.publicKey.toBase58()} is not the PriceCall builder ${BUILDER_PUBKEY.toBase58()}. Refusing to run.`,
    );
  }
  const provider = new AnchorProvider(connection, new Wallet(kp), {
    commitment: "confirmed",
  });
  const sendClient = PmAmmClient.fromProvider(provider, PROGRAM_ID, USDC_MINT);
  const state = loadState(statePath);
  const observations: Record<string, PriceObservation[]> = Object.fromEntries(
    ASSETS.map((a) => [a.symbol, [] as PriceObservation[]]),
  );
  const opts: KeeperOpts = { dryRun, disputeWindowSecs, maxWaitAfterExpirySecs };
  log(
    `starting (builder ${kp.publicKey.toBase58()}, poll ${pollSecs}s, ` +
      `dispute ${disputeWindowSecs}s, maxWait ${maxWaitAfterExpirySecs}s, ` +
      `dryRun=${dryRun}, once=${once})`,
  );

  let markets: PriceCallMarket[] = [];
  let tick = 0;
  for (;;) {
    tick += 1;
    try {
      // Price observations every tick (1 RPC call for all assets).
      const now = Math.floor(Date.now() / 1000);
      const prices = await fetchOnChainPrices(connection);
      for (const [symbol, p] of Object.entries(prices)) {
        const list = observations[symbol];
        if (!list.some((o) => o.publishTime === p.publishTime)) {
          list.push({ ...p, observedAt: now });
          if (list.length > 500) list.splice(0, list.length - 500);
          log(`price ${symbol} $${p.price} ±$${p.conf} (published ${p.publishTime})`);
        }
      }
      // Market list every ~30s (getProgramAccounts is the expensive call).
      if (tick === 1 || tick % 3 === 0) {
        markets = await listPriceCallMarkets(readClient);
      }
      const due = markets.filter(
        (m) => m.seeded && m.endTs <= now && !m.account.resolved,
      );
      for (const m of due) {
        await settleMarket(
          m,
          observations[m.symbol] ?? [],
          sendClient,
          state,
          statePath,
          opts,
        );
      }
      if (due.length === 0 && tick % 6 === 0) {
        log("no expired unresolved seeded markets");
      }
    } catch (e) {
      console.error(new Date().toISOString(), "[keeper] tick failed:", e);
    }
    if (once) break;
    await new Promise((r) => setTimeout(r, pollSecs * 1000));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
