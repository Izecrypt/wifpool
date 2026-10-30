// Deploy SwapHelper and run the setup swap ETH(WETH) -> WIF.
require("dotenv").config();
const { ethers } = require("hardhat");

const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const WIF = "0x5173b8eA6923c2d40267890D45C46a3480954773";
const POOL = "0x156064f872Eb6DedC953E7AF21E7A7991910Ef09";

async function main() {
  const [wallet] = await ethers.getSigners();
  const Helper = await ethers.getContractFactory("SwapHelper");
  const helper = await Helper.deploy();
  await helper.waitForDeployment();
  const helperAddr = await helper.getAddress();
  console.log("SwapHelper:", helperAddr);

  const weth = new ethers.Contract(WETH, ["function approve(address,uint256)"], wallet);
  let tx = await weth.approve(helperAddr, ethers.parseEther("0.004"));
  await tx.wait();
  console.log("approved helper");

  const tx2 = await helper.swapExactIn(POOL, WETH, ethers.parseEther("0.0035"), ethers.parseUnits("4000", 18), wallet.address);
  const rc = await tx2.wait();
  console.log("swapped, tx:", rc.hash);

  const wif = new ethers.Contract(WIF, ["function balanceOf(address) view returns (uint256)"], ethers.provider);
  console.log("WIF balance:", ethers.formatUnits(await wif.balanceOf(wallet.address), 18));
  console.log("WETH left:", ethers.formatUnits(await new ethers.Contract(WETH, ["function balanceOf(address) view returns (uint256)"], ethers.provider).balanceOf(wallet.address), 18));
  console.log("ETH left:", ethers.formatEther(await ethers.provider.getBalance(wallet.address)));
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
