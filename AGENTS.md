# AGENTS.md (wifpool)

Project-specific instructions. Universal rules from the vault still apply.

## What this is

A 2-day hackathon build (world is flat, $WIF on Robinhood Chain). Speed
matters, but the security invariants in Architecture-essentials.md matter
more. A judge panel includes a security expert.

## Verification rules

- Every contract change: `npx hardhat test` must pass before commit.
- Every deploy: verify token address decimals/symbol via eth_call first, and
  record the deployment tx hash in docs/deployments.md.
- Never commit `.env`. Never print private keys to logs.
- Every claim in the README or demo must match onchain reality; if a feature
  is not done, it is not in the README.

## Boundaries

- No fund extraction paths, no upgradeability, no external calls other than
  the $WIF ERC20.
- Do not change payout math (4 percent rollover, 96 percent pro-rata) without
  an explicit owner decision; it is in the PRD as locked.

## Documentation expectations

Keep Architecture.md, this file, and CLAUDE.md in sync with behavior. The
hackathon judges read the repo.
