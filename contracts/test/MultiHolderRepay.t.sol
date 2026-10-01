// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {MontaneSwap} from "../src/MontaneSwap.sol";
import {Treasury} from "../src/Treasury.sol";
import {CDPManager} from "../src/CDPManager.sol";
import {CreditMarket} from "../src/CreditMarket.sol";
import {MontaneMonad} from "../src/MontaneMonad.sol";
import {MontaneParams} from "../src/helpers/MontaneParams.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// Every holder of a cell's notes must be redeemed at repay, not only the last buyer.
contract MultiHolderRepayTest is Test {
    MockPyth pyth;
    MockUSDC usdc;
    MontaneSwap protocol;
    CDPManager manager;
    CreditMarket market;

    address mateo = address(0xA11CE);
    address alice = address(0xB0B);
    address bob = address(0xB0B2);

    bytes32 constant MON_USD = 0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1;
    bytes32 constant USDC_USD = 0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a;

    function setUp() public {
        pyth = new MockPyth(60, 1);
        usdc = new MockUSDC();
        bytes[] memory upd = new bytes[](2);
        upd[0] = pyth.createPriceFeedUpdateData(MON_USD, 1e8, 0, -8, 1e8, 0, uint64(block.timestamp));
        upd[1] = pyth.createPriceFeedUpdateData(USDC_USD, 1e8, 0, -8, 1e8, 0, uint64(block.timestamp));
        pyth.updatePriceFeeds{value: pyth.getUpdateFee(upd)}(upd);
        Treasury treasury = new Treasury(address(this));
        protocol = new MontaneSwap(address(treasury), address(usdc), address(pyth), address(this));
        manager = protocol.manager();
        market = protocol.market();
        usdc.mint(mateo, 10_000 ether);
        usdc.mint(alice, 10_000 ether);
        usdc.mint(bob, 10_000 ether);
    }

    function test_repayRedeemsEveryHolder() public {
        uint256 debt = 100 ether;
        uint256 usdcIn = (debt * 14) / 10 + (debt * MontaneParams.ORIGINATION_BPS) / MontaneParams.BPS;
        vm.startPrank(mateo);
        usdc.approve(address(manager), usdcIn);
        uint256 cdpId = manager.createCDP(debt, usdcIn);
        vm.stopPrank();

        uint256 px = MontaneParams.PAR + MontaneParams.SPREAD;
        _buy(alice, cdpId, px, 30 ether);
        _buy(bob, cdpId, px, 30 ether);

        vm.warp(block.timestamp + MontaneParams.MATURITY + 1);
        vm.roll(block.number + 10);
        vm.prank(mateo);
        manager.repayCDP(cdpId);

        MontaneMonad token = protocol.token();
        address[2] memory holders = [alice, bob];
        for (uint256 i = 0; i < 2; i++) {
            uint256 before = usdc.balanceOf(holders[i]);
            vm.prank(holders[i]);
            token.redeem(cdpId);
            assertEq(usdc.balanceOf(holders[i]) - before, 30 ether, "par per note");
            assertEq(token.balanceOf(holders[i], cdpId), 0, "notes burned");
        }
    }

    function test_notesAreNotFungibleAcrossCells() public {
        uint256 debt = 100 ether;
        uint256 usdcIn = (debt * 14) / 10 + (debt * MontaneParams.ORIGINATION_BPS) / MontaneParams.BPS;
        vm.startPrank(mateo);
        usdc.approve(address(manager), usdcIn);
        uint256 a = manager.createCDP(debt, usdcIn);
        vm.stopPrank();
        vm.startPrank(bob);
        usdc.approve(address(manager), usdcIn);
        uint256 b = manager.createCDP(debt, usdcIn);
        vm.stopPrank();

        _buy(alice, b, MontaneParams.PAR + MontaneParams.SPREAD, 10 ether);
        assertEq(protocol.token().balanceOf(alice, b), 10 ether);
        assertEq(protocol.token().balanceOf(alice, a), 0);

        vm.prank(mateo);
        vm.expectRevert();
        manager.retire(a, 10 ether);
    }

    function test_underwaterCellRedeemsProRata() public {
        uint256 debt = 100 ether;
        uint256 usdcIn = (debt * 11) / 10 + (debt * MontaneParams.ORIGINATION_BPS) / MontaneParams.BPS;
        vm.startPrank(mateo);
        usdc.approve(address(manager), usdcIn);
        uint256 cdpId = manager.createCDP(debt, usdcIn);
        vm.stopPrank();
        _buy(alice, cdpId, MontaneParams.PAR + MontaneParams.SPREAD, 50 ether);

        vm.warp(block.timestamp + MontaneParams.MATURITY + 1);
        vm.roll(block.number + 10);
        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        manager.redeemMatured(cdpId, 50 ether);
        assertEq(usdc.balanceOf(alice) - before, 50 ether, "H >= 1 pays par");
        assertEq(manager.healthOf(cdpId), (1.2e18 * 1e18) / market.pMid());
    }

    function _buy(address who, uint256 cdpId, uint256 px, uint256 amount) internal {
        vm.startPrank(who);
        usdc.approve(address(market), (amount * px) / 1 ether + 1);
        market.placeOrder(cdpId, CreditMarket.Side.LongBid, px, amount);
        vm.stopPrank();
    }
}
