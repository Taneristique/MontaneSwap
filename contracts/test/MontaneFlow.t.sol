// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {MontaneMonad} from "../src/MontaneMonad.sol";
import {CDPManager} from "../src/CDPManager.sol";
import {CollateralDebtPosition} from "../src/CollateralDebtPosition.sol";
import {CreditMarket} from "../src/CreditMarket.sol";
import {MontaneSwap} from "../src/MontaneSwap.sol";
import {Treasury} from "../src/Treasury.sol";
import {MontaneParams} from "../src/helpers/MontaneParams.sol";
import {ICollateralDebtPosition} from "../src/interfaces/ICollateralDebtPosition.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract MontaneFlowTest is Test {
    MockPyth pyth;
    MockUSDC usdc;
    CDPManager manager;
    CollateralDebtPosition position;
    CreditMarket market;
    MontaneMonad token;
    MontaneSwap protocol;
    Treasury treasuryContract;

    address treasury;
    address mateo = address(0xA11CE);
    address alice = address(0xB0B);
    address hunter = address(0x4007);
    address elif_ = address(0xE11F);

    bytes32 constant MON_USD = 0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1;
    bytes32 constant USDC_USD = 0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a;

    function setUp() public {
        pyth = new MockPyth(60, 1);
        usdc = new MockUSDC();
        _setPrices(1e8, 1e8);

        treasuryContract = new Treasury(address(this));
        treasury = address(treasuryContract);

        MontaneSwap d = new MontaneSwap(treasury, address(usdc), address(pyth), address(this));
        protocol = d;
        manager = d.manager();
        position = d.position();
        market = d.market();
        token = d.token();

        usdc.mint(mateo, 1_000 ether);
        usdc.mint(alice, 1_000 ether);
        usdc.mint(hunter, 1_000 ether);
        usdc.mint(elif_, 1_000 ether);
    }

    function test_mintSeedsBookAndKeepsIssuer() public {
        uint256 debt = 100e18;
        uint256 fee = 0.25 ether;
        uint256 id = _open(mateo, debt, 110 ether + fee);

        ICollateralDebtPosition.CDP memory cdp = position.getCDP(id);
        assertEq(cdp.issuer, mateo);
        assertEq(cdp.longOwner, mateo);
        assertEq(cdp.collateralAmount, 110 ether);
        assertEq(cdp.debtAmount, debt);
        assertTrue(cdp.active);
        assertEq(token.balanceOf(address(market), id), debt);
        assertEq(token.totalSupply(id), debt);
        assertEq(usdc.balanceOf(address(token)), 110 ether);
        assertEq(usdc.balanceOf(treasury), fee);

        uint256 askId = market.seedLongAskId(id);
        (address maker,, CreditMarket.Side side, uint256 price, uint256 remaining, bool live,,) = market.orders(askId);
        assertEq(maker, mateo);
        assertEq(uint256(side), uint256(CreditMarket.Side.LongAsk));
        assertEq(price, MontaneParams.PAR + MontaneParams.SPREAD);
        assertEq(remaining, debt);
        assertTrue(live);
        assertEq(market.pMid(), 0.955 ether, "mid of seed ask and one gap below");
        assertEq(market.pPyth(), 1e18);
        assertFalse(market.frozen());

        CreditMarket.LiveOrder[] memory book = market.liveBook();
        assertEq(book.length, 1, "short book starts empty");
        assertEq(book[0].maker, mateo);
        assertEq(book[0].landedAt, block.timestamp);
        assertEq(uint256(book[0].side), uint256(CreditMarket.Side.LongAsk));
    }

    function test_fillLongAskPaysIssuerAndSetsLongOwner() public {
        uint256 debt = 100e18;
        uint256 id = _open(mateo, debt, 110.25 ether);
        uint256 askId = market.seedLongAskId(id);

        uint256 fillAmt = 50e18;
        uint256 pay = (fillAmt * (MontaneParams.PAR + MontaneParams.SPREAD)) / token.issuanceCost();
        uint256 fee = (pay * MontaneParams.TAKER_BPS) / MontaneParams.BPS;
        uint256 mateoBefore = usdc.balanceOf(mateo);

        _fill(alice, askId, fillAmt, pay);

        assertEq(token.balanceOf(alice, id), fillAmt);
        assertEq(token.balanceOf(address(market), id), debt - fillAmt);
        assertEq(usdc.balanceOf(mateo), mateoBefore + pay - fee);
        assertEq(position.getCDP(id).longOwner, alice);
        assertEq(position.getCDP(id).firstSaleAt, block.timestamp);
        assertEq(manager.CDPPositionIssuer(id), mateo);
        assertEq(token.totalSupply(id), debt);
    }

    function test_selfMatchReverts() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        uint256 askId = market.seedLongAskId(id);
        uint256 pay = (100e18 * (MontaneParams.PAR + MontaneParams.SPREAD)) / token.issuanceCost();
        vm.startPrank(mateo);
        usdc.approve(address(market), pay);
        vm.expectRevert(CreditMarket.SelfMatch.selector);
        market.fillOrder(askId, 100e18);
        vm.stopPrank();
    }

    function test_repayBeforeMaturityReverts() public {
        uint256 id = _open(mateo, 100e18, 150.25 ether);
        vm.prank(mateo);
        vm.expectRevert(CDPManager.NotMature.selector);
        manager.repayCDP(id);
    }

    function test_repayClockStartsAtFirstSale() public {
        uint256 id = _open(mateo, 100e18, 150.25 ether);
        vm.warp(block.timestamp + 20 hours);
        vm.roll(block.number + 3);

        uint256 askId = market.seedLongAskId(id);
        uint256 pay = (1e18 * (MontaneParams.PAR + MontaneParams.SPREAD)) / token.issuanceCost();
        _fill(alice, askId, 1e18, pay);

        vm.warp(block.timestamp + 20 hours);
        vm.prank(mateo);
        vm.expectRevert(CDPManager.NotMature.selector);
        manager.repayCDP(id);
    }

    function test_repayVerdantAfterMaturity() public {
        uint256 id = _open(mateo, 100e18, 150.25 ether);
        uint256 g = position.getCDP(id).collateralAmount;
        assertEq(manager.healthOf(id), (1.5e18 * 1e18) / market.pMid());

        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 3);

        uint256 before = usdc.balanceOf(mateo);
        vm.prank(mateo);
        manager.repayCDP(id);

        assertEq(token.totalSupply(id), 0);
        assertEq(token.balanceOf(mateo, id), 0);
        assertEq(token.balanceOf(address(market), id), 0);
        assertEq(usdc.balanceOf(mateo), before + g);
        assertFalse(position.getCDP(id).active);
        assertEq(manager.lastRepaidAt(mateo), block.timestamp);
        assertEq(manager.originationBps(mateo), MontaneParams.ROLL_BPS);
    }

    function test_rollMintsAtOneBp() public {
        uint256 id = _open(mateo, 100e18, 150.25 ether);
        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 3);
        vm.prank(mateo);
        manager.repayCDP(id);

        uint256 treas = usdc.balanceOf(treasury);
        uint256 rollFee = 0.01 ether;
        uint256 id2 = _open(mateo, 100e18, 150 ether + rollFee);
        assertEq(usdc.balanceOf(treasury), treas + rollFee);
        assertEq(position.getCDP(id2).collateralAmount, 150 ether);
        assertEq(manager.originationBps(mateo), MontaneParams.ROLL_BPS);
    }

    function test_staleRollPaysFullOrigination() public {
        uint256 id = _open(mateo, 100e18, 150.25 ether);
        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 3);
        vm.prank(mateo);
        manager.repayCDP(id);

        vm.warp(block.timestamp + 2 days + 1);
        assertEq(manager.originationBps(mateo), MontaneParams.ORIGINATION_BPS);

        uint256 treas = usdc.balanceOf(treasury);
        _open(mateo, 100e18, 150.25 ether);
        assertEq(usdc.balanceOf(treasury), treas + 0.25 ether);
    }

    function test_repayReservesParForHolders() public {
        uint256 id = _open(mateo, 100e18, 150.25 ether);
        uint256 askId = market.seedLongAskId(id);
        uint256 fillAmt = 40e18;
        uint256 pay = (fillAmt * (MontaneParams.PAR + MontaneParams.SPREAD)) / token.issuanceCost();
        _fill(alice, askId, fillAmt, pay);

        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 3);

        uint256 mateoUsdc = usdc.balanceOf(mateo);
        vm.prank(mateo);
        manager.repayCDP(id);

        assertFalse(position.getCDP(id).active);
        assertEq(usdc.balanceOf(mateo), mateoUsdc + 150 ether - fillAmt);
        assertEq(token.redeemPool(id), fillAmt);

        uint256 aliceUsdc = usdc.balanceOf(alice);
        vm.prank(alice);
        token.redeem(id);
        assertEq(token.balanceOf(alice, id), 0);
        assertEq(usdc.balanceOf(alice), aliceUsdc + fillAmt);
    }

    function test_retireShrinksFace() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        _markAtPar();
        assertEq(manager.healthOf(id), MontaneParams.FROSTBITE);
        uint256 askId = market.seedLongAskId(id);
        manager.pause();
        vm.prank(mateo);
        market.cancelOrder(askId);
        manager.unpause();

        vm.prank(mateo);
        manager.retire(id, 20e18);
        assertEq(position.getCDP(id).debtAmount, 80e18);
        assertEq(token.totalSupply(id), 80e18);
        assertGt(manager.healthOf(id), MontaneParams.FROSTBITE);

        vm.prank(alice);
        vm.expectRevert(bytes("issuer"));
        manager.retire(id, 1e18);
    }

    function test_huntBondSlashedIfVerdant() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        _markAtPar();
        uint256 p = 70 ether;
        vm.startPrank(hunter);
        usdc.approve(address(manager), p);
        manager.requestHunt(id, p);
        vm.stopPrank();

        uint256 budget = 20 ether;
        usdc.mint(address(market), budget);
        vm.startPrank(address(market));
        usdc.approve(address(manager), budget);
        manager.injectWaterline(budget);
        vm.stopPrank();
        assertGt(manager.healthOf(id), MontaneParams.FROSTBITE);

        uint256 mateoBefore = usdc.balanceOf(mateo);
        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 3);
        manager.resolveHunt(id);

        assertEq(usdc.balanceOf(mateo), mateoBefore + p);
        assertEq(position.getCDP(id).issuer, mateo);
        (,, bool pending) = manager.huntRequest(id);
        assertFalse(pending);
    }

    function test_instantHuntDuringMaturityReverts() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        vm.startPrank(hunter);
        usdc.approve(address(manager), 70 ether);
        vm.expectRevert(CDPManager.InstantHunt.selector);
        manager.liquidateCDP(id, 70 ether);
        vm.stopPrank();
    }

    function test_requestHuntThenResolve() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        _markAtPar();
        uint256 eveBefore = usdc.balanceOf(mateo);
        uint256 p = 70 ether;

        vm.startPrank(hunter);
        usdc.approve(address(manager), p);
        manager.requestHunt(id, p);
        vm.stopPrank();

        assertEq(position.getCDP(id).issuer, mateo);
        (,, bool pending) = manager.huntRequest(id);
        assertTrue(pending);

        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 3);
        manager.resolveHunt(id);

        ICollateralDebtPosition.CDP memory cdp = position.getCDP(id);
        assertEq(cdp.issuer, hunter);
        assertEq(cdp.collateralAmount, 110 ether + p);
        assertEq(usdc.balanceOf(mateo), eveBefore);
        (,, bool still) = manager.huntRequest(id);
        assertFalse(still);
    }

    function test_novationHandsIssuerSeatToHunter() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        _markAtPar();
        assertEq(manager.healthOf(id), MontaneParams.FROSTBITE);

        uint256 mateoBefore = usdc.balanceOf(mateo);
        uint256 p = 70 ether;
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 3);
        vm.startPrank(hunter);
        usdc.approve(address(manager), p);
        manager.liquidateCDP(id, p);
        vm.stopPrank();

        ICollateralDebtPosition.CDP memory cdp = position.getCDP(id);
        assertEq(cdp.issuer, hunter);
        assertEq(cdp.collateralAmount, 110 ether + p);
        assertEq(token.totalSupply(id), 100e18);
        assertEq(usdc.balanceOf(mateo), mateoBefore);
        assertEq(usdc.balanceOf(treasury), treasuryBefore);
        assertEq(manager.CDPPositionIssuer(id), hunter);
        assertEq(token.balanceOf(mateo, id), 0, "ousted issuer keeps no unsold notes");
        assertEq(token.balanceOf(hunter, id), 100e18, "unsold seed moves to new issuer");
        assertEq(market.seedLongAskId(id), 0);
    }

    function test_novatedCellRepaysToHunter() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        _markAtPar();
        uint256 p = 200 ether;

        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 3);
        vm.startPrank(hunter);
        usdc.approve(address(manager), p);
        manager.liquidateCDP(id, p);
        vm.stopPrank();

        // Never-sold cell: novation starts the maturity clock for the new issuer.
        vm.warp(block.timestamp + 1 days);
        uint256 hunterBefore = usdc.balanceOf(hunter);
        vm.prank(hunter);
        manager.repayCDP(id);
        assertEq(usdc.balanceOf(hunter), hunterBefore + 110 ether + p);
        assertFalse(position.getCDP(id).active);
    }

    function test_pMidMovesOnFillsOnly() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        uint256 before = market.pMid();

        vm.startPrank(hunter);
        usdc.approve(address(market), 10 ether);
        market.placeOrder(id, CreditMarket.Side.ShortAsk, 0.9e18, 10e18);
        vm.stopPrank();
        assertEq(market.pMid(), before, "resting order is not a print");

        vm.startPrank(alice);
        usdc.approve(address(market), 10 ether);
        market.placeOrder(id, CreditMarket.Side.ShortBid, 0.9e18, 10e18);
        vm.stopPrank();
        assertEq(market.lastShortPx(), 0.9e18);
        assertEq(market.pMid(), (MontaneParams.PAR + MontaneParams.SPREAD + 0.9e18) / 2);
        assertFalse(market.frozen());
    }

    function test_longPrintRaisesReturnIntoFomo() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        uint256 askId = market.seedLongAskId(id);
        uint256 fillPay = (100e18 * (MontaneParams.PAR + MontaneParams.SPREAD)) / token.issuanceCost();
        _fill(alice, askId, 100e18, fillPay);
        assertEq(market.p60(), 0.955 ether);

        vm.roll(block.number + 1);
        vm.prank(alice);
        market.placeOrder(id, CreditMarket.Side.LongAsk, 1.2e18, 10e18);
        _fill(hunter, market.orderCount(), 10e18, 13 ether);

        assertEq(market.pMid(), (1.2e18 + 0.905e18) / 2);
        assertGe(market.returnBps(), int256(MontaneParams.FOMO_UP_BPS));
        assertEq(manager.fomoMode(), 1);
    }

    function test_pokeFomoInjectsWhenLongsRally() public {
        test_longPrintRaisesReturnIntoFomo();
        uint256 gBefore = position.getCDP(1).collateralAmount;
        vm.startPrank(alice);
        usdc.approve(address(market), 1 ether);
        market.fundFomo(1 ether);
        market.pokeFomo();
        vm.stopPrank();
        assertGt(position.getCDP(1).collateralAmount, gBefore);
    }

    function test_issuerCannotHuntSelf() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        vm.startPrank(mateo);
        usdc.approve(address(manager), 70 ether);
        vm.expectRevert(CDPManager.HunterSelf.selector);
        manager.requestHunt(id, 70 ether);
        vm.stopPrank();
    }

    function test_verdantCannotBeHunted() public {
        uint256 id = _open(mateo, 100e18, 150.25 ether);
        vm.startPrank(hunter);
        usdc.approve(address(manager), 70 ether);
        vm.expectRevert(CDPManager.NotFrostbite.selector);
        manager.requestHunt(id, 70 ether);
        vm.stopPrank();
    }

    function test_frostbiteCannotRepay() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        _markAtPar();
        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 3);
        vm.prank(mateo);
        vm.expectRevert(CDPManager.NotVerdant.selector);
        manager.repayCDP(id);
    }

    function _open(address who, uint256 debt, uint256 usdcIn) internal returns (uint256 id) {
        vm.startPrank(who);
        usdc.approve(address(manager), usdcIn);
        id = manager.createCDP(debt, usdcIn);
        vm.stopPrank();
    }

    /// @dev Prints long 1.05 / short 0.95 on a side cell so the global mark is exactly PAR (marked H = G/F).
    function _markAtPar() internal {
        uint256 side = _open(elif_, 100e18, 150.25 ether);
        uint256 cost = token.issuanceCost();
        _fill(alice, market.seedLongAskId(side), 100e18, (100e18 * (MontaneParams.PAR + MontaneParams.SPREAD)) / cost);
        vm.prank(alice);
        market.placeOrder(side, CreditMarket.Side.LongAsk, 1.05e18, 10e18);
        _fill(hunter, market.orderCount(), 10e18, (10e18 * 1.05e18) / cost);

        vm.startPrank(hunter);
        usdc.approve(address(market), 1 ether);
        market.placeOrder(side, CreditMarket.Side.ShortAsk, 0.95e18, 10e18);
        vm.stopPrank();
        vm.startPrank(alice);
        usdc.approve(address(market), 10 ether);
        market.placeOrder(side, CreditMarket.Side.ShortBid, 0.95e18, 10e18);
        vm.stopPrank();
        assertEq(market.pMid(), MontaneParams.PAR);
    }

    function _fill(address who, uint256 askId, uint256 amount, uint256 pay) internal {
        vm.startPrank(who);
        usdc.approve(address(market), pay);
        market.fillOrder(askId, amount);
        vm.stopPrank();
    }

    function _setPrices(int64 monUsd, int64 usdcUsd) internal {
        bytes[] memory updateData = new bytes[](2);
        updateData[0] = pyth.createPriceFeedUpdateData(
            MON_USD, monUsd, 1e5, -8, monUsd, 1e5, uint64(block.timestamp)
        );
        updateData[1] = pyth.createPriceFeedUpdateData(
            USDC_USD, usdcUsd, 1e4, -8, usdcUsd, 1e4, uint64(block.timestamp)
        );
        pyth.updatePriceFeeds{value: 2}(updateData);
    }

    function test_placeOrderMatchesRestingAsk() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        uint256 cost = token.issuanceCost();
        uint256 need = (50e18 * 1.01e18) / cost;
        uint256 askPx = MontaneParams.PAR + MontaneParams.SPREAD;
        uint256 pay = (50e18 * askPx) / cost;
        uint256 fee = (pay * MontaneParams.TAKER_BPS) / MontaneParams.BPS;
        uint256 mateoBefore = usdc.balanceOf(mateo);

        vm.startPrank(alice);
        usdc.approve(address(market), need);
        market.placeOrder(id, CreditMarket.Side.LongBid, 1.01e18, 50e18);
        vm.stopPrank();

        assertEq(token.balanceOf(alice, id), 50e18);
        assertEq(usdc.balanceOf(mateo), mateoBefore + pay - fee);
        assertEq(position.getCDP(id).longOwner, alice);
        (,,,, uint256 remaining,,,) = market.orders(market.seedLongAskId(id));
        assertEq(remaining, 50e18);
    }

    function test_redeemMaturedAtPar() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        uint256 askId = market.seedLongAskId(id);
        uint256 pay = (10e18 * (MontaneParams.PAR + MontaneParams.SPREAD)) / token.issuanceCost();
        _fill(alice, askId, 10e18, pay);

        vm.prank(alice);
        vm.expectRevert(CDPManager.NotMature.selector);
        manager.redeemMatured(id, 10e18);

        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 3);

        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        manager.redeemMatured(id, 10e18);

        assertEq(usdc.balanceOf(alice), aliceBefore + 10 ether);
        assertEq(token.balanceOf(alice, id), 0);
        assertEq(position.getCDP(id).collateralAmount, 100 ether);
        assertEq(position.getCDP(id).debtAmount, 90e18);
    }

    function test_waterlineInjectsHighestHFirst() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        _markAtPar();
        assertEq(manager.healthOf(id), MontaneParams.FROSTBITE);

        uint256 budget = 1 ether;
        usdc.mint(address(market), budget);
        uint256 marketBefore = usdc.balanceOf(address(market));
        vm.startPrank(address(market));
        usdc.approve(address(manager), budget);
        uint256 used = manager.injectWaterline(budget);
        vm.stopPrank();

        assertEq(used, 100);
        assertGt(manager.healthOf(id), MontaneParams.FROSTBITE);
        assertEq(position.getCDP(id).collateralAmount, 110 ether + 100);
        assertEq(usdc.balanceOf(address(market)), marketBefore - 100);
    }

    function test_fomoSilentAtGenesis() public {
        _open(mateo, 100e18, 110.25 ether);
        assertEq(manager.fomoMode(), 0);
        vm.expectRevert(CreditMarket.FomoSilent.selector);
        market.pokeFomo();
    }

    function test_deployerWiresImmutables() public view {
        assertEq(protocol.name(), "Montane Swap");
        assertEq(address(manager.debtToken()), address(token));
        assertEq(address(manager.creditMarket()), address(market));
        assertEq(address(position.cdpManager()), address(manager));
        assertEq(address(position.creditMarket()), address(market));
        assertEq(market.cdpManager(), address(manager));
        assertEq(address(token.cdpManager()), address(manager));
        assertEq(token.creditMarket(), address(market));
        assertEq(manager.owner(), address(this));
        assertFalse(manager.paused());
    }

    function test_pauseBlocksMintAndFill_emergencyCloseWorks() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        uint256 askId = market.seedLongAskId(id);

        manager.pause();
        assertTrue(manager.paused());
        assertTrue(market.paused());
        assertTrue(market.tradingHalted());

        vm.prank(alice);
        vm.expectRevert(CDPManager.EnforcedPause.selector);
        manager.createCDP(50e18, 60 ether);

        uint256 pay = (1e18 * (MontaneParams.PAR + MontaneParams.SPREAD)) / MontaneParams.PAR;
        vm.startPrank(alice);
        usdc.approve(address(market), pay);
        vm.expectRevert(CreditMarket.EnforcedPause.selector);
        market.fillOrder(askId, 1e18);
        vm.stopPrank();

        uint256 mateoBefore = usdc.balanceOf(mateo);
        vm.prank(mateo);
        manager.emergencyClose(id);
        assertFalse(position.getCDP(id).active);
        assertGt(usdc.balanceOf(mateo), mateoBefore);

        manager.unpause();
        assertFalse(manager.paused());
        uint256 id2 = _open(alice, 100e18, 110.25 ether);
        assertTrue(position.getCDP(id2).active);
    }

    function test_cancelOrderReturnsAskTokens() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        uint256 askId = market.seedLongAskId(id);

        manager.pause();
        uint256 before = token.balanceOf(mateo, id);
        vm.prank(mateo);
        market.cancelOrder(askId);
        assertEq(token.balanceOf(mateo, id), before + 100e18);
        (,,,,, bool live,,) = market.orders(askId);
        assertFalse(live);
    }

    function test_emergencyCloseRevertsWhenNotPaused() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        vm.prank(mateo);
        vm.expectRevert(CDPManager.ExpectedPause.selector);
        manager.emergencyClose(id);
    }
}
