// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev Protocol hub. `paused` is guardian halt (separate from market circuit `frozen`).
interface ICDPManager {
    function injectWaterline(uint256 usdcIn) external returns (uint256 used);
    function fomoMode() external view returns (uint8);
    function frostbiteShare() external view returns (uint256);
    function paused() external view returns (bool);
}
