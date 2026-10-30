// Keeper: resolve finished rounds in all four pools (1h, 4h, 6h, 24h) with
// open price (at round start, from CoinGecko's range endpoint) and close
// price (now), then start each pool's next round.
// Run under cron every 10 minutes:
//   */10 * * * *  cd /Users/tbo/wifpool && node scripts/keeper.js >> keeper.log 2>&1

require("dotenv").config();
const { ethers } = require("ethers");

const RPC = process.env.RHCHAIN_RPC;
const KEY = process.env.KEEPER_KEY || process.env.DEPLOYER_KEY;
const POOL = process.env.POOL_ADDRESS;
const COINGECKO_ID = process.env.COINGECKO_ID || "world-is-flat-wif";
const POOL_COUNT = 4;

const ABI = [
  "function currentRound(uint8) view returns (uint256)",
  "function rounds(uint256) view returns (tuple(uint8 poolId,uint64 startTime,uint64 endTime,uint128 openPrice,uint128 closePrice,uint256 potUp,uint256 potDown,uint256 jackpot,bool resolved,uint8 winningSide))",
  "function startRound(uint8)",
  "function resolve(uint8, uint128, uint128, string)",
];

async function jget(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`coingecko ${r.status} for ${url}`);
  return r.json();
}

async function closePrice() {
  const j = await jget(`https://api.coingecko.com/api/v3/simple/price?ids=${COINGECKO_ID}&vs_currencies=usd`);
  const usd = j[COINGECKO_ID]?.usd;
  if (!usd) throw new Error(`no price for ${COINGECKO_ID}`);
  return BigInt(Math.round(usd * 1e8));
}

async function openPriceAt(ts) {
  const j = await jget(
    `https://api.coingecko.com/api/v3/coins/${COINGECKO_ID}/market_chart/range?vs_currency=usd&from=${ts - 300}&to=${ts + 300}`
  );
  const prices = j.prices || [];
  if (!prices.length) throw new Error(`no historical price at ${ts}`);
  return BigInt(Math.round(prices[0][1] * 1e8));
}

async function main() {
  if (!RPC || !KEY || !POOL) throw new Error("need RHCHAIN_RPC, KEEPER_KEY/DEPLOYER_KEY, POOL_ADDRESS");
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  const pool = new ethers.Contract(POOL, ABI, wallet);
  const now = Math.floor(Date.now() / 1000);
  let didSomething = false;

  for (let p = 0; p < POOL_COUNT; p++) {
    const rid = await pool.currentRound(p);
    const r = await pool.rounds(rid);
    const end = Number(r.endTime);
    console.log(`${new Date().toISOString()} pool ${p} round ${rid} resolved=${r.resolved} end=${new Date(end * 1000).toISOString()}`);

    if (r.resolved) continue;
    if (now < end) continue;

    const open = await openPriceAt(Number(r.startTime));
    const close = await closePrice();
    const check = await closePrice();
    const drift = close > check ? close - check : check - close;
    if (drift * 100n > close) {
      console.error(`pool ${p}: price drift ${drift} vs ${close}, skipping this tick`);
      continue;
    }
    if (open === 0n || close === 0n) {
      console.error(`pool ${p}: zero price, skipping`);
      continue;
    }
    const tx = await pool.resolve(p, open, close, `coingecko:${COINGECKO_ID}`);
    const rc = await tx.wait();
    console.log(`pool ${p}: resolved round ${rid} open=${open} close=${close} tx=${rc.hash}`);
    const tx2 = await pool.startRound(p);
    const rc2 = await tx2.wait();
    console.log(`pool ${p}: started next round tx=${rc2.hash}`);
    didSomething = true;
  }
  if (!didSomething) console.log("nothing to do");
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
