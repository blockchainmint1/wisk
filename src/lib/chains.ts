// Supported source chains and tokens (ERC-20 stables + native ETH).
// Safe to import from client (no secrets).

export type ChainKey = "ethereum" | "base" | "arbitrum" | "polygon" | "bsc";

// Sentinel address for native coin (ETH on EVM). The scanner branches on this.
export const NATIVE_TOKEN_ADDRESS = "native";

export interface TokenConfig {
  symbol: string; // e.g. "USDC", "PYUSD", "ETH"
  address: string; // ERC-20 contract address (lowercase) OR "native" for native coin
  decimals: number;
  isNative?: boolean;
  // Bitmart spot symbol used to price this token in USD when it isn't a $1
  // stable (e.g. ETH). Stables omit this — they're treated as $1.
  bitmartSymbol?: string;
}

export interface ChainConfig {
  key: ChainKey;
  name: string;
  chainId: number;
  explorer: string;
  confirmations: number;
  nativeSymbol: string;
  tokens: TokenConfig[];
}

// Helpers to keep the table readable.
const stable = (symbol: string, address: string, decimals: number): TokenConfig => ({
  symbol,
  address: address.toLowerCase(),
  decimals,
});

const native = (symbol: string, bitmartSymbol: string): TokenConfig => ({
  symbol,
  address: NATIVE_TOKEN_ADDRESS,
  decimals: 18,
  isNative: true,
  bitmartSymbol,
});

export const CHAINS: Record<ChainKey, ChainConfig> = {
  ethereum: {
    key: "ethereum",
    name: "Ethereum",
    chainId: 1,
    explorer: "https://etherscan.io",
    confirmations: 3,
    nativeSymbol: "ETH",
    tokens: [
      stable("USDC",  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", 6),
      stable("USDT",  "0xdac17f958d2ee523a2206206994597c13d831ec7", 6),
      stable("DAI",   "0x6b175474e89094c44da98b954eedeac495271d0f", 18),
      stable("PYUSD", "0x6c3ea9036406852006290770bedfcaba0e23a0e8", 6),
      stable("FRAX",  "0x853d955aCEf822Db058eb8505911ED77F175b99e", 18),
      stable("TUSD",  "0x0000000000085d4780B73119b644AE5ecd22b376", 18),
      stable("USDP",  "0x8E870D67F660D95d5be530380D0eC0bd388289E1", 18),
      stable("USDe",  "0x4c9EDD5852cd905f086C759E8383e09bff1E68B3", 18),
      native("ETH", "ETH_USDT"),
    ],
  },
  base: {
    key: "base",
    name: "Base",
    chainId: 8453,
    explorer: "https://basescan.org",
    confirmations: 5,
    nativeSymbol: "ETH",
    tokens: [
      stable("USDC",  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", 6),
      stable("USDbC", "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", 6),
      stable("USDT",  "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", 6),
      native("ETH", "ETH_USDT"),
    ],
  },
  arbitrum: {
    key: "arbitrum",
    name: "Arbitrum",
    chainId: 42161,
    explorer: "https://arbiscan.io",
    confirmations: 5,
    nativeSymbol: "ETH",
    tokens: [
      stable("USDC",   "0xaf88d065e77c8cc2239327c5edb3a432268e5831", 6),
      stable("USDC.e", "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8", 6),
      stable("USDT",   "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", 6),
      stable("DAI",    "0xDA10009cBd5D07dD0CeCc66161FC93D7c9000da1", 18),
      stable("FRAX",   "0x17FC002b466eEc40DaE837Fc4bE5c67993ddBd6F", 18),
      native("ETH", "ETH_USDT"),
    ],
  },
  polygon: {
    key: "polygon",
    name: "Polygon",
    chainId: 137,
    explorer: "https://polygonscan.com",
    confirmations: 20,
    nativeSymbol: "MATIC",
    tokens: [
      stable("USDC",   "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", 6),
      stable("USDC.e", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", 6),
      stable("USDT",   "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", 6),
      stable("DAI",    "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", 18),
    ],
  },
  bsc: {
    key: "bsc",
    name: "BNB Chain",
    chainId: 56,
    explorer: "https://bscscan.com",
    confirmations: 15,
    nativeSymbol: "BNB",
    tokens: [
      stable("USDT", "0x55d398326f99059ff775485246999027b3197955", 18),
      stable("USDC", "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", 18),
    ],
  },
};

export function getChain(key: string): ChainConfig {
  const c = CHAINS[key as ChainKey];
  if (!c) throw new Error(`Unknown chain: ${key}`);
  return c;
}

export function getToken(chain: ChainKey, symbol: string): TokenConfig {
  const c = CHAINS[chain];
  const t = c.tokens.find((t) => t.symbol === symbol);
  if (!t) throw new Error(`Token ${symbol} not on ${chain}`);
  return t;
}

export function isNativeToken(t: TokenConfig): boolean {
  return t.isNative === true || t.address === NATIVE_TOKEN_ADDRESS;
}

export const PREMIUM_BPS = 500; // 5%
