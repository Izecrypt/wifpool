# wifpool Architecture Essentials

Quick reference for agents working in this repo. Full design in Architecture.md.

## Invariants (never break)

1. Player funds live in the contract and can only leave via `claim` (winners,
   pro-rata) or `refund` (unresolved round emergency path).
2. The keeper can only call `resolve` once per round, after `endTime`, and
   only stores prices. All payout math happens at claim time from stored
   pots.
3. Each pool has at most one unresolved round.
   `startRound(poolId)` requires that pool's previous round to be resolved.
4. The 4 percent fee goes only to `rolloverOf[poolId]`, only ever added to
   the same pool's next round as its jackpot. No admin fund extraction exists.
5. Rollover counts toward nobody's winnings; it is house-seeded pot, not
   player money.

## Commands

- `npm install` then `npx hardhat test` (contract tests, local only).
- `npx hardhat run scripts/deploy.js --network robinhood` (mainnet 4663).
- Keeper: `node scripts/keeper.js` (intended to run under cron every 15 min).

## Chain facts

- Mainnet chain id 4663, $WIF at 0x5173b8eA6923c2d40267890D45C46a3480954773
  (verify decimals and symbol via eth_call before deploy).
- RPC and deployer key come from `.env` (never committed). Deployer key is
  the same operational wallet family used for Familydotfun work; ask the
  owner if it is not in the local env.

## Where things live

- `contracts/WifDailyPool.sol`: the whole game.
- `scripts/deploy.js`: deploy + verify reads via eth_call.
- `scripts/keeper.js`: price fetch + resolve loop.
- `web/`: static frontend (GitHub Pages hosted).

## Known trade-offs (state these honestly to anyone who asks)

- Prices come from CoinGecko via keeper, not an onchain oracle (TODO(oracle)
  in code). Resolution data is emitted in events for inspectability.
- No minimum liquidity or sanity bound on keeper prices beyond the 1
  percent cross-read flag.
