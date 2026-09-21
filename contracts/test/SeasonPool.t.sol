// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {MockPyth} from "@pythnetwork/pyth-sdk-solidity/MockPyth.sol";
import {MontaneSwap} from "../src/MontaneSwap.sol";
import {Treasury} from "../src/Treasury.sol";
import {CDPManager} from "../src/CDPManager.sol";
import {CollateralDebtPosition} from "../src/CollateralDebtPosition.sol";
import {SeasonPool} from "../src/SeasonPool.sol";
import {MontaneParams} from "../src/helpers/MontaneParams.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract SeasonPoolTest is Test {
    MockPyth pyth;
    MockUSDC usdc;
    MontaneSwap protocol;
    CDPManager manager;
    CollateralDebtPosition position;
    Treasury treasuryContract;
    SeasonPool season;

    address mateo = address(0xA11CE);
    address alice = address(0xB0B);
    address bob = address(0xB0B2);

    bytes32 constant MON_USD = 0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1;
    bytes32 constant USDC_USD = 0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a;

    function setUp() public {
        pyth = new MockPyth(60, 1);
        usdc = new MockUSDC();
        _setPrices(1e8, 1e8);

        treasuryContract = new Treasury(address(this));
        protocol = new MontaneSwap(address(treasuryContract), address(usdc), address(pyth), address(this));
        manager = protocol.manager();
        position = protocol.position();
        season = new SeasonPool(address(usdc), address(position), address(treasuryContract), address(manager));
        manager.setSeasonPool(address(season));

        usdc.mint(mateo, 10_000 ether);
        usdc.mint(alice, 10_000 ether);
        usdc.mint(bob, 10_000 ether);
    }

    function test_autoOpen_onMint_maturityMatchesOpenedAt() public {
        uint256 t0 = block.timestamp;
        uint256 cdpId = _openVerdant(mateo, 100e18);
        uint256 mid = season.marketOfCdp(cdpId);
        assertEq(mid, 1);
        (,,, uint256 mat,,,,,,) = season.markets(mid);
        assertEq(mat, t0 + MontaneParams.MATURITY);
        assertEq(season.maturityOf(mid), t0 + MontaneParams.MATURITY);

        // Manual open already exists
        vm.expectRevert(SeasonPool.Exists.selector);
        season.openMarket(cdpId);
    }

    function test_resolve_sweepWhenNoWinners() public {
        uint256 cdpId = _openVerdant(mateo, 100e18);
        uint256 mid = season.marketOfCdp(cdpId);

        // Only frostbite minted; Verdant wins → winSupply 0
        vm.startPrank(alice);
        usdc.approve(address(season), 10 ether);
        season.mintDirectional(mid, false, 10 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + MontaneParams.MATURITY + 1);
        uint256 treBefore = usdc.balanceOf(address(treasuryContract));
        season.resolve(mid);
        // 10% treasury + 10% issuer + 80% dust sweep to treasury = 10% + 80% = 9 to treasury, 1 to issuer
        assertEq(usdc.balanceOf(address(treasuryContract)) - treBefore, 9 ether);
        assertEq(usdc.balanceOf(address(season)), 0);
    }

    function test_repaySettlesSeason() public {
        uint256 cdpId = _openVerdant(mateo, 100e18);
        uint256 mid = season.marketOfCdp(cdpId);
        vm.warp(block.timestamp + MontaneParams.MATURITY + 1);
        vm.roll(block.number + 10);
        vm.prank(mateo);
        manager.repayCDP(cdpId);
        (,,,,,,,, bool resolved,) = season.markets(mid);
        assertTrue(resolved);
        assertFalse(position.getCDP(cdpId).active);
    }

    function test_flexiblePack_10_each() public {
        uint256 cdpId = _openVerdant(mateo, 100e18);
        uint256 mid = season.marketOfCdp(cdpId);

        vm.startPrank(alice);
        usdc.approve(address(season), 20 ether);
        season.mintPack(mid, 10 ether); // 10V + 10F for 20 USDC
        vm.stopPrank();

        assertEq(season.verdantOf(mid, alice), 10 ether);
        assertEq(season.frostbiteOf(mid, alice), 10 ether);
    }

    function test_directionalOnly_within12h() public {
        uint256 cdpId = _openVerdant(mateo, 100e18);
        uint256 mid = season.marketOfCdp(cdpId);

        vm.startPrank(alice);
        usdc.approve(address(season), 7 ether);
        season.mintDirectional(mid, true, 7 ether);
        vm.stopPrank();
        assertEq(season.verdantOf(mid, alice), 7 ether);
        assertEq(season.frostbiteOf(mid, alice), 0);

        vm.warp(block.timestamp + 12 hours + 1);
        vm.startPrank(bob);
        usdc.approve(address(season), 1 ether);
        vm.expectRevert(SeasonPool.WindowClosed.selector);
        season.mintDirectional(mid, false, 1 ether);
        // pack still ok until maturity
        usdc.approve(address(season), 4 ether);
        season.mintPack(mid, 2 ether);
        vm.stopPrank();
        assertEq(season.frostbiteOf(mid, bob), 2 ether);
    }

    function test_packResolveVerdant_10_10_80() public {
        uint256 cdpId = _openVerdant(mateo, 100e18);
        uint256 mid = season.marketOfCdp(cdpId);

        vm.startPrank(alice);
        usdc.approve(address(season), 30 ether);
        season.mintPack(mid, 15 ether);
        vm.stopPrank();

        vm.startPrank(bob);
        usdc.approve(address(season), 30 ether);
        season.mintPack(mid, 15 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + MontaneParams.MATURITY + 1);
        uint256 treBefore = usdc.balanceOf(address(treasuryContract));
        uint256 mateoBefore = usdc.balanceOf(mateo);

        season.resolve(mid);

        assertEq(usdc.balanceOf(address(treasuryContract)) - treBefore, 3 ether);
        assertEq(usdc.balanceOf(mateo) - mateoBefore, 3 ether);

        vm.prank(alice);
        assertEq(season.claim(mid), 27 ether);
        vm.prank(bob);
        assertEq(season.claim(mid), 27 ether);
    }

    function test_frostbiteWins_directionalSkew() public {
        uint256 cdpId = _openFrostbite(mateo, 100e18);
        uint256 mid = season.marketOfCdp(cdpId);

        vm.startPrank(alice);
        usdc.approve(address(season), 20 ether);
        season.mintDirectional(mid, false, 20 ether); // only F
        vm.stopPrank();

        vm.startPrank(bob);
        usdc.approve(address(season), 10 ether);
        season.mintDirectional(mid, true, 10 ether); // only V
        vm.stopPrank();

        vm.warp(block.timestamp + MontaneParams.MATURITY + 1);
        season.resolve(mid);

        // F wins: alice 20 principal + 80% of 10 V = 8 → 28
        vm.prank(alice);
        assertEq(season.claim(mid), 28 ether);
        vm.prank(bob);
        vm.expectRevert(SeasonPool.Nothing.selector);
        season.claim(mid);
    }

    function test_dustSlice_staysWithWinners() public {
        uint256 cdpId = _openVerdant(mateo, 100e18);
        uint256 mid = season.marketOfCdp(cdpId);

        // loser pot = 5 wei → floor(5*1000/10000)=0; full 5 stays for winners
        vm.startPrank(alice);
        usdc.approve(address(season), 5);
        season.mintDirectional(mid, false, 5);
        usdc.approve(address(season), 100 ether);
        season.mintDirectional(mid, true, 100 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + MontaneParams.MATURITY + 1);
        uint256 treBefore = usdc.balanceOf(address(treasuryContract));
        season.resolve(mid);
        assertEq(usdc.balanceOf(address(treasuryContract)), treBefore); // no transfer

        vm.prank(alice);
        assertEq(season.claim(mid), 100 ether + 5); // principal + full dust pot
    }

    /// @dev Σ claims ≤ vault after fees; each claim == preview; pro-rata invariant.
    function testFuzz_claimProRata(uint96 aRaw, uint96 bRaw) public {
        uint256 aAmt = bound(uint256(aRaw), 1e15, 50 ether);
        uint256 bAmt = bound(uint256(bRaw), 1e15, 50 ether);

        address carol = address(0xCAFE);
        usdc.mint(carol, 200 ether);

        uint256 cdpId = _openVerdant(mateo, 100e18);
        uint256 mid = season.marketOfCdp(cdpId);

        vm.startPrank(alice);
        usdc.approve(address(season), aAmt * 2);
        season.mintPack(mid, aAmt);
        vm.stopPrank();

        vm.startPrank(bob);
        usdc.approve(address(season), bAmt * 2);
        season.mintPack(mid, bAmt);
        vm.stopPrank();

        // skew with directional so winner supply ≠ loser
        vm.startPrank(carol);
        usdc.approve(address(season), 5 ether);
        season.mintDirectional(mid, true, 5 ether);
        vm.stopPrank();

        vm.warp(block.timestamp + MontaneParams.MATURITY + 1);
        season.resolve(mid);

        uint256 vaultBefore = usdc.balanceOf(address(season));
        uint256 pA = season.previewClaim(mid, alice);
        uint256 pB = season.previewClaim(mid, bob);
        uint256 pC = season.previewClaim(mid, carol);

        vm.prank(alice);
        uint256 cA = season.claim(mid);
        vm.prank(bob);
        uint256 cB = season.claim(mid);
        vm.prank(carol);
        uint256 cC = season.claim(mid);

        assertEq(cA, pA);
        assertEq(cB, pB);
        assertEq(cC, pC);
        // Successive floor divisions may leave ≤2 wei in the vault.
        assertApproxEqAbs(cA + cB + cC, vaultBefore, 2);
        assertLe(usdc.balanceOf(address(season)), 2);
    }

    function _openVerdant(address who, uint256 debt) internal returns (uint256 id) {
        uint256 fee = (debt * 25) / 10_000;
        uint256 g = (debt * 12) / 10;
        uint256 usdcIn = g + fee;
        vm.startPrank(who);
        usdc.approve(address(manager), usdcIn);
        id = manager.createCDP(debt, usdcIn);
        vm.stopPrank();
    }

    function _openFrostbite(address who, uint256 debt) internal returns (uint256 id) {
        uint256 fee = (debt * 25) / 10_000;
        uint256 g = (debt * 11) / 10; // H = 1.10 → Frostbite on resolve
        uint256 usdcIn = g + fee;
        vm.startPrank(who);
        usdc.approve(address(manager), usdcIn);
        id = manager.createCDP(debt, usdcIn);
        vm.stopPrank();
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
