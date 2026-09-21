// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Season satellite — opened on mint, settled before cell close.
interface ISeasonPool {
    function openForMint(uint256 cdpId) external returns (uint256 marketId);

    /// @dev If market open: resolve when mature, else revert. No-op if none / already resolved.
    function ensureSettled(uint256 cdpId) external;

    function marketOfCdp(uint256 cdpId) external view returns (uint256);
}
