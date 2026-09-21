export const swapAbi = [
  {
    type: "function",
    name: "manager",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "position",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "market",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "token",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

export const creditMarketAbi = [
  {
    type: "function",
    name: "liveBook",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple[]",
        name: "rows",
        components: [
          { name: "id", type: "uint256" },
          { name: "maker", type: "address" },
          { name: "cdpId", type: "uint256" },
          { name: "side", type: "uint8" },
          { name: "price", type: "uint256" },
          { name: "remaining", type: "uint256" },
          { name: "fomo", type: "bool" },
          { name: "landedAt", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "liveCount",
    stateMutability: "view",
    inputs: [{ name: "side", type: "uint8" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "pMid",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "frozen",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "usdc",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "placeOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "cdpId", type: "uint256" },
      { name: "side", type: "uint8" },
      { name: "price", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fillOrder",
    stateMutability: "nonpayable",
    inputs: [
      { name: "orderId", type: "uint256" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelOrder",
    stateMutability: "nonpayable",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "tradeCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "v100",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "shortSize",
    stateMutability: "view",
    inputs: [
      { name: "who", type: "address" },
      { name: "cdpId", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "shortEscrow",
    stateMutability: "view",
    inputs: [
      { name: "who", type: "address" },
      { name: "cdpId", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "orders",
    stateMutability: "view",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [
      { name: "maker", type: "address" },
      { name: "cdpId", type: "uint256" },
      { name: "side", type: "uint8" },
      { name: "price", type: "uint256" },
      { name: "remaining", type: "uint256" },
      { name: "active", type: "bool" },
      { name: "fomo", type: "bool" },
      { name: "landedAt", type: "uint256" },
    ],
  },
  {
    type: "event",
    name: "Filled",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "taker", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "payUsdc", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "OrderCancelled",
    inputs: [
      { name: "orderId", type: "uint256", indexed: true },
      { name: "maker", type: "address", indexed: true },
      { name: "remaining", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Sealed",
    inputs: [
      { name: "pMid", type: "uint256", indexed: false },
      { name: "blockNumber", type: "uint256", indexed: false },
    ],
  },
] as const;

export const managerAbi = [
  {
    type: "function",
    name: "createCDP",
    stateMutability: "nonpayable",
    inputs: [
      { name: "debtAmount", type: "uint256" },
      { name: "usdcIn", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "repayCDP",
    stateMutability: "nonpayable",
    inputs: [{ name: "cdpId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "requestHunt",
    stateMutability: "nonpayable",
    inputs: [
      { name: "cdpId", type: "uint256" },
      { name: "p", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "resolveHunt",
    stateMutability: "nonpayable",
    inputs: [{ name: "cdpId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "liquidateCDP",
    stateMutability: "nonpayable",
    inputs: [
      { name: "cdpId", type: "uint256" },
      { name: "p", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "huntRequest",
    stateMutability: "view",
    inputs: [{ name: "cdpId", type: "uint256" }],
    outputs: [
      { name: "hunter", type: "address" },
      { name: "bond", type: "uint256" },
      { name: "pending", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "healthOf",
    stateMutability: "view",
    inputs: [{ name: "cdpId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const cdpAbi = [
  {
    type: "function",
    name: "nextId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getCDP",
    stateMutability: "view",
    inputs: [{ name: "cdpId", type: "uint256" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "issuer", type: "address" },
          { name: "longOwner", type: "address" },
          { name: "collateralAmount", type: "uint256" },
          { name: "debtAmount", type: "uint256" },
          { name: "openedAt", type: "uint256" },
          { name: "firstSaleAt", type: "uint256" },
          { name: "openBlock", type: "uint256" },
          { name: "active", type: "bool" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "health",
    stateMutability: "view",
    inputs: [{ name: "cdpId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const nnsAbi = [
  {
    type: "function",
    name: "getPrimaryNameForAddress",
    stateMutability: "view",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ type: "string" }],
  },
] as const;

export const tokenAbi = [
  {
    type: "function",
    name: "getIssuanceCost",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "issuedDebt",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const seasonPoolAbi = [
  {
    type: "function",
    name: "openMarket",
    stateMutability: "nonpayable",
    inputs: [{ name: "cdpId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "mintDirectional",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "verdant", type: "bool" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "mintPack",
    stateMutability: "nonpayable",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "each", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "resolve",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maturityOf",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "marketOfCdp",
    stateMutability: "view",
    inputs: [{ name: "cdpId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "markets",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [
      { name: "cdpId", type: "uint256" },
      { name: "issuer", type: "address" },
      { name: "openedAt", type: "uint256" },
      { name: "maturity", type: "uint256" },
      { name: "verdantSupply", type: "uint256" },
      { name: "frostbiteSupply", type: "uint256" },
      { name: "verdantColl", type: "uint256" },
      { name: "frostbiteColl", type: "uint256" },
      { name: "resolved", type: "bool" },
      { name: "verdantWins", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "verdantOf",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "who", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "frostbiteOf",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "who", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "previewClaim",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "who", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "directionalOpen",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "claimed",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "who", type: "address" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "nextMarketId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "maturityOf",
    stateMutability: "view",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "DIRECTIONAL_WINDOW",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

export const Side = {
  LongAsk: 0,
  LongBid: 1,
  ShortAsk: 2,
  ShortBid: 3,
} as const;
