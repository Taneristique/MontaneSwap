# Montane Swap — frontend

Next.js 16 app for the live Monad testnet deployment. Product overview, addresses, and verify status live in the **[root README](../README.md)**.

## Stack

- **Next.js 16** (App Router) + TypeScript + Tailwind 4  
- **wagmi** + **viem** + **RainbowKit** (Monad testnet `10143`)  
- Protocol root: `NEXT_PUBLIC_SWAP` → `useProtocol()` derives manager, CDP, market, token, USDC  
- Season satellite: `NEXT_PUBLIC_SEASON_POOL`

## Setup

```bash
cd frontend
cp .env.example .env.local
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment

| Variable | Required | Meaning |
|----------|----------|---------|
| `NEXT_PUBLIC_WC_PROJECT_ID` | yes | WalletConnect Cloud project id |
| `NEXT_PUBLIC_SWAP` | yes | `MontaneSwap` root (defaults in `lib/addresses.ts` if unset) |
| `NEXT_PUBLIC_SEASON_POOL` | yes for Season / portfolio season | `SeasonPool` address |
| `NEXT_PUBLIC_RPC` | no | Override RPC (default Monad testnet public RPC) |

Current testnet defaults (also in root README):

```env
NEXT_PUBLIC_SWAP=0xE3A43A6d6bd9Ad277E086292C494A0Ace96E3ef5
NEXT_PUBLIC_SEASON_POOL=0x550FCf8f52F0304c368d7452b6C7AA2515c7143b
```

## Routes

| Path | What it does |
|------|----------------|
| `/` | Landing / product map |
| `/issue` | Create CDP — post USDC, mint mMonad, seed books |
| `/trade` | Note CLOB — aggregated book, place / fill / cancel, my open + fills |
| `/cell` | Single cell — health, hunt, repay, Winter / liquidate |
| `/season` | Open markets for any active cell, mint Verdant/Frostbite, resolve, claim |
| `/portfolio` | Wallet balances, cells, orders, shorts, season positions / PnL |
| `/docs` `/how` | Protocol explainers |
| `/legal` | Legal copy |

## Important UI ↔ chain notes

- **Addresses:** never hardcode market/CDP in pages — use `useProtocol()` / `SWAP` + `SEASON_POOL`.  
- **Pmid display:** book mid from long ask/bid; risk paths on-chain use sealed mid.  
- **Season:** bets resolve from `cdp.health(cdpId)`. Closing that CDP before resolve breaks the market.  
- **USDC approve:** `lib/ensure-usdc.ts` caches allowance (`maxUint256`) to avoid repeat approvals.  
- **Errors:** `lib/tx-error.ts` maps common custom errors (e.g. not mature) to readable copy.  
- **Tape:** `/api/tape` + `lib/use-fill-tape.ts` for recent fills.

## Scripts

```bash
pnpm dev      # local
pnpm build    # production build
pnpm start    # serve build
pnpm lint
```

## Layout of `lib/`

| File | Role |
|------|------|
| `addresses.ts` | `SWAP` / `SEASON_POOL` / NNS |
| `abi.ts` | Minimal ABIs for reads/writes |
| `use-protocol.ts` | Derive core addresses from `SWAP` |
| `wagmi.ts` | Chain + transports |
| `ensure-usdc.ts` | Approve helper |
| `format.ts` | Amounts, ETA, PnL formatting |
| `tx-error.ts` | Revert → user message |

Contracts and deploy/verify: see [`../contracts/README.md`](../contracts/README.md) and the root README.
