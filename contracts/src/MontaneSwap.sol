// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {CDPManager} from "./CDPManager.sol";
import {CollateralDebtPosition} from "./CollateralDebtPosition.sol";
import {CreditMarket} from "./CreditMarket.sol";
import {MontaneMonad} from "./MontaneMonad.sol";
import {CreateAddress} from "./helpers/CreateAddress.sol";

/// @dev Protocol root. Customer name: Montane Swap. Note token stays MontaneMonad / mMonad.
/// @dev Core deps stay immutable. Guardian on CDPManager can pause; users escape via emergencyClose / cancelOrder.
contract MontaneSwap {
    string public constant name = "Montane Swap";

    CDPManager public immutable manager;
    CollateralDebtPosition public immutable position;
    CreditMarket public immutable market;
    MontaneMonad public immutable token;

    constructor(address treasury, address usdc, address pyth, address guardian) {
        address self = address(this);
        address managerAddr = CreateAddress.compute(self, 1);
        address cdpAddr = CreateAddress.compute(self, 2);
        address marketAddr = CreateAddress.compute(self, 3);
        address tokenAddr = CreateAddress.compute(self, 4);

        manager = new CDPManager(treasury, usdc, tokenAddr, cdpAddr, marketAddr, guardian);
        position = new CollateralDebtPosition(managerAddr, tokenAddr, marketAddr);
        market = new CreditMarket(pyth, treasury, usdc, managerAddr, tokenAddr, cdpAddr);
        token = new MontaneMonad(managerAddr, marketAddr, usdc);

        require(address(manager) == managerAddr, "manager addr");
        require(address(position) == cdpAddr, "cdp addr");
        require(address(market) == marketAddr, "market addr");
        require(address(token) == tokenAddr, "token addr");
    }
}
