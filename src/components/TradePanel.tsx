/** Trade panel: quote + buy/sell YES/NO, positions, claim winnings. */
import { useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { PmAmmClient } from "@pm-amm/sdk";
import { marketState, minOutput, quoteSwap } from "../lib/pm-amm-helpers";
import { formatPct, formatUsd } from "../lib/format";
import type { PriceCallMarket } from "../lib/pmamm";

interface Position {
  yes: number;
  no: number;
}

export function TradePanel({
  market,
  client,
  owner,
  onTraded,
}: {
  market: PriceCallMarket;
  client: PmAmmClient;
  owner: PublicKey;
  onTraded: () => void;
}) {
  const [amount, setAmount] = useState("5");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [position, setPosition] = useState<Position>({ yes: 0, no: 0 });
  const { account, pda } = market;

  const refreshPosition = useCallback(async () => {
    try {
      const [yes, no] = await Promise.all(
        [client.yesMint(pda), client.noMint(pda)].map(async (mint) => {
          const ata = getAssociatedTokenAddressSync(mint, owner);
          return client.connection
            .getTokenAccountBalance(ata)
            .then((b) => Number(b.value.uiAmount ?? 0))
            .catch(() => 0);
        }),
      );
      setPosition({ yes, no });
    } catch {
      /* balances are best-effort */
    }
  }, [client, owner, pda]);

  useEffect(() => {
    refreshPosition();
  }, [refreshPosition, market]);

  const now = Math.floor(Date.now() / 1000);
  const state = marketState(account, now);
  const amountNum = Math.max(0, Number(amount) || 0);
  const amountMicro = Math.floor(amountNum * 1_000_000);
  const tradable = !state.resolved && !state.expired;

  const quote = (direction: "usdcToYes" | "usdcToNo" | "yesToUsdc" | "noToUsdc") => {
    try {
      if (amountMicro <= 0) return null;
      return quoteSwap(account, direction, amountMicro);
    } catch {
      return null;
    }
  };
  const qYes = quote("usdcToYes");
  const qNo = quote("usdcToNo");

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(`${label} confirmed.`);
      await refreshPosition();
      onTraded();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const buy = (side: "yes" | "no") => {
    const q = side === "yes" ? qYes : qNo;
    if (!q) return;
    run(`Buy ${side.toUpperCase()}`, () =>
      client.send.swap(
        pda,
        side === "yes" ? "usdcToYes" : "usdcToNo",
        amountMicro,
        minOutput(q),
      ),
    );
  };

  const sell = (side: "yes" | "no") => {
    const bal = side === "yes" ? position.yes : position.no;
    if (bal <= 0) return;
    const sellMicro = Math.floor(bal * 1_000_000);
    const q = quote(side === "yes" ? "yesToUsdc" : "noToUsdc");
    if (!q) return;
    run(`Sell ${side.toUpperCase()}`, () =>
      client.send.swap(
        pda,
        side === "yes" ? "yesToUsdc" : "noToUsdc",
        sellMicro,
        minOutput(q),
      ),
    );
  };

  const claim = () =>
    run("Claim winnings", () => client.send.claimWinnings(pda));

  const claimable =
    state.resolved && state.winner
      ? state.winner === "yes"
        ? position.yes
        : position.no
      : 0;

  return (
    <div className="trade">
      <div className="trade-row">
        <span>
          YES <b>{formatPct(state.price)}</b>
        </span>
        <span>
          NO <b>{formatPct(1 - state.price)}</b>
        </span>
        <span className="muted small">
          2% fee on the USDC leg · 1% slippage
        </span>
      </div>
      {tradable && (
        <>
          <label className="field">
            Amount (mUSDC)
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy !== null}
            />
          </label>
          <div className="trade-row">
            <button
              className="btn yes"
              disabled={busy !== null || !qYes}
              onClick={() => buy("yes")}
              type="button"
            >
              {busy === "Buy YES" ? "…" : `Buy YES → ~${qYes ? qYes.out / 1e6 : 0} YES`}
            </button>
            <button
              className="btn no"
              disabled={busy !== null || !qNo}
              onClick={() => buy("no")}
              type="button"
            >
              {busy === "Buy NO" ? "…" : `Buy NO → ~${qNo ? qNo.out / 1e6 : 0} NO`}
            </button>
          </div>
        </>
      )}
      <div className="trade-row small">
        <span>
          Your position: {position.yes.toFixed(2)} YES · {position.no.toFixed(2)} NO
        </span>
        <span>
          {(position.yes > 0 || position.no > 0) && tradable && (
            <>
              <button disabled={busy !== null || position.yes <= 0} onClick={() => sell("yes")} type="button">
                Sell YES
              </button>{" "}
              <button disabled={busy !== null || position.no <= 0} onClick={() => sell("no")} type="button">
                Sell NO
              </button>
            </>
          )}
        </span>
      </div>
      {claimable > 0 && (
        <button className="btn claim" disabled={busy !== null} onClick={claim} type="button">
          {busy === "Claim winnings" ? "…" : `Claim ${formatUsd(claimable, 2)} winnings`}
        </button>
      )}
      {state.resolved && claimable === 0 && (
        <p className="muted small">Resolved — no winning tokens in this wallet.</p>
      )}
      {msg && <p className="ok">{msg}</p>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}
