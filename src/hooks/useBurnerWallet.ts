"use client";
/**
 * React hook: a funded devnet burner wallet + a signing pm-AMM client.
 * Adapted from the pm-AMM kit (useBurnerWallet.ts); the connection uses
 * HTTP-poll confirmation (see lib/burner.ts) — websocket confirmation is
 * broken on this VM.
 *
 *   const { client, publicKey, balances, status, error, refresh } = useBurnerWallet();
 *   await client?.send.swap(market, "usdcToYes", 5_000_000, minOut);
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Keypair } from "@solana/web3.js";
import type { PmAmmClient } from "@pm-amm/sdk";
import {
  DEVNET,
  type Balances,
  createBurnerClient,
  createBurnerConnection,
  ensureFunded,
  exportBurner,
  getBalances,
  importBurner,
  loadOrCreateBurner,
  resetBurner,
} from "../lib/burner";

export type BurnerStatus = "loading" | "funding" | "ready" | "error";

export function useBurnerWallet(opts: { storageKey?: string; rpc?: string } = {}) {
  const { storageKey, rpc = DEVNET.rpc } = opts;
  const connection = useMemo(() => createBurnerConnection(rpc), [rpc]);
  const [keypair, setKeypair] = useState<Keypair | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [status, setStatus] = useState<BurnerStatus>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setKeypair(loadOrCreateBurner(storageKey)), [storageKey]);

  const client: PmAmmClient | null = useMemo(
    () => (keypair ? createBurnerClient(connection, keypair) : null),
    [connection, keypair],
  );

  useEffect(() => {
    if (!keypair) return;
    let cancelled = false;
    setStatus("funding");
    ensureFunded(connection, keypair.publicKey).then(({ balances, fund }) => {
      if (cancelled) return;
      setBalances(balances);
      const empty = balances.sol === 0 || balances.usdc === 0;
      if (fund && !fund.funded && empty) {
        setError(fund.reason);
        setStatus("error");
      } else {
        setError(null);
        setStatus("ready");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [connection, keypair]);

  const refresh = useCallback(async () => {
    if (keypair) setBalances(await getBalances(connection, keypair.publicKey));
  }, [connection, keypair]);

  // Keypair.publicKey is a getter returning a NEW PublicKey on every access:
  // memoize it so dependent effects don't loop.
  const publicKey = useMemo(() => keypair?.publicKey ?? null, [keypair]);

  return {
    publicKey,
    client,
    connection,
    balances,
    status,
    error,
    refresh,
    exportKey: () => exportBurner(storageKey),
    importKey: (secret: string) => setKeypair(importBurner(secret, storageKey)),
    reset: () => {
      resetBurner(storageKey);
      setKeypair(loadOrCreateBurner(storageKey));
    },
  };
}
