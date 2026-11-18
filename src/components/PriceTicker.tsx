/** Live Pyth price ticker + sparkline chart (in-memory history, no paid API). */
import { formatUsd } from "../lib/format";
import type { PythPrice } from "../lib/pyth";
import type { PriceHistory } from "../hooks/useData";

export function PriceTicker({
  symbol,
  price,
}: {
  symbol: string;
  price: PythPrice | undefined;
}) {
  if (!price) return <span className="ticker">{symbol}: …</span>;
  const age = Math.floor(Date.now() / 1000) - price.publishTime;
  return (
    <span className="ticker">
      <b>{symbol}</b> {formatUsd(price.price, symbol === "BTC" ? 0 : 2)}
      <span className="muted"> ±{formatUsd(price.conf, 2)}</span>
      <span className="muted"> · {age}s ago</span>
    </span>
  );
}

export function PriceChart({ history }: { history: PriceHistory }) {
  const pts = history.points;
  if (pts.length < 2) return <div className="chart empty">Collecting live prices…</div>;
  const w = 260;
  const h = 60;
  const min = Math.min(...pts.map((p) => p.price));
  const max = Math.max(...pts.map((p) => p.price));
  const span = max - min || 1;
  const xy = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * w;
    const y = h - 4 - ((p.price - min) / span) * (h - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const first = pts[0].price;
  const last = pts[pts.length - 1].price;
  const up = last >= first;
  return (
    <div className="chart">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        <polyline
          points={xy.join(" ")}
          fill="none"
          stroke={up ? "#2ea043" : "#da3633"}
          strokeWidth="2"
        />
      </svg>
      <div className="muted small">
        {history.symbol} live · {formatUsd(min, 2)} – {formatUsd(max, 2)} (session)
      </div>
    </div>
  );
}
