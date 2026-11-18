// Live end-to-end smoke test (devnet only — run once SOL is available).
// Creates a 10-minute SOL market, buys YES + NO, then runs the REAL keeper
// (short dispute window) until it resolves, then claims any winnings.
//
//   node scripts/live-smoke.cjs
// Env: BUILDER_KEY_PATH (default ../quickstart/devnet-wallet.json),
//      RPC_URL, DISPUTE_WINDOW_SECS (default 60 for the smoke test),
//      DEPOSIT_USDC (default 10), TRADE_USDC (default 5).
// Do NOT run on mainnet. Do NOT run without devnet SOL (needs ~0.1 SOL).
const fs = require("fs");
const { spawn } = require("child_process");
const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { AnchorProvider, Wallet } = require("@anchor-lang/core");
const { getAssociatedTokenAddressSync } = require("@solana/spl-token");
const { PmAmmClient } = require("@pm-amm/sdk");
const { estimateSwapOutput, i80f48ToNumber, priceFromReserves } = require("@pm-amm/sdk/math");
const { withHttpConfirm } = require("./http-confirm.cjs");
const { onChainPrice } = require("./pyth-onchain.cjs");

const PROGRAM_ID = new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
const USDC_MINT = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const APP = "https://pm-amm-devnet.vercel.app";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pythPrice(symbol) {
  const p = await onChainPrice(symbol);
  return p.price;
}

function marketState(m) {
  const now = Math.floor(Date.now() / 1000);
  const endTs = m.endTs.toNumber();
  const lZero = i80f48ToNumber(m.lZero);
  const lEff = lZero * Math.sqrt(Math.max(endTs - now, 1));
  const lLast = lZero * Math.sqrt(Math.max(endTs - m.lastAccrualTs.toNumber(), 1));
  const x = i80f48ToNumber(m.reserveYes) * (lEff / lLast);
  const y = i80f48ToNumber(m.reserveNo) * (lEff / lLast);
  return { x, y, lEff, price: priceFromReserves(x, y, lEff) };
}

async function main() {
  const keyPath = process.env.BUILDER_KEY_PATH || "../quickstart/devnet-wallet.json";
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));
  const connection = withHttpConfirm(new Connection(RPC, "confirmed"));
  const sol = (await connection.getBalance(kp.publicKey)) / 1e9;
  console.log(`builder ${kp.publicKey.toBase58()} — ${sol} SOL`);
  if (sol < 0.2) throw new Error("need >= 0.2 devnet SOL to run the smoke test");

  const provider = new AnchorProvider(connection, new Wallet(kp), { commitment: "confirmed" });
  const client = PmAmmClient.fromProvider(provider, PROGRAM_ID, USDC_MINT);

  const live = await pythPrice("SOL");
  const strike = Math.round(live / 5) * 5;
  const durationSecs = 600; // 10 min: the on-chain minimum is 300s, but exactly
  // 300 fails with InvalidDuration when the chain clock runs slightly ahead
  // of local time — keep a safety margin.
  const deposit = Number(process.env.DEPOSIT_USDC || 10);
  const trade = Number(process.env.TRADE_USDC || 5);
  const endTs = Math.floor(Date.now() / 1000) + durationSecs;
  const iso = new Date(endTs * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const name = `PriceCall: SOL above ${strike} @ ${iso}`;
  console.log(`live SOL $${live} — creating "${name}" (${deposit} mUSDC seed)`);
  const { marketId, marketPda } = await client.send.createMarket({
    name,
    durationSecs,
    initialPriceBps: 5000,
    depositUsdc: deposit,
  });
  const market = new PublicKey(marketPda);
  console.log(`market #${marketId} ${marketPda} — ${APP}/market/${marketId}`);

  for (const [dir, side] of [["usdcToYes", "yes"], ["usdcToNo", "no"]]) {
    const m = await client.fetchMarket(market);
    const st = marketState(m);
    const amountIn = trade * 1_000_000;
    const { output } = estimateSwapOutput(st.x, st.y, st.lEff, amountIn * 0.98, side);
    const minOut = Math.floor(output * 0.99);
    await client.send.swap(market, dir, amountIn, minOut);
    console.log(`bought ${side.toUpperCase()} with ${trade} mUSDC`);
  }
  const m2 = await client.fetchMarket(market);
  console.log(`YES price now ${(marketState(m2).price * 100).toFixed(1)}%`);

  // Run the REAL keeper until it resolves (short dispute window for the test).
  const dispute = process.env.DISPUTE_WINDOW_SECS || "60";
  console.log(`starting keeper (dispute window ${dispute}s) — waiting for resolution…`);
  const keeper = spawn(
    "node",
    ["dist-keeper/keeper.cjs"],
    {
      cwd: __dirname + "/..",
      env: {
        ...process.env,
        BUILDER_KEY_PATH: keyPath,
        RPC_URL: RPC,
        DISPUTE_WINDOW_SECS: dispute,
        POLL_SECS: "10",
        STATE_PATH: "./keeper-state-smoke.json",
      },
      stdio: "inherit",
    },
  );
  const deadline = Date.now() + (durationSecs + Number(dispute) + 180) * 1000;
  let resolved = null;
  while (Date.now() < deadline) {
    await sleep(10_000);
    const m = await client.fetchMarket(market);
    if (m && m.resolved) {
      resolved = m.winningSide === 1 ? "YES" : "NO";
      break;
    }
  }
  keeper.kill();
  if (!resolved) throw new Error("keeper did not resolve the market in time");
  console.log(`RESOLVED: ${resolved} won`);

  // Claim winnings (if any winning tokens are held).
  const yesMint = client.yesMint(market);
  const noMint = client.noMint(market);
  const winningMint = resolved === "YES" ? yesMint : noMint;
  const ata = getAssociatedTokenAddressSync(winningMint, kp.publicKey);
  const bal = await connection
    .getTokenAccountBalance(ata)
    .then((b) => Number(b.value.uiAmount ?? 0))
    .catch(() => 0);
  console.log(`winning tokens held: ${bal}`);
  if (bal > 0) {
    const sig = await client.send.claimWinnings(market);
    console.log(`claimed ${bal} mUSDC: ${sig}`);
  }
  console.log("SMOKE TEST PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
