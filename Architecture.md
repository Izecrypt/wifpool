# wifpool architecture

## System

```
players --commit($WIF)--> WifDailyPool (mainnet 4663)
                              |
                        keeper bot (cron, off-chain)
                        fetches WIF/USD open + close price
                        calls resolve(roundId, open, close)
                              |
                        winners --claim--> contract pays pro-rata
                        4% of pot rolls to next round
                              |
                        web app (static, reads contract, wallet connect)
```

## Contract design

Single contract `WifDailyPool`, no upgradeability, no external calls except
the $WIF ERC20. Rationale: judges include a security expert; the smallest
possible surface is the feature.

State:
- `rounds[id]`: {openPrice, closePrice, resolved, potUp, potDown, rolloverIn,
  startTime, endTime, totalFee}
- `stakes[round][side][addr]`: amount committed per side.
- `claimed[round][addr]`: bool.
- `rollover`: balance reserved for the next round.
- `keeper`: address allowed to call resolve. Owner can rotate keeper.

Flow:
1. `startRound()` is called at deploy (round 1) and again by anyone after a
   round resolves (round N+1 starts immediately; overlapping is impossible,
   one active round at a time).
2. `commit(side, amount)`: transfers $WIF from player (transferFrom), adds to
   side pot. One side per address per round; switching moves the stake.
3. `resolve(openPrice, closePrice)` (keeper only, after endTime, once):
   stores prices, computes winning side, emits `RoundResolved` with prices,
   source tag, pots, and the rollover amount.
4. `claim(roundId)`: winners pull their pro-rata share of the 96 percent
   pot. Losers get nothing. Unclaimed winnings stay in contract (pull
   pattern, no push).

Security decisions:
- Pull over push for payouts. Reentrancy guard on commit and claim.
- Keeper cannot move player funds, cannot set prices retroactively
   (resolve is one-shot and only stores numbers, all payouts are computed at
   claim time from stored pots).
- No admin withdrawal of player funds. The only privileged flows are
  resolution and keeper rotation.
- Front-running resolution is bounded: commits close at endTime and the
  keeper resolves after endTime, so the outcome price is fixed before the
  window closes.

## Keeper

Node script (scripts/keeper.js), run by cron every 15 minutes:
- If a round is near start: record open price (CoinGecko simple price for the
  World is Flat token id, stored with timestamp and source URL).
- If a round passed endTime and is unresolved: fetch close price, call
  resolve.
- Prices are logged locally and emitted on-chain; discrepancies over 1
  percent between keeper reads are flagged to the owner before resolving.

## Web app

Static single page (no build framework, vanilla JS + ethers v6 via CDN) so it
can be hosted anywhere (GitHub Pages for the demo URL plus IPFS later if
time). Reads contract state via RPC, connects wallet (injected provider),
submits commits and claims. Sections: active round, pots, your stake, past
rounds, leaderboard of win streaks (read from RoundResolved events).

## Chain facts

- Robinhood Chain mainnet chain id 4663. $WIF token:
  `0x5173b8eA6923c2d40267890D45C46a3480954773` (verify symbol/decimals via
  eth_call before first deploy; 18 decimals expected).
- RPC: see `.env` (private endpoint, not committed). Blockscout explorer is
  Cloudflare gated; verification via raw RPC is the fallback path.
- Testnet 46630 exists but the game is only meaningful on mainnet where $WIF
  liquidity lives; deploy straight to mainnet after local tests, fund with
  small real amounts.

## Trust model (stated plainly for judges)

Prices come from CoinGecko via the keeper, not an onchain oracle. The
contract records both prices in an event at resolution time, the keeper
wallet is public, and the price source is named. For a daily game with small
pots this is a reasonable trade; an oracle upgrade path is noted in code
comments as TODO(oracle).
