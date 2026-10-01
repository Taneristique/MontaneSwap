// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";

/// @dev Per-cell notes: ERC-1155 id = cdpId. Also the USDC vault for every cell's collateral.
interface IMontaneMonad is IERC1155 {
    function usdc() external view returns (IERC20);
    function cdpManager() external view returns (address);
    function setIssuanceCost(uint256 _issuanceCost) external;
    function getIssuanceCost() external view returns (uint256);
    function mint(address to, uint256 cdpId, uint256 amount) external;
    function burn(address from, uint256 cdpId, uint256 amount) external;
    function payOut(address to, uint256 amount) external;
    function pullUsdc(address to, uint256 amount) external;
    function openRedemption(uint256 cdpId, uint256 reserve) external;
    function totalSupply(uint256 cdpId) external view returns (uint256);
    function redeemPool(uint256 cdpId) external view returns (uint256);
    function redeemOpen(uint256 cdpId) external view returns (bool);
}
