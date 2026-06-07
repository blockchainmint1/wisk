// Destination-asset registry.
// - TXC: TEXITcoin native chain, base58 P2PKH starting with `T` (34 chars).
// - ISK$: Iskander chain — its own network with TWO address formats:
//     • Legacy P2PKH (pubKeyHash 0x2d, P2SH 0x2c) → base58 starting with `K`
//     • Native SegWit P2WPKH (bech32 hrp `isk`) → starts with `isk1q…`
//   Bitmart accepts both; we accept either at order time.

// Base58 alphabet (no 0, O, I, l)
const B58 = "[1-9A-HJ-NP-Za-km-z]";
// Bech32 alphabet
const BECH32 = "[qpzry9x8gf2tvdw0s3jn54khce6mua7l]";

const TXC_ADDRESS_REGEX = new RegExp(`^T${B58}{33}$`);

// ISK legacy (K-prefix base58, ~34 chars) OR ISK native SegWit (isk1q…, bech32).
// Bech32 P2WPKH is `isk1q` + 38 chars (total 43); P2WSH is `isk1q` + 58 chars.
// We allow the broader bech32 range to be future-proof.
const ISK_ADDRESS_REGEX = new RegExp(
  `^(K${B58}{33}|isk1${BECH32}{6,87})$`,
);

export const DESTINATIONS = {
  TXC: {
    key: "TXC",
    label: "TXC",
    bitmartSymbol: "TXC_USDT",
    bitmartCurrency: "TXC",
    bitmartNetwork: "TXC",
    addressRegex: TXC_ADDRESS_REGEX,
    addressHint: "Your native TEXITcoin address (starts with T, 34 chars)",
    walletUrl: "https://wallet.texitcoin.org",
  },
  "ISK$": {
    key: "ISK$",
    label: "ISK$",
    bitmartSymbol: "ISK$_USDT",
    bitmartCurrency: "ISK$",
    bitmartNetwork: "ISK",
    addressRegex: ISK_ADDRESS_REGEX,
    addressHint: "Your Iskander address — legacy (K…) or SegWit (isk1q…)",
    walletUrl: "https://wallet.iskandercoin.com",
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
