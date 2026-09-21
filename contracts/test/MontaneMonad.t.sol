// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MontaneMonad} from "../src/MontaneMonad.sol";
import {MontaneParams} from "../src/helpers/MontaneParams.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract MontaneMonadTest is Test {
    function test_constructorSetsIssuanceCostToPar() public {
        MockUSDC usdc = new MockUSDC();
        MontaneMonad token = new MontaneMonad(address(this), address(this), address(usdc));
        assertEq(token.issuanceCost(), MontaneParams.PAR);
        assertEq(address(token.usdc()), address(usdc));
    }
}
