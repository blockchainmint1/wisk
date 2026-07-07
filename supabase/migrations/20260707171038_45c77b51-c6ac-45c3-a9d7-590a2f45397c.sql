-- EMERGENCY: halt in-flight orders whose "payment" is a replay of a tx_hash
-- previously credited to an older order. HD deposit addresses get recycled
-- after 1h, and the scanner was matching any incoming tx at the address
-- without checking whether that tx was already credited elsewhere.
UPDATE public.orders o
SET status = 'failed',
    error_message = COALESCE(error_message,'') ||
      ' [halted: replay of tx_hash previously credited to another order]',
    updated_at = now()
WHERE o.status IN ('sending','payment_detected','awaiting_payment','confirmed','buying_on_bitmart')
  AND o.paid_tx_hash IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.orders o2
    WHERE o2.paid_tx_hash = o.paid_tx_hash
      AND o2.id <> o.id
      AND o2.created_at < o.created_at
  );

-- Prevent the same on-chain deposit tx from ever being credited to two orders.
CREATE UNIQUE INDEX IF NOT EXISTS deposits_chain_tx_unique
  ON public.deposits (chain, tx_hash, log_index);