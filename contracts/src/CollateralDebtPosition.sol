// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IMontaneMonad} from "./interfaces/IMontaneMonad.sol";
import {ICollateralDebtPosition} from "./interfaces/ICollateralDebtPosition.sol";
import {MontaneParams} from "./helpers/MontaneParams.sol";

contract CollateralDebtPosition is ICollateralDebtPosition {
    address public immutable cdpManager;
    address public immutable creditMarket;
    IMontaneMonad public immutable debtToken;
    uint256 public nextId;
    /// @dev Active CDPs with H <= FROSTBITE. Kept in sync on create / repay / setCollateral.
    uint256 public frostbiteCount;

    error OnlyCDPManager();
    error OnlyBook();
    error CDPAlreadyExists();
    error CDPMissing();

    mapping(uint256 => CDP) public cdpMap;
    mapping(address => bool) public hasActiveCDP;
    mapping(address => uint256) public positionOf;

    /// @dev Compact active set (swap-and-pop). Scans ignore closed holes in `1..nextId`.
    uint256[] private _activeIds;
    mapping(uint256 => uint256) private _activeIndex; // 1-based into _activeIds; 0 = absent

    /// @dev PAR < H <= FROSTBITE and below waterline target. Used by injectWaterline.
    uint256[] private _waterlineIds;
    mapping(uint256 => uint256) private _waterlineIndex; // 1-based; 0 = absent

    constructor(address _cdpManager, address _debtToken, address _creditMarket) {
        cdpManager = _cdpManager;
        debtToken = IMontaneMonad(_debtToken);
        creditMarket = _creditMarket;
    }

    function activeCount() external view returns (uint256) {
        return _activeIds.length;
    }

    function activeIdAt(uint256 index) external view returns (uint256) {
        return _activeIds[index];
    }

    function waterlineCount() external view returns (uint256) {
        return _waterlineIds.length;
    }

    function waterlineIdAt(uint256 index) external view returns (uint256) {
        return _waterlineIds[index];
    }

    function createCDP(address issuer, uint256 collateralAmount, uint256 debtAmount)
        external
        returns (uint256 cdpId)
    {
        if (msg.sender != cdpManager) revert OnlyCDPManager();
        if (hasActiveCDP[issuer]) revert CDPAlreadyExists();
        require(collateralAmount > 0 && debtAmount > 0, "zero");

        cdpId = ++nextId;
        cdpMap[cdpId] = CDP({
            issuer: issuer,
            longOwner: issuer,
            collateralAmount: collateralAmount,
            debtAmount: debtAmount,
            openedAt: block.timestamp,
            firstSaleAt: 0,
            openBlock: block.number,
            active: true
        });
        hasActiveCDP[issuer] = true;
        positionOf[issuer] = cdpId;
        _activeIds.push(cdpId);
        _activeIndex[cdpId] = _activeIds.length;
        if (_isFrost(collateralAmount, debtAmount)) {
            unchecked {
                ++frostbiteCount;
            }
        }
        if (_waterlineNeed(collateralAmount, debtAmount) > 0) {
            _addWaterline(cdpId);
        }
    }

    function markFirstSale(uint256 cdpId, address longOwner) external {
        if (msg.sender != creditMarket && msg.sender != cdpManager) revert OnlyBook();
        CDP storage c = cdpMap[cdpId];
        if (!c.active) revert CDPMissing();
        if (c.firstSaleAt == 0) c.firstSaleAt = block.timestamp;
        c.longOwner = longOwner;
    }

    function repayCDP(uint256 cdpId) external {
        if (msg.sender != cdpManager) revert OnlyCDPManager();
        CDP storage c = cdpMap[cdpId];
        if (!c.active) revert CDPMissing();
        if (_isFrost(c.collateralAmount, c.debtAmount)) {
            unchecked {
                --frostbiteCount;
            }
        }
        _removeWaterline(cdpId);
        c.active = false;
        hasActiveCDP[c.issuer] = false;
        _removeActive(cdpId);
    }

    /// @dev Accounting only. USDC movement lives on MontaneMonad.novateCell.
    /// @dev Starts the long withdraw clock if the note never traded (hunter must be able to exit).
    function liquidateCDP(address liquidator, uint256 cdpId) external {
        if (msg.sender != cdpManager) revert OnlyCDPManager();
        CDP storage c = cdpMap[cdpId];
        if (!c.active) revert CDPMissing();
        c.longOwner = liquidator;
        if (c.firstSaleAt == 0) c.firstSaleAt = block.timestamp;
    }

    function setCollateral(uint256 cdpId, uint256 g) external {
        if (msg.sender != cdpManager) revert OnlyCDPManager();
        CDP storage c = cdpMap[cdpId];
        uint256 debt = c.debtAmount;
        bool wasFrost = _isFrost(c.collateralAmount, debt);
        bool wasLine = _waterlineIndex[cdpId] != 0;
        c.collateralAmount = g;
        bool nowFrost = _isFrost(g, debt);
        bool nowLine = _waterlineNeed(g, debt) > 0;
        if (wasFrost && !nowFrost) {
            unchecked {
                --frostbiteCount;
            }
        } else if (!wasFrost && nowFrost) {
            unchecked {
                ++frostbiteCount;
            }
        }
        if (wasLine && !nowLine) {
            _removeWaterline(cdpId);
        } else if (!wasLine && nowLine) {
            _addWaterline(cdpId);
        }
    }

    function health(uint256 cdpId) public view returns (uint256) {
        CDP storage c = cdpMap[cdpId];
        if (!c.active || c.debtAmount == 0) revert CDPMissing();
        return (c.collateralAmount * MontaneParams.WAD) / c.debtAmount;
    }

    /// @dev Same G/F as health, but allowed after repay — Season must still resolve.
    function ratio(uint256 cdpId) public view returns (uint256) {
        CDP storage c = cdpMap[cdpId];
        if (c.debtAmount == 0) revert CDPMissing();
        return (c.collateralAmount * MontaneParams.WAD) / c.debtAmount;
    }

    function getCDP(uint256 cdpId) external view returns (CDP memory) {
        return cdpMap[cdpId];
    }

    function _isFrost(uint256 collateralAmount, uint256 debtAmount) private pure returns (bool) {
        if (debtAmount == 0) return false;
        return (collateralAmount * MontaneParams.WAD) / debtAmount <= MontaneParams.FROSTBITE;
    }

    /// @dev Same band as injectWaterline: PAR < H <= FROSTBITE and G below target just over 1.10.
    function _waterlineNeed(uint256 collateralAmount, uint256 debtAmount) private pure returns (uint256) {
        if (debtAmount == 0) return 0;
        uint256 h = (collateralAmount * MontaneParams.WAD) / debtAmount;
        if (h <= MontaneParams.PAR || h > MontaneParams.FROSTBITE) return 0;
        uint256 target = ((MontaneParams.FROSTBITE + 1) * debtAmount + MontaneParams.WAD - 1) / MontaneParams.WAD;
        if (collateralAmount >= target) return 0;
        return target - collateralAmount;
    }

    function _addWaterline(uint256 cdpId) private {
        if (_waterlineIndex[cdpId] != 0) return;
        // Bound set size to the inject scan cap — never grow an uncapped array.
        if (_waterlineIds.length >= MontaneParams.WATERLINE_SCAN_MAX) return;
        _waterlineIds.push(cdpId);
        _waterlineIndex[cdpId] = _waterlineIds.length;
    }

    function _removeWaterline(uint256 cdpId) private {
        uint256 idx = _waterlineIndex[cdpId];
        if (idx == 0) return;
        uint256 lastIdx = _waterlineIds.length;
        uint256 lastId = _waterlineIds[lastIdx - 1];
        if (idx != lastIdx) {
            _waterlineIds[idx - 1] = lastId;
            _waterlineIndex[lastId] = idx;
        }
        _waterlineIds.pop();
        _waterlineIndex[cdpId] = 0;
    }

    function _removeActive(uint256 cdpId) private {
        uint256 idx = _activeIndex[cdpId];
        if (idx == 0) return;
        uint256 lastIdx = _activeIds.length;
        uint256 lastId = _activeIds[lastIdx - 1];
        if (idx != lastIdx) {
            _activeIds[idx - 1] = lastId;
            _activeIndex[lastId] = idx;
        }
        _activeIds.pop();
        _activeIndex[cdpId] = 0;
    }
}
