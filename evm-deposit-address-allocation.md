# EVM Deposit Address Allocation & Recycling

> **One-paragraph summary** — We serve EVM deposit addresses from a single HD wallet. Slot `0` is the operator/treasury wallet. Slots `1, 2, 3…` are handed out to customers one-per-order, held for a fixed reservation window (currently **1 hour**), then recycled back to the pool. If no free slot exists, we mint a fresh one by bumping a counter. The result is a dense, predictable, small set of addresses that are easy to scan, sweep, and reconcile.

---

## 1. The HD path

All EVM deposit addresses are derived from one mnemonic using the standard Ethereum account path:

```
m/44'/60'/0'/0/{index}
```

- **Index `0`** — Operator / treasury wallet. This is the hot wallet that holds wTXC + ETH for gas and pays out unwraps.
- **Index `≥ 1`** — Per-order customer deposit addresses. A customer sends stables, ETH, or wTXC here.

In code (ethers / viem):

```ts
const wallet = ethers.HDNodeWallet.fromPhrase(BRIDGE_MNEMONIC);
const derived = wallet.derivePath(`m/44'/60'/0'/0/${index}`);
const depositAddress = derived.address; // 0x...
```

---

## 2. How an address is allocated

Two pieces of state drive allocation:

1. **`hd_address_counter`** — a single-row table storing the next fresh index to use when nothing is recyclable.
2. **`orders.deposit_index`** — each order records the index it was assigned.

Allocation runs in this order:

### Step 1: Try to recycle

Look for the **smallest** index whose **most recent** order is older than the reservation window (currently 1 hour):

```sql
SELECT deposit_index
FROM   orders o
WHERE  deposit_index > 0
  AND  created_at < now() - interval '1 hour'
  AND  NOT EXISTS (
         SELECT 1 FROM orders o2
         WHERE  o2.deposit_index = o.deposit_index
           AND  o2.created_at > o.created_at
       )
ORDER BY deposit_index ASC
LIMIT 1;
```

Key points:

- We only look at the **most recent** order for each index.
- If that most recent order is **older than 1 hour**, the slot is considered free.
- We always pick the **smallest** free index, so the pool fills from `#1` upward.

### Step 2: Mint a fresh index

If nothing is recyclable, bump the counter:

```sql
UPDATE hd_address_counter
   SET next_index = next_index + 1, updated_at = now()
 WHERE id = 1
RETURNING next_index - 1;
```

This guarantees a dense sequence: `#1, #2, #3…` rather than forever-growing gaps.

---

## 3. The reservation window

The 1-hour window is a **fixed reservation**, not a sliding window tied to order status.

- Order completed → address is still reserved for 1 hour.
- Order expired → address is still reserved for 1 hour.
- Order failed → address is still reserved for 1 hour.
- Order pending → address is still reserved for 1 hour.

After the hour, the slot goes back into the pool. This matches the order expiry shown to customers and gives a slow payer a predictable grace period.

**Tunable:** change `interval '1 hour'` in the allocation function to any duration.

- Shorter window → faster recycling, but a slow payer might see their address reassigned.
- Longer window → safer for slow payers, but the address set grows larger.

---

## 4. Why this works well

| Benefit | Why it matters |
|--------|----------------|
| **Dense address set** | Wallet scans / block filters only watch a small, contiguous range. |
| **Cheap sweeps** | Fewer addresses means fewer inputs to consolidate when sweeping wTXC. |
| **Human-friendly** | Admin UIs and alerts can refer to “slot #1, #2, #3…”. |
| **Predictable load** | No unbounded growth of per-order addresses in the DB or scanner. |
| **Race-safe** | The counter bump uses `UPDATE … RETURNING`, so two callers cannot claim the same fresh index. |

---

## 5. Example lifecycle

1. Order A is created → allocated slot `#1`.
2. Order B is created 5 minutes later → slot `#2`.
3. Order A completes 10 minutes later → slot `#1` is still reserved.
4. One hour after Order A was created → slot `#1` becomes recyclable.
5. Order C is created → allocated slot `#1` again.
6. Order D is created while `#1`, `#2`, `#3` are all still live → allocated slot `#4`.

---

## 6. Resetting the counter

If you ever want a clean slate, reset the counter to `1`:

```sql
UPDATE public.hd_address_counter
   SET next_index = 1,
       updated_at = now()
 WHERE id = 1;
```

This is safe because the recycler will still skip over any index whose most-recent order is within the 1-hour window. If `#1` is currently reserved, the next allocation will simply take the smallest free slot or mint a fresh one.

---

## 7. Race safety note

The recycle `SELECT` is not locked. In very high concurrency, two simultaneous calls could theoretically read the same free index. If that is a concern, add a partial unique index on “live” orders:

```sql
CREATE UNIQUE INDEX idx_orders_one_live_per_index
ON public.orders (deposit_index)
WHERE paid_tx_hash IS NULL;
```

The second `INSERT` would fail and the caller can retry.

---

## 8. TL;DR for sharing

- One HD wallet, path `m/44'/60'/0'/0/{index}`.
- Index `0` = operator treasury.
- Index `≥ 1` = customer deposit address.
- Allocation picks the smallest index whose latest order is older than 1 hour.
- If nothing is free, bump a counter and hand out a fresh index.
- Addresses are deterministic, dense, and easy to scan/sweep.
- The 1-hour window is tunable and applies regardless of order status.
