// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {IPyth} from "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import {PythStructs} from "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import {CreditMarket} from "../src/CreditMarket.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract PythOracleForkTest is Test {
    address constant PYTH = 0x2880aB155794e7179c9eE2e38200202908C17B43;

    function setUp() public {
        vm.createSelectFork("https://testnet-rpc.monad.xyz");
    }

    function test_livePythSetsPPythToUsdcUsd() public {
        IPyth pyth = IPyth(PYTH);

        PythStructs.Price memory usdcPx = pyth.getPriceUnsafe(
            0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a
        );

        require(usdcPx.price > 0, "oracle returned non-positive price");

        uint256 expected = _toWad(usdcPx);
        console2.log("USDC/USD (1e18)", expected);
        console2.log("USDC publishTime", usdcPx.publishTime);
        console2.log("block.timestamp", block.timestamp);

        MockUSDC usdc = new MockUSDC();
        CreditMarket market = new CreditMarket(
            PYTH, address(this), address(usdc), address(this), address(this), address(this)
        );
        uint256 fair = market.pPyth();

        console2.log("pPyth", fair);

        assertEq(fair, expected);
        assertGt(fair, 0.9e18);
        assertLt(fair, 1.1e18);
    }

    function _toWad(PythStructs.Price memory price) internal pure returns (uint256) {
        uint256 absPrice = uint256(uint64(price.price));
        int256 decimals = int256(price.expo) + 18;
        if (decimals >= 0) {
            return absPrice * (10 ** uint256(decimals));
        }
        return absPrice / (10 ** uint256(-decimals));
    }
}
