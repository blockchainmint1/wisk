# HD Deposit Address Allocator & Recycler

> **Purpose** — share the exact recycling logic we use across the TXC bridge / on-ramp for per-order deposit addresses.
> Works for both EVM (EVM stable/ETH/wTXC) and TXC native (wrap) deposit addresses; the HD counter is reused for every chain.

## 1. Data model

### `hd_address_counter`

Exactly one row. It stores the next fresh index to hand out when recycling cannot find a free index.

```sql
CREATE TABLE public.hd_address_counter (
  id          integer PRIMARY KEY,
  next_index  integer NOT NULL DEFAULT 1,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Bootstrap
INSERT INTO public.hd_address_counter (id, next_index, updated_at)
VALUES (1, 1, now())
ON CONFLICT (id) DO NOTHING;

GRANT SELECT, UPDATE ON public.hd_address_counter TO service_role;
```

- `next_index` starts at `1`.
- `updated_at` is touched whenever the counter is bumped or manually reset.

### `orders`

Each order records the index it was assigned. The deposit address itself is derived deterministically from this index.

```sql
ALTER TABLE public.orders
  ADD COLUMN deposit_index integer NOT NULL DEFAULT 0;

-- Helpful index for the recycler
CREATE INDEX idx_orders_deposit_index_created_at
  ON public.orders (deposit_index, created_at DESC);
```

## 2. Allocating an index

```sql
CREATE OR REPLACE FUNCTION public.allocate_hd_index()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  recycled INTEGER;
  fresh INTEGER;
BEGIN
  -- Recycle: pick the SMALLEST deposit_index whose most-recent use is
  -- older than 1 hour. We never hand back an index that a newer order is
  -- already using.
  SELECT deposit_index INTO recycled
  FROM public.orders o
  WHERE deposit_index > 0
    AND created_at < now() - interval '1 hour'
    AND NOT EXISTS (
      SELECT 1 FROM public.orders o2
      WHERE o2.deposit_index = o.deposit_index
        AND o2.created_at > o.created_at
    )
  ORDER BY deposit_index ASC
  LIMIT 1;

  IF recycled IS NOT NULL THEN
    RETURN recycled;
  END IF;

  -- Nothing to recycle: bump the counter and hand out the new index.
  UPDATE public.hd_address_counter
    SET next_index = next_index + 1, updated_at = now()
    WHERE id = 1
    RETURNING next_index - 1 INTO fresh;
  RETURN fresh;
END;
$function$;

-- Only the service role may call this function.
REVOKE EXECUTE ON FUNCTION public.allocate_hd_index() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.allocate_hd_index() FROM anon;
REVOKE EXECUTE ON FUNCTION public.allocate_hd_index() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_hd_index() TO service_role;
```

### How the rule works

1. Look at every `deposit_index` that has ever been used.
2. For each index, consider only its **most recent** order (`NOT EXISTS ... o2.created_at > o.created_at`).
3. If that most recent order is **older than 1 hour**, the index is considered free.
4. Pick the **smallest** such index (`ORDER BY deposit_index ASC`).
5. If no index is free, bump `hd_address_counter.next_index` and return that fresh index.

This means:

- After a quiet hour, the next allocation will be index `#1` again.
- During busy periods, allocation marches `#1, #2, #3, …` without skipping upward because of a recent re-use on a higher index.
- The 1-hour window is a **fixed reservation**, not a sliding window keyed to order status. Orders that are completed, expired, failed, or still pending all release their index after 1 hour.

## 3. Deriving the deposit address

The index itself is chain-agnostic. The app derives the actual address from the index.

### EVM deposit address

Using `m/44'/60'/0'/0/{index}` from a single bridge mnemonic:

- Index `0` → operator / treasury wallet.
- Index `≥ 1` → per-order customer deposit addresses.

With `ethers` / `viem`:

```ts
const wallet = ethers.HDNodeWallet.fromPhrase(BRIDGE_MNEMONIC);
const derived = wallet.derivePath(`m/44'/60'/0'/0/${index}`);
const depositAddress = derived.address;   // 0x...
```

### TXC native deposit address

For the TXC wrap direction, derive from the same mnemonic but using the TXC BIP84 path:

```ts
const wallet = bip39.mnemonicToSeedSync(BRIDGE_MNEMONIC);
const root = bip32.fromSeed(wallet);
const child = root.derivePath(`m/84'/0'/0'/0/${index}`);
const { address } = bitcoin.payments.p2wpkh({
  pubkey: child.publicKey,
  network: txcNetwork,
});
```

## 4. Application call-site

```ts
const { data: idx, error } = await supabaseAdmin.rpc("allocate_hd_index");
if (error || typeof idx !== "number") {
  throw new Error("Failed to allocate deposit index: " + error?.message);
}

const isWrap = sourceChain === "txc";
const depositAddress = deriveDepositAddress(idx, isWrap ? "txc" : "evm");

const { data: order } = await supabaseAdmin
  .from("orders")
  .insert({
    deposit_address: isWrap ? depositAddress : depositAddress.toLowerCase(),
    deposit_index: idx,
    /* ... other order fields ... */
  })
  .select("public_id")
  .single();
```

## 5. Why not just increment forever?

- **Small working set** — wallet scans / block filters only need to watch a small, dense range of addresses.
- **Cheap sweeps** — on UTXO chains, fewer addresses mean fewer inputs to manage when consolidating.
- **Human-friendly** — admin UIs, Telegram alerts, and block explorers show addresses like `#1`, `#2`, `#3` in order, making reconciliation obvious.
- **Predictable load** — no unbounded growth of per-order addresses in the database or scanner.

## 6. Resetting the counter

If you ever want a clean slate, reset the counter to `1`:

```sql
UPDATE public.hd_address_counter
   SET next_index = 1,
       updated_at = now()
 WHERE id = 1;
```

This is safe because the recycler will still skip over any index whose most-recent order is within the 1-hour window. If index `#1` is locked, the next allocation will simply be the smallest free index, or a fresh one if the pool is exhausted.

## 7. Race safety & hardening

- **Counter bump is atomic** — `UPDATE ... RETURNING` guarantees only one caller gets each fresh index.
- **Recycle SELECT is not locked** — two simultaneous calls could theoretically read the same free index. If this is a concern, add one of:
  - A partial unique index on live orders:
    ```sql
    CREATE UNIQUE INDEX idx_orders_one_live_per_index
    ON public.orders (deposit_index)
    WHERE paid_tx_hash IS NULL;
    ```
    The second `INSERT` would fail and the caller can retry.
  - Or use `SELECT ... FOR UPDATE SKIP LOCKED` inside the recycle CTE (more complex, but removes the unique-index constraint).

## 8. Tuning the reservation window

Change `interval '1 hour'` in the function to any desired window. Trade-offs:

- **Shorter window** → addresses recycle faster, but a slow-paying customer might see their address reassigned to a new order.
- **Longer window** → safer for slow payers, but addresses recycle slower and the counter grows more.

Our default is **1 hour**, matching the order expiry shown to customers.

## 9. TL;DR

- One counter table, one `orders.deposit_index` column.
- Recycle the smallest index whose latest order is older than 1 hour.
- Only bump the counter when nothing is recyclable.
- Address derivation is deterministic from the index and chain.
- Resetting the counter to 1 is always safe; the recycler protects live indices.
