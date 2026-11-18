/** One PriceCall market card: terms, live YES price, countdown, status. */
import { marketState } from "../lib/pm-amm-helpers";
import { formatDateTime, formatPct, formatTimeLeft } from "../lib/format";
import type { PriceCallMarket } from "../lib/pmamm";
import type { PythPrice } from "../lib/pyth";
import { formatUsd } from "../lib/format";

export function MarketCard({
  market,
  pyth,
  selected,
  onSelect,
}: {
  market: PriceCallMarket;
  pyth: PythPrice | undefined;
  selected: boolean;
  onSelect: () => void;
}) {
  const { account, symbol, direction, strike, endTs, seeded } = market;
  const now = Math.floor(Date.now() / 1000);
  const state = marketState(account, now);
  const live = !state.resolved && !state.expired;
  const question = `Will ${symbol} close ${direction === "above" ? "above" : "below"} ${formatUsd(strike, symbol === "BTC" ? 0 : 2)}?`;
  return (
    <button
      className={`card${selected ? " selected" : ""}`}
      onClick={onSelect}
      type="button"
    >
      <div className="card-title">{question}</div>
      <div className="card-row">
        <span className="yes-price">YES {formatPct(state.price)}</span>
        <span className="muted">
          {state.resolved
            ? state.winner === "yes"
              ? "Resolved: YES won"
              : "Resolved: NO won"
            : live
              ? `${formatTimeLeft(state.secondsLeft)} left`
              : "Expired — awaiting resolution"}
        </span>
      </div>
      <div className="card-row muted small">
        <span>
          Expires {formatDateTime(endTs)}
          {pyth ? ` · ${symbol} now ${formatUsd(pyth.price, symbol === "BTC" ? 0 : 2)}` : ""}
        </span>
        <span>{seeded ? "Keeper-resolved" : "Self-resolved"}</span>
      </div>
    </button>
  );
}
