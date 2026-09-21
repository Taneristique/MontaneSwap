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
        assertEq(token.balanceOf(address(market)), debt);
        assertEq(token.issuedDebt(mateo), debt);
        assertEq(token.underlyingCollateral(mateo), 110 ether);
        assertEq(usdc.balanceOf(treasury), fee);

        uint256 askId = market.seedLongAskId(id);
        (address maker,, CreditMarket.Side side, uint256 price, uint256 remaining, bool live,,) = market.orders(askId);
        assertEq(maker, mateo);
        assertEq(uint256(side), uint256(CreditMarket.Side.LongAsk));
        assertEq(price, MontaneParams.PAR + MontaneParams.SPREAD);
        assertEq(remaining, debt);
        assertTrue(live);
        assertEq(market.pMid(), MontaneParams.PAR);
        assertEq(market.pPyth(), 1e18);
        assertFalse(market.frozen());

        CreditMarket.LiveOrder[] memory book = market.liveBook();
        assertEq(book.length, 2);
        assertEq(book[0].maker, mateo);
        assertEq(book[0].landedAt, block.timestamp);
        assertEq(uint256(book[0].side), uint256(CreditMarket.Side.LongAsk));
        assertEq(uint256(book[1].side), uint256(CreditMarket.Side.ShortAsk));
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

        assertEq(token.balanceOf(alice), fillAmt);
        assertEq(token.balanceOf(address(market)), debt - fillAmt);
        assertEq(usdc.balanceOf(mateo), mateoBefore + pay - fee);
        assertEq(position.getCDP(id).longOwner, alice);
        assertEq(position.getCDP(id).firstSaleAt, block.timestamp);
        assertEq(manager.CDPPositionIssuer(id), mateo);
        assertEq(token.issuedDebt(mateo), debt);
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
        uint256 g = token.underlyingCollateral(mateo);
        assertEq(manager.healthOf(id), 1.5e18);

        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 3);

        uint256 before = usdc.balanceOf(mateo);
        vm.prank(mateo);
        manager.repayCDP(id);

        assertEq(token.issuedDebt(mateo), 0);
        assertEq(token.balanceOf(mateo), 0);
        assertEq(token.balanceOf(address(market)), 0);
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

    function test_repaySettlesLongOffBook() public {
        uint256 id = _open(mateo, 100e18, 150.25 ether);
        uint256 askId = market.seedLongAskId(id);
        uint256 fillAmt = 40e18;
        uint256 pay = (fillAmt * (MontaneParams.PAR + MontaneParams.SPREAD)) / token.issuanceCost();
        _fill(alice, askId, fillAmt, pay);

        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 3);

        uint256 aliceTok = token.balanceOf(alice);
        uint256 aliceUsdc = usdc.balanceOf(alice);
        uint256 mid = market.pMid();
        uint256 cap = (100e18 * mid) / MontaneParams.WAD;
        if (cap > 150 ether) cap = 150 ether;
        uint256 due = (cap * aliceTok) / 100e18;

        vm.prank(mateo);
        manager.repayCDP(id);

        assertEq(token.balanceOf(alice), 0);
        assertEq(usdc.balanceOf(alice), aliceUsdc + due);
        assertFalse(position.getCDP(id).active);
        assertEq(token.issuedDebt(mateo), 0);
    }

    function test_huntBondSlashedIfVerdant() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
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
        assertEq(position.getCDP(id).longOwner, mateo);
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
        uint256 eveBefore = usdc.balanceOf(mateo);
        uint256 p = 70 ether;

        vm.startPrank(hunter);
        usdc.approve(address(manager), p);
        manager.requestHunt(id, p);
        vm.stopPrank();

        assertEq(position.getCDP(id).longOwner, mateo);
        (,, bool pending) = manager.huntRequest(id);
        assertTrue(pending);

        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 3);
        manager.resolveHunt(id);

        ICollateralDebtPosition.CDP memory cdp = position.getCDP(id);
        assertEq(cdp.issuer, mateo);
        assertEq(cdp.longOwner, hunter);
        assertEq(cdp.collateralAmount, 110 ether);
        assertEq(usdc.balanceOf(mateo), eveBefore + p);
        (,, bool still) = manager.huntRequest(id);
        assertFalse(still);
    }

    function test_novationKeepsIssuerMovesLongOwner() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        assertEq(manager.healthOf(id), MontaneParams.FROSTBITE);

        uint256 eveBefore = usdc.balanceOf(mateo);
        uint256 p = 70 ether;
        uint256 treasuryBefore = usdc.balanceOf(treasury);

        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 3);
        vm.startPrank(hunter);
        usdc.approve(address(manager), p);
        manager.liquidateCDP(id, p);
        vm.stopPrank();

        ICollateralDebtPosition.CDP memory cdp = position.getCDP(id);
        assertEq(cdp.issuer, mateo);
        assertEq(cdp.longOwner, hunter);
        assertEq(cdp.collateralAmount, 110 ether);
        assertEq(token.issuedDebt(mateo), 100e18);
        assertEq(usdc.balanceOf(mateo), eveBefore + p);
        assertEq(usdc.balanceOf(treasury), treasuryBefore);
    }

    function test_novationRecapWhenGLessThanP() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        uint256 eveBefore = usdc.balanceOf(mateo);
        uint256 p = 200 ether;

        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 3);
        vm.startPrank(hunter);
        usdc.approve(address(manager), p);
        manager.liquidateCDP(id, p);
        vm.stopPrank();

        ICollateralDebtPosition.CDP memory cdp = position.getCDP(id);
        assertEq(cdp.collateralAmount, p);
        assertEq(usdc.balanceOf(mateo), eveBefore + 110 ether);
        assertEq(token.underlyingCollateral(mateo), p);
    }

    function test_pMidUsesBothBidsOnly() public {
        _open(mateo, 100e18, 110.25 ether);
        assertEq(market.pMid(), MontaneParams.PAR);

        uint256 cost = token.issuanceCost();
        uint256 longNeed = (10e18 * 1.004e18) / cost;
        uint256 shortNeed = (10e18 * 0.996e18) / cost;

        vm.startPrank(alice);
        usdc.approve(address(market), longNeed);
        market.placeOrder(1, CreditMarket.Side.LongBid, 1.004e18, 10e18);
        vm.stopPrank();
        assertEq(market.pMid(), MontaneParams.PAR);

        vm.startPrank(hunter);
        usdc.approve(address(market), shortNeed);
        market.placeOrder(1, CreditMarket.Side.ShortBid, 0.996e18, 10e18);
        vm.stopPrank();
        assertEq(market.pMid(), 1e18);
    }

    function test_circuitComparesToPythAndSealsPyth() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        uint256 askId = market.seedLongAskId(id);
        uint256 fillPay = (100e18 * (MontaneParams.PAR + MontaneParams.SPREAD)) / token.issuanceCost();
        _fill(alice, askId, 100e18, fillPay);
        uint256 shortId = market.seedShortAskId(id);
        uint256 shortPay = (100e18 * (MontaneParams.PAR - MontaneParams.SPREAD)) / token.issuanceCost();
        vm.startPrank(elif_);
        usdc.approve(address(market), shortPay);
        market.fillOrder(shortId, 100e18);
        vm.stopPrank();

        _setPrices(1e8, 1e8);

        uint256 cost = token.issuanceCost();
        uint256 longNeed = (10e18 * 1.03e18) / cost;
        uint256 shortNeed = (10e18 * 1.02e18) / cost;

        vm.startPrank(elif_);
        usdc.approve(address(market), longNeed);
        market.placeOrder(1, CreditMarket.Side.LongBid, 1.03e18, 10e18);
        vm.stopPrank();

        vm.roll(block.number + 1);
        vm.startPrank(hunter);
        usdc.approve(address(market), shortNeed);
        market.placeOrder(1, CreditMarket.Side.ShortBid, 1.02e18, 10e18);
        vm.stopPrank();

        assertEq(market.pMid(), 1.025e18);
        assertTrue(market.frozen());
        assertTrue(market.circuitTripped());
        assertEq(market.sealedPMid(), market.pPyth());
        assertGe(market.returnBps(), int256(MontaneParams.FOMO_UP_BPS));
        assertEq(manager.fomoMode(), 1);
    }

    function test_pokeFomoInjectsWhenCircuitStretches() public {
        test_circuitComparesToPythAndSealsPyth();
        uint256 gBefore = token.underlyingCollateral(mateo);
        vm.startPrank(alice);
        token.approve(address(market), 10e18);
        usdc.approve(address(market), 1 ether);
        market.fundFomo(1 ether, 10e18);
        market.pokeFomo();
        vm.stopPrank();
        assertGt(token.underlyingCollateral(mateo), gBefore);
        assertTrue(market.fomoAskId() != 0);
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

        assertEq(token.balanceOf(alice), 50e18);
        assertEq(usdc.balanceOf(mateo), mateoBefore + pay - fee);
        assertEq(position.getCDP(id).longOwner, alice);
        (,,,, uint256 remaining,,,) = market.orders(market.seedLongAskId(id));
        assertEq(remaining, 50e18);
    }

    function test_shortFillDoesNotMoveCellOrMint() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        uint256 shortId = market.seedShortAskId(id);
        uint256 px = MontaneParams.PAR - MontaneParams.SPREAD;
        uint256 amount = 40e18;
        uint256 pay = (amount * px) / token.issuanceCost();
        uint256 g = token.underlyingCollateral(mateo);

        vm.startPrank(elif_);
        usdc.approve(address(market), pay);
        market.fillOrder(shortId, amount);
        vm.stopPrank();

        assertEq(token.balanceOf(elif_), 0);
        assertEq(market.shortSize(elif_, id), amount);
        assertEq(token.underlyingCollateral(mateo), g);
        assertEq(position.getCDP(id).issuer, mateo);
        assertEq(position.getCDP(id).longOwner, mateo);
        assertEq(token.issuedDebt(mateo), 100e18);
    }

    function test_coverShortReturnsEscrow() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        uint256 shortId = market.seedShortAskId(id);
        uint256 px = MontaneParams.PAR - MontaneParams.SPREAD;
        uint256 amount = 10e18;
        uint256 pay = (amount * px) / token.issuanceCost();
        uint256 fee = (pay * MontaneParams.TAKER_BPS) / MontaneParams.BPS;

        vm.startPrank(elif_);
        usdc.approve(address(market), pay);
        market.fillOrder(shortId, amount);
        vm.stopPrank();

        uint256 askId = market.seedLongAskId(id);
        uint256 longPay = (amount * (MontaneParams.PAR + MontaneParams.SPREAD)) / token.issuanceCost();
        _fill(alice, askId, amount, longPay);

        vm.startPrank(alice);
        token.transfer(elif_, amount);
        vm.stopPrank();

        uint256 before = usdc.balanceOf(elif_);
        vm.startPrank(elif_);
        token.approve(address(market), amount);
        market.coverShort(id, amount);
        vm.stopPrank();

        assertEq(market.shortSize(elif_, id), 0);
        assertEq(usdc.balanceOf(elif_), before + pay - fee);
    }

    function test_withdrawCapAfterFirstSale() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        uint256 askId = market.seedLongAskId(id);
        uint256 pay = (1e18 * (MontaneParams.PAR + MontaneParams.SPREAD)) / token.issuanceCost();
        _fill(alice, askId, 1e18, pay);

        vm.prank(alice);
        vm.expectRevert(CDPManager.NotMature.selector);
        manager.withdraw(id, 1 ether);

        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 3);

        uint256 cap = 100 ether;
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        manager.withdraw(id, cap);

        assertEq(usdc.balanceOf(alice), aliceBefore + cap);
        assertEq(position.getCDP(id).collateralAmount, 10 ether);
        vm.prank(alice);
        vm.expectRevert(CDPManager.Cap.selector);
        manager.withdraw(id, 11 ether);
    }

    function test_waterlineInjectsHighestHFirst() public {
        uint256 id = _open(mateo, 100e18, 110.25 ether);
        uint256 askId = market.seedLongAskId(id);
        uint256 pay = (1e18 * (MontaneParams.PAR + MontaneParams.SPREAD)) / token.issuanceCost();
        _fill(alice, askId, 1e18, pay);

        vm.warp(block.timestamp + 1 days);
        vm.roll(block.number + 3);
        vm.prank(alice);
        manager.withdraw(id, 8 ether);
        assertEq(manager.healthOf(id), 1.02e18);

        uint256 budget = 8 ether + 100;
        usdc.mint(address(market), budget);
        vm.startPrank(address(market));
        usdc.approve(address(manager), budget);
        uint256 used = manager.injectWaterline(budget);
        vm.stopPrank();

        assertEq(used, budget);
        assertGt(manager.healthOf(id), MontaneParams.FROSTBITE);
        assertEq(position.getCDP(id).collateralAmount, 110 ether + 100);
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
        uint256 before = token.balanceOf(mateo);
        vm.prank(mateo);
        market.cancelOrder(askId);
        assertEq(token.balanceOf(mateo), before + 100e18);
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
