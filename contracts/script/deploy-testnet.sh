#!/usr/bin/env bash
# Full Monad testnet redeploy: core stack -> SeasonPool (wired into CDPManager) -> Sourcify verify.
# Signs with a Foundry keystore account; never takes a raw private key.
#
# Usage (from contracts/):
#   ./script/deploy-testnet.sh                    # tests, deploy, verify
#   ./script/deploy-testnet.sh --update-frontend  # also rewrite frontend/lib/addresses.ts
#   ./script/deploy-testnet.sh --skip-tests --skip-verify
#   ./script/deploy-testnet.sh --account otherKey
#
# Env:
#   ACCOUNT        keystore name (default teamKey; create with `cast wallet import teamKey --interactive`)
#   PASSWORD_FILE  optional keystore password file, otherwise forge prompts for it
#   USDC / FRESH_USDC=true  reuse another token / deploy a new MockUSDC (default: reuse the live one)
#   TREASURY_OWNER optional role override read by Deploy.s.sol (GUARDIAN must stay the deployer).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
cd "$ROOT"

CHAIN=10143
RPC="${ETH_RPC_URL:-https://testnet-rpc.monad.xyz}"
ACCOUNT="${ACCOUNT:-teamKey}"
EXPLORER="https://testnet.monadvision.com/address"

RUN_TESTS=1
RUN_VERIFY=1
UPDATE_FRONTEND=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --account) ACCOUNT="${2:?--account needs a keystore name}"; shift ;;
    --skip-tests) RUN_TESTS=0 ;;
    --skip-verify) RUN_VERIFY=0 ;;
    --update-frontend) UPDATE_FRONTEND=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "unknown flag: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

for bin in forge cast jq; do
  command -v "$bin" >/dev/null || { echo "missing: $bin" >&2; exit 1; }
done

if ! cast wallet list 2>/dev/null | grep -qw "$ACCOUNT"; then
  echo "keystore account '$ACCOUNT' not found. Create it with:" >&2
  echo "  cast wallet import $ACCOUNT --interactive" >&2
  exit 1
fi

if [[ "$(cast chain-id --rpc-url "$RPC")" != "$CHAIN" ]]; then
  echo "RPC $RPC is not chain $CHAIN" >&2
  exit 1
fi

SIGN=(--account "$ACCOUNT")
[[ -n "${PASSWORD_FILE:-}" ]] && SIGN+=(--password-file "$PASSWORD_FILE")

# Last CREATE address for a contract name in a broadcast log.
created() {
  jq -r --arg n "$2" \
    '[.transactions[] | select(.transactionType == "CREATE" and .contractName == $n) | .contractAddress] | last // empty' \
    "broadcast/$1/$CHAIN/run-latest.json"
}

echo "==> build"
forge build

if [[ $RUN_TESTS -eq 1 ]]; then
  echo "==> test"
  forge test
fi

echo "==> deploy Treasury, MontaneSwap, SeasonPool (one broadcast, existing USDC reused)"
forge script script/Deploy.s.sol:Deploy --rpc-url "$RPC" "${SIGN[@]}" --broadcast
SWAP=$(created Deploy.s.sol MontaneSwap)
SEASON=$(created Deploy.s.sol SeasonPool)
[[ -n "$SWAP" && -n "$SEASON" ]] || { echo "SWAP/SeasonPool address not found in broadcast log" >&2; exit 1; }
SWAP=$(cast to-check-sum-address "$SWAP")
SEASON=$(cast to-check-sum-address "$SEASON")
echo "SWAP=$SWAP"

MANAGER=$(cast call --rpc-url "$RPC" "$SWAP" "manager()(address)")
WIRED=$(cast call --rpc-url "$RPC" "$MANAGER" "seasonPool()(address)")
if [[ "${WIRED,,}" != "${SEASON,,}" ]]; then
  echo "CDPManager.seasonPool is $WIRED, expected $SEASON" >&2
  exit 1
fi
echo "SEASON=$SEASON (wired)"

OUT="$ROOT/deployments/testnet.env"
mkdir -p "$(dirname "$OUT")"
{
  echo "# Montane Swap Monad testnet deploy, $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "SWAP=$SWAP"
  echo "SEASON=$SEASON"
  echo "MANAGER=$MANAGER"
  echo "MARKET=$(cast call --rpc-url "$RPC" "$SWAP" "market()(address)")"
  echo "CDP=$(cast call --rpc-url "$RPC" "$SWAP" "position()(address)")"
  echo "TOKEN=$(cast call --rpc-url "$RPC" "$SWAP" "token()(address)")"
  echo "TREASURY=$(cast call --rpc-url "$RPC" "$MANAGER" "treasury()(address)")"
  echo "USDC=$(cast call --rpc-url "$RPC" "$MANAGER" "usdc()(address)")"
} > "$OUT"
echo "==> addresses written to ${OUT#"$REPO"/}"

if [[ $UPDATE_FRONTEND -eq 1 ]]; then
  ADDR_TS="$REPO/frontend/lib/addresses.ts"
  sed -i -E \
    -e "s/(const DEPLOYED_SWAP = \")0x[0-9a-fA-F]{40}/\1$SWAP/" \
    -e "s/(const DEPLOYED_SEASON_POOL = \")0x[0-9a-fA-F]{40}/\1$SEASON/" \
    "$ADDR_TS"
  # .env.local overrides addresses.ts at runtime, so keep it in sync too.
  for envf in "$REPO/frontend/.env.local" "$REPO/frontend/.env.example"; do
    [[ -f "$envf" ]] || continue
    sed -i -E \
      -e "s/^(NEXT_PUBLIC_SWAP=).*/\1$SWAP/" \
      -e "s/^(NEXT_PUBLIC_SEASON_POOL=).*/\1$SEASON/" \
      "$envf"
  done
  echo "==> updated frontend/lib/addresses.ts, .env.local, .env.example (restart next dev)"
fi

if [[ $RUN_VERIFY -eq 1 ]]; then
  echo "==> verify (waiting for the explorer to index)"
  sleep 15
  SWAP="$SWAP" SEASON="$SEASON" "$ROOT/script/verify-testnet.sh"
fi

cat <<EOF

======== done ========
SWAP    $EXPLORER/$SWAP
SEASON  $EXPLORER/$SEASON
Frontend env (if not using --update-frontend):
  NEXT_PUBLIC_SWAP=$SWAP
  NEXT_PUBLIC_SEASON_POOL=$SEASON
EOF
