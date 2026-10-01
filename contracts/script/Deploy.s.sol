// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {MontaneSwap} from "../src/MontaneSwap.sol";
import {Treasury} from "../src/Treasury.sol";
import {CDPManager} from "../src/CDPManager.sol";
import {SeasonPool} from "../src/SeasonPool.sol";
import {MockUSDC} from "../test/MockUSDC.sol";

/// @dev Full Monad testnet stack in one broadcast: Treasury, MontaneSwap (manager, cell, market, mMonad),
///      SeasonPool wired into CDPManager. Reuses the existing MockUSDC so balances survive redeploys.
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url https://testnet-rpc.monad.xyz \
///     --account teamKey \
///     --broadcast -vvvv
/// @dev Env (all optional): USDC=<addr> to reuse a different token, FRESH_USDC=true to deploy a new MockUSDC,
///      TREASURY_OWNER / GUARDIAN role overrides. GUARDIAN must be the deployer for the Season wiring.
/// @dev Do NOT use msg.sender for roles before/without broadcast — it becomes Foundry DefaultSender.
contract Deploy is Script {
    address constant PYTH = 0x2880aB155794e7179c9eE2e38200202908C17B43;
    /// @dev MockUSDC with open mint, shared by every testnet redeploy since 2026-09-21.
    address constant DEFAULT_USDC = 0xb5fd0160056cEBFe59B86FB95A4a6c48ad7E642f;

    function run() external {
        // The --account signer is only visible once broadcasting; tx.origin is --account.
        vm.startBroadcast();
        (, address msgSender, address txOrigin) = vm.readCallers();
        address deployer = txOrigin != address(0) ? txOrigin : msgSender;
        require(deployer != address(0), "deployer");
        // Reject Foundry DefaultSender so guardian/treasury are not owned by 0x1804... again.
        require(
            deployer != 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38,
            "use --account teamKey (not DefaultSender)"
        );
        address treasuryOwner = _optionalAddr("TREASURY_OWNER", deployer);
        // Alias: some .env files use TREASURY= for the owner EOA/multisig (not the Treasury contract).
        if (treasuryOwner == deployer) {
            address aliasOwner = _optionalAddr("TREASURY", deployer);
            if (aliasOwner != deployer) treasuryOwner = aliasOwner;
        }
        address guardian = _optionalAddr("GUARDIAN", deployer);
        require(guardian == deployer, "GUARDIAN must be deployer to wire SeasonPool");

        bool fresh = vm.envOr("FRESH_USDC", false);
        address usdcAddr = fresh ? address(0) : _optionalAddr("USDC", DEFAULT_USDC);
        if (!fresh) require(usdcAddr.code.length > 0, "USDC has no code on this chain; set FRESH_USDC=true");

        Treasury treasury = new Treasury(treasuryOwner);
        if (fresh) {
            MockUSDC mock = new MockUSDC();
            mock.mint(deployer, 1_000_000 ether);
            usdcAddr = address(mock);
        }
        MontaneSwap swap = new MontaneSwap(address(treasury), usdcAddr, PYTH, guardian);
        CDPManager manager = swap.manager();
        SeasonPool season =
            new SeasonPool(usdcAddr, address(swap.position()), address(treasury), address(manager));
        manager.setSeasonPool(address(season));

        vm.stopBroadcast();

        require(manager.owner() == guardian, "guardian mismatch");
        require(treasury.owner() == treasuryOwner, "treasury owner mismatch");
        require(address(manager.usdc()) == usdcAddr, "usdc wire");
        require(address(manager.seasonPool()) == address(season), "season wire");

        console2.log("======== Montane Swap deploy ========");
        console2.log("chainId", block.chainid);
        console2.log("DEPLOYER", deployer);
        console2.log("SWAP", address(swap));
        console2.log("SEASON", address(season));
        console2.log("USDC", usdcAddr, fresh ? "(new)" : "(reused)");
        console2.log("MANAGER", address(manager));
        console2.log("MARKET", address(swap.market()));
        console2.log("CDP", address(swap.position()));
        console2.log("TOKEN", address(swap.token()));
        console2.log("TREASURY", address(treasury));
        console2.log("TREASURY_OWNER", treasuryOwner);
        console2.log("GUARDIAN", guardian);
        console2.log("--- frontend ---");
        console2.log("NEXT_PUBLIC_SWAP", address(swap));
        console2.log("NEXT_PUBLIC_SEASON_POOL", address(season));
        console2.log("=====================================");
    }

    function _optionalAddr(string memory key, address fallbackAddr) internal view returns (address) {
        try vm.envAddress(key) returns (address a) {
            return a == address(0) ? fallbackAddr : a;
        } catch {
            return fallbackAddr;
        }
    }
}
