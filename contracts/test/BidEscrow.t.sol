// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {MontaneSwap} from "../src/MontaneSwap.sol";
import {Treasury} from "../src/Treasury.sol";
import {CDPManager} from "../src/CDPManager.sol";
import {CreditMarket} from "../src/CreditMarket.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// Resting bids must stay funded: escrow recorded == USDC the market keeps.
contract BidEscrowTest is Test {
    MockPyth pyth;
    MockUSDC usdc;
    MontaneSwap protocol;
    CDPManager manager;
    CreditMarket market;

    address mateo = address(0xA11CE);
    address bob = address(0xB0B2);

    bytes32 constant MON_USD = 0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1;
    bytes32 constant USDC_USD = 0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a;

    function setUp() public {
        pyth = new MockPyth(60, 1);
        usdc = new MockUSDC();
        _setPrices(1e8, 1e8);
        Treasury treasury = new Treasury(address(this));
        protocol = new MontaneSwap(address(treasury), address(usdc), address(pyth), address(this));
        manager = protocol.manager();
        market = protocol.market();
        usdc.mint(mateo, 10_000 ether);
        usdc.mint(bob, 10_000 ether);

        uint256 debt = 100 ether;
        uint256 usdcIn = (debt * 12) / 10 + (debt * 25) / 10_000;
        vm.startPrank(mateo);
        usdc.approve(address(manager), usdcIn);
        manager.createCDP(debt, usdcIn);
        vm.stopPrank();
    }

    function test_restingLongBid_isFunded() public {
        // A short print at 0.4 lowers the long floor to 0.5, so a 0.5 long bid can rest under the seed ask.
        vm.startPrank(mateo);
        usdc.approve(address(market), 1 ether);
        market.placeOrder(1, CreditMarket.Side.ShortAsk, 0.4 ether, 1 ether);
        vm.stopPrank();
        vm.startPrank(bob);
        usdc.approve(address(market), 1 ether);
        market.placeOrder(1, CreditMarket.Side.ShortBid, 0.4 ether, 1 ether);
        vm.stopPrank();
        _assertRestingBidFunded(CreditMarket.Side.LongBid, 0.5 ether);
    }

    function test_restingShortBid_isFunded() public {
        _assertRestingBidFunded(CreditMarket.Side.ShortBid, 0.5 ether);
    }

    function test_crossingLongBid_restsFundedRemainder() public {
        (, , , uint256 askPx, uint256 askLeft, , , ) = market.orders(market.seedLongAskId(1));
        uint256 amount = askLeft + 10 ether;
        uint256 px = askPx;
        uint256 need = (amount * px) / 1 ether;
        uint256 mktBefore = usdc.balanceOf(address(market));

        vm.startPrank(bob);
        usdc.approve(address(market), need);
        market.placeOrder(1, CreditMarket.Side.LongBid, px, amount);
        vm.stopPrank();

        uint256 id = market.orderCount();
        uint256 escrow = market.bidEscrow(id);
        assertEq(escrow, (10 ether * px) / 1 ether, "remainder escrow");
        assertGe(usdc.balanceOf(address(market)), mktBefore + escrow, "market keeps remainder escrow");

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        market.cancelOrder(id);
        assertEq(usdc.balanceOf(bob) - bobBefore, escrow, "cancel refunds escrow");
    }

    function _assertRestingBidFunded(CreditMarket.Side side, uint256 px) internal {
        uint256 amount = 10 ether;
        uint256 need = (amount * px) / 1 ether;
        uint256 bobBefore = usdc.balanceOf(bob);
        uint256 mktBefore = usdc.balanceOf(address(market));

        vm.startPrank(bob);
        usdc.approve(address(market), need);
        market.placeOrder(1, side, px, amount);
        vm.stopPrank();

        uint256 id = market.orderCount();
        assertEq(market.bidEscrow(id), need, "escrow recorded");
        assertEq(bobBefore - usdc.balanceOf(bob), need, "bob paid for resting bid");
        assertEq(usdc.balanceOf(address(market)) - mktBefore, need, "market holds escrow");
    }

    function _setPrices(int64 mon, int64 usd) internal {
        bytes memory m = pyth.createPriceFeedUpdateData(MON_USD, mon, 0, -8, mon, 0, uint64(block.timestamp));
        bytes memory u = pyth.createPriceFeedUpdateData(USDC_USD, usd, 0, -8, usd, 0, uint64(block.timestamp));
        bytes[] memory upd = new bytes[](2);
        upd[0] = m;
        upd[1] = u;
        pyth.updatePriceFeeds{value: pyth.getUpdateFee(upd)}(upd);
    }
}
