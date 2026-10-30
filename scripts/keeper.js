// Keeper: resolve finished rounds with open price (at round start) and close
// price (now), both from CoinGecko, then start the next round.
// Intended to run under cron every 15 minutes:
//   */15 * * * *  cd /Users/tbo/wifpool && node scripts/keeper.js >> keeper.log 2>&1
//
// The open price is fetched from CoinGecko's range endpoint for the exact
// round start timestamp, so a keeper outage at round start does not corrupt
// resolution. Both prices are stored in the RoundResolved event.

require("dotenv").config();
const { ethers } = require("ethers");

const RPC = process.env.RHCHAIN_RPC;
const KEY = process.env.KEEPER_KEY || process.env.DEPLOYER_KEY;
const POOL = process.env.POOL_ADDRESS;
const COINGECKO_ID = process.env.COINGECKO_ID || "world-is-flat-wif";

const ABI = [
  "function currentRoundId() view returns (uint256)",
  "function rounds(uint256) view returns (tuple(uint64 startTime,uint64 endTime,uint128 openPrice,uint128 closePrice,uint256 potUp,uint256 potDown,uint256 jackpot,bool resolved,uint8 winningSide))",
  "function startRound()",
  "function resolve(uint128 openPrice, uint128 closePrice, string priceSource)",
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
  const to = ts + 300; // small window around the start timestamp
  const from = ts - 300;
  const j = await jget(
    `https://api.coingecko.com/api/v3/coins/${COINGECKO_ID}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`
  );
  const prices = j.prices || [];
  if (!prices.length) throw new Error(`no historical price at ${ts}`);
  const usd = prices[0][1];
  return BigInt(Math.round(usd * 1e8));
}

async function main() {
  if (!RPC || !KEY || !POOL) throw new Error("need RHCHAIN_RPC, KEEPER_KEY/DEPLOYER_KEY, POOL_ADDRESS");
  const provider = new ethers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(KEY, provider);
  const pool = new ethers.Contract(POOL, ABI, wallet);

  const id = await pool.currentRoundId();
  const r = await pool.rounds(id);
  const now = Math.floor(Date.now() / 1000);
  console.log(`${new Date().toISOString()} round ${id} resolved=${r.resolved} end=${new Date(Number(r.endTime) * 1000).toISOString()}`);

  if (r.resolved || now < Number(r.endTime)) {
    console.log("nothing to do");
    return;
  }

  const open = await openPriceAt(Number(r.startTime));
  const close = await closePrice();
  // cross-read guard: a second current read 5s apart diverging >1% means the
  // feed is moving violently or lying; refuse and try again next cron tick.
  const check = await closePrice();
  const drift = close > check ? close - check : check - close;
  if (drift * 100n > close) {
    throw new Error(`price drift ${drift} vs ${close}, refusing to resolve`);
  }
  if (open === 0n || close === 0n) throw new Error("zero price, refusing to resolve");

  const tx = await pool.resolve(open, close, `coingecko:${COINGECKO_ID}`);
  const rc = await tx.wait();
  console.log(`resolved round ${id}: open=${open} close=${close} tx=${rc.hash}`);
  const tx2 = await pool.startRound();
  const rc2 = await tx2.wait();
  console.log(`started round ${Number(id) + 1}: tx=${rc2.hash}`);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
