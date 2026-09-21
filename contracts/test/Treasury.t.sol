// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Treasury} from "../src/Treasury.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract TreasuryTest is Test {
    Treasury treasury;
    MockUSDC usdc;
    address owner = address(0xA11CE);
    address ops = address(0xB0B);

    function setUp() public {
        treasury = new Treasury(owner);
        usdc = new MockUSDC();
        usdc.mint(address(treasury), 100 ether);
    }

    function test_receiveFeesAndOwnerWithdraw() public {
        assertEq(usdc.balanceOf(address(treasury)), 100 ether);

        vm.prank(owner);
        treasury.withdraw(address(usdc), ops, 40 ether);

        assertEq(usdc.balanceOf(address(treasury)), 60 ether);
        assertEq(usdc.balanceOf(ops), 40 ether);
    }

    function test_nonOwnerCannotWithdraw() public {
        vm.prank(ops);
        vm.expectRevert();
        treasury.withdraw(address(usdc), ops, 1 ether);
    }

    function test_withdrawAll() public {
        vm.prank(owner);
        treasury.withdrawAll(address(usdc), ops);
        assertEq(usdc.balanceOf(address(treasury)), 0);
        assertEq(usdc.balanceOf(ops), 100 ether);
    }

    function test_twoStepOwnership() public {
        vm.prank(owner);
        treasury.transferOwnership(ops);
        assertEq(treasury.owner(), owner);

        vm.prank(ops);
        treasury.acceptOwnership();
        assertEq(treasury.owner(), ops);
    }
}
