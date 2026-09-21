#!/usr/bin/env bash
# Verify live Monad testnet Montane Swap contracts on Sourcify (MonadVision).
# Usage: from contracts/ → ./script/verify-testnet.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHAIN=10143
VERIFIER_URL="https://sourcify-api-monad.blockvision.org/"
RPC="${ETH_RPC_URL:-https://testnet-rpc.monad.xyz}"

SWAP=0x14f8C210Aa5eB50CDD59683BEfd89169A5B40763
SEASON=0xc04A778b007a927F9276141296c7EabA2f142dc3
TREASURY=0x86058bc519b8a69922E6D5572aa11C6B80DB3603
USDC=0xDd6B8E3E5555Efb3A9DC6f4cc3D1D0B703e46895
PYTH=0x2880aB155794e7179c9eE2e38200202908C17B43
GUARDIAN=0xDdf4E32e4d23310E6Ec17870D0232905C05f2910
MANAGER=0xfEE479167399B2cc9f2e2D26a33b4104f2c595AD
CDP=0x17f379168818698ce2A08838568B873A60d3ad37
MARKET=0xE13c7666449Eb4EDa7c671225333C457171c643f
TOKEN=0x0be0d35549ca751416798a8de7af55efd4077d0c

verify() {
  local addr=$1
  local name=$2
  shift 2
  echo
  echo "======== $name @ $addr ========"
  if [[ $# -gt 0 ]]; then
    forge verify-contract "$addr" "$name" \
      --chain "$CHAIN" \
      --rpc-url "$RPC" \
      --verifier sourcify \
      --verifier-url "$VERIFIER_URL" \
      --constructor-args "$@" || true
  else
    forge verify-contract "$addr" "$name" \
      --chain "$CHAIN" \
      --rpc-url "$RPC" \
      --verifier sourcify \
      --verifier-url "$VERIFIER_URL" || true
  fi
}

forge build --skip test

verify "$TREASURY" src/Treasury.sol:Treasury \
  "$(cast abi-encode 'constructor(address)' "$GUARDIAN")"

verify "$USDC" test/MockUSDC.sol:MockUSDC

verify "$SWAP" src/MontaneSwap.sol:MontaneSwap \
  "$(cast abi-encode 'constructor(address,address,address,address)' "$TREASURY" "$USDC" "$PYTH" "$GUARDIAN")"

verify "$MANAGER" src/CDPManager.sol:CDPManager \
  "$(cast abi-encode 'constructor(address,address,address,address,address,address)' "$TREASURY" "$USDC" "$TOKEN" "$CDP" "$MARKET" "$GUARDIAN")"

verify "$CDP" src/CollateralDebtPosition.sol:CollateralDebtPosition \
  "$(cast abi-encode 'constructor(address,address,address)' "$MANAGER" "$TOKEN" "$MARKET")"

verify "$MARKET" src/CreditMarket.sol:CreditMarket \
  "$(cast abi-encode 'constructor(address,address,address,address,address,address)' "$PYTH" "$TREASURY" "$USDC" "$MANAGER" "$TOKEN" "$CDP")"

verify "$TOKEN" src/MontaneMonad.sol:MontaneMonad \
  "$(cast abi-encode 'constructor(address,address,address)' "$MANAGER" "$MARKET" "$USDC")"

verify "$SEASON" src/SeasonPool.sol:SeasonPool \
  "$(cast abi-encode 'constructor(address,address,address)' "$USDC" "$CDP" "$TREASURY")"

echo
echo "Done. CreditMarket may fail until repo source matches live bytecode (post-deploy optimizations)."
echo "Explorer: https://testnet.monadvision.com/address/<addr>"
