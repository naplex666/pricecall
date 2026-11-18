/** Create a price market. The creator (your burner wallet) becomes the market authority. */
import { useState } from "react";
import type { PmAmmClient } from "@pm-amm/sdk";
import { ASSETS, EXPIRY_PRESETS } from "../lib/constants";
import { buildMarketName } from "../lib/pmamm";
import type { Direction } from "../lib/resolution";
import { formatUsd } from "../lib/format";
import type { PythPrice } from "../lib/pyth";

export function CreateMarketForm({
  client,
  prices,
  onCreated,
}: {
  client: PmAmmClient;
  prices: Record<string, PythPrice>;
  onCreated: () => void;
}) {
  const [symbol, setSymbol] = useState("SOL");
  const [direction, setDirection] = useState<Direction>("above");
  const [strike, setStrike] = useState("");
  const [expirySecs, setExpirySecs] = useState(3600);
  const [deposit, setDeposit] = useState("10");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const asset = ASSETS.find((a) => a.symbol === symbol)!;
  const live = prices[symbol]?.price;
  const strikeNum = Number(strike);

  const suggestStrike = () => {
    if (live) setStrike(String(Math.round(live / asset.strikeStep) * asset.strikeStep));
  };

  const create = async () => {
    if (!strikeNum || strikeNum <= 0) {
      setErr("Enter a strike price.");
      return;
    }
    const depositNum = Number(deposit);
    if (!depositNum || depositNum < 1) {
      setErr("Deposit must be at least 1 mUSDC.");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const endTs = Math.floor(Date.now() / 1000) + expirySecs;
      const name = buildMarketName(symbol, direction, strikeNum, endTs);
      const { marketId, marketPda } = await client.send.createMarket({
        name,
        durationSecs: expirySecs,
        initialPriceBps: 5000,
        depositUsdc: depositNum,
      });
      setMsg(`Market #${marketId} created: ${marketPda}`);
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="create">
      <h3>Create a price market</h3>
      <div className="form-grid">
        <label className="field">
          Asset
          <select value={symbol} onChange={(e) => setSymbol(e.target.value)} disabled={busy}>
            {ASSETS.map((a) => (
              <option key={a.symbol} value={a.symbol}>
                {a.symbol} — {a.name}
                {prices[a.symbol] ? ` (${formatUsd(prices[a.symbol].price, a.symbol === "BTC" ? 0 : 2)})` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Direction
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
            disabled={busy}
          >
            <option value="above">Above (YES if price &gt; strike)</option>
            <option value="below">Below (YES if price &lt; strike)</option>
          </select>
        </label>
        <label className="field">
          Strike (USD)
          <input
            type="number"
            min="0"
            step="any"
            placeholder={live ? `e.g. ${Math.round(live)}` : "e.g. 180"}
            value={strike}
            onChange={(e) => setStrike(e.target.value)}
            disabled={busy}
          />
        </label>
        <label className="field">
          Expires in
          <select
            value={expirySecs}
            onChange={(e) => setExpirySecs(Number(e.target.value))}
            disabled={busy}
          >
            {EXPIRY_PRESETS.map((p) => (
              <option key={p.secs} value={p.secs}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Seed liquidity (mUSDC)
          <input
            type="number"
            min="1"
            step="1"
            value={deposit}
            onChange={(e) => setDeposit(e.target.value)}
            disabled={busy}
          />
        </label>
      </div>
      <div className="trade-row">
        <button className="btn" disabled={busy} onClick={suggestStrike} type="button">
          Strike = live price
        </button>
        <button className="btn primary" disabled={busy} onClick={create} type="button">
          {busy ? "Creating…" : "Create market"}
        </button>
      </div>
      <p className="muted small">
        You become this market&apos;s authority: only your wallet can resolve it.
        Markets seeded by PriceCall (builder wallet) are auto-resolved by the
        Pyth keeper after a 10-minute dispute window.
      </p>
      {msg && <p className="ok">{msg}</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
