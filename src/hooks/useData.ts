/**
 * Hooks for live Pyth prices + PriceCall market list.
 * Both poll at POLL_INTERVAL_MS (15s) and pause when the tab is hidden
 * (public devnet RPC rate-limits hard).
 */
import { useEffect, useRef, useState } from "react";
import { ASSETS, DEVNET_RPC, POLL_INTERVAL_MS } from "../lib/constants";
import { createHttpConnection } from "../lib/httpConfirm";
import { fetchOnChainPrices, type PythPrice } from "../lib/pyth";
import { createReadOnlyClient, listPriceCallMarkets, type PriceCallMarket } from "../lib/pmamm";
import { getBuilderPubkey } from "../lib/builderPubkey";

export interface PriceHistory {
  symbol: string;
  points: { t: number; price: number }[];
}

export function usePythPrices() {
  const [prices, setPrices] = useState<Record<string, PythPrice>>({});
  const [history, setHistory] = useState<PriceHistory[]>(
    ASSETS.map((a) => ({ symbol: a.symbol, points: [] })),
  );
  const [error, setError] = useState<string | null>(null);
  // On-chain Pyth pull-oracle reads (no Hermes — its updates endpoint 401s
  // from this environment; see lib/pyth.ts).
  const connectionRef = useRef(createHttpConnection(DEVNET_RPC));

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const latest = await fetchOnChainPrices(connectionRef.current);
        if (cancelled) return;
        const now = Date.now();
        setPrices((prev) => ({ ...prev, ...latest }));
        setHistory((prev) =>
          prev.map((h) => {
            const p = latest[h.symbol];
            if (!p) return h;
            const points = [...h.points, { t: now, price: p.price }].slice(-120);
            return { ...h, points };
          }),
        );
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { prices, history, error };
}

export function useMarkets(refreshKey: number) {
  const [markets, setMarkets] = useState<PriceCallMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef(createReadOnlyClient());

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const list = await listPriceCallMarkets(clientRef.current, getBuilderPubkey());
        if (cancelled) return;
        setMarkets(list);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshKey]);

  return { markets, loading, error };
}
