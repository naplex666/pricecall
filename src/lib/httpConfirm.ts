/**
 * HTTP-poll transaction confirmation.
 *
 * WHY: on this VM the egress proxy breaks wss:// to api.devnet.solana.com
 * (TLS "wrong version number" on the websocket upgrade), so web3.js
 * `confirmTransaction()` — which subscribes over websocket — times out
 * after 30s even though the transaction itself lands and finalizes.
 * Plain HTTP JSON-RPC works fine (verified 18 Nov 2026: the pm-AMM faucet
 * tx finalized while the websocket confirmation timed out).
 *
 * Patch a Connection instance (never the global prototype) and every
 * `send.*` / `sendAndConfirm*` call that goes through it will confirm by
 * polling `getSignatureStatuses` over HTTP instead.
 */
import { Connection, type Commitment } from "@solana/web3.js";

export type ConfirmResult = {
  context: { slot: number };
  value: { err: unknown };
};

/** Poll getSignatureStatuses until confirmed/finalized, or throw. */
export async function httpConfirmTransaction(
  connection: Connection,
  signature: string,
  timeoutMs = 90_000,
  pollMs = 2_000,
): Promise<ConfirmResult> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const st = res?.value?.[0];
    if (st?.err) throw new Error(`tx failed: ${JSON.stringify(st.err)}`);
    if (
      st &&
      (st.confirmationStatus === "confirmed" ||
        st.confirmationStatus === "finalized")
    ) {
      return { context: { slot: st.slot }, value: { err: null } };
    }
    if (Date.now() >= deadline) {
      throw new Error(`HTTP-poll confirm timeout for ${signature}`);
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/**
 * Return the same Connection with confirmTransaction replaced by the
 * HTTP-poll implementation. Idempotent per instance.
 */
export function withHttpConfirm(connection: Connection): Connection {
  const conn = connection as Connection & { __pricecallHttpConfirm?: boolean };
  if (conn.__pricecallHttpConfirm) return connection;
  const original = connection.confirmTransaction.bind(connection);
  void original; // kept for reference; the websocket path is never used.
  connection.confirmTransaction = ((
    sigOrStrategy: string | { signature: string },
    _commitment?: Commitment,
  ) => {
    const sig =
      typeof sigOrStrategy === "string"
        ? sigOrStrategy
        : sigOrStrategy.signature;
    return httpConfirmTransaction(connection, sig);
  }) as Connection["confirmTransaction"];
  conn.__pricecallHttpConfirm = true;
  return connection;
}

/** Convenience: a patched devnet Connection. */
export function createHttpConnection(
  rpcUrl: string,
  commitment: Commitment = "confirmed",
): Connection {
  return withHttpConfirm(new Connection(rpcUrl, commitment));
}
