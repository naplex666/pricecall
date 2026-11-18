// Claim winnings for a resolved PriceCall market (devnet only).
// Usage: node scripts/claim-smoke.cjs <market-pda> [YES|NO]
// The builder wallet claims its winning-side tokens (1 mUSDC each).
const fs = require("fs");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { AnchorProvider, Wallet } = require("@anchor-lang/core");
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");
const { PmAmmClient } = require("@pm-amm/sdk");
const { withHttpConfirm } = require("./http-confirm.cjs");

const PROGRAM_ID = new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
const USDC_MINT = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";

async function usdcBalance(connection, owner) {
  const ata = getAssociatedTokenAddressSync(USDC_MINT, owner);
  return connection
    .getTokenAccountBalance(ata)
    .then((b) => Number(b.value.uiAmount ?? 0))
    .catch(() => 0);
}

async function main() {
  const market = new PublicKey(process.argv[2]);
  const keyPath = process.env.BUILDER_KEY_PATH || "../quickstart/devnet-wallet.json";
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));
  const connection = withHttpConfirm(new Connection(RPC, "confirmed"));
  const provider = new AnchorProvider(connection, new Wallet(kp), { commitment: "confirmed" });
  const client = PmAmmClient.fromProvider(provider, PROGRAM_ID, USDC_MINT);

  const m = await client.fetchMarket(market);
  if (!m) throw new Error("market not found");
  if (!m.resolved) throw new Error("market not resolved yet — nothing to claim");
  const won = m.winningSide === 1 ? "YES" : "NO";
  console.log(`market resolved: ${won} won (winningSide ${m.winningSide})`);

  const winningMint = won === "YES" ? client.yesMint(market) : client.noMint(market);
  const ata = getAssociatedTokenAddressSync(winningMint, kp.publicKey);
  const bal = await connection
    .getTokenAccountBalance(ata)
    .then((b) => Number(b.value.uiAmount ?? 0))
    .catch(() => 0);
  console.log(`winning tokens held: ${bal}`);
  if (bal <= 0) {
    console.log("no winning tokens — nothing to claim");
    return;
  }
  const before = await usdcBalance(connection, kp.publicKey);
  const sig = await client.send.claimWinnings(market);
  console.log(`claimed ${bal} mUSDC: ${sig}`);
  // Confirm the payout landed.
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const after = await usdcBalance(connection, kp.publicKey);
    if (after > before) {
      console.log(`mUSDC balance: ${before} -> ${after} (+${(after - before).toFixed(2)})`);
      return;
    }
  }
  console.log(`mUSDC balance still ${before} after 30s — check the claim tx manually`);
}

main().catch((e) => {
  console.error("CLAIM FAILED:", e.message);
  process.exit(1);
});
