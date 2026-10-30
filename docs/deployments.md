# wifpool deployments (Robinhood Chain mainnet, chain id 4663)

- WifDailyPool: 0xaF0499536a6F39baedB377dB72258EE0C751956a
  (deployed 2026-10-30 ~17:45 UTC, deploy tx via scripts/deploy.js; four pools started in constructor)
- SwapHelper (one-shot setup tool, not part of the product): 0x33a0D37Df20673Ce270628721Fd298142E93095C
- $WIF token: 0x5173b8eA6923c2d40267890D45C46a3480954773 (verified symbol/decimals at deploy)
- Swap pool used: Uni v3 fee 10000 at 0x156064f872Eb6DedC953E7AF21E7A7991910Ef09
- Note: the official chain SwapRouter at 0xcaf681a66d020601342297493863e78c959e5cb2 reverts
  on exactInputSingle for this pool (empty revert, cause undiagnosed); the setup swap went through
  SwapHelper directly against the pool. TODO(router): revisit if more swaps are needed.

## Standing sweep order (owner directive 2026-10-30)

After testing and demo videos are complete (no earlier than submission, Nov 2):
1. Claim any unclaimed winnings from both wallets.
2. Swap all remaining WIF to ETH through the pool (use SwapHelper, same path as setup).
3. Send the full ETH balance to 0x61810117d55a7ec1256D0FaE20f19858452564e5.
4. Record the sweep tx hash here.

Key records (never lose money rule): deployer key in macOS keychain
item wifpool-deployer-key and .env DEPLOYER_KEY; player2 key in keychain item
wifpool-player2-key and .env PLAYER2_KEY. Any future wallet gets the same
treatment: keychain item + .env entry + address recorded here BEFORE funding.
- Round 5 (pool 0 round 2) resolved 2026-10-30 20:05 UTC: open 124737, close
  125180, UP wins, no stakes. Known v1 edge found: a round with zero
  winning stake leaves its seeded jackpot in the contract instead of
  rolling forward (claim path reverts cleanly, no funds at risk).
  TODO(v2): carry unclaimed jackpots into the next round of the same pool.
