// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMontaneMonad} from "./interfaces/IMontaneMonad.sol";
import {MontaneAccess} from "./helpers/MontaneAccess.sol";
import {MontaneParams} from "./helpers/MontaneParams.sol";

contract MontaneMonad is ERC20, IMontaneMonad, MontaneAccess {
    using SafeERC20 for IERC20;

    IERC20 public immutable override usdc;
    uint256 public issuanceCost;
    mapping(address => uint256) public underlyingCollateral;
    mapping(address => uint256) public issuedDebt;

    error NovationHole();

    function cdpManager() public view override(MontaneAccess, IMontaneMonad) returns (address) {
        return MontaneAccess.cdpManager();
    }

    constructor(address _cdpManager, address _creditMarket, address _usdc)
        ERC20("MontaneMonad", "mMonad")
        MontaneAccess(_cdpManager, _creditMarket)
    {
        usdc = IERC20(_usdc);
        issuanceCost = MontaneParams.PAR;
    }

    /// @dev Tokens go to `tokenTo` (CLOB escrow). Collateral and debt stick to `owner` (issuer).
    function issue(address tokenTo, address owner, uint256 amount, uint256 collateral) public onlyCDPManager {
        underlyingCollateral[owner] += collateral;
        issuedDebt[owner] += amount;
        _mint(tokenTo, amount);
    }

    /// @dev Cell novation: prior long receives `toLong` USDC; hunter `bid` stays in the cell. Debt is not burned.
    function novateCell(address owner, address longOwner, uint256 toLong, uint256 bid) public onlyCDPManager {
        uint256 g = underlyingCollateral[owner];
        if (toLong > g) revert NovationHole();
        underlyingCollateral[owner] = g - toLong + bid;
        if (toLong > 0) usdc.safeTransfer(longOwner, toLong);
    }

    function burnFrom(address from, uint256 amount) public onlyCDPManager {
        require(amount > 0, "zero");
        _burn(from, amount);
    }

    /// @dev Clears debt and returns leftover G. Burns only what `owner` still holds.
    function repay(address owner, uint256 amount) public onlyCDPManager {
        require(issuedDebt[owner] == amount, "debt mismatch");
        issuedDebt[owner] = 0;
        uint256 held = balanceOf(owner);
        if (held > 0) {
            uint256 burnAmt = held < amount ? held : amount;
            _burn(owner, burnAmt);
        }
        uint256 col = underlyingCollateral[owner];
        underlyingCollateral[owner] = 0;
        if (col > 0) usdc.safeTransfer(owner, col);
    }

    function pullUsdc(address to, uint256 amount) public {
        require(msg.sender == _cdpManager || msg.sender == _creditMarket, "pull");
        usdc.safeTransfer(to, amount);
    }

    function inject(address owner, uint256 amount) public onlyCDPManager {
        require(amount > 0, "zero");
        underlyingCollateral[owner] += amount;
    }

    function withdrawCell(address owner, address to, uint256 amount) public onlyCDPManager {
        uint256 g = underlyingCollateral[owner];
        require(amount > 0 && amount <= g, "cell");
        underlyingCollateral[owner] = g - amount;
        usdc.safeTransfer(to, amount);
    }

    function setIssuanceCost(uint256 _issuanceCost) public onlyCreditMarket {
        issuanceCost = _issuanceCost;
    }

    function getIssuanceCost() public view returns (uint256) {
        return issuanceCost;
    }
}
