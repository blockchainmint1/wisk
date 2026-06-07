// Destination-asset registry. TXC and ISK$ share an address format
// (ISK$ is an Omni Layer token on the TXC chain), but Bitmart treats them
// as separate symbols/withdrawal networks.

// Base58 P2PKH on the TXC/Litecoin-fork chain: starts with `T`, total 34 chars,
// Base58 alphabet (no 0/O/I/l).
const TXC_ADDRESS_REGEX = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

export const DESTINATIONS = {
  TXC: {
    key: "TXC",
    label: "TXC",
    bitmartSymbol: "TXC_USDT",
    bitmartCurrency: "TXC",
    bitmartNetwork: "TXC",
    addressRegex: TXC_ADDRESS_REGEX,
    addressHint: "Your native TEXITcoin address (starts with T, 34 chars)",
  },
  "ISK$": {
    key: "ISK$",
    label: "ISK$",
    bitmartSymbol: "ISK$_USDT",
    bitmartCurrency: "ISK$",
    bitmartNetwork: "ISK",
    addressRegex: TXC_ADDRESS_REGEX,
    addressHint: "Your IskanderCoin address (TXC-format, starts with T, 34 chars)",
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
