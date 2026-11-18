/**
 * Burner wallets for PriceCall (devnet): visitors trade in one tap, with no
 * wallet extension and no devnet setup.
 *
 * Adapted from the pm-AMM burner kit (https://predict-pm-amm.dev/burner/):
 * - storage key is PriceCall-specific so apps on the same domain don't share
 *   a wallet;
 * - faucet confirmation uses the HTTP-poll patch (see httpConfirm.ts) —
 *   websocket confirmation is broken on this VM, and the kit's stock
 *   `connection.confirmTransaction` would time out.
 *
 * DEVNET ONLY: the secret key lives in localStorage. Never use this pattern
 * with real funds; for mainnet, use a real wallet or an embedded-wallet
 * provider.
 */
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { AnchorProvider } from "@anchor-lang/core";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PmAmmClient } from "@pm-amm/sdk";
import bs58 from "bs58";
import { FAUCET_URL, PROGRAM_ID, USDC_MINT } from "./constants";
import { createHttpConnection } from "./httpConfirm";

export const DEVNET = {
  rpc: "https://api.devnet.solana.com",
  programId: PROGRAM_ID,
  usdcMint: USDC_MINT,
  faucetUrl: FAUCET_URL,
};

/** PriceCall-specific key so two apps on the same domain don't share a wallet. */
const DEFAULT_KEY = "pricecall-burner";

export function loadOrCreateBurner(storageKey = DEFAULT_KEY): Keypair {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    try {
      return Keypair.fromSecretKey(bs58.decode(saved));
    } catch {
      // corrupted entry: fall through and replace it
    }
  }
  const kp = Keypair.generate();
  localStorage.setItem(storageKey, bs58.encode(kp.secretKey));
  return kp;
}

export function exportBurner(storageKey = DEFAULT_KEY): string | null {
  return localStorage.getItem(storageKey);
}

export function importBurner(secretBase58: string, storageKey = DEFAULT_KEY): Keypair {
  const kp = Keypair.fromSecretKey(bs58.decode(secretBase58.trim()));
  localStorage.setItem(storageKey, bs58.encode(kp.secretKey));
  return kp;
}

export function resetBurner(storageKey = DEFAULT_KEY): void {
  localStorage.removeItem(storageKey);
}

export interface Balances {
  sol: number;
  usdc: number;
}

export async function getBalances(connection: Connection, owner: PublicKey): Promise<Balances> {
  const ata = getAssociatedTokenAddressSync(DEVNET.usdcMint, owner);
  const [lamports, usdc] = await Promise.all([
    connection.getBalance(owner),
    connection
      .getTokenAccountBalance(ata)
      .then((b) => Number(b.value.uiAmount ?? 0))
      .catch(() => 0),
  ]);
  return { sol: lamports / LAMPORTS_PER_SOL, usdc };
}

export type FundResult =
  | { funded: true; signature: string; usdc: number; sol: number }
  | { funded: false; reason: string; retryAfterSecs?: number };

export async function fundBurner(connection: Connection, owner: PublicKey): Promise<FundResult> {
  try {
    const res = await fetch(DEVNET.faucetUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet: owner.toBase58(), role: "player" }),
    });
    const body = await res.json();
    if (!res.ok) {
      const retry = Number(res.headers.get("Retry-After")) || undefined;
      return { funded: false, reason: body.error ?? `faucet ${res.status}`, retryAfterSecs: retry };
    }
    // HTTP-poll confirmation (patched connection) — never websocket.
    await connection.confirmTransaction(body.signature, "confirmed");
    return { funded: true, signature: body.signature, usdc: body.amount, sol: body.sol ?? 0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { funded: false, reason: `faucet unreachable (${msg})` };
  }
}

/** Below these, `ensureFunded` asks the faucet for a top-up. */
export const LOW = { sol: 0.003, usdc: 10 };

export async function ensureFunded(connection: Connection, owner: PublicKey) {
  const before = await getBalances(connection, owner);
  if (before.sol >= LOW.sol && before.usdc >= LOW.usdc) return { balances: before, fund: null };
  const fund = await fundBurner(connection, owner);
  return { balances: fund.funded ? await getBalances(connection, owner) : before, fund };
}

export function keypairWallet(kp: Keypair) {
  const sign = <T extends Transaction | VersionedTransaction>(tx: T): T => {
    if (tx instanceof VersionedTransaction) tx.sign([kp]);
    else tx.partialSign(kp);
    return tx;
  };
  return {
    publicKey: kp.publicKey,
    payer: kp,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T) => sign(tx),
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]) =>
      txs.map(sign),
  };
}

/** A pm-AMM client that signs with the burner, over an HTTP-confirm connection. */
export function createBurnerClient(connection: Connection, kp: Keypair): PmAmmClient {
  const provider = new AnchorProvider(connection, keypairWallet(kp), { commitment: "confirmed" });
  return PmAmmClient.fromProvider(provider, DEVNET.programId, DEVNET.usdcMint);
}

/** Patched devnet connection (HTTP-poll confirmation) for burner use. */
export function createBurnerConnection(rpc = DEVNET.rpc): Connection {
  return createHttpConnection(rpc, "confirmed");
}
