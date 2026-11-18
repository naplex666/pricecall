// Shared HTTP-poll transaction confirmation (plain Node, no bundler).
// Same logic as src/lib/httpConfirm.ts: websocket confirmation is broken
// on this VM (wss:// TLS fails through the egress proxy), so confirm by
// polling getSignatureStatuses over HTTP. Devnet only.
const { Connection } = require("@solana/web3.js");

async function httpConfirmTransaction(connection, signature, timeoutMs = 90000, pollMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await connection.getSignatureStatuses([signature], {
      searchTransactionHistory: true,
    });
    const st = res && res.value && res.value[0];
    if (st && st.err) throw new Error(`tx failed: ${JSON.stringify(st.err)}`);
    if (
      st &&
      (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")
    ) {
      return { context: { slot: st.slot }, value: { err: null } };
    }
    if (Date.now() >= deadline) throw new Error(`HTTP-poll confirm timeout for ${signature}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

function withHttpConfirm(connection) {
  if (connection.__pricecallHttpConfirm) return connection;
  connection.confirmTransaction = (sigOrStrategy) => {
    const sig =
      typeof sigOrStrategy === "string" ? sigOrStrategy : sigOrStrategy.signature;
    return httpConfirmTransaction(connection, sig);
  };
  connection.__pricecallHttpConfirm = true;
  return connection;
}

module.exports = { httpConfirmTransaction, withHttpConfirm };
