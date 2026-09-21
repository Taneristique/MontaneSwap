// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

abstract contract MontaneAccess {
    address internal immutable _cdpManager;
    address internal immutable _creditMarket;

    error OnlyCDPManager();
    error OnlyCreditMarket();

    constructor(address cdpManager_, address creditMarket_) {
        _cdpManager = cdpManager_;
        _creditMarket = creditMarket_;
    }

    function cdpManager() public view virtual returns (address) {
        return _cdpManager;
    }

    function creditMarket() public view virtual returns (address) {
        return _creditMarket;
    }

    modifier onlyCDPManager() {
        _checkCDPManager();
        _;
    }

    modifier onlyCreditMarket() {
        _checkCreditMarket();
        _;
    }

    function _checkCDPManager() internal view {
        if (msg.sender != _cdpManager) revert OnlyCDPManager();
    }

    function _checkCreditMarket() internal view {
        if (msg.sender != _creditMarket) revert OnlyCreditMarket();
    }
}
