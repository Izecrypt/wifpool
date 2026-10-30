const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const SIDE = { None: 0, Up: 1, Down: 2 };
const DAILY = 3; // pool id of the 24h pool

describe("WifDailyPool (multi-pool)", function () {
  async function deploy() {
    const [owner, keeper, alice, bob, carol] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockWIF");
    const token = await Token.deploy();
    const Pool = await ethers.getContractFactory("WifDailyPool");
    const pool = await Pool.deploy(await token.getAddress(), keeper.address);
    const M = 1000n * 10n ** 18n;
    for (const user of [alice, bob, carol]) {
      await token.mint(user.address, 1_000_000n * 10n ** 18n);
      await token.connect(user).approve(await pool.getAddress(), ethers.MaxUint256);
    }
    // round ids 1..4 are the four pools' first rounds; daily = 4
    return { token, pool, owner, keeper, alice, bob, carol, M, dailyId: 4n };
  }

  it("opens four pools at deploy with zero jackpots", async function () {
    const { pool, dailyId } = await deploy();
    expect(await pool.POOL_COUNT()).to.equal(4);
    expect(await pool.currentRound(0)).to.equal(1);
    expect(await pool.currentRound(3)).to.equal(dailyId);
    const r = await pool.rounds(dailyId);
    expect(r.poolId).to.equal(DAILY);
    expect(r.jackpot).to.equal(0);
    expect(r.resolved).to.equal(false);
  });

  it("pool lengths are 1h, 4h, 6h, 24h", async function () {
    const { pool } = await deploy();
    expect(await pool.poolLength(0)).to.equal(3600n);
    expect(await pool.poolLength(1)).to.equal(14400n);
    expect(await pool.poolLength(2)).to.equal(21600n);
    expect(await pool.poolLength(3)).to.equal(86400n);
    await expect(pool.poolLength(4)).to.be.revertedWithCustomError(pool, "BadPool");
  });

  it("commits to a side and tracks pots", async function () {
    const { pool, alice, M, dailyId } = await deploy();
    await expect(pool.connect(alice).commit(DAILY, SIDE.Up, M))
      .to.emit(pool, "Committed").withArgs(dailyId, alice.address, SIDE.Up, M);
    const r = await pool.rounds(dailyId);
    expect(r.potUp).to.equal(M);
    expect(r.potDown).to.equal(0);
  });

  it("rejects commits below the minimum and bad pools", async function () {
    const { pool, alice, M } = await deploy();
    await expect(pool.connect(alice).commit(DAILY, SIDE.Up, M - 1n)).to.be.revertedWithCustomError(pool, "BelowMinimum");
    await expect(pool.connect(alice).commit(9, SIDE.Up, M)).to.be.revertedWithCustomError(pool, "BadPool");
  });

  it("rejects commits after the round window closes", async function () {
    const { pool, alice, M } = await deploy();
    await time.increase(24 * 3600 + 1);
    await expect(pool.connect(alice).commit(DAILY, SIDE.Up, M)).to.be.revertedWithCustomError(pool, "RoundNotOpen");
  });

  it("same-side re-commit adds stake", async function () {
    const { pool, alice, M, dailyId } = await deploy();
    await pool.connect(alice).commit(DAILY, SIDE.Up, M);
    await pool.connect(alice).commit(DAILY, SIDE.Up, M);
    expect((await pool.rounds(dailyId)).potUp).to.equal(2n * M);
    expect(await pool.stakes(dailyId, SIDE.Up, alice.address)).to.equal(2n * M);
  });

  it("switching sides moves the full stake and updates the side record", async function () {
    const { pool, alice, M, dailyId } = await deploy();
    await pool.connect(alice).commit(DAILY, SIDE.Up, M);
    await pool.connect(alice).commit(DAILY, SIDE.Down, 2n * M);
    const r = await pool.rounds(dailyId);
    expect(r.potUp).to.equal(0);
    expect(r.potDown).to.equal(2n * M);
    expect(await pool.stakes(dailyId, SIDE.Up, alice.address)).to.equal(0);
    expect(await pool.sideOf(dailyId, alice.address)).to.equal(SIDE.Down);
  });

  it("1h pool resolves on its own clock without touching the daily pool", async function () {
    const { pool, keeper, alice, M } = await deploy();
    const hourlyId = 1n; // pool 0's first round
    await pool.connect(alice).commit(0, SIDE.Up, M);
    await time.increase(3600 + 1);
    await pool.connect(keeper).resolve(0, 100_000, 120_000, "coingecko");
    const hr = await pool.rounds(hourlyId);
    expect(hr.resolved).to.equal(true);
    expect(hr.winningSide).to.equal(SIDE.Up);
    const daily = await pool.rounds(4n);
    expect(daily.resolved).to.equal(false); // untouched
    await pool.startRound(0);
    expect((await pool.rounds(await pool.currentRound(0))).poolId).to.equal(0);
  });

  it("only the keeper can resolve, and only after endTime", async function () {
    const { pool, owner, keeper, alice, M } = await deploy();
    await pool.connect(alice).commit(DAILY, SIDE.Up, M);
    await expect(pool.connect(owner).resolve(DAILY, 100, 200, "test"))
      .to.be.revertedWithCustomError(pool, "OnlyKeeper");
    await expect(pool.connect(keeper).resolve(DAILY, 100, 200, "test"))
      .to.be.revertedWithCustomError(pool, "RoundStillOpen");
  });

  it("pays winners the whole pot minus fee plus jackpot", async function () {
    const { token, pool, keeper, alice, bob, M, dailyId } = await deploy();
    await pool.connect(alice).commit(DAILY, SIDE.Up, M);
    await pool.connect(bob).commit(DAILY, SIDE.Down, 3n * M);
    await time.increase(24 * 3600 + 1);
    await pool.connect(keeper).resolve(DAILY, 100_000, 120_000, "coingecko");
    const balBefore = await token.balanceOf(alice.address);
    await expect(pool.connect(alice).claim(dailyId)).to.emit(pool, "Claimed");
    const gained = (await token.balanceOf(alice.address)) - balBefore;
    expect(gained).to.equal((4n * M * 9600n) / 10000n);
  });

  it("splits pro-rata, rolls the fee per pool, and pays it as the next jackpot", async function () {
    const { token, pool, keeper, alice, bob, carol, M, dailyId } = await deploy();
    await pool.connect(alice).commit(DAILY, SIDE.Up, M);
    await pool.connect(bob).commit(DAILY, SIDE.Up, 3n * M);
    await pool.connect(carol).commit(DAILY, SIDE.Down, 4n * M);
    await time.increase(24 * 3600 + 1);
    await pool.connect(keeper).resolve(DAILY, 100_000, 90_000, "coingecko"); // Down wins
    const carolBefore = await token.balanceOf(carol.address);
    await pool.connect(carol).claim(dailyId);
    const carolGain = (await token.balanceOf(carol.address)) - carolBefore;
    expect(carolGain).to.equal((8n * M * 9600n) / 10000n);
    await expect(pool.connect(alice).claim(dailyId)).to.be.revertedWithCustomError(pool, "NothingToClaim");

    await pool.startRound(DAILY);
    const daily2 = await pool.currentRound(DAILY);
    expect((await pool.rounds(daily2)).jackpot).to.equal((8n * M * 400n) / 10000n);
    // other pools' jackpots untouched
    expect(await pool.rolloverOf(0)).to.equal(0);

    await pool.connect(alice).commit(DAILY, SIDE.Up, M);
    await time.increase(24 * 3600 + 1);
    await pool.connect(keeper).resolve(DAILY, 100_000, 110_000, "coingecko");
    const before = await token.balanceOf(alice.address);
    await pool.connect(alice).claim(daily2);
    const gain = (await token.balanceOf(alice.address)) - before;
    expect(gain).to.equal(M + (8n * M * 400n) / 10000n - (M * 400n) / 10000n);
  });

  it("conserves balance across pools at every step", async function () {
    const { token, pool, keeper, alice, bob, M } = await deploy();
    await pool.connect(alice).commit(0, SIDE.Up, M);        // 1h pool
    await pool.connect(bob).commit(DAILY, SIDE.Down, 2n * M); // daily
    expect(await token.balanceOf(await pool.getAddress())).to.equal(3n * M);
    await time.increase(3600 + 1);
    await pool.connect(keeper).resolve(0, 1, 2, "x");
    await pool.connect(alice).claim(1n);
    const fee1h = (M * 400n) / 10000n;
    expect(await token.balanceOf(await pool.getAddress())).to.equal(2n * M + fee1h);
    await pool.startRound(0);
    // daily pool untouched, its resolution later must not see the 1h fee
    await time.increase(24 * 3600);
    await pool.connect(keeper).resolve(DAILY, 2, 1, "x"); // Down wins
    const before = await token.balanceOf(bob.address);
    await pool.connect(bob).claim(4n);
    expect((await token.balanceOf(bob.address)) - before).to.equal((2n * M * 9600n) / 10000n); // 96% of 2M + 0 jackpot
    // contract now holds exactly the two pools' rollover fees
    const feeDaily = (2n * M * 400n) / 10000n;
    expect(await token.balanceOf(await pool.getAddress())).to.equal(fee1h + feeDaily);
  });

  it("double claim is rejected", async function () {
    const { pool, keeper, alice, M, dailyId } = await deploy();
    await pool.connect(alice).commit(DAILY, SIDE.Up, M);
    await time.increase(24 * 3600 + 1);
    await pool.connect(keeper).resolve(DAILY, 1, 2, "x");
    await pool.connect(alice).claim(dailyId);
    await expect(pool.connect(alice).claim(dailyId)).to.be.revertedWithCustomError(pool, "AlreadyClaimed");
  });

  it("refund path returns exact stake after 48h grace on unresolved round", async function () {
    const { pool, alice, M, dailyId } = await deploy();
    await pool.connect(alice).commit(DAILY, SIDE.Up, M);
    await time.increase(24 * 3600 + 48 * 3600 + 2);
    await expect(pool.connect(alice).refund(dailyId)).to.emit(pool, "Refunded");
    expect(await pool.stakes(dailyId, SIDE.Up, alice.address)).to.equal(0);
  });

  it("owner can rotate keeper", async function () {
    const { pool, owner, bob } = await deploy();
    await pool.connect(owner).rotateKeeper(bob.address);
    expect(await pool.keeper()).to.equal(bob.address);
  });
});
