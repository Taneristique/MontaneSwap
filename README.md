# Montane Swap

Debt-note **CLOB** on **Monad** (testnet `10143`) for the Metropolis hackathon.  
Issue a cell → notes listed on the long book → trade notes or bet on their price on the short book → optional Season (Verdant / Frostbite).

```
frontend/     Next.js 16 · wagmi · RainbowKit · viem
contracts/    Foundry · core protocol + SeasonPool
brand/        logo / assets
```

**License:** MIT

---

## Live stack = this repo (2026-09-28 redeploy)

Frontend defaults and on-chain bytecode match this repository: health is marked to the mMonad price, long and short keep a 0.10 spread, Season settles on marked health, per-cell ERC-1155 notes, cash-settled short book. Sourcify verified on all core contracts including CreditMarket.

**Legacy stacks** (`0xE3A4…3ef5`, `0xAD4b…a7b0`, `0x14f8…0763`) are abandoned — do not point the UI there.

Immutables still mean you cannot hot-swap only `CreditMarket`; any future integrity change needs another full `MontaneSwap` + `DeploySeason` pair.

```bash
# Redeploy again (from contracts/): test, deploy core + SeasonPool, verify on Sourcify
./script/deploy-testnet.sh --update-frontend
# Verify only (any stack; the rest is read on-chain from SWAP)
SWAP=0x... SEASON=0x... ./script/verify-testnet.sh
```

---

## Live deployment addresses (current frontend)

Derived from `NEXT_PUBLIC_SWAP` / `NEXT_PUBLIC_SEASON_POOL` (see `frontend/lib/addresses.ts`).

