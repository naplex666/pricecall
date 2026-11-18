// One-off discovery: find the devnet Pyth price-account pubkeys for
// SOL/USD, BTC/USD, ETH/USD by reading the Pyth program's accounts
// on-chain (no Hermes — its updates endpoint 401s from this VM).
// Prints the pubkeys + current prices; copy the pubkeys into
// src/lib/constants.ts (they are stable on-chain addresses).
const { Connection, PublicKey } = require("@solana/web3.js");
const {
  PythHttpClient,
  getPythProgramKeyForCluster,
} = require("@pythnetwork/client");
const { withHttpConfirm } = require("./http-confirm.cjs");

async function main() {
  const connection = withHttpConfirm(
    new Connection("https://api.devnet.solana.com", "confirmed"),
  );
  const programKey = getPythProgramKeyForCluster("devnet");
  console.log("pyth program:", programKey.toBase58());
  const client = new PythHttpClient(connection, programKey);
  const data = await client.getData();
  for (const symbol of ["Crypto.SOL/USD", "Crypto.BTC/USD", "Crypto.ETH/USD"]) {
    const product = data.productFromSymbol.get(symbol);
    const price = data.productPrice.get(symbol);
    if (!product || !price) {
      console.log(symbol, "NOT FOUND");
      continue;
    }
    console.log(
      `${symbol}: priceAccount=${product.priceAccountKey?.toBase58?.() ?? product.priceAccountKey} ` +
        `price=${price.price} conf=${price.confidence} status=${price.status} ts=${price.timestamp}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
