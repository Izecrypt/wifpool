// Deploy WifDailyPool to Robinhood Chain mainnet (4663) and verify reads.
// Usage: npx hardhat run scripts/deploy.js --network robinhood
// Requires .env: RHCHAIN_RPC, DEPLOYER_KEY (and KEEPER_ADDRESS, defaults to deployer).

require("dotenv").config();
const { ethers } = require("hardhat");

const WIF = "0x5173b8eA6923c2d40267890D45C46a3480954773";

async function main() {
  const [deployer] = await ethers.getSigners();
  const keeper = process.env.KEEPER_ADDRESS || deployer.address;
  console.log("deployer:", deployer.address);
  console.log("keeper:  ", keeper);
  console.log("chain id:", (await ethers.provider.getNetwork()).chainId);

  // verify the token contract before wiring it in
  const erc20 = new ethers.Interface([
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
  ]);
  const sym = await ethers.provider.call({ to: WIF, data: erc20.encodeFunctionData("symbol") });
  const dec = await ethers.provider.call({ to: WIF, data: erc20.encodeFunctionData("decimals") });
  const symbol = erc20.decodeFunctionResult("symbol", sym)[0];
  const decimals = erc20.decodeFunctionResult("decimals", dec)[0];
  console.log("token:", WIF, "symbol:", symbol, "decimals:", decimals);
  if (symbol !== "WIF" || Number(decimals) !== 18) {
    throw new Error("token sanity check failed, aborting deploy");
  }

  const Pool = await ethers.getContractFactory("WifDailyPool");
  const pool = await Pool.deploy(WIF, keeper);
  await pool.waitForDeployment();
  const addr = await pool.getAddress();
  console.log("WifDailyPool deployed:", addr);

  const r1 = await pool.rounds(1);
  console.log("round 1:", {
    start: new Date(Number(r1.startTime) * 1000).toISOString(),
    end: new Date(Number(r1.endTime) * 1000).toISOString(),
    jackpot: r1.jackpot.toString(),
  });

  console.log("\nRecord this in docs/deployments.md and fund the contract only via commits.");
}

main().catch((e) => { console.error(e); process.exit(1); });
