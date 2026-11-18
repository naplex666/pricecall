/// <reference types="vite/client" />
import { PublicKey } from "@solana/web3.js";

/**
 * Builder pubkey (the wallet that seeds PriceCall markets, which the keeper
 * auto-resolves). Read from build-time env only — the repo never hardcodes
 * it. Set VITE_BUILDER_PUBKEY when building the demo; null when unset, in
 * which case markets simply aren't labelled "Keeper-resolved".
 */
export function getBuilderPubkey(): PublicKey | null {
  const raw = import.meta.env.VITE_BUILDER_PUBKEY as string | undefined;
  if (!raw) return null;
  try {
    return new PublicKey(raw);
  } catch {
    return null;
  }
}
