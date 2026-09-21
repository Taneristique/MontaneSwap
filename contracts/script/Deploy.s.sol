// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {MontaneSwap} from "../src/MontaneSwap.sol";
import {Treasury} from "../src/Treasury.sol";
import {CDPManager} from "../src/CDPManager.sol";
import {MockUSDC} from "../test/MockUSDC.sol";

/// @dev Monad testnet deploy via keystore:
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url https://testnet-rpc.monad.xyz \
///     --account teamKey \
///     --broadcast -vvvv
/// @dev Do NOT use msg.sender for roles before/without broadcast — it becomes Foundry DefaultSender.
/// @dev Frontend: NEXT_PUBLIC_SWAP=<SWAP>
contract Deploy is Script {
    address constant PYTH = 0x2880aB155794e7179c9eE2e38200202908C17B43;

    function run() external {
        vm.startBroadcast();

        // During broadcast, script msg.sender can still be DefaultSender; tx.origin is --account.
        (, address msgSender, address txOrigin) = vm.readCallers();
        address deployer = txOrigin != address(0) ? txOrigin : msgSender;
        require(deployer != address(0), "deployer");
        // Reject Foundry DefaultSender so guardian/treasury are not owned by 0x1804... again.
        require(
            deployer != 0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38,
            "use --account teamKey (not DefaultSender)"
        );
        console2.log("broadcast msgSender", msgSender);
        console2.log("broadcast txOrigin", txOrigin);
        address treasuryOwner = _optionalAddr("TREASURY_OWNER", deployer);
        // Alias: some .env files use TREASURY= for the owner EOA/multisig (not the Treasury contract).
        if (treasuryOwner == deployer) {
            address aliasOwner = _optionalAddr("TREASURY", deployer);
            if (aliasOwner != deployer) treasuryOwner = aliasOwner;
        }
        address guardian = _optionalAddr("GUARDIAN", deployer);

        Treasury treasury = new Treasury(treasuryOwner);
        MockUSDC usdc = new MockUSDC();
        MontaneSwap swap = new MontaneSwap(address(treasury), address(usdc), PYTH, guardian);
        usdc.mint(deployer, 1_000_000 ether);

        vm.stopBroadcast();

        address manager = address(swap.manager());
        require(CDPManager(manager).owner() == guardian, "guardian mismatch");
        require(treasury.owner() == treasuryOwner, "treasury owner mismatch");
        require(address(swap.manager().usdc()) == address(usdc), "usdc wire");

        console2.log("======== Montane Swap deploy ========");
        console2.log("chainId", block.chainid);
        console2.log("DEPLOYER", deployer);
        console2.log("SWAP", address(swap));
        console2.log("USDC", address(usdc));
        console2.log("MANAGER", manager);
        console2.log("MARKET", address(swap.market()));
        console2.log("CDP", address(swap.position()));
        console2.log("TOKEN", address(swap.token()));
        console2.log("TREASURY", address(treasury));
        console2.log("TREASURY_OWNER", treasuryOwner);
        console2.log("GUARDIAN", guardian);
        console2.log("PYTH", PYTH);
        console2.log("--- frontend ---");
        console2.log("NEXT_PUBLIC_SWAP=");
        console2.log(address(swap));
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
