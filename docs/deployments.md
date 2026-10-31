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

## Sweep executed 2026-10-31 (owner order)

Keeper cron deleted (01M66YYXRJ2QXZQDDAW0N3NXHW, rounds stopped by owner
decision). ETH sent to 0x61810117d55a7ec1256D0FaE20f19858452564e5:
- player2: 0.000067970355024 ETH (tx 0xf778bbffb30bd2c448b86f257ebf120813789825165ea0a16d64f2af6434b6db)
- deployer: 0.000230751381926 ETH (tx 0x70286bf65343e82800059d4fa95e477f5e81fe8251a37c4ba8f18f11c42708de)
- player2 dust: 0.00000157858 ETH (tx 0x4dca5d91cb33d685398c6d80057a543f3c9a7427963ef1bf6a44f27d95e7180b)

WIF could NOT be swept: the Uni v3 WIF/WETH pool's liquidity was pulled
(liquidity 0, price at max tick) during the market slide. Selling WIF into
it returns ~zero WETH. Stranded as a result:
- deployer wallet: 355.18 WIF (unsellable via this pool)
- player2's 2,120 WIF went into the dead pool in the failed sweep attempt
  (tx 0xf9155e076d9f7c2fdefc1cd98376bab1071ebe833e8650e56a297446b95a4709,
  received ~33 wei WETH; the WIF is now part of the pool's 9.36M WIF balance)
- the WifDailyPool contract's stranded stakes and fees (documented edges)
  remain locked by design.
Total stranded WIF across wallets and contract: roughly 11,500 WIF,
worth single-digit dollars at the last onchain price. Written off unless
the owner wants to chase the Pons launchpad route for cents.
SweepHelper v2 (0xcec8bC8d6Ab0761D03B36Cb73E1194CdC1d41B44) deployed after
v1's equality check proved wrong for token1-input direction; the setup
swap's SwapHelper v1 (0x33a0D37D) remains documented for WETH-input only.
