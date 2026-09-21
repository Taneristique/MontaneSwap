## Foundry

**Foundry is a blazing fast, portable and modular toolkit for Ethereum application development written in Rust.**

Foundry consists of:

- **Forge**: Ethereum testing framework (like Truffle, Hardhat and DappTools).
- **Cast**: Swiss army knife for interacting with EVM smart contracts, sending transactions and getting chain data.
- **Anvil**: Local Ethereum node, akin to Ganache, Hardhat Network.
- **Chisel**: Fast, utilitarian, and verbose solidity REPL.

## Documentation

https://book.getfoundry.sh/

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

### Format

```shell
$ forge fmt
```

### Gas Snapshots

```shell
$ forge snapshot
```

### Anvil

```shell
$ anvil
```

### Deploy

Uses the local Foundry keystore account `teamKey` (`cast wallet list`). **No plaintext `PRIVATE_KEY` in `.env`.**

```shell
$ forge script script/Deploy.s.sol:Deploy \
    --rpc-url https://testnet-rpc.monad.xyz \
    --account teamKey \
    --broadcast \
    -vvvv
```

Optional address overrides in `.env` (not keys): `TREASURY_OWNER=0x…` `GUARDIAN=0x…`  
Forge prompts for the keystore password.

After deploy, set frontend `NEXT_PUBLIC_SWAP` to the logged `SWAP` address (not Treasury).

### Verify (Monad testnet Sourcify)

Live addresses and status are listed in the **[root README](../README.md)**. Re-submit:

```shell
$ ./script/verify-testnet.sh
```

Uses `--verifier sourcify` and `https://sourcify-api-monad.blockvision.org/`.  
**Note:** `CreditMarket` on the current testnet deploy predates the in-repo match/book optimisations — verification fails until the next full `MontaneSwap` redeploy matches source.

### Cast

```shell
$ cast <subcommand>
```

### Help

```shell
$ forge --help
$ anvil --help
$ cast --help
```
