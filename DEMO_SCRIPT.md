# PriceCall — Demo Video Script (≤ 3 minutes)

Target: a judge who has never seen the app. Show the whole loop, no slides.

## 0:00–0:20 — The problem (20s)
- "Prediction markets on Solana have a trust problem: whoever creates a
  market resolves it by hand. They can delay it, or get it wrong."
- "PriceCall fixes that for price markets: the market is priced by the
  pm-AMM, and a Pyth keeper resolves it automatically at expiry."

## 0:20–0:50 — Browse + live prices (30s)
- Open the deployed demo. Burner wallet is created and funded automatically
  (1,000 test mUSDC, no wallet install, no popups).
- Point at the live SOL/BTC/ETH tickers (Pyth prices, updating every 15s)
  and the market list: "Will SOL close above $180?" with the live YES
  price and countdown.

## 0:50–1:30 — Trade in one tap (40s)
- Select a market. Buy 5 mUSDC of YES — show the exact quote (fee
  included) and the position updating.
- Buy some NO as well. Show both sides of the book moving.

## 1:30–2:20 — The keeper resolves (50s)
- Cut to the 10-minute test market created for the demo (or a time-lapse):
  it expires, the keeper proposes an outcome from the Pyth price AT
  expiry, the 10-minute dispute window is shown, then the market resolves
  on-chain.
- Narrate the safety gates while it happens: "The price must be within
  60 seconds of expiry, and the strike must be outside Pyth's confidence
  band — if either fails, the keeper refuses and a human reviews it."

## 2:20–2:50 — Claim (30s)
- The winning side claims: 1 mUSDC per winning token, in one click.
  Show the balance going up.

## 2:50–3:00 — Why pm-AMM (10s)
- "Outcome tokens break constant-product AMMs — LPs lose everything at
  expiry. The pm-AMM's uniform curve is built for exactly this asset, so
  we build on it instead of rebuilding it."

## B-roll / backup
- If the live demo lags, the repo README has the same flow as screenshots,
  and `npm run live-smoke` reproduces the full loop from the terminal.
