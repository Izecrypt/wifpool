// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUniPool {
    function token0() external view returns (address);
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external returns (int256 amount0, int256 amount1);
}

/// One-shot helper: swap an exact input through a known Uni v3 pool without
/// relying on the chain's router deployment. Deployed, used, and documented
/// for the wifpool setup swap only.
contract SwapHelper {
    uint160 private constant MIN_RATIO = 4295128739 + 1;
    uint160 private constant MAX_RATIO = 1461446703485210103287273052203988822378723970342 - 1;

    function swapExactIn(address pool, address tokenIn, uint256 amountIn, uint256 minOut, address recipient)
        external returns (uint256 out)
    {
        bool zeroForOne = tokenIn == IUniPool(pool).token0();
        (int256 d0, int256 d1) = IUniPool(pool).swap(
            recipient,
            zeroForOne,
            int256(amountIn),
            zeroForOne ? MIN_RATIO : MAX_RATIO,
            abi.encode(msg.sender, tokenIn)
        );
        uint256 owed = uint256(zeroForOne ? d0 : d1);
        require(owed == amountIn, "input mismatch");
        out = uint256(-(zeroForOne ? d1 : d0));
        require(out >= minOut, "slippage");
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        (address payer, address tokenIn) = abi.decode(data, (address, address));
        uint256 owed = amount0Delta > 0 ? uint256(amount0Delta) : uint256(amount1Delta);
        require(IERC20(tokenIn).transferFrom(payer, msg.sender, owed), "pay failed");
    }
}
