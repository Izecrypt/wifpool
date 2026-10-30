// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title WifDailyPool
/// @notice Daily up/down prediction pool on the World is Flat token ($WIF).
/// Players commit $WIF to UP or DOWN. After 24h the keeper resolves with
/// open/close prices (from CoinGecko, emitted here for inspectability).
/// Winners split 96% of the pot pro-rata; 4% rolls into the next round.
contract WifDailyPool is ReentrancyGuard {
    enum Side { None, Up, Down }

    struct Round {
        uint64 startTime;
        uint64 endTime;
        uint128 openPrice;   // 8 decimals, e.g. 129300 => $0.001293
        uint128 closePrice;
        uint256 potUp;
        uint256 potDown;
        uint256 jackpot;     // previous round's fee, seeded into this round's pot
        bool resolved;
        Side winningSide;
    }

    IERC20 public immutable wif;
    address public owner;
    address public keeper;

    uint256 public constant ROUND_LENGTH = 24 hours;
    uint256 public constant FEE_BPS = 400;          // 4%
    uint256 public constant MIN_COMMIT = 1000e18;   // 1,000 WIF
    uint256 public constant PRICE_DECIMALS = 8;

    uint256 public currentRoundId;
    uint256 public rollover;                        // reserve for next round
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(Side => mapping(address => uint256))) public stakes;
    mapping(uint256 => mapping(address => Side)) public sideOf;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event RoundStarted(uint256 indexed id, uint64 startTime, uint64 endTime, uint256 rolloverIn);
    event Committed(uint256 indexed id, address indexed player, Side side, uint256 amount);
    event SideSwitched(uint256 indexed id, address indexed player, Side fromSide, Side toSide, uint256 amount);
    event RoundResolved(
        uint256 indexed id,
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
        _startRound(0);
    }

    /// @notice Open the next round. Anyone may call once the previous round
    /// is resolved; rounds are sequential, never overlapping.
    function startRound() external {
        Round storage prev = rounds[currentRoundId];
        if (!prev.resolved) revert PrevRoundUnresolved();
        _startRound(rollover);
    }

    function _startRound(uint256 rolloverIn) internal {
        unchecked { currentRoundId += 1; }
        rollover = 0;
        Round storage r = rounds[currentRoundId];
        r.startTime = uint64(block.timestamp);
        r.endTime = uint64(block.timestamp + ROUND_LENGTH);
        r.jackpot = rolloverIn;
        emit RoundStarted(currentRoundId, r.startTime, r.endTime, rolloverIn);
    }

    /// @notice Commit $WIF to a side. One side per address per round;
    /// committing again on the same side adds stake, on the other side
    /// moves the full stake.
    function commit(Side side, uint256 amount) external nonReentrant {
        if (side == Side.None) revert BelowMinimum();
        if (amount < MIN_COMMIT) revert BelowMinimum();
        Round storage r = rounds[currentRoundId];
        if (r.resolved || block.timestamp >= r.endTime) revert RoundNotOpen();

        if (!wif.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();

        Side prevSide = sideOf[currentRoundId][msg.sender];
        if (prevSide == Side.None) {
            sideOf[currentRoundId][msg.sender] = side;
            stakes[currentRoundId][side][msg.sender] = amount;
        } else if (prevSide == side) {
            stakes[currentRoundId][side][msg.sender] += amount;
        } else {
            uint256 moved = stakes[currentRoundId][prevSide][msg.sender];
            stakes[currentRoundId][prevSide][msg.sender] = 0;
            stakes[currentRoundId][side][msg.sender] += amount;
            sideOf[currentRoundId][msg.sender] = side;
            unchecked {
                if (prevSide == Side.Up) r.potUp -= moved; else r.potDown -= moved;
            }
            emit SideSwitched(currentRoundId, msg.sender, prevSide, side, moved);
        }
        unchecked {
            if (side == Side.Up) r.potUp += amount; else r.potDown += amount;
        }
        emit Committed(currentRoundId, msg.sender, side, amount);
    }

    /// @notice Keeper-only, one-shot, after endTime. Stores prices and the
    /// winning side; payouts are computed at claim time. Rollover fee is
    /// reserved here.
    // TODO(oracle): replace keeper prices with an onchain oracle (Pyth)
    // when one supports $WIF on Robinhood Chain.
    function resolve(uint128 openPrice, uint128 closePrice, string calldata priceSource)
        external
        onlyKeeper
    {
        Round storage r = rounds[currentRoundId];
        if (r.resolved) revert AlreadyResolved();
        if (block.timestamp < r.endTime) revert RoundStillOpen();
        if (openPrice == 0 || closePrice == 0) revert BelowMinimum();

        r.openPrice = openPrice;
        r.closePrice = closePrice;
        r.resolved = true;
        r.winningSide = closePrice > openPrice ? Side.Up : Side.Down;

        uint256 pot = r.potUp + r.potDown;
        uint256 fee = (pot * FEE_BPS) / 10_000;
        rollover = fee;
        emit RoundResolved(
            currentRoundId,
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
    /// previous round's rollover. Conservation: the fee stays in the
    /// contract and becomes the next round's jackpot, so every wei is
    /// either claimed or rolls forward.
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

    /// @notice View: your potential payout if your side wins the round.
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
