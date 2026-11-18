// On-chain Pyth pull-oracle reads for Node scripts (devnet).
// Same layout as src/lib/pyth.ts: PriceUpdateAccount, PDA derived from the
// push-oracle program with seeds [shard u16 LE, feedId]. No Hermes — its
// updates endpoint 401s from this VM.
const { Connection, PublicKey } = require("@solana/web3.js");
const { withHttpConfirm } = require("./http-confirm.cjs");

const PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";

const FEEDS = {
  SOL: "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
};

function priceAccountPda(feedIdHex) {
  const shard = Buffer.alloc(2);
  shard.writeUInt16LE(0, 0);
  return PublicKey.findProgramAddressSync(
    [shard, Buffer.from(feedIdHex, "hex")],
    PUSH_ORACLE,
  )[0];
}

function parsePriceUpdateAccount(feedIdHex, data) {
  if (!data || data.length < 109) return null;
  if (data.subarray(41, 73).toString("hex") !== feedIdHex.toLowerCase()) return null;
  const priceRaw = data.readBigInt64LE(73);
  const confRaw = data.readBigUInt64LE(81);
  const expo = data.readInt32LE(89);
  const publishTime = Number(data.readBigInt64LE(93));
  if (!Number.isFinite(publishTime) || publishTime <= 0) return null;
  const scale = Math.pow(10, expo);
  return {
    price: Number(priceRaw) * scale,
    conf: Number(confRaw) * scale,
    publishTime,
    id: feedIdHex,
  };
}

let _connection = null;
function connection() {
  if (!_connection) {
    _connection = withHttpConfirm(new Connection(RPC, "confirmed"));
  }
  return _connection;
}

async function onChainPrice(symbol) {
  const feedId = FEEDS[symbol];
  const info = await connection().getAccountInfo(priceAccountPda(feedId));
  if (!info) throw new Error(`no Pyth pull-oracle account for ${symbol}`);
  const parsed = parsePriceUpdateAccount(feedId, info.data);
  if (!parsed) throw new Error(`unparsable Pyth account for ${symbol}`);
  return parsed;
}

module.exports = { FEEDS, onChainPrice, parsePriceUpdateAccount, priceAccountPda };
