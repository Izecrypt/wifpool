require("dotenv").config();
const { ethers } = require("hardhat");
async function main() {
  const H = await ethers.getContractFactory("SweepHelper");
  const h = await H.deploy();
  await h.waitForDeployment();
  console.log("SweepHelper:", await h.getAddress());
}
main().catch((e) => { console.error(e.message); process.exit(1); });
