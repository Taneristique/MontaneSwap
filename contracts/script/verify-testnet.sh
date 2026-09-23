#!/usr/bin/env bash
# Verify live Monad testnet Montane Swap contracts on Sourcify (MonadVision).
# Usage: from contracts/ → ./script/verify-testnet.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHAIN=10143
VERIFIER_URL="https://sourcify-api-monad.blockvision.org/"
RPC="${ETH_RPC_URL:-https://testnet-rpc.monad.xyz}"

# 2026-09-21 redeploy (teamKey)
SWAP=0xE3A43A6d6bd9Ad277E086292C494A0Ace96E3ef5
SEASON=0x550FCf8f52F0304c368d7452b6C7AA2515c7143b
TREASURY=0xc84035652E4055051077eA55b16cAc4534d18B0C
USDC=0xb5fd0160056cEBFe59B86FB95A4a6c48ad7E642f
PYTH=0x2880aB155794e7179c9eE2e38200202908C17B43
GUARDIAN=0xDdf4E32e4d23310E6Ec17870D0232905C05f2910
MANAGER=0x034e2Db9C1F64815bb4280A67a9EF6766F1d7D22
CDP=0x2f46c40e3371FC1029C3974AbA76997d92f6f745
MARKET=0xf4a2A026e0DfE9773AC78d2C056BB7C4DEb076dD
TOKEN=0x70924556BF3D2ed73608E41fA7Ed298dCF7B33eD

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
  "$(cast abi-encode 'constructor(address,address,address,address)' "$USDC" "$CDP" "$TREASURY" "$MANAGER")"

echo
echo "Done. Explorer: https://testnet.monadvision.com/address/<addr>"
