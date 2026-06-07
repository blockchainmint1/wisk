ALTER TABLE public.orders RENAME COLUMN quoted_txc_out TO quoted_dest_out;
ALTER TABLE public.orders RENAME COLUMN quoted_txc_per_usd TO quoted_dest_per_usd;
ALTER TABLE public.orders RENAME COLUMN dest_txc_address TO dest_address;
ALTER TABLE public.orders RENAME COLUMN txc_tx_hash TO dest_tx_hash;
ALTER TABLE public.orders RENAME COLUMN txc_fee_sats TO dest_fee_sats;
ALTER TABLE public.orders RENAME COLUMN txc_from_address TO dest_from_address;
ALTER TABLE public.orders RENAME COLUMN bitmart_filled_txc TO bitmart_filled_dest;