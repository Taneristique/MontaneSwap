// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICreditMarket {
    function seedOnMint(address issuer, uint256 cdpId, uint256 face) external;
    function cancelSeed(uint256 cdpId) external;
    function returnUnsoldTo(address issuer, uint256 cdpId) external returns (uint256);
    /// @dev Fix the short-book settlement price (idempotent). Manager calls it before G/F change on close.
    function settleShortsCdp(uint256 cdpId) external;
    /// @dev Cancel/refund all live orders for `cdpId` (bounded by LIVE_PER_SIDE_MAX × 4).
    function scrubCdp(uint256 cdpId) external;
    function pMid() external view returns (uint256);
    function pPyth() external view returns (uint256);
    function frozen() external view returns (bool);
    function paused() external view returns (bool);
    function tradingHalted() external view returns (bool);
    function seedLongAskId(uint256 cdpId) external view returns (uint256);
    function returnBps() external view returns (int256);
    /// @dev Time-weighted long-note price for `cdpId` from its first fill to min(now, maturity).
    function seasonMark(uint256 cdpId) external view returns (uint256 twap, uint256 fills, uint256 volume);
    /// @dev `who`'s short and writer units on `cdpId`, and their payout once settled.
    function shortClaim(uint256 cdpId, address who)
        external
        view
        returns (uint256 short, uint256 written, bool settled, uint256 mark, uint256 payout);
}
