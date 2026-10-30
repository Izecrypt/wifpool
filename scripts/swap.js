// One-time: wrap ETH, approve the Uniswap V3 router, swap ETH -> WIF.
require("dotenv").config();
const { ethers } = require("ethers");

const RPC = process.env.RHCHAIN_RPC;
const KEY = process.env.DEPLOYER_KEY;
const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
const WIF = "0x5173b8eA6923c2d40267890D45C46a3480954773";
const ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2";
const FEE = 10000;
const SWAP_ETH = "0.004";

const WETH_ABI = ["function deposit() payable", "function approve(address,uint256) returns (bool)"];
const ROUTER_ABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  const bal = await provider.getBalance(wallet.address);
  console.log("ETH in:", ethers.formatEther(bal));

  const weth = new ethers.Contract(WETH, WETH_ABI, wallet);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);

  console.log("wrapping", SWAP_ETH, "ETH...");
  let tx = await weth.deposit({ value: ethers.parseEther(SWAP_ETH) });
  await tx.wait();
  console.log("wrapped. approving router...");
  tx = await weth.approve(ROUTER, ethers.MaxUint256);
  await tx.wait();
  console.log("approved. quoting...");
  const Quoter = new ethers.Contract(
    "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7",
    ["function quoteExactInputSingle(tuple(address tokenIn,address tokenOut,uint256 amountIn,uint24 fee,uint160 sqrtPriceLimitX96) params) view returns (uint256,uint160,uint32,uint256)"],
    provider
  );
  const q = await Quoter.quoteExactInputSingle.staticCall({ tokenIn: WETH, tokenOut: WIF, amountIn: ethers.parseEther(SWAP_ETH), fee: FEE, sqrtPriceLimitX96: 0n });
  const expected = q[0];
  const minOut = (expected * 95n) / 100n; // 5% slippage
  console.log("expected WIF:", ethers.formatUnits(expected, 18), "min:", ethers.formatUnits(minOut, 18));

  tx = await router.exactInputSingle({
    tokenIn: WETH, tokenOut: WIF, fee: FEE, recipient: wallet.address,
    deadline: Math.floor(Date.now() / 1000) + 300,
    amountIn: ethers.parseEther(SWAP_ETH), amountOutMinimum: minOut, sqrtPriceLimitX96: 0n,
  });
  const rc = await tx.wait();
  console.log("swapped. tx:", rc.hash);

  const wif = new ethers.Contract(WIF, ["function balanceOf(address) view returns (uint256)"], provider);
  console.log("WIF balance:", ethers.formatUnits(await wif.balanceOf(wallet.address), 18));
  console.log("ETH left:", ethers.formatEther(await provider.getBalance(wallet.address)));
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
