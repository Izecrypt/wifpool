# wifpool PRD

Daily price-prediction pool for the World is Flat token ($WIF) on Robinhood
Chain. Entry for the world is flat hackathon (worldisflat.fun/build),
categories: games, consumer and payments.

## What it is

Four pools run in parallel: 1 hour,
4 hour, 6 hour and 24 hour rounds. Every round, players commit $WIF
predicting whether the $WIF price goes up or down by round end. When the round closes, the winning
side splits the whole pot (losers included) pro-rata by stake. A fee of 4 percent of the pot
rolls into the next round as a jackpot. That rollover is the flywheel: every round
makes the next one bigger, and a rollover pot is a reason to come back daily.

## Why it fits the hackathon rules

- Uses $WIF onchain on Robinhood Chain (rule 3), real ERC20 transfers in and
  out of the contract.
- Flywheel (rule 7) is the rollover, plus a public streak leaderboard as a
  social retention hook.
- Existing work welcome (rule 6): keeper bot and deployment patterns reuse
  the Familydotfun Robinhood Chain pipeline knowledge.
- Judges can try it live (rule 4): it stays live on mainnet through Nov 6.
- Proof (rule 5): public repo, demo video, real mainnet transactions.

## Scope (v1, submission-ready)

- One Solidity contract: rounds, commit, resolve, claim, rollover accounting.
- Resolution by keeper bot: fetches $WIF/USD from CoinGecko at round open and
  close, calls resolve with both prices. Prices and source are emitted in an
  event, so resolution is inspectable, not a black box.
- Minimal web app: current round, pot, up/down commit, history, claim.
- Deployed on Robinhood Chain mainnet (4663) with several real rounds played.
- Demo video under 5 minutes.

## Explicit non-goals for v1

- No oracle integration (Pyth or similar): keeper resolution with public
  price events is honest and auditable for a game, and keeps scope inside two
  days.
- No referral system, no multi-asset, no mobile app, no account system.
- No custody beyond the contract: players claim their own winnings.

## Numbers (locked)

- Pool lengths: 1 hour, 4 hours, 6 hours, 24 hours, all live at deploy.
- Entry: minimum 1,000 $WIF per commit (18 decimals token), no maximum.
- Fee: 4 percent of the total pot rolls to the next round. Winners take 96
  percent of the whole pot (losers' stake included) plus any jackpot, pro-rata
  by stake.
- One commit per side per address per round (re-committing same side adds
  stake, switching sides moves stake).

## Success criteria

1. Contract deployed on mainnet 4663 and verified readable via RPC.
2. At least 3 full rounds played with real $WIF by at least 2 addresses.
3. Keeper runs 3 consecutive days without a missed resolution.
4. Demo video shows a full round: commit, resolution, claim, rollover.
5. Submitted on worldisflat.fun before Nov 2, 17:30 UTC.
