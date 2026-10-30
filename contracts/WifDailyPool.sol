// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title WifDailyPool
/// @notice Up/down prediction pools on the World is Flat token ($WIF).
/// Four pools run in parallel: 1 hour, 4 hour, 6 hour and 24 hour rounds.
/// Players commit $WIF to UP or DOWN. After each round the keeper resolves
/// with open/close prices (from CoinGecko, emitted here for inspectability).
/// Winners split 96% of the whole pot pro-rata; 4% rolls into the next
/// round of the SAME pool as its jackpot. Rollover per pool, flywheel per
/// pool: every pool compounds on its own clock.
contract WifDailyPool is ReentrancyGuard {
    enum Side { None, Up, Down }

    struct Round {
        uint8 poolId;
        uint64 startTime;
        uint64 endTime;
        uint128 openPrice;   // 8 decimals, e.g. 129300 => $0.001293
        uint128 closePrice;
        uint256 potUp;
        uint256 potDown;
        uint256 jackpot;     // previous round's fee, seeded into this round
        bool resolved;
        Side winningSide;
    }

    IERC20 public immutable wif;
    address public owner;
    address public keeper;

    // pools: 0 = 1h, 1 = 4h, 2 = 6h, 3 = 24h
    uint64 public constant POOL_1H  = 1 hours;
    uint64 public constant POOL_4H  = 4 hours;
    uint64 public constant POOL_6H  = 6 hours;
    uint64 public constant POOL_24H = 24 hours;
    uint8 public constant POOL_COUNT = 4;

    uint256 public constant FEE_BPS = 400;          // 4%
    uint256 public constant MIN_COMMIT = 1000e18;   // 1,000 WIF

    uint256 public roundCounter;                    // global, all pools
    mapping(uint8 => uint256) public currentRound;  // pool => round id
    mapping(uint8 => uint256) public rolloverOf;    // pool => unclaimed fee
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(Side => mapping(address => uint256))) public stakes;
    mapping(uint256 => mapping(address => Side)) public sideOf;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event RoundStarted(uint256 indexed id, uint8 indexed poolId, uint64 startTime, uint64 endTime, uint256 jackpot);
    event Committed(uint256 indexed id, address indexed player, Side side, uint256 amount);
    event SideSwitched(uint256 indexed id, address indexed player, Side fromSide, Side toSide, uint256 amount);
    event RoundResolved(
        uint256 indexed id,
        uint8 indexed poolId,
        uint128 openPrice,
        uint128 closePrice,
        Side winningSide,
        uint256 potUp,
        uint256 potDown,
        uint256 rolloverOut,
        string priceSource
    );
    event Claimed(uint256 indexed id, address indexed player, uint256 amount);
    event Refunded(uint256 indexed id, address indexed player, uint256 amount);
    event KeeperRotated(address indexed newKeeper);

    error OnlyOwner();
    error OnlyKeeper();
    error BadPool();
    error RoundNotOpen();
    error RoundStillOpen();
    error AlreadyResolved();
    error NotResolved();
    error AlreadyClaimed();
    error NothingToClaim();
    error BelowMinimum();
    error PrevRoundUnresolved();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert OnlyKeeper();
        _;
    }

    constructor(address wifToken, address keeperAddr) {
        wif = IERC20(wifToken);
        owner = msg.sender;
        keeper = keeperAddr;
        for (uint8 p = 0; p < POOL_COUNT; p++) {
            _startRound(p, 0);
        }
    }

    function poolLength(uint8 poolId) public pure returns (uint64) {
        if (poolId == 0) return POOL_1H;
        if (poolId == 1) return POOL_4H;
        if (poolId == 2) return POOL_6H;
        if (poolId == 3) return POOL_24H;
        revert BadPool();
    }

    /// @notice Open the next round for a pool. Anyone may call once that
    /// pool's previous round is resolved; pools never overlap internally.
    function startRound(uint8 poolId) external {
        _requirePool(poolId);
        Round storage prev = rounds[currentRound[poolId]];
        if (prev.poolId == poolId && !prev.resolved) revert PrevRoundUnresolved();
        _startRound(poolId, rolloverOf[poolId]);
    }

    function _startRound(uint8 poolId, uint256 jackpotIn) internal {
        unchecked { roundCounter += 1; }
        rolloverOf[poolId] = 0;
        Round storage r = rounds[roundCounter];
        r.poolId = poolId;
        r.startTime = uint64(block.timestamp);
        r.endTime = uint64(block.timestamp + poolLength(poolId));
        r.jackpot = jackpotIn;
        currentRound[poolId] = roundCounter;
        emit RoundStarted(roundCounter, poolId, r.startTime, r.endTime, jackpotIn);
    }

    function _requirePool(uint8 poolId) internal pure {
        if (poolId >= POOL_COUNT) revert BadPool();
    }

    /// @notice Commit $WIF to a side of a pool's active round. One side per
    /// address per round; re-committing on the same side adds stake, on the
    /// other side moves the full stake.
    function commit(uint8 poolId, Side side, uint256 amount) external nonReentrant {
        _requirePool(poolId);
        if (side == Side.None) revert BelowMinimum();
        if (amount < MIN_COMMIT) revert BelowMinimum();
        uint256 rid = currentRound[poolId];
        Round storage r = rounds[rid];
        if (r.resolved || block.timestamp >= r.endTime) revert RoundNotOpen();

        if (!wif.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        Side prevSide = sideOf[rid][msg.sender];
        if (prevSide == Side.None) {
            sideOf[rid][msg.sender] = side;
            stakes[rid][side][msg.sender] = amount;
        } else if (prevSide == side) {
            stakes[rid][side][msg.sender] += amount;
        } else {
            uint256 moved = stakes[rid][prevSide][msg.sender];
            stakes[rid][prevSide][msg.sender] = 0;
            stakes[rid][side][msg.sender] += amount;
            sideOf[rid][msg.sender] = side;
            unchecked {
                if (prevSide == Side.Up) r.potUp -= moved; else r.potDown -= moved;
            }
            emit SideSwitched(rid, msg.sender, prevSide, side, moved);
        }
        unchecked {
            if (side == Side.Up) r.potUp += amount; else r.potDown += amount;
        }
        emit Committed(rid, msg.sender, side, amount);
    }

    /// @notice Keeper-only, one-shot per round, after its endTime. Stores
    /// prices and the winning side; payouts are computed at claim time.
    // TODO(oracle): replace keeper prices with an onchain oracle (Pyth)
    // when one supports $WIF on Robinhood Chain.
    function resolve(uint8 poolId, uint128 openPrice, uint128 closePrice, string calldata priceSource)
        external
        onlyKeeper
    {
        _requirePool(poolId);
        uint256 rid = currentRound[poolId];
        Round storage r = rounds[rid];
        if (r.resolved) revert AlreadyResolved();
        if (block.timestamp < r.endTime) revert RoundStillOpen();
        if (openPrice == 0 || closePrice == 0) revert BelowMinimum();

        r.openPrice = openPrice;
        r.closePrice = closePrice;
        r.resolved = true;
        r.winningSide = closePrice > openPrice ? Side.Up : Side.Down; // tie resolves Down

        uint256 pot = r.potUp + r.potDown;
        uint256 fee = (pot * FEE_BPS) / 10_000;
        rolloverOf[poolId] = fee;
        emit RoundResolved(
            rid,
            poolId,
            openPrice,
            closePrice,
            r.winningSide,
            r.potUp,
            r.potDown,
            fee,
            priceSource
        );
    }

    /// @notice Winners pull their pro-rata share of the ENTIRE pot (losers'
    /// stake included) minus the 4% fee, plus the jackpot seeded by the
    /// previous round of the same pool. Conservation: the fee stays in the
    /// contract and becomes that pool's next jackpot, so every wei is either
    /// claimed or rolls forward within its pool.
    function claim(uint256 roundId) external nonReentrant {
        Round storage r = rounds[roundId];
        if (!r.resolved) revert NotResolved();
        if (claimed[roundId][msg.sender]) revert AlreadyClaimed();
        Side s = sideOf[roundId][msg.sender];
        if (s == Side.None || s != r.winningSide) revert NothingToClaim();

        uint256 stake = stakes[roundId][s][msg.sender];
        if (stake == 0) revert NothingToClaim();
        uint256 winningPot = s == Side.Up ? r.potUp : r.potDown;
        uint256 totalPot = r.potUp + r.potDown;
        uint256 distributable = ((totalPot * (10_000 - FEE_BPS)) / 10_000) + r.jackpot;
        uint256 payout = (stake * distributable) / winningPot;

        claimed[roundId][msg.sender] = true;
        if (!wif.transfer(msg.sender, payout)) revert TransferFailed();
        emit Claimed(roundId, msg.sender, payout);
    }

    /// @notice Emergency path: if a round somehow stays unresolved, players
    /// of any side can pull their exact stake back after a 48h grace window.
    function refund(uint256 roundId) external nonReentrant {
        Round storage r = rounds[roundId];
        if (r.resolved) revert NotResolved();
        if (block.timestamp < r.endTime + 48 hours) revert RoundStillOpen();
        Side s = sideOf[roundId][msg.sender];
        uint256 stake = stakes[roundId][s][msg.sender];
        if (stake == 0) revert NothingToClaim();
        stakes[roundId][s][msg.sender] = 0;
        if (!wif.transfer(msg.sender, stake)) revert TransferFailed();
        emit Refunded(roundId, msg.sender, stake);
    }

    function rotateKeeper(address newKeeper) external onlyOwner {
        keeper = newKeeper;
        emit KeeperRotated(newKeeper);
    }

    /// @notice View: your payout for a round if your side won.
    function previewClaim(uint256 roundId, address player) external view returns (uint256) {
        Round storage r = rounds[roundId];
        if (!r.resolved) return 0;
        Side s = sideOf[roundId][player];
        if (s == Side.None || s != r.winningSide) return 0;
        uint256 stake = stakes[roundId][s][player];
        uint256 winningPot = s == Side.Up ? r.potUp : r.potDown;
        if (winningPot == 0) return 0;
        uint256 distributable = (((r.potUp + r.potDown) * (10_000 - FEE_BPS)) / 10_000) + r.jackpot;
        return (stake * distributable) / winningPot;
    }
}
