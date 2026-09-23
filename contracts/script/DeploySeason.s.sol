// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {SeasonPool} from "../src/SeasonPool.sol";
import {MontaneSwap} from "../src/MontaneSwap.sol";
import {CDPManager} from "../src/CDPManager.sol";

/// @dev Satellite deploy + one-time wire into CDPManager:
///   forge script script/DeploySeason.s.sol:DeploySeason \
///     --rpc-url https://testnet-rpc.monad.xyz --account teamKey --broadcast -vvvv
///   Optional: SWAP=0x... (must be a stack whose manager.seasonPool is still unset)
contract DeploySeason is Script {
    /// @dev Current Monad testnet MontaneSwap root (2026-09-21 teamKey redeploy).
    address constant DEFAULT_SWAP = 0xE3A43A6d6bd9Ad277E086292C494A0Ace96E3ef5;

    function run() external {
        address swapAddr = vm.envOr("SWAP", DEFAULT_SWAP);
        console2.log("using SWAP", swapAddr);
        MontaneSwap swap = MontaneSwap(swapAddr);
        CDPManager mgr = swap.manager();

        vm.startBroadcast();
        SeasonPool pool = new SeasonPool(
            address(mgr.usdc()),
            address(swap.position()),
            mgr.treasury(),
            address(mgr)
        );
        // Auto-open on mint + ensureSettled before repay. Reverts if already wired.
        mgr.setSeasonPool(address(pool));
        vm.stopBroadcast();

        console2.log("SEASON_POOL", address(pool));
        console2.log("NEXT_PUBLIC_SEASON_POOL=");
        console2.log(address(pool));
    }
}
