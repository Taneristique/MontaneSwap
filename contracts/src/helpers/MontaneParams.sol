// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

library MontaneParams {
    uint256 public constant WAD = 1e18;
    uint256 public constant PAR = 1e18;
    uint256 public constant BPS = 10_000;
    uint256 public constant ORIGINATION_BPS = 25;
    /// @dev Same issuer remint within ROLL_WINDOW of repay. 1 bp/day ≈ 3.65% APR, not 25 bp/day.
    uint256 public constant ROLL_BPS = 1;
    uint256 public constant ROLL_WINDOW = 2 days;
    uint256 public constant TAKER_BPS = 5;
    uint256 public constant WINTER_BPS = 100;
    /// @dev H <= 1.10 is Frostbite.
    uint256 public constant FROSTBITE = 11e17;
    uint256 public constant MATURITY = 1 days;
    uint256 public constant MIN_BLOCKS = 3;
    uint256 public constant SPREAD = 5e15;
    uint256 public constant CIRCUIT_BPS = 150;
    uint256 public constant V100_MIN = 5000e18;
    /// @dev Same width as circuit. +20% / −15% could never fire while the book freezes at ±1.5%.
    uint256 public constant FOMO_UP_BPS = CIRCUIT_BPS;
    uint256 public constant FOMO_PHI = 3e17;
    uint256 public constant FOMO_STOP_PHI = 5e16;
    uint256 public constant SHOCK_DOWN_BPS = CIRCUIT_BPS;
    uint256 public constant FOMO_WINDOW = 60;
    uint256 public constant V100_WINDOW = 100;
    /// @dev Max CDPs funded per injectWaterline call (global top-K by H desc, need asc).
    uint256 public constant WATERLINE_BATCH = 64;
    /// @dev Max resting orders crossed in one placeOrder match loop.
    uint256 public constant MATCH_FILL_MAX = 32;
    /// @dev Cap per side of `_live` — bounds liveBook / match gather gas.
    uint256 public constant LIVE_PER_SIDE_MAX = 64;
    /// @dev Cap unique short holders per cell — bounds `forceCoverCdp`.
    uint256 public constant SHORT_HOLDERS_MAX = 64;
    /// @dev Max waterline ids scanned per `injectWaterline` (batch still ≤ WATERLINE_BATCH).
    uint256 public constant WATERLINE_SCAN_MAX = 256;

    bytes32 public constant MON_USD_FEED_ID =
        0x31491744e2dbf6df7fcf4ac0820d18a609b49076d45066d3568424e62f686cd1;
    bytes32 public constant USDC_USD_FEED_ID =
        0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a;
}
