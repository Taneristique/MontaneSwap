// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IMontaneMonad} from "./interfaces/IMontaneMonad.sol";
import {MontaneAccess} from "./helpers/MontaneAccess.sol";
import {MontaneParams} from "./helpers/MontaneParams.sol";

/// @notice mMonad notes, one ERC-1155 id per cell (id = cdpId). 1 note = claim on 1 USDC of that cell at par.
/// @dev Holds every cell's USDC collateral. Cell G/F bookkeeping lives in CollateralDebtPosition.
/// @dev CreditMarket and CDPManager are built-in operators: they only move notes of the caller they act for.
contract MontaneMonad is ERC1155Supply, IMontaneMonad, MontaneAccess, ReentrancyGuard {
    using SafeERC20 for IERC20;

    string public constant name = "MontaneMonad";
    string public constant symbol = "mMonad";

    IERC20 public immutable override usdc;
    uint256 public issuanceCost;
    /// @dev USDC reserved for holders after the issuer closes the cell.
    mapping(uint256 => uint256) public redeemPool;
    mapping(uint256 => bool) public redeemOpen;

    event RedemptionOpened(uint256 indexed cdpId, uint256 reserve, uint256 outstanding);
    event Redeemed(uint256 indexed cdpId, address indexed holder, uint256 notes, uint256 usdcOut);

    error RedeemClosed();
    error NothingToRedeem();

    constructor(address _cdpManager, address _creditMarket, address _usdc)
        ERC1155("")
        MontaneAccess(_cdpManager, _creditMarket)
    {
        usdc = IERC20(_usdc);
        issuanceCost = MontaneParams.PAR;
    }

    function cdpManager() public view override(MontaneAccess, IMontaneMonad) returns (address) {
        return MontaneAccess.cdpManager();
    }

    function totalSupply(uint256 cdpId) public view override(ERC1155Supply, IMontaneMonad) returns (uint256) {
        return ERC1155Supply.totalSupply(cdpId);
    }

    function isApprovedForAll(address account, address operator)
        public
        view
        override(ERC1155, IERC1155)
        returns (bool)
    {
        if (operator == _creditMarket || operator == _cdpManager) return true;
        return super.isApprovedForAll(account, operator);
    }

    function mint(address to, uint256 cdpId, uint256 amount) external onlyCDPManager {
        _mint(to, cdpId, amount, "");
    }

    function burn(address from, uint256 cdpId, uint256 amount) external onlyCDPManager {
        _burn(from, cdpId, amount);
    }

    function payOut(address to, uint256 amount) external onlyCDPManager {
        if (amount > 0) usdc.safeTransfer(to, amount);
    }

    function pullUsdc(address to, uint256 amount) external {
        require(msg.sender == _cdpManager || msg.sender == _creditMarket, "pull");
        usdc.safeTransfer(to, amount);
    }

    /// @dev Called once when the issuer closes the cell; `reserve` = min(G, outstanding) at par.
    function openRedemption(uint256 cdpId, uint256 reserve) external onlyCDPManager {
        redeemOpen[cdpId] = true;
        redeemPool[cdpId] = reserve;
        emit RedemptionOpened(cdpId, reserve, totalSupply(cdpId));
    }

    /// @notice Burn all your notes of a closed cell for your pro-rata share of its reserve (par if fully backed).
    function redeem(uint256 cdpId) external nonReentrant returns (uint256 out) {
        if (!redeemOpen[cdpId]) revert RedeemClosed();
        uint256 held = balanceOf(msg.sender, cdpId);
        if (held == 0) revert NothingToRedeem();
        out = (redeemPool[cdpId] * held) / totalSupply(cdpId);
        redeemPool[cdpId] -= out;
        _burn(msg.sender, cdpId, held);
        if (out > 0) usdc.safeTransfer(msg.sender, out);
        emit Redeemed(cdpId, msg.sender, held, out);
    }

    function setIssuanceCost(uint256 _issuanceCost) external onlyCreditMarket {
        issuanceCost = _issuanceCost;
    }

    function getIssuanceCost() external view returns (uint256) {
        return issuanceCost;
    }
}
