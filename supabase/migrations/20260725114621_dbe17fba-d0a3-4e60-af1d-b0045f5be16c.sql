UPDATE public.orders
SET status = 'confirmed', send_attempts = 0, dest_tx_hash = NULL
WHERE status = 'sending' AND dest_tx_hash IS NULL AND dest_asset = 'wTXC';