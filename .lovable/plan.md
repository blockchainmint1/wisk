## Add ISK$ destination support

### Research result
- TXC and ISK$ **share an address format**: Base58, exactly 34 chars, must start with `T`. Regex: `^T[1-9A-HJ-NP-Za-km-z]{33}$`. (ISK$ is an Omni Layer token on the TXC chain — confirmed via BitMart's official listing.)
- Bitmart pair: `ISK$_USDT`. Withdrawal network code: `ISK`.
- All other settings (premium, min/max USD, expiry, notify threshold) shared with TXC.

### 1. New destination-asset registry
Create `src/lib/destinations.ts`:
```ts
export const DESTINATIONS = {
  TXC:   { key: "TXC",  label: "TXC",  bitmartSymbol: "TXC_USDT",  bitmartNetwork: "TXC", addressRegex: /^T[1-9A-HJ-NP-Za-km-z]{33}$/ },
  "ISK$":{ key: "ISK$", label: "ISK$", bitmartSymbol: "ISK$_USDT", bitmartNetwork: "ISK", addressRegex: /^T[1-9A-HJ-NP-Za-km-z]{33}$/ },
} as const;
export type DestAsset = keyof typeof DESTINATIONS;
```

### 2. Bitmart client — make symbol/network parameters
`src/lib/bitmart.server.ts`:
- `getSpotPrice(symbol)` (replaces `getTxcSpotPrice`)
- `submitMarketBuy({ symbol, notionalUsdt })`
- `submitWithdrawal({ currency, network, amount, address })`
- Keep `getBalances()` as-is.

### 3. Database migration
Add to `orders`:
- `dest_asset TEXT NOT NULL DEFAULT 'TXC'` (backfill = `'TXC'`)

(Leave existing `dest_txc_address`, `quoted_txc_out`, `quoted_txc_per_usd`, `bitmart_filled_txc`, `txc_tx_hash` column names — they'll hold the destination asset's values regardless. Renaming would churn lots of code with no functional gain.)

### 4. Server functions
- `getQuote` → accept optional `destAsset` (default `TXC`), price using that asset's Bitmart symbol.
- `createOrder` → accept `destAsset`, validate `destAddress` against `DESTINATIONS[destAsset].addressRegex`, store `dest_asset`, price/buy via the right symbol.
- `getOrder` → return `dest_asset` and a label.
- Swap-tick worker (`api/public/hooks/swap-tick.ts`) → use the order's `dest_asset` for spot price, market buy symbol, and withdrawal currency/network.
- `notifyOrderEvent` → include asset in the message (`"… you'll receive X ISK$"`).

### 5. UI
- Swap form: add a small destination toggle (TXC / ISK$) above the address input. Address-format hint text becomes asset-aware. Quote re-fetch keyed on the selected asset.
- Order detail page: replace hard-coded "TXC" labels with the order's `dest_asset`.

### 6. Admin
Already monitoring TXC / ISK$ / USDT balances. Nothing to do here.

### Out of scope
- No per-asset premium/min/max/expiry settings (you chose shared settings).
- No new HD-wallet logic — deposit addresses are EVM-side and unaffected.
- TXC P2SH addresses (research couldn't confirm a version byte). Validator only accepts P2PKH (`T…`), which matches every ISK$/TXC address seen in the wild.

### Technical risks
- `ISK$` contains `$` — safe in JSON, regex, and Bitmart's symbol string, but I'll add a small enum guard to keep it from leaking into URL paths or SQL identifiers.
- Existing rows have no `dest_asset`; the `DEFAULT 'TXC'` + `NOT NULL` covers them.
