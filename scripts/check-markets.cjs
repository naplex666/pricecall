// One-off verification: list PriceCall markets on devnet through the same
// query path the frontend uses (readOnly client + fetchAllMarkets).
const { Connection, PublicKey } = require("@solana/web3.js");
const { PmAmmClient } = require("@pm-amm/sdk");
const { withHttpConfirm } = require("./http-confirm.cjs");

const PROGRAM_ID = new PublicKey("GV1FMGHRYBjQLaghE5fnGuYCuCcpdt3GD5xEX3TwN16y");
const USDC_MINT = new PublicKey("3WQ8hCqTNwjrh8WzE2XyoZoUrd1miPcwWfMkmFPUMEWZ");
const BUILDER = new PublicKey("2YJT3QZHdyvF19v6qzvJYqapfDE1HqKSBxPxLdxyQiCv");

(async () => {
  const conn = withHttpConfirm(new Connection("https://api.devnet.solana.com", "confirmed"));
  const client = PmAmmClient.readOnly(conn, PROGRAM_ID, USDC_MINT);
  const all = await client.fetchAllMarkets(443);
  const pc = all.filter(({ account }) => {
    const name = Buffer.from(account.name).toString("utf8").replace(/\0+$/, "");
    return name.startsWith("PriceCall:");
  });
  console.log("total markets on devnet:", all.length, "| PriceCall:", pc.length);
  for (const { publicKey, account } of pc) {
    const name = Buffer.from(account.name).toString("utf8").replace(/\0+$/, "");
    const end = new Date(Number(account.endTs) * 1000).toISOString();
    console.log(
      `- #${account.marketId.toString()} ${publicKey.toBase58()} | ${name} | ends ${end} | resolved: ${account.resolved} | winningSide: ${account.winningSide}`,
    );
  }
  const bal = await conn.getBalance(BUILDER);
  console.log("builder SOL:", bal / 1e9);
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
