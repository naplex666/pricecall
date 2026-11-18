# PriceCall — Price Prediction Markets on Solana

**Devnet only. Test money only. Nothing here has real value.**

PriceCall is a prediction-market app for the Solana Foundation's
[Perps and Prediction Markets Hackathon](https://hackathons.solana.com/hackathons/perps-and-prediction-markets)
($100k main track + $1k pm-AMM bounty, deadline 5 Dec 2026).

Short-duration price markets — *"Will SOL close above $180 by Friday?"* —
priced by the deployed **pm-AMM** and auto-resolved by a **Pyth keeper**.
No custom on-chain program: the pm-AMM already is the AMM.

## The problem

pm-AMM markets are resolved manually by whoever created them. That is the
trust bottleneck for price markets: the resolver can sit on the outcome,
resolve late, or resolve wrong, and traders have no recourse. PriceCall
removes the human from price resolution.

## How it works

1. **Markets** are pm-AMM binary markets on Solana devnet (USDC collateral),
   named `PriceCall: SOL above 180 @ 2026-12-01T16:00:00Z` so any client —
   and the keeper — can parse the terms from the chain alone.
2. **Trading** is one tap: a burner wallet is created in the browser and
   funded with 1,000 test mUSDC by the pm-AMM faucet. Quotes are exact
   (copied helper from the pm-AMM kit, 2% fee included, 1% slippage).
3. **Resolution** is done by the keeper (`src/keeper.ts`):
   - it polls the Pyth pull-oracle price accounts **on-chain** (one RPC
     call for all assets, every 10s) and records observations;
   - **Settlement rule:** the first Pyth price published **at/after
     expiry**, within 30 minutes. If none arrives in that window, the
     keeper HOLDs for manual review — it never resolves on an old price
     and never substitutes another source;
   - **Gate 1 — staleness:** the settling price must be within the wait
     bound of expiry (see above);
   - **Gate 2 — confidence band:** the strike must lie outside
     `[price − conf, price + conf]`. Inside the band the true price could be
     on either side → HOLD. Resolving anyway would be a coin flip dressed
     as an oracle.
   - **Gate 3 — dispute window:** a proposed outcome is published for 10
     minutes before the keeper resolves on-chain. Only then does it call
     `resolveMarket`.
   - Winners claim 1 mUSDC per winning token via `claimWinnings`.
4. Markets created by visitors are theirs to resolve (the creator is the
   market authority on-chain). The keeper only auto-resolves builder-seeded
   markets.

## Why pm-AMM (and not an order book, LMSR, or constant-product AMM)

Outcome tokens pay $1 or $0, so they get more volatile as the price nears
50% and as expiry approaches. A constant-product pool or LMSR gives LPs
liquidity badly matched to that behaviour — they bleed unevenly and are all
but guaranteed to lose everything at expiry. The pm-AMM (Moallemi &
Robinson, Paradigm 2024) is *uniform*: expected losses to arbitrage are a
constant fraction of pool value at any price, liquidity concentrates around
50%, and the dynamic version withdraws liquidity as `√(T−t)` so LPs end
with about half their wealth in expectation instead of zero. For
short-duration price markets — the most volatile case — that is the right
curve, and it already exists on Solana as a tested program (266 tests),
so PriceCall builds the product on top instead of rebuilding the AMM.

## Run it

```bash
npm install
npm run dev        # frontend on http://localhost:5173
npm test           # unit tests (keeper logic, quotes, name encoding)
npm run build      # production build
```

Keeper (needs the devnet builder key at `../quickstart/devnet-wallet.json`):

```bash
npm run build:keeper
npm run keeper     # polls every 30s; DRY_RUN=1 to propose without resolving
```

Seed demo markets (builder wallet, devnet):

```bash
npm run seed
```

Live end-to-end smoke test (needs ≥0.2 devnet SOL — run once SOL is available):

```bash
npm run live-smoke  # 10-min market → trade YES+NO → keeper resolves → claim
```

## Configuration

- `RPC_URL` — Solana RPC (default: public devnet). The public endpoint
  rate-limits; poll intervals are ≥15s and reads are batched.
- `BUILDER_KEY_PATH` — builder keypair JSON (default
  `../quickstart/devnet-wallet.json`). Never commit it, never put it in the
  frontend bundle. The keeper refuses to run if the key is not the
  PriceCall builder.
- `POLL_SECS`, `DISPUTE_WINDOW_SECS`, `MAX_WAIT_AFTER_EXPIRY_SECS`
  (default 1800), `DRY_RUN=1`, `ONCE=1` — keeper tuning.

## Price source: Pyth, read on-chain

The keeper and the frontend read Pyth prices from the pull-oracle
`PriceUpdateAccount`s on Solana devnet (program
`pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`, PDAs derived from the
feed ids — see `src/lib/pyth.ts`). This was a deliberate pivot, verified
live 18 Nov 2026:

- The Hermes REST price-updates endpoint returns HTTP 401 from this
  environment (curl, Node fetch, and the browser fetcher all agree).
  The metadata endpoint works, but it carries no prices.
- The OLD Pyth push-oracle price accounts on devnet are stale since
  Aug 2024 (last publish slot ~322M vs ~523M now).
- The pull-oracle accounts ARE live on devnet (SOL was minutes old at
  the check; prices match other venues to <0.1%). They update in
  bursts, which is why the settlement rule waits for the first price
  published at/after expiry instead of assuming sub-second freshness.

The oracle is still Pyth throughout — only the transport changed, from
Hermes HTTP to the same Pyth prices as published on-chain.

## VM quirk: HTTP-poll confirmation

On this dev machine the egress proxy breaks `wss://` to devnet, so
web3.js `confirmTransaction()` (websocket-based) times out even though the
transaction finalizes. Every connection in PriceCall is patched
(`src/lib/httpConfirm.ts`, `scripts/http-confirm.cjs`) to confirm by
polling `getSignatureStatuses` over HTTP. If you deploy elsewhere this is
harmless — polling works everywhere websockets do.

## Self-audit notes

Checked against the `solana-vulnerability-scanner` skill (Trail of Bits):
the app writes no on-chain program — PDA/account validation, CPI safety and
ownership checks are the pm-AMM program's job (deployed, 266 tests). The
remaining risks are in PriceCall's own code and are handled here:
- the builder key is read from disk by the keeper only, never logged,
  never bundled into the frontend (the frontend only ever holds burner
  keys in localStorage — devnet only, by design);
- the keeper never resolves on a stale price or a price inside the
  confidence band, and never resolves before the dispute window closes;
- the keeper refuses to run with any key other than the builder's, so a
  misconfigured key cannot resolve someone else's markets;
- all amounts go through the SDK helpers (human vs raw 6-dp units are the
  classic footgun — see `src/lib/pm-amm-helpers.ts`).

## What is NOT in v1

Multi-outcome groups, LP dashboard, mobile app, mainnet. Mainnet would
need real USDC and a separate decision — the code has no mainnet path
enabled.

## Known issue: the pm-AMM faucet is not dripping SOL right now

New burner wallets get 1,000 test mUSDC from the faucet, but the faucet
currently returns `sol: 0` (`solSkipped: "reserve"` — verified 18 Nov 2026),
so a fresh burner has no SOL to pay transaction fees and every trade fails
at simulation ("This account may not be used to pay transaction fees").
The app detects this: when a burner holds < 0.003 SOL it shows a warning
with a link to claim 1 free devnet SOL at
[faucet.solana.com](https://faucet.solana.com) (GitHub login, ~1 min) and
disables trading until the wallet is funded. If the faucet resumes its SOL
drip, one-tap trading works with no manual step.

## Live verification (devnet, 18 Nov 2026)

Full end-to-end loop verified live with the devnet builder wallet (address withheld — devnet only, test funds):

- **Create:** `PriceCall: SOL above 75 @ 2026-11-18T03:44:38Z`, market
  #91574155480457 —
  https://pm-amm-devnet.vercel.app/market/91574155480457
- **Trade:** bought YES with 5 mUSDC and NO with 5 mUSDC; YES price 46.3%.
- **Resolve:** keeper waited for the first Pyth price published at/after
  expiry (the devnet Pyth feeder was silent for ~1h; the first fresh
  observation arrived 25 min after expiry, still inside the 30-min wait
  bound), proposed NO ($74.67 < $75, outside the confidence band), waited
  the 60s dispute window, then resolved on-chain —
  `4CV1XupqeecLQbCiJjuNhe9Q23n5KwATN4k5nCXY6WZyNjVbkBtybXNBzkvTSnLjd17djptTK4X1H4rhgdyfGYif`
- **Claim:** 10.889346 NO tokens redeemed for 10.89 mUSDC —
  `4z9oeTapUGseQFwELbMNWjpZ28w2B4FuxuKVz1YcAMgeNNdXEYQvPvv3uH2JfUUMquSkcz2o6w15P3u8MghtHyfU`
  (mUSDC balance 830.1 → 840.99).
- **Seeded demo markets** (all live, unresolved): SOL 1h #261296424131057,
  BTC 1d #12585805152801, ETH 1w #2258594448332.
- **Frontend:** `npm run build` passes; preview serves HTTP 200.

Lessons from the live run:

- A 300s market duration fails on-chain with `InvalidDuration` (6012)
  when the chain clock runs slightly ahead of local time — the shortest
  preset is 600s now, with a safety margin.
- The devnet Pyth pull-oracle feeder updates in bursts (SOL went ~1h
  without a push). The keeper's bounded-wait + HOLD design is what makes
  that survivable: it never resolves on a stale price. Budget long
  deadlines for any live test that depends on a fresh devnet observation.
