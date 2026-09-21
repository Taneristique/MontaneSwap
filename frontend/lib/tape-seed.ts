import type { Address } from "viem";
import type { TapeFillJson } from "./tape-server";

/** Bootstrap fills — Market/phone stay populated while RPC scan catches up. */
export const TAPE_SEED: TapeFillJson[] = [
  {
    orderId: "6",
    taker: "0x8057a1cAD421d366E94BB334C7B7c5E47E6787d7" as Address,
    amount: "100000000000000000000",
    payUsdc: "148000000000000000000",
    price: "1480000000000000000",
    blockNumber: "63952811",
    timestampSec: "1789842163",
    txHash: "0xab8859723872d6dd6624ee4758c5c3cf541de5c0aae5f8bf373391e12b7f11c7",
    logIndex: 38,
  },
  {
    orderId: "3",
    taker: "0xDdf4E32e4d23310E6Ec17870D0232905C05f2910" as Address,
    amount: "50000000000000000000",
    payUsdc: "50250000000000000000",
    price: "1005000000000000000",
    blockNumber: "63949390",
    timestampSec: "1789841130",
    txHash: "0x1484d1e2a20aff177cb854e1052bdf4dc69ecdf120f49a16082f42d364be6a3b",
    logIndex: 6,
  },
  {
    orderId: "4",
    taker: "0xDdf4E32e4d23310E6Ec17870D0232905C05f2910" as Address,
    amount: "199540000000000000000",
    payUsdc: "198542300000000000000",
    price: "995000000000000000",
    blockNumber: "63947033",
    timestampSec: "1789840417",
    txHash: "0x45ae64f29cc737e556cfda89d3fbb26536ab715e3d0f116186b35dd89ce1e161",
    logIndex: 5,
  },
  {
    orderId: "1",
    taker: "0x8057a1cAD421d366E94BB334C7B7c5E47E6787d7" as Address,
    amount: "25000000000000000000",
    payUsdc: "25125000000000000000",
    price: "1005000000000000000",
    blockNumber: "63938259",
    timestampSec: "1789837763",
    txHash: "0xc3d25d7737c31ae078b7becce769608c45b6cedb6fdae36c8d517daabb0144a7",
    logIndex: 6,
  },
];
