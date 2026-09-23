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

## Live stack = this repo (2026-09-21 redeploy)

Frontend defaults and on-chain bytecode match this repository: Season opens on mint, maturity follows the **cell clock**, book loops are capped, repay scrubs the book, Sourcify **full** on all core contracts including CreditMarket.

**Legacy stack** (`0x14f8…0763` / Season `0xc04A…`) is abandoned after claims — do not point the UI there.

Immutables still mean you cannot hot-swap only `CreditMarket`; any future integrity change needs another full `MontaneSwap` + `DeploySeason` pair.

```bash
# Redeploy again (if needed)
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://testnet-rpc.monad.xyz --account teamKey --broadcast -vvvv
SWAP=<new> forge script script/DeploySeason.s.sol:DeploySeason \
  --rpc-url https://testnet-rpc.monad.xyz --account teamKey --broadcast -vvvv
./script/verify-testnet.sh
```

---

## Live deployment addresses (current frontend)

Derived from `NEXT_PUBLIC_SWAP` / `NEXT_PUBLIC_SEASON_POOL` (see `frontend/lib/addresses.ts`).

| Role | Address |
|------|---------|
| **MontaneSwap (root)** | [`0xE3A43A6d6bd9Ad277E086292C494A0Ace96E3ef5`](https://testnet.monadvision.com/address/0xE3A43A6d6bd9Ad277E086292C494A0Ace96E3ef5) |
| **SeasonPool** | [`0x550FCf8f52F0304c368d7452b6C7AA2515c7143b`](https://testnet.monadvision.com/address/0x550FCf8f52F0304c368d7452b6C7AA2515c7143b) |
| CreditMarket | [`0xf4a2A026e0DfE9773AC78d2C056BB7C4DEb076dD`](https://testnet.monadvision.com/address/0xf4a2A026e0DfE9773AC78d2C056BB7C4DEb076dD) |
| CDPManager | [`0x034e2Db9C1F64815bb4280A67a9EF6766F1d7D22`](https://testnet.monadvision.com/address/0x034e2Db9C1F64815bb4280A67a9EF6766F1d7D22) |
| CollateralDebtPosition | [`0x2f46c40e3371FC1029C3974AbA76997d92f6f745`](https://testnet.monadvision.com/address/0x2f46c40e3371FC1029C3974AbA76997d92f6f745) |
| MontaneMonad (mMonad) | [`0x70924556BF3D2ed73608E41fA7Ed298dCF7B33eD`](https://testnet.monadvision.com/address/0x70924556BF3D2ed73608E41fA7Ed298dCF7B33eD) |
| Treasury | [`0xc84035652E4055051077eA55b16cAc4534d18B0C`](https://testnet.monadvision.com/address/0xc84035652E4055051077eA55b16cAc4534d18B0C) |
| MockUSDC | [`0xb5fd0160056cEBFe59B86FB95A4a6c48ad7E642f`](https://testnet.monadvision.com/address/0xb5fd0160056cEBFe59B86FB95A4a6c48ad7E642f) |
| Pyth | `0x2880aB155794e7179c9eE2e38200202908C17B43` |

Guardian / deployer EOA: `0xDdf4E32e4d23310E6Ec17870D0232905C05f2910`

### Sourcify (live stack)

All eight contracts above are Sourcify **full** match on MonadVision (post 2026-09-21 redeploy).  
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
