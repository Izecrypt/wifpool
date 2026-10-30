const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const SIDE = { None: 0, Up: 1, Down: 2 };

describe("WifDailyPool", function () {
  async function deploy() {
    const [owner, keeper, alice, bob, carol] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockWIF");
    const token = await Token.deploy();
    const Pool = await ethers.getContractFactory("WifDailyPool");
    const pool = await Pool.deploy(await token.getAddress(), keeper.address);
    const M = 1000n * 10n ** 18n; // MIN_COMMIT
    for (const user of [alice, bob, carol]) {
      await token.mint(user.address, 1_000_000n * 10n ** 18n);
      await token.connect(user).approve(await pool.getAddress(), ethers.MaxUint256);
    }
    return { token, pool, owner, keeper, alice, bob, carol, M };
  }

  it("opens round 1 at deploy with zero jackpot", async function () {
    const { pool } = await deploy();
    const r = await pool.rounds(1);
    expect(r.resolved).to.equal(false);
    expect(r.jackpot).to.equal(0);
    expect(await pool.currentRoundId()).to.equal(1n);
  });

  it("commits to a side and tracks pots", async function () {
    const { pool, alice, M } = await deploy();
    await expect(pool.connect(alice).commit(SIDE.Up, M))
      .to.emit(pool, "Committed").withArgs(1, alice.address, SIDE.Up, M);
    const r = await pool.rounds(1);
    expect(r.potUp).to.equal(M);
    expect(r.potDown).to.equal(0);
  });

  it("rejects commits below the minimum", async function () {
    const { pool, alice, M } = await deploy();
    await expect(pool.connect(alice).commit(SIDE.Up, M - 1n)).to.be.revertedWithCustomError(pool, "BelowMinimum");
  });

  it("rejects commits after the round window closes", async function () {
    const { pool, alice, M } = await deploy();
    await time.increase(24 * 3600 + 1);
    await expect(pool.connect(alice).commit(SIDE.Up, M)).to.be.revertedWithCustomError(pool, "RoundNotOpen");
  });

  it("same-side re-commit adds stake", async function () {
    const { pool, alice, M } = await deploy();
    await pool.connect(alice).commit(SIDE.Up, M);
    await pool.connect(alice).commit(SIDE.Up, M);
    expect((await pool.rounds(1)).potUp).to.equal(2n * M);
    expect(await pool.stakes(1, SIDE.Up, alice.address)).to.equal(2n * M);
  });

  it("switching sides moves the full stake", async function () {
    const { pool, alice, M } = await deploy();
    await pool.connect(alice).commit(SIDE.Up, M);
    await pool.connect(alice).commit(SIDE.Down, 2n * M);
    const r = await pool.rounds(1);
    expect(r.potUp).to.equal(0);
    expect(r.potDown).to.equal(2n * M);
    expect(await pool.stakes(1, SIDE.Up, alice.address)).to.equal(0);
    expect(await pool.sideOf(1, alice.address)).to.equal(SIDE.Down);
  });

  it("only the keeper can resolve, and only after endTime", async function () {
    const { pool, owner, keeper, alice, M } = await deploy();
    await pool.connect(alice).commit(SIDE.Up, M);
    await expect(pool.connect(owner).resolve(100, 200, "test"))
      .to.be.revertedWithCustomError(pool, "OnlyKeeper");
    await expect(pool.connect(keeper).resolve(100, 200, "test"))
      .to.be.revertedWithCustomError(pool, "RoundStillOpen");
  });

  it("pays winners the whole pot minus fee plus jackpot", async function () {
    const { token, pool, keeper, alice, bob, M } = await deploy();
    await pool.connect(alice).commit(SIDE.Up, M);
    await pool.connect(bob).commit(SIDE.Down, 3n * M);
    await time.increase(24 * 3600 + 1);
    await pool.connect(keeper).resolve(100_000, 120_000, "coingecko"); // Up wins
    const balBefore = await token.balanceOf(alice.address);
    await expect(pool.connect(alice).claim(1)).to.emit(pool, "Claimed");
    const gained = (await token.balanceOf(alice.address)) - balBefore;
    // pot 4M, fee 4% = 0.16M, distributable 3.84M, alice is the only winner
    expect(gained).to.equal((4n * M * 9600n) / 10000n);
  });

  it("splits pro-rata between multiple winners and rolls the fee", async function () {
    const { token, pool, keeper, alice, bob, carol, M } = await deploy();
    await pool.connect(alice).commit(SIDE.Up, M);
    await pool.connect(bob).commit(SIDE.Up, 3n * M);
    await pool.connect(carol).commit(SIDE.Down, 4n * M);
    await time.increase(24 * 3600 + 1);
    await pool.connect(keeper).resolve(100_000, 90_000, "coingecko"); // Down wins
    const carolBefore = await token.balanceOf(carol.address);
    await pool.connect(carol).claim(1);
    const carolGain = (await token.balanceOf(carol.address)) - carolBefore;
    // pot 8M, distributable 7.68M, carol holds all winning stake
    expect(carolGain).to.equal((8n * M * 9600n) / 10000n);
    // losers cannot claim
    await expect(pool.connect(alice).claim(1)).to.be.revertedWithCustomError(pool, "NothingToClaim");
    // next round starts with the fee as jackpot
    await pool.startRound();
    expect((await pool.rounds(2)).jackpot).to.equal((8n * M * 400n) / 10000n);
    // alice can get her round-2 winnings plus the jackpot when she wins
    await pool.connect(alice).commit(SIDE.Up, M);
    await time.increase(24 * 3600 + 1);
    await pool.connect(keeper).resolve(100_000, 110_000, "coingecko");
    const before = await token.balanceOf(alice.address);
    await pool.connect(alice).claim(2);
    const gain = (await token.balanceOf(alice.address)) - before;
    expect(gain).to.equal(M + (8n * M * 400n) / 10000n - (M * 400n) / 10000n);
  });

  it("conserves balance: contract holds exactly pot plus rollover at every step", async function () {
    const { token, pool, keeper, alice, bob, M } = await deploy();
    await pool.connect(alice).commit(SIDE.Up, M);
    await pool.connect(bob).commit(SIDE.Down, 2n * M);
    expect(await token.balanceOf(await pool.getAddress())).to.equal(3n * M);
    await time.increase(24 * 3600 + 1);
    await pool.connect(keeper).resolve(1, 2, "x");
    await pool.connect(alice).claim(1);
    const fee = (3n * M * 400n) / 10000n;
    expect(await token.balanceOf(await pool.getAddress())).to.equal(fee);
    await pool.startRound();
    expect(await token.balanceOf(await pool.getAddress())).to.equal(fee);
  });

  it("double claim is rejected", async function () {
    const { pool, keeper, alice, M } = await deploy();
    await pool.connect(alice).commit(SIDE.Up, M);
    await time.increase(24 * 3600 + 1);
    await pool.connect(keeper).resolve(1, 2, "x");
    await pool.connect(alice).claim(1);
    await expect(pool.connect(alice).claim(1)).to.be.revertedWithCustomError(pool, "AlreadyClaimed");
  });

  it("refund path returns exact stake after 48h grace on unresolved round", async function () {
    const { pool, alice, M } = await deploy();
    await pool.connect(alice).commit(SIDE.Up, M);
    await time.increase(24 * 3600 + 48 * 3600 + 2);
    await expect(pool.connect(alice).refund(1)).to.emit(pool, "Refunded");
    expect(await pool.stakes(1, SIDE.Up, alice.address)).to.equal(0);
  });

  it("owner can rotate keeper", async function () {
    const { pool, owner, bob } = await deploy();
    await pool.connect(owner).rotateKeeper(bob.address);
    expect(await pool.keeper()).to.equal(bob.address);
  });
});
