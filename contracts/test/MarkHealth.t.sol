// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {MontaneSwap} from "../src/MontaneSwap.sol";
import {Treasury} from "../src/Treasury.sol";
import {CDPManager} from "../src/CDPManager.sol";
import {CreditMarket} from "../src/CreditMarket.sol";
import {CollateralDebtPosition} from "../src/CollateralDebtPosition.sol";
import {SeasonPool} from "../src/SeasonPool.sol";
import {MontaneParams} from "../src/helpers/MontaneParams.sol";
import {MockUSDC} from "./MockUSDC.sol";

/// H = G / (F × pMid), pMid = (last long fill + last short fill) / 2, long ≥ short + 0.10.
contract MarkHealthTest is Test {
    MockPyth pyth;
    MockUSDC usdc;
    MontaneSwap protocol;
    CDPManager manager;
    CreditMarket market;
    CollateralDebtPosition position;
    SeasonPool season;

    address mateo = address(0xA11CE);
    address alice = address(0xB0B);
    address bob = address(0xB0B2);
    address carol = address(0xCA201);
    address dave = address(0xDA5E);
    address hunter = address(0x4B7);

    uint256 constant SEED_ASK = MontaneParams.PAR + MontaneParams.SPREAD;
    uint256 constant GAP = MontaneParams.LONG_SHORT_GAP;

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
        season = new SeasonPool(address(usdc), address(position), address(treasury), address(manager));
        manager.setSeasonPool(address(season));
        address[6] memory users = [mateo, alice, bob, carol, dave, hunter];
        for (uint256 i = 0; i < users.length; i++) {
            usdc.mint(users[i], 10_000 ether);
            vm.startPrank(users[i]);
            usdc.approve(address(market), type(uint256).max);
            usdc.approve(address(manager), type(uint256).max);
            vm.stopPrank();
        }
    }

    function test_initialMark_isMidOfSeedAndGap() public {
        uint256 id = _mint(140);
        assertEq(market.lastLongPx(), SEED_ASK);
        assertEq(market.lastShortPx(), SEED_ASK - GAP);
        uint256 p = (SEED_ASK + SEED_ASK - GAP) / 2;
        assertEq(market.pMid(), p);
        assertEq(position.health(id), (1.4 ether * 1 ether) / p);
    }

    function test_longBuysRaiseMark_healthFallsIntoFrostbite() public {
        uint256 id = _mint(114);
        assertGt(position.health(id), MontaneParams.FROSTBITE, "starts Verdant at the mark");

        _pumpLong(id, 1.2 ether);
        assertEq(market.lastLongPx(), 1.2 ether);
        assertEq(market.pMid(), (1.2 ether + SEED_ASK - GAP) / 2);
        assertLe(position.health(id), MontaneParams.FROSTBITE, "notes worth more USDC, same collateral");

        vm.prank(hunter);
        manager.requestHunt(id, 10 ether);
        (,, bool pending) = manager.huntRequest(id);
        assertTrue(pending);
    }

    function test_frostbiteAtMark_blocksRepay() public {
        uint256 id = _mint(114);
        _pumpLong(id, 1.2 ether);
        vm.warp(block.timestamp + MontaneParams.MATURITY);
        vm.roll(block.number + MontaneParams.MIN_BLOCKS);
        vm.prank(mateo);
        vm.expectRevert(CDPManager.NotVerdant.selector);
        manager.repayCDP(id);
    }

    function test_shortTradesLowerMark_healthRecovers() public {
        uint256 id = _mint(114);
        _pumpLong(id, 1.2 ether);
        assertLe(position.health(id), MontaneParams.FROSTBITE);

        vm.prank(carol);
        market.placeOrder(id, CreditMarket.Side.ShortAsk, 0.5 ether, 10 ether);
        vm.prank(dave);
        market.placeOrder(id, CreditMarket.Side.ShortBid, 0.5 ether, 10 ether);

        assertEq(market.lastShortPx(), 0.5 ether);
        assertEq(market.pMid(), 0.85 ether);
        assertGt(position.health(id), MontaneParams.FROSTBITE, "notes worth less USDC, H back above 1.10");
    }

    function test_spread_rejectsLongBelowShortPlusGap_andShortAboveLongMinusGap() public {
        uint256 id = _mint(140);
        _buy(alice, id, SEED_ASK, 20 ether);

        vm.prank(alice);
        vm.expectRevert(CreditMarket.SpreadTooTight.selector);
        market.placeOrder(id, CreditMarket.Side.LongAsk, 1 ether, 5 ether);

        vm.prank(bob);
        vm.expectRevert(CreditMarket.SpreadTooTight.selector);
        market.placeOrder(id, CreditMarket.Side.ShortAsk, SEED_ASK - GAP + 1, 5 ether);

        vm.prank(bob);
        market.placeOrder(id, CreditMarket.Side.ShortAsk, SEED_ASK - GAP, 5 ether);
    }

    function test_restingOrderOutsideSpread_isNotFillable() public {
        uint256 id = _mint(140);
        _buy(alice, id, SEED_ASK, 100 ether);
        vm.startPrank(alice);
        market.placeOrder(id, CreditMarket.Side.LongAsk, 1.01 ether, 10 ether);
        uint256 cheapAsk = market.orderCount();
        market.placeOrder(id, CreditMarket.Side.LongAsk, 1.2 ether, 10 ether);
        uint256 highAsk = market.orderCount();
        vm.stopPrank();
        vm.prank(bob);
        market.fillOrder(highAsk, 10 ether);
        assertEq(market.lastLongPx(), 1.2 ether);

        vm.prank(carol);
        market.placeOrder(id, CreditMarket.Side.ShortAsk, 0.95 ether, 5 ether);
        vm.prank(dave);
        market.placeOrder(id, CreditMarket.Side.ShortBid, 0.95 ether, 5 ether);
        assertEq(market.lastShortPx(), 0.95 ether);

        vm.prank(bob);
        vm.expectRevert(CreditMarket.SpreadTooTight.selector);
        market.fillOrder(cheapAsk, 1 ether);
    }

    function test_season_frostbiteWinsAfterLongPump() public {
        uint256 id = _mint(114);
        uint256 mid = season.marketOfCdp(id);
        _pumpLong(id, 1.2 ether);

        vm.warp(block.timestamp + MontaneParams.MATURITY + 1);
        season.resolve(mid);
        assertFalse(_verdantWins(mid));
        assertEq(season.settleMark(mid), market.pMid());
        assertLe(season.settleHealth(mid), MontaneParams.FROSTBITE);
    }

    function test_season_verdantWhenMarkHolds() public {
        uint256 id = _mint(140);
        uint256 mid = season.marketOfCdp(id);
        _buy(alice, id, SEED_ASK, 20 ether);

        vm.warp(block.timestamp + MontaneParams.MATURITY + 1);
        season.resolve(mid);
        assertTrue(_verdantWins(mid));
    }

    /// @dev Alice clears the seed ask, lists some at `px`, Bob lifts them: the last long print becomes `px`.
    function _pumpLong(uint256 id, uint256 px) internal {
        _buy(alice, id, SEED_ASK, 100 ether);
        vm.prank(alice);
        market.placeOrder(id, CreditMarket.Side.LongAsk, px, 10 ether);
        _buy(bob, id, px, 10 ether);
    }

    function _mint(uint256 hundredthsH) internal returns (uint256 id) {
        uint256 debt = 100 ether;
        uint256 usdcIn = (debt * hundredthsH) / 100 + (debt * MontaneParams.ORIGINATION_BPS) / MontaneParams.BPS;
        vm.prank(mateo);
        id = manager.createCDP(debt, usdcIn);
    }

    function _buy(address who, uint256 id, uint256 px, uint256 amount) internal {
        vm.prank(who);
        market.placeOrder(id, CreditMarket.Side.LongBid, px, amount);
    }

    function _verdantWins(uint256 mid) internal view returns (bool w) {
        (,,,,,,,,, w) = season.markets(mid);
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
