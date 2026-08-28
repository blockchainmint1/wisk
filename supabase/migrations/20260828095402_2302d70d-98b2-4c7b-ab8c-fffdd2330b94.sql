ALTER TABLE public.app_settings RENAME COLUMN low_txc_threshold TO low_isk_threshold;
ALTER TABLE public.app_settings RENAME COLUMN low_wtxc_threshold TO low_wisk_threshold;
ALTER TABLE public.txc_balance_snapshots RENAME COLUMN balance_txc TO balance_isk;
ALTER TABLE public.txc_balance_snapshots RENAME TO isk_balance_snapshots;