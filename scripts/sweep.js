// Execute the standing sweep order (docs/deployments.md): swap all WIF to
// ETH through the pool via SwapHelper, unwrap WETH, send everything to the
// owner address. One-shot, prints every tx hash.
require("dotenv").config();
const { ethers } = require("ethers");

const RPC = process.env.RHCHAIN_RPC;
const WIF = "0x5173b8eA6923c2d40267890D45C46a3480954773";
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const POOL = "0x156064f872Eb6DedC953E7AF21E7A7991910Ef09";
const HELPER = process.env.SWEEP_HELPER || "0x33a0D37Df20673Ce270628721Fd298142E93095C";
const OWNER = "0x61810117d55a7ec1256D0FaE20f19858452564e5";

const ERC20 = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256)", "function allowance(address,address) view returns (uint256)"];
const HELPER_ABI = ["function swapExactIn(address pool, address tokenIn, uint256 amountIn, uint256 minOut, address recipient) returns (uint256)"];
const WETH_ABI = ["function withdraw(uint256)", "function balanceOf(address) view returns (uint256)"];

async function sweepWallet(w, name, p) {
  const wif = new ethers.Contract(WIF, ERC20, w);
  const helper = new ethers.Contract(HELPER, HELPER_ABI, w);
  const weth = new ethers.Contract(WETH, WETH_ABI, w);
  const bal = await wif.balanceOf(w.address);
  if (bal > 0n) {
    if (await wif.allowance(w.address, HELPER) < bal) {
      const t = await wif.approve(HELPER, ethers.MaxUint256); await t.wait();
      console.log(name, "approved helper");
    }
    const t2 = await helper.swapExactIn(POOL, WIF, bal, 1n, w.address); // minOut 1 wei: thin pool, single tx, owner-ordered
    const rc = await t2.wait();
    console.log(name, "swapped", ethers.formatUnits(bal, 18), "WIF, tx:", rc.hash);
  } else {
    console.log(name, "no WIF");
  }
  const wb = await weth.balanceOf(w.address);
  if (wb > 0n) {
    const t3 = await weth.withdraw(wb); await t3.wait();
    console.log(name, "unwrapped", ethers.formatEther(wb), "ETH");
  }
  const ethBal = await p.getBalance(w.address);
  const keep = ethers.parseEther("0.000005"); // dust for the final send gas on the last tx
  const send = ethBal - keep;
  if (send > 0n) {
    const t4 = await w.sendTransaction({ to: OWNER, value: send });
    const rc4 = await t4.wait();
    console.log(name, "sent", ethers.formatEther(send), "ETH to owner, tx:", rc4.hash);
  }
}

async function main() {
  const p = new ethers.JsonRpcProvider(RPC);
  const w1 = new ethers.Wallet(process.env.DEPLOYER_KEY, p);
  const w2 = new ethers.Wallet(process.env.PLAYER2_KEY, p);
  console.log("deployer:", w1.address, "ETH:", ethers.formatEther(await p.getBalance(w1.address)));
  console.log("player2:", w2.address, "ETH:", ethers.formatEther(await p.getBalance(w2.address)));
  // fund player2 gas if tight
  const b2 = await p.getBalance(w2.address);
  if (b2 < ethers.parseEther("0.00008")) {
    const t = await w1.sendTransaction({ to: w2.address, value: ethers.parseEther("0.00008") - b2 });
    await t.wait();
    console.log("funded player2 gas");
  }
  await sweepWallet(w2, "player2", p); // small wallet first
  await sweepWallet(w1, "deployer", p);
  console.log("owner ETH balance now:", ethers.formatEther(await p.getBalance(OWNER)));
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
