// Supported source chains and stablecoin tokens.
// Safe to import from client (no secrets).

export type ChainKey = "ethereum" | "base" | "arbitrum" | "polygon" | "bsc";
export type TokenSymbol = "USDC" | "USDT" | "DAI";

export interface TokenConfig {
  symbol: TokenSymbol;
  address: string; // ERC-20 contract address (lowercase)
  decimals: number;
}

export interface ChainConfig {
  key: ChainKey;
  name: string;
  chainId: number;
  explorer: string;
  confirmations: number;
  tokens: TokenConfig[];
}

export const CHAINS: Record<ChainKey, ChainConfig> = {
  ethereum: {
    key: "ethereum",
    name: "Ethereum",
    chainId: 1,
    explorer: "https://etherscan.io",
    confirmations: 3,
    tokens: [
      { symbol: "USDC", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
      { symbol: "USDT", address: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6 },
      { symbol: "DAI",  address: "0x6b175474e89094c44da98b954eedeac495271d0f", decimals: 18 },
    ],
  },
  base: {
    key: "base",
    name: "Base",
    chainId: 8453,
    explorer: "https://basescan.org",
    confirmations: 5,
    tokens: [
      { symbol: "USDC", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
    ],
  },
  arbitrum: {
    key: "arbitrum",
    name: "Arbitrum",
    chainId: 42161,
    explorer: "https://arbiscan.io",
    confirmations: 5,
    tokens: [
      { symbol: "USDC", address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", decimals: 6 },
      { symbol: "USDT", address: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", decimals: 6 },
    ],
  },
  polygon: {
    key: "polygon",
    name: "Polygon",
    chainId: 137,
    explorer: "https://polygonscan.com",
    confirmations: 20,
    tokens: [
      { symbol: "USDC", address: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", decimals: 6 },
      { symbol: "USDT", address: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", decimals: 6 },
    ],
  },
  bsc: {
    key: "bsc",
    name: "BNB Chain",
    chainId: 56,
    explorer: "https://bscscan.com",
    confirmations: 15,
    tokens: [
      { symbol: "USDT", address: "0x55d398326f99059ff775485246999027b3197955", decimals: 18 },
      { symbol: "USDC", address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", decimals: 18 },
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

export const PREMIUM_BPS = 500; // 5%
