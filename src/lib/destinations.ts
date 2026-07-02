// Destination-asset registry.
// - TXC:  TEXITcoin native chain. Two address formats:
//     • Legacy P2PKH → base58 starting with `T`
//     • Native SegWit → starts with `txc1q…`
// - wTXC: ERC-20 on Ethereum mainnet, 1:1 backed by TXC held in the
//   bridge operator wallet. Address = any Ethereum EOA (`0x…`).

const B58 = "[1-9A-HJ-NP-Za-km-z]";
const BECH32 = "[qpzry9x8gf2tvdw0s3jn54khce6mua7l]";

const TXC_ADDRESS_REGEX = new RegExp(`^(T${B58}{33}|txc1${BECH32}{6,87})$`);
const WTXC_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export const DESTINATIONS = {
  TXC: {
    key: "TXC",
    label: "TXC",
    kind: "native" as const,
    bitmartSymbol: "TXC_USDT",
    bitmartCurrency: "TXC",
    bitmartNetwork: "TXC",
    addressRegex: TXC_ADDRESS_REGEX,
    addressHint: "Your TEXITcoin address — legacy (T…) or SegWit (txc1q…)",
    walletUrl: "https://wallet.texitcoin.org",
    explorer: "https://mempool.texitcoin.org",
  },
  wTXC: {
    key: "wTXC",
    label: "wTXC",
    kind: "erc20" as const,
    bitmartSymbol: "TXC_USDT", // priced identically to TXC for on-ramp quotes
    bitmartCurrency: "TXC",
    bitmartNetwork: "TXC",
    addressRegex: WTXC_ADDRESS_REGEX,
    addressHint: "Your Ethereum address (0x…) to receive wTXC (ERC-20)",
    walletUrl: "https://ethereum.org/en/wallets/find-wallet/",
    explorer: "https://etherscan.io",
  },
} as const;

export type DestAsset = keyof typeof DESTINATIONS;
export const DEST_ASSETS = Object.keys(DESTINATIONS) as DestAsset[];

export function getDestination(asset: string): (typeof DESTINATIONS)[DestAsset] {
  if (!(asset in DESTINATIONS)) {
    throw new Error(`Unsupported destination asset: ${asset}`);
  }
  return DESTINATIONS[asset as DestAsset];
}

export function destTxUrl(asset: string, txid: string): string {
  const d = getDestination(asset);
  return `${d.explorer}/tx/${txid}`;
}
