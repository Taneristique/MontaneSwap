// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {MontaneSwap} from "../src/MontaneSwap.sol";
import {Treasury} from "../src/Treasury.sol";
import {CDPManager} from "../src/CDPManager.sol";
import {CreditMarket} from "../src/CreditMarket.sol";
import {CollateralDebtPosition} from "../src/CollateralDebtPosition.sol";
import {MontaneMonad} from "../src/MontaneMonad.sol";
import {MontaneParams} from "../src/helpers/MontaneParams.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// Short book = cash-settled note-price future: 1 USDC per unit, short gets PAR − v, writer gets v.
contract ShortFutureTest is Test {
    MockPyth pyth;
    MockUSDC usdc;
    MontaneSwap protocol;
    CDPManager manager;
    CreditMarket market;
    CollateralDebtPosition position;
    MontaneMonad token;

    address mateo = address(0xA11CE);
    address alice = address(0xB0B);
    address bob = address(0xB0B2);
    address carol = address(0xCA201);
    address dave = address(0xDA5E);

    uint256 constant SEED_ASK = MontaneParams.PAR + MontaneParams.SPREAD;

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
        position = protocol.position();
        token = protocol.token();
        address[5] memory users = [mateo, alice, bob, carol, dave];
        for (uint256 i = 0; i < users.length; i++) {
            usdc.mint(users[i], 10_000 ether);
            vm.prank(users[i]);
            usdc.approve(address(market), type(uint256).max);
        }
    }

    function test_tradeLocksOneUsdcPerUnit_cellUntouched() public {
        uint256 id = _mint();
        uint256 g = position.getCDP(id).collateralAmount;

        uint256 bobBefore = usdc.balanceOf(bob);
        _short(bob, id, 0.9 ether, 10 ether);
        assertEq(bobBefore - usdc.balanceOf(bob), 1 ether, "short escrows PAR - e");

        uint256 carolBefore = usdc.balanceOf(carol);
        _write(carol, id, 0.9 ether, 10 ether);
        uint256 fee = (9 ether * MontaneParams.TAKER_BPS) / MontaneParams.BPS;
        assertEq(carolBefore - usdc.balanceOf(carol), 9 ether + fee, "writer pays e + fee");

        assertEq(market.shortSize(bob, id), 10 ether);
        assertEq(market.writerSize(carol, id), 10 ether);
        assertEq(market.shortPot(id), 10 ether);
        assertEq(position.getCDP(id).collateralAmount, g);
        assertEq(position.getCDP(id).debtAmount, 100 ether);
        assertEq(token.totalSupply(id), 100 ether);
    }

    function test_thinBook_settlesAtRedemptionValue() public {
        uint256 id = _mint();
        _short(bob, id, 0.9 ether, 10 ether);
        _write(carol, id, 0.9 ether, 10 ether);

        vm.expectRevert(CreditMarket.TooEarly.selector);
        market.settleShorts(id);

        vm.warp(block.timestamp + MontaneParams.MATURITY);
        market.settleShorts(id);
        assertEq(market.shortMark(id), MontaneParams.PAR, "H >= 1 redeems at par");

        assertEq(_claim(bob, id), 0);
        assertEq(_claim(carol, id), 10 ether);
        assertEq(market.shortPot(id), 0);
    }

    function test_priceSettlement_shortWinsWhenNotesTradeDown() public {
        uint256 id = _mint();
        _buyLong(alice, id, SEED_ASK, 30 ether);
        _short(bob, id, 0.9 ether, 20 ether);
        _write(carol, id, 0.9 ether, 20 ether);

        // Later shorts print lower, which lowers the long floor (last short + gap) and lets notes trade down.
        _short(dave, id, 0.6 ether, 10 ether);
        _write(mateo, id, 0.6 ether, 10 ether);
        for (uint256 i = 0; i < 30; i++) {
            vm.warp(block.timestamp + 1 hours);
            vm.prank(alice);
            market.placeOrder(id, CreditMarket.Side.LongAsk, 0.7 ether, 1 ether);
            _buyLong(dave, id, 0.7 ether, 1 ether);
        }

        vm.warp(block.timestamp + MontaneParams.MATURITY);
        (uint256 twap,,) = market.seasonMark(id);
        market.settleShorts(id);
        assertEq(market.shortMark(id), twap);
        assertLt(twap, 0.9 ether, "notes traded below bob's entry");

        uint256 shortOut = _claim(bob, id);
        uint256 writerOut = _claim(carol, id);
        assertEq(shortOut, (20 ether * (MontaneParams.PAR - twap)) / 1 ether);
        assertGt(shortOut, 2 ether, "short profits: paid 0.10 per unit, receives more");
        assertLe(shortOut + writerOut, 20 ether, "pot covers both sides");
    }

    function test_holdingBothSides_netsAtOneUsdc() public {
        uint256 id = _mint();
        _short(bob, id, 0.9 ether, 10 ether);
        _write(carol, id, 0.9 ether, 10 ether);

        _short(carol, id, 0.88 ether, 10 ether);
        uint256 carolBefore = usdc.balanceOf(carol);
        _write(dave, id, 0.88 ether, 10 ether);

        assertEq(usdc.balanceOf(carol) - carolBefore, 10 ether, "netted units refund 1 USDC each");
        assertEq(market.shortSize(carol, id), 0);
        assertEq(market.writerSize(carol, id), 0);
        assertEq(market.shortSize(bob, id), 10 ether);
        assertEq(market.writerSize(dave, id), 10 ether);
        assertEq(market.shortPot(id), 10 ether);
    }

    function test_shortBook_rejectsParPriceAndClosesAtMaturity() public {
        uint256 id = _mint();
        vm.prank(bob);
        vm.expectRevert(CreditMarket.BadOrder.selector);
        market.placeOrder(id, CreditMarket.Side.ShortAsk, MontaneParams.PAR, 1 ether);

        _short(bob, id, 0.9 ether, 10 ether);
        uint256 askId = market.orderCount();
        vm.warp(block.timestamp + MontaneParams.MATURITY);

        vm.prank(carol);
        vm.expectRevert(CreditMarket.ShortClosed.selector);
        market.placeOrder(id, CreditMarket.Side.ShortBid, 0.9 ether, 1 ether);

        vm.prank(carol);
        vm.expectRevert(CreditMarket.ShortClosed.selector);
        market.fillOrder(askId, 1 ether);

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        market.cancelOrder(askId);
        assertEq(usdc.balanceOf(bob) - bobBefore, 1 ether, "resting escrow refundable");
    }

    function test_repaySettlesShortsAndRefundsRestingEscrow() public {
        uint256 id = _mint();
        _short(bob, id, 0.9 ether, 10 ether);
        _write(carol, id, 0.9 ether, 4 ether);

        vm.warp(block.timestamp + MontaneParams.MATURITY);
        vm.roll(block.number + MontaneParams.MIN_BLOCKS);
        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(mateo);
        manager.repayCDP(id);

        assertTrue(market.shortSettled(id));
        assertEq(usdc.balanceOf(bob) - bobBefore, 0.6 ether, "unfilled short escrow returned on close");
        assertEq(_claim(bob, id), 0);
        assertEq(_claim(carol, id), 4 ether);
    }

    function test_dustFills_doNotWalkNotePrice() public {
        uint256 id = _mint();
        _buyLong(alice, id, SEED_ASK, 30 ether);
        (uint256 twapBefore, uint256 fills,) = market.seasonMark(id);
        assertEq(fills, 1);
        uint256 markBefore = market.pMid();

        for (uint256 i = 0; i < 20; i++) {
            vm.prank(alice);
            market.placeOrder(id, CreditMarket.Side.LongAsk, 3 ether, 0.5 ether);
            _buyLong(dave, id, 3 ether, 0.5 ether);
        }
        (uint256 twap, uint256 fillsAfter, uint256 volume) = market.seasonMark(id);
        assertEq(fillsAfter, 1, "sub-1% fills stay off the tape");
        assertEq(volume, 30 ether);
        assertEq(twap, twapBefore);
        assertEq(market.pMid(), markBefore, "sub-1% fills don't move the global mark");
    }

    function test_shortOpenInterest_cappedAtHalfFace() public {
        uint256 id = _mint();
        _short(bob, id, 0.9 ether, 60 ether);
        _write(carol, id, 0.9 ether, 50 ether);
        assertEq(market.shortPot(id), 50 ether);

        vm.prank(dave);
        vm.expectRevert(CreditMarket.ShortCap.selector);
        market.placeOrder(id, CreditMarket.Side.ShortBid, 0.9 ether, 1 ether);
    }

    function _mint() internal returns (uint256 id) {
        uint256 debt = 100 ether;
        uint256 usdcIn = (debt * 14) / 10 + (debt * MontaneParams.ORIGINATION_BPS) / MontaneParams.BPS;
        vm.startPrank(mateo);
        usdc.approve(address(manager), usdcIn);
        id = manager.createCDP(debt, usdcIn);
        vm.stopPrank();
    }

    function _short(address who, uint256 id, uint256 px, uint256 amount) internal {
        vm.prank(who);
        market.placeOrder(id, CreditMarket.Side.ShortAsk, px, amount);
    }

    function _write(address who, uint256 id, uint256 px, uint256 amount) internal {
        vm.prank(who);
        market.placeOrder(id, CreditMarket.Side.ShortBid, px, amount);
    }

    function _buyLong(address who, uint256 id, uint256 px, uint256 amount) internal {
        vm.prank(who);
        market.placeOrder(id, CreditMarket.Side.LongBid, px, amount);
    }

    function _claim(address who, uint256 id) internal returns (uint256 out) {
        uint256 before = usdc.balanceOf(who);
        market.claimShort(id, who);
        out = usdc.balanceOf(who) - before;
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
