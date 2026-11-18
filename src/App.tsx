import { useMemo, useState } from "react";
import { useBurnerWallet } from "./hooks/useBurnerWallet";
import { useMarkets, usePythPrices } from "./hooks/useData";
import { ASSETS } from "./lib/constants";
import { REFERENCE_APP } from "./lib/constants";
import { PriceChart, PriceTicker } from "./components/PriceTicker";
import { MarketCard } from "./components/MarketCard";
import { TradePanel } from "./components/TradePanel";
import { CreateMarketForm } from "./components/CreateMarketForm";
import type { PriceCallMarket } from "./lib/pmamm";

export function App() {
  const { client, publicKey, balances, status, error, refresh } = useBurnerWallet();
  const { prices, history } = usePythPrices();
  const [refreshKey, setRefreshKey] = useState(0);
  const { markets, loading, error: marketsError } = useMarkets(refreshKey);
  const [selectedPda, setSelectedPda] = useState<string | null>(null);

  const selected: PriceCallMarket | undefined = useMemo(
    () => markets.find((m) => m.pda.toBase58() === selectedPda) ?? markets[0],
    [markets, selectedPda],
  );
  const selectedHistory = useMemo(
    () => history.find((h) => h.symbol === (selected?.symbol ?? "SOL")),
    [history, selected],
  );

  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <div className="app">
      <header>
        <h1>PriceCall</h1>
        <span className="muted">Price prediction markets on Solana · devnet</span>
      </header>

      <div className="banner">
        <b>Devnet demo — test money only.</b> Markets run on the pm-AMM
        (Solana devnet) with mock USDC. Nothing here has real value. Seeded
        PriceCall markets are auto-resolved by a Pyth keeper after a 10-minute
        dispute window; markets you create are yours to resolve.
      </div>

      <div className="ticker-row">
        {ASSETS.map((a) => (
          <PriceTicker key={a.symbol} symbol={a.symbol} price={prices[a.symbol]} />
        ))}
      </div>

      <div className="wallet">
        {status === "loading" && <span>Creating your burner wallet…</span>}
        {status === "funding" && <span>Funding your burner wallet (1,000 test mUSDC)…</span>}
        {status === "ready" && publicKey && (
          <span>
            Your burner wallet:{" "}
            <span className="addr">{publicKey.toBase58()}</span>
            {balances && (
              <span className="muted">
                {" "}
                · {balances.usdc.toFixed(2)} mUSDC · {balances.sol.toFixed(3)} SOL
              </span>
            )}{" "}
            <button onClick={refresh} type="button">
              Refresh
            </button>
          </span>
        )}
        {status === "ready" && balances && balances.sol < 0.003 && (
          <p className="err">
            This burner has no SOL for transaction fees (the pm-AMM faucet is
            currently not dripping SOL — it returns <code>solSkipped: "reserve"</code>).
            Claim 1 free devnet SOL for{" "}
            <span className="addr">{publicKey?.toBase58()}</span> at{" "}
            <a href="https://faucet.solana.com" target="_blank" rel="noreferrer">
              faucet.solana.com
            </a>{" "}
            (GitHub login, ~1 min), then press Refresh. Trading stays disabled
            until then.
          </p>
        )}
        {status === "error" && (
          <span className="err">
            Burner wallet failed: {error ?? "unknown error"}. Reload to retry — the
            faucet allows 1 claim per wallet per hour.
          </span>
        )}
      </div>

      <h2>Markets</h2>
      {loading && <p className="muted">Loading markets…</p>}
      {marketsError && <p className="err">{marketsError}</p>}
      {!loading && markets.length === 0 && (
        <p className="muted">
          No PriceCall markets yet — create the first one below, or run the
          seed script (see README).
        </p>
      )}
      <div className="grid">
        {markets.map((m) => (
          <MarketCard
            key={m.pda.toBase58()}
            market={m}
            pyth={prices[m.symbol]}
            selected={selected?.pda.toBase58() === m.pda.toBase58()}
            onSelect={() => setSelectedPda(m.pda.toBase58())}
          />
        ))}
      </div>

      {selected && selectedHistory && (
        <div className="detail">
          <h3>
            {selected.symbol} {selected.direction} ${selected.strike} —{" "}
            <span className="muted">expires {new Date(selected.endTs * 1000).toLocaleString()}</span>
          </h3>
          <PriceChart history={selectedHistory} />
          {client && publicKey ? (
            <TradePanel
              market={selected}
              client={client}
              owner={publicKey}
              onTraded={bump}
              solLow={balances ? balances.sol < 0.003 : false}
            />
          ) : (
            <p className="muted">Waiting for your burner wallet…</p>
          )}
          <p className="muted small">
            Market PDA: <span className="addr">{selected.pda.toBase58()}</span> ·{" "}
            <a
              href={`${REFERENCE_APP}/market/${selected.account.marketId.toString()}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in the pm-AMM reference app
            </a>
          </p>
        </div>
      )}

      {client && (
        <CreateMarketForm client={client} prices={prices} onCreated={bump} />
      )}

      <footer className="muted small">
        <p>
          PriceCall is a hackathon demo for the Solana Perps &amp; Prediction
          Markets Hackathon. Pricing by the pm-AMM (Paradigm, Moallemi &amp;
          Robinson 2024); settlement prices by Pyth. Resolution is
          oracle-based for seeded markets — see README for the keeper&apos;s
          safety gates (staleness, confidence band, dispute window).
        </p>
      </footer>
    </div>
  );
}
