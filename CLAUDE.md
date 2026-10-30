# CLAUDE.md (wifpool)

See AGENTS.md and Architecture-essentials.md. Summary: daily $WIF up/down
prediction pool on Robinhood Chain mainnet (4663). One contract
(`contracts/WifDailyPool.sol`), keeper resolution via CoinGecko prices
emitted onchain, pull-claim payouts, 4 percent rollover flywheel. Tests via
`npx hardhat test`. Deploy via `scripts/deploy.js` with env-provided RPC and
key. Never commit secrets; never break the invariants in
Architecture-essentials.md.
