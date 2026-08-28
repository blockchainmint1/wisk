// Destination-asset registry.
// - ISK:  Iskander Coin native chain. Two address formats:
//     • Legacy P2PKH → base58 starting with `T`
//     • Native SegWit → starts with `isk1q…`
// - wISK: ERC-20 on Ethereum mainnet, 1:1 backed by ISK held in the
//   bridge operator wallet. Address = any Ethereum EOA (`0x…`).

const B58 = "[1-9A-HJ-NP-Za-km-z]";
const BECH32 = "[qpzry9x8gf2tvdw0s3jn54khce6mua7l]";

const ISK_ADDRESS_REGEX = new RegExp(`^(T${B58}{33}|isk1${BECH32}{6,87})$`);
const WISK_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export const DESTINATIONS = {
  ISK: {
    key: "ISK",
    label: "ISK",
    kind: "native" as const,
    bitmartSymbol: "ISK_USDT",
    bitmartCurrency: "ISK",
    bitmartNetwork: "ISK",
    addressRegex: ISK_ADDRESS_REGEX,
    addressHint: "Your Iskander Coin address — legacy (T…) or SegWit (isk1q…)",
    walletUrl: "https://wallet.iskandercoin.com",
    explorer: "https://mempool.iskandercoin.com",
  },
  wISK: {
    key: "wISK",
    label: "wISK",
    kind: "erc20" as const,
    bitmartSymbol: "ISK_USDT", // priced identically to ISK for on-ramp quotes
    bitmartCurrency: "ISK",
    bitmartNetwork: "ISK",
    addressRegex: WISK_ADDRESS_REGEX,
    addressHint: "Your Ethereum address (0x…) to receive wISK (ERC-20)",
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
