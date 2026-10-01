// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {SeasonPool} from "../src/SeasonPool.sol";
import {MontaneSwap} from "../src/MontaneSwap.sol";
import {CDPManager} from "../src/CDPManager.sol";

/// @dev Attach a SeasonPool to an existing stack whose manager.seasonPool is still unset.
///      Fresh deploys don't need this: Deploy.s.sol already deploys and wires SeasonPool.
///   SWAP=0x... forge script script/DeploySeason.s.sol:DeploySeason \
///     --rpc-url https://testnet-rpc.monad.xyz --account teamKey --broadcast -vvvv
contract DeploySeason is Script {
    function run() external {
        address swapAddr = vm.envAddress("SWAP");
        console2.log("using SWAP", swapAddr);
        MontaneSwap swap = MontaneSwap(swapAddr);
        CDPManager mgr = swap.manager();
        require(address(mgr.seasonPool()) == address(0), "SeasonPool already wired on this SWAP");

        vm.startBroadcast();
        SeasonPool pool = new SeasonPool(
            address(mgr.usdc()),
            address(swap.position()),
            mgr.treasury(),
            address(mgr)
        );
        mgr.setSeasonPool(address(pool));
        vm.stopBroadcast();

        console2.log("SEASON_POOL", address(pool));
        console2.log("NEXT_PUBLIC_SEASON_POOL", address(pool));
    }
}