| Role | Address |
|------|---------|
| **MontaneSwap (root)** | [`0x32e947A829b8bB59eae198014998C34855b9aD62`](https://testnet.monadvision.com/address/0x32e947A829b8bB59eae198014998C34855b9aD62) |
| **SeasonPool** | [`0x0792a6e6cA7f196764D0E653cC8D9c099eDF5fE0`](https://testnet.monadvision.com/address/0x0792a6e6cA7f196764D0E653cC8D9c099eDF5fE0) |
| CreditMarket | [`0x88EfD79354E77040ADAf31e9cf0B1b83abe1698D`](https://testnet.monadvision.com/address/0x88EfD79354E77040ADAf31e9cf0B1b83abe1698D) |
| CDPManager | [`0x4026790fc839298b6564Bc62174Ff0490663e014`](https://testnet.monadvision.com/address/0x4026790fc839298b6564Bc62174Ff0490663e014) |
| CollateralDebtPosition | [`0x502a58F120E46e957DB9E7F176b784eA468Ca905`](https://testnet.monadvision.com/address/0x502a58F120E46e957DB9E7F176b784eA468Ca905) |
| MontaneMonad (mMonad) | [`0xdBCbAd311129d091beF19065cA608Cbc98cDF97b`](https://testnet.monadvision.com/address/0xdBCbAd311129d091beF19065cA608Cbc98cDF97b) |
| Treasury | [`0x60Eb9ccc4ef6614eEC7efA672d7323f8FfAa578E`](https://testnet.monadvision.com/address/0x60Eb9ccc4ef6614eEC7efA672d7323f8FfAa578E) |
| MockUSDC | [`0xb5fd0160056cEBFe59B86FB95A4a6c48ad7E642f`](https://testnet.monadvision.com/address/0xb5fd0160056cEBFe59B86FB95A4a6c48ad7E642f) |
| Pyth | `0x2880aB155794e7179c9eE2e38200202908C17B43` |

Guardian / deployer EOA: `0xDdf4E32e4d23310E6Ec17870D0232905C05f2910`

### Sourcify (live stack)

All eight contracts above are Sourcify verified on MonadVision (2026-09-28 redeploy).  
`cd contracts && ./script/verify-testnet.sh`

### Test USDC (MockUSDC)

Testnet collateral is **MockUSDC**. `mint(address,uint256)` is **permissionless** — any wallet can self-fund.  
`Deploy.s.sol` also mints `1_000_000` (18 decimals) to the deployer on each fresh deploy.

Do **not** paste a private key into the mint command. Import a keystore once (interactive prompt), then sign with `--account`:

```bash
# one-time (if you do not already have teamKey / defaultWallet):
cast wallet import teamKey --interactive

# MockUSDC from the table above — change YOUR_WALLET_ADDRESS to the recipient
USDC=0xb5fd0160056cEBFe59B86FB95A4a6c48ad7E642f
YOUR_WALLET_ADDRESS=0xDdf4E32e4d23310E6Ec17870D0232905C05f2910

# amount = 10_000e18
cast send "$USDC" "mint(address,uint256)" "$YOUR_WALLET_ADDRESS" 10000000000000000000000 \
  --rpc-url https://testnet-rpc.monad.xyz --account teamKey
```

No separate faucet script: call the contract (Explorer / cast / Foundry console) the same way. Explorer “Write Contract” + connected wallet also works if you prefer not to use cast.

---

## Protocol sketch

```
                  ┌─────────────┐
   USDC ─────────►│ CDPManager  │── mint / repay / hunt / waterline
                  └──────┬──────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   CollateralDebt   CreditMarket    MontaneMonad
   Position (cell)  (note CLOB)     (mMonad ERC-1155,
                                     id = cell, USDC vault)
         ▲
         │ health / ratio
   SeasonPool (Verdant / Frostbite)
```

- **Cell:** health is marked to the mMonad price, `H = G / (F × P_mid)`. Frostbite if `H ≤ 1.10` (hunt opens, repay blocked); Winter levy if `H ≤ 1.00`. Mint needs raw `G / F ≥ 1.10` so notes stay backed at par. Maturity 1 day (testnet).
- **Price:** `P_mid = (last long fill + last short fill) / 2`, one price for all cells. Long buys push it up (H down), shorts push it down (H up). Long orders must be ≥ last short + 0.10 and short orders ≤ last long − 0.10, so the books always keep a spread. Fills under 1% of the cell's face don't move `P_mid`. No circuit breaker; the guardian pause remains.
- **CLOB:** long book trades real per-cell notes (seeded with a 1.005 ask on mint). Short book is a cash-settled future on the same cell's note price: each unit locks 1 USDC (short 1 − e, writer e); at maturity v = note TWAP capped at 1.00 (par on a thin book), short gets 1 − v, writer v. Holding both sides nets at 1 USDC. Open shorts per cell are capped at 50% of face; only fills of at least 1% of face (each moving the price at most 1%) feed the TWAP.
- **Season:** directional (12h) or packs until cell maturity; Verdant iff the cell's marked health `G / (F × P_mid)` is above 1.10 at resolve. The settling `P_mid` and H are stored on-chain (`settleMark`, `settleHealth`). In this repo, repay waits for Season settle when wired.

Params: `contracts/src/helpers/MontaneParams.sol`.

### Integrity patch in this tree (ships with redeploy)

- Season `openForMint` + `maturityOf` + `ensureSettled` before close  
- `ratio` resolve if CDP already inactive; dust sweep if no winners  
- Caps: `LIVE_PER_SIDE_MAX`, `MATCH_FILL_MAX`, `WATERLINE_SCAN_MAX`  
- `scrubCdp` / fixed `cancelSeed`; novation sets `firstSaleAt` for withdraw  

---

## Frontend

```bash
cd frontend && cp .env.example .env.local && pnpm install && pnpm dev
```

| Env | Role |
|-----|------|
| `NEXT_PUBLIC_WC_PROJECT_ID` | WalletConnect |
| `NEXT_PUBLIC_SWAP` | Protocol root |
| `NEXT_PUBLIC_SEASON_POOL` | Season satellite |
| `NEXT_PUBLIC_RPC` | optional |

Routes: `/issue` `/trade` `/cell` `/season` `/portfolio` `/docs` `/legal`  
Details: [`frontend/README.md`](frontend/README.md)

---

## Contracts

```bash
cd contracts && forge build
forge test --match-contract SeasonPoolTest
```

Deploy uses Foundry keystore `teamKey` (no plaintext key in git).  
More: [`contracts/README.md`](contracts/README.md)

---

## Demo mental model

1. **Issue** → books seed (Season opens on mint after redeploy).  
2. **Trade** → onchain match.  
3. **Cell** → on-chain H gate, hunt / liquidate.  
4. **Season** → V/F until maturity → resolve → claim.

Testnet only · not financial advice.

---

## Links

- RPC: `https://testnet-rpc.monad.xyz`
- [MonadVision](https://testnet.monadvision.com) · [Monadscan](https://testnet.monadscan.com)
- [Verify with Foundry](https://docs.monad.xyz/guides/verify-smart-contract/foundry)
- Metropolis: [Onchain Finance track](https://hackathon.monad.xyz/tracks/onchain-finance)
