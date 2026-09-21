// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMontaneMonad is IERC20 {
    function usdc() external view returns (IERC20);
    function cdpManager() external view returns (address);
    function setIssuanceCost(uint256 _issuanceCost) external;
    function repay(address owner, uint256 amount) external;
    function burnFrom(address from, uint256 amount) external;
    function novateCell(address owner, address longOwner, uint256 toLong, uint256 bid) external;
    function issue(address tokenTo, address owner, uint256 amount, uint256 collateral) external;
    function getIssuanceCost() external view returns (uint256);
    function pullUsdc(address to, uint256 amount) external;
    function inject(address owner, uint256 amount) external;
    function withdrawCell(address owner, address to, uint256 amount) external;
    function underlyingCollateral(address owner) external view returns (uint256);
    function issuedDebt(address owner) external view returns (uint256);
}
