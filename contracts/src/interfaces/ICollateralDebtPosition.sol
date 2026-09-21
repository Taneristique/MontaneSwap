// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICollateralDebtPosition {
    struct CDP {
        address issuer;
        address longOwner;
        uint256 collateralAmount;
        uint256 debtAmount;
        uint256 openedAt;
        uint256 firstSaleAt;
        uint256 openBlock;
        bool active;
    }

    function createCDP(address issuer, uint256 collateralAmount, uint256 debtAmount)
        external
        returns (uint256 cdpId);

    function liquidateCDP(address liquidator, uint256 cdpId) external;

    function repayCDP(uint256 cdpId) external;

    function markFirstSale(uint256 cdpId, address longOwner) external;

    function setCollateral(uint256 cdpId, uint256 g) external;

    function health(uint256 cdpId) external view returns (uint256);

    /// @dev G/F even if inactive — Season resolve escape when cell already closed.
    function ratio(uint256 cdpId) external view returns (uint256);

    function nextId() external view returns (uint256);

    function activeCount() external view returns (uint256);

    function activeIdAt(uint256 index) external view returns (uint256);

    function waterlineCount() external view returns (uint256);

    function waterlineIdAt(uint256 index) external view returns (uint256);

    function frostbiteCount() external view returns (uint256);

    function getCDP(uint256 cdpId) external view returns (CDP memory);
}
