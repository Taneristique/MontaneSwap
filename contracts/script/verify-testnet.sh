#!/usr/bin/env bash
# Verify a Montane Swap stack on Sourcify (MonadVision).
# Only the root and the Season satellite are needed; everything else is read on-chain.
# Usage (from contracts/):
#   ./script/verify-testnet.sh                      # current live stack
#   SWAP=0x... SEASON=0x... ./script/verify-testnet.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CHAIN=10143
VERIFIER_URL="https://sourcify-api-monad.blockvision.org/"
RPC="${ETH_RPC_URL:-https://testnet-rpc.monad.xyz}"

# 2026-09-28 redeploy (teamKey) — defaults when not overridden.
SWAP="${SWAP:-0x32e947A829b8bB59eae198014998C34855b9aD62}"
SEASON="${SEASON:-0x0792a6e6cA7f196764D0E653cC8D9c099eDF5fE0}"

call() { cast call --rpc-url "$RPC" "$@"; }

MANAGER=$(call "$SWAP" "manager()(address)")
MARKET=$(call "$SWAP" "market()(address)")
CDP=$(call "$SWAP" "position()(address)")
TOKEN=$(call "$SWAP" "token()(address)")
TREASURY=$(call "$MANAGER" "treasury()(address)")
USDC=$(call "$MANAGER" "usdc()(address)")
PYTH=$(call "$MARKET" "pyth()(address)")
GUARDIAN=$(call "$MANAGER" "owner()(address)")
# Constructor arg, not the current owner — override if ownership has moved since deploy.
TREASURY_OWNER="${TREASURY_OWNER:-$(call "$TREASURY" "owner()(address)")}"

cat <<EOF
SWAP=$SWAP
SEASON=$SEASON
MANAGER=$MANAGER
MARKET=$MARKET
CDP=$CDP
TOKEN=$TOKEN
TREASURY=$TREASURY
USDC=$USDC
PYTH=$PYTH
GUARDIAN=$GUARDIAN
TREASURY_OWNER=$TREASURY_OWNER
EOF

FAILED=()

verify() {
  local addr=$1 name=$2
  shift 2
  echo
  echo "======== $name @ $addr ========"
  local args=(--chain "$CHAIN" --rpc-url "$RPC" --verifier sourcify --verifier-url "$VERIFIER_URL" --watch)
  [[ $# -gt 0 ]] && args+=(--constructor-args "$1")
  forge verify-contract "$addr" "$name" "${args[@]}" || FAILED+=("$name")
}

forge build --skip test

verify "$TREASURY" src/Treasury.sol:Treasury \
  "$(cast abi-encode 'constructor(address)' "$TREASURY_OWNER")"

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
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "Verification failed for: ${FAILED[*]}"
  echo "(bytecode mismatch usually means the working tree differs from what was deployed.)"
  exit 1
fi
echo "All verified. Explorer: https://testnet.monadvision.com/address/$SWAP"
