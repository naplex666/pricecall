// Seed PriceCall markets with the builder wallet (devnet only).
// Creates one market per asset with a strike near the live Pyth price.
// The keeper auto-resolves these after expiry + dispute window.
//
//   node scripts/seed-markets.cjs
// Env: BUILDER_KEY_PATH (default ../quickstart/devnet-wallet.json),
//      RPC_URL (default https://api.devnet.solana.com)
const fs = require("fs");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { AnchorProvider, Wallet } = require("@anchor-lang/core");
const { PmAmmClient } = require("@pm-amm/sdk");
const { withHttpConfirm } = require("./http-confirm.cjs");
const { onChainPrice } = require("./pyth-onchain.cjs");

const PROGRAM_ID = new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
const USDC_MINT = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const APP = "https://pm-amm-devnet.vercel.app";

async function pythPrice(symbol) {
  const p = await onChainPrice(symbol);
  return p.price;
}

async function main() {
  const keyPath = process.env.BUILDER_KEY_PATH || "../quickstart/devnet-wallet.json";
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));
  const connection = withHttpConfirm(new Connection(RPC, "confirmed"));
  const provider = new AnchorProvider(connection, new Wallet(kp), { commitment: "confirmed" });
  const client = PmAmmClient.fromProvider(provider, PROGRAM_ID, USDC_MINT);
  console.log(`builder ${kp.publicKey.toBase58()}`);

  const plan = [
    { symbol: "SOL", direction: "above", durationSecs: 3600, deposit: 50 },
    { symbol: "BTC", direction: "above", durationSecs: 86400, deposit: 50 },
    { symbol: "ETH", direction: "below", durationSecs: 604800, deposit: 50 },
  ];
  for (const item of plan) {
    const live = await pythPrice(item.symbol);
    const step = item.symbol === "BTC" ? 1000 : item.symbol === "ETH" ? 50 : 5;
    const strike = Math.round(live / step) * step;
    const endTs = Math.floor(Date.now() / 1000) + item.durationSecs;
    const iso = new Date(endTs * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const name = `PriceCall: ${item.symbol} ${item.direction} ${strike} @ ${iso}`;
    const { marketId, marketPda } = await client.send.createMarket({
      name,
      durationSecs: item.durationSecs,
      initialPriceBps: 5000,
      depositUsdc: item.deposit,
    });
    console.log(`${item.symbol} ${item.direction} ${strike} (live ${live}): #${marketId} ${marketPda}`);
    console.log(`  open it: ${APP}/market/${marketId}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
