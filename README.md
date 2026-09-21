# Montane Swap

Debt-note **CLOB** on **Monad** (testnet `10143`) for the Metropolis hackathon.  
Issue a cell → seed long/short books → trade onchain → optional Season (Verdant / Frostbite).

```
frontend/     Next.js 16 · wagmi · RainbowKit · viem
contracts/    Foundry · core protocol + SeasonPool
brand/        logo / assets
```

**License:** MIT

---

## Live testnet vs this repo (important)

| | **On-chain now** (frontend defaults) | **This repository** |
|---|--------------------------------------|---------------------|
| Stack | Deployed earlier on Monad testnet | Audit / integrity patch — **ahead of live bytecode** |
| Season | Manual `openMarket`; maturity ≈ `now + 1d` | Opens on mint; maturity follows **cell clock** |
| Book / gas | Older match loops; no live-side caps | Bounded live book, shorts, waterline, scrub |
| CreditMarket verify | Fails Sourcify length match | Matches after next full redeploy |

**Frontend still points at the live stack** until Season markets settle and we redeploy. Do not expect every README “patch” line to be live yet.

### Why a full redeploy is coming

1. **Immutables** — `creditMarket` is fixed on `CDPManager`, `CollateralDebtPosition`, and `MontaneMonad`. You cannot swap only `CreditMarket`.
2. **Season clock bug (live)** — Opening the market hours after mint set maturity to `block.timestamp + MATURITY`, so Season ran ~1h past the cell’s real maturity. Repo fixes: open on `createCDP`, `maturityOf` = `firstSaleAt || openedAt` + `MATURITY`.
3. **Stuck / DoS integrity** — Live book had unbounded gas paths; Season `resolve` used `health()` (reverts if CDP closed). Repo: caps + `ratio` + settle-before-repay + escrow scrub / withdraw fixes.
4. **Active Season first** — As of the last check, markets were still open with USDC locked. Redeploy only after **resolve + claim** (or dual-run: keep old Season for claims, point UI at new `SWAP`).

### After redeploy checklist

```bash
# 1) Core
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://testnet-rpc.monad.xyz --account teamKey --broadcast -vvvv

# 2) Season + wire into manager
forge script script/DeploySeason.s.sol:DeploySeason \
  --rpc-url https://testnet-rpc.monad.xyz --account teamKey --broadcast -vvvv
# (script calls manager.setSeasonPool)

# 3) Frontend
# NEXT_PUBLIC_SWAP=...
# NEXT_PUBLIC_SEASON_POOL=...

# 4) Verify
./script/verify-testnet.sh
```

Solo `new CreditMarket(...)` **does not work** — the rest of the stack still points at the old market.

---

## Live deployment addresses (current frontend)

Derived from `NEXT_PUBLIC_SWAP` / `NEXT_PUBLIC_SEASON_POOL` (see `frontend/lib/addresses.ts`).

| Role | Address |
|------|---------|
| **MontaneSwap (root)** | [`0x14f8C210Aa5eB50CDD59683BEfd89169A5B40763`](https://testnet.monadvision.com/address/0x14f8C210Aa5eB50CDD59683BEfd89169A5B40763) |
| **SeasonPool** | [`0xc04A778b007a927F9276141296c7EabA2f142dc3`](https://testnet.monadvision.com/address/0xc04A778b007a927F9276141296c7EabA2f142dc3) |
| CreditMarket | [`0xE13c7666449Eb4EDa7c671225333C457171c643f`](https://testnet.monadvision.com/address/0xE13c7666449Eb4EDa7c671225333C457171c643f) |
| CDPManager | [`0xfEE479167399B2cc9f2e2D26a33b4104f2c595AD`](https://testnet.monadvision.com/address/0xfEE479167399B2cc9f2e2D26a33b4104f2c595AD) |
| CollateralDebtPosition | [`0x17f379168818698ce2A08838568B873A60d3ad37`](https://testnet.monadvision.com/address/0x17f379168818698ce2A08838568B873A60d3ad37) |
| MontaneMonad (mMonad) | [`0x0be0d35549ca751416798a8de7af55efd4077d0c`](https://testnet.monadvision.com/address/0x0be0d35549ca751416798a8de7af55efd4077d0c) |
| Treasury | [`0x86058bc519b8a69922E6D5572aa11C6B80DB3603`](https://testnet.monadvision.com/address/0x86058bc519b8a69922E6D5572aa11C6B80DB3603) |
| MockUSDC | [`0xDd6B8E3E5555Efb3A9DC6f4cc3D1D0B703e46895`](https://testnet.monadvision.com/address/0xDd6B8E3E5555Efb3A9DC6f4cc3D1D0B703e46895) |
| Pyth | `0x2880aB155794e7179c9eE2e38200202908C17B43` |

Guardian / deployer EOA: `0xDdf4E32e4d23310E6Ec17870D0232905C05f2910`

### Sourcify (live stack)

Most contracts **match** / **exact** on MonadVision. **CreditMarket** does not — live bytecode ≠ this repo until redeploy.  
`cd contracts && ./script/verify-testnet.sh`

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
   Position (cell)  (note CLOB)     (mMonad ERC-20)
         ▲
         │ health / ratio
   SeasonPool (Verdant / Frostbite)
```

- **Cell:** `H = G / F`. Frostbite if `H ≤ 1.10`. Maturity 1 day (testnet).
- **CLOB:** long and short books do not cross. Seed on mint. Escrow on `CreditMarket`.
- **Season:** directional (12h) or packs until cell maturity; resolve from on-chain H. In this repo, repay waits for Season settle when wired.

Params: `contracts/src/helpers/MontaneParams.sol`.

### Integrity patch in this tree (ships with redeploy)

- Season `openForMint` + `maturityOf` + `ensureSettled` before close  
- `ratio` resolve if CDP already inactive; dust sweep if no winners  
- Caps: `LIVE_PER_SIDE_MAX`, `SHORT_HOLDERS_MAX`, `MATCH_FILL_MAX`, `WATERLINE_SCAN_MAX`  
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
