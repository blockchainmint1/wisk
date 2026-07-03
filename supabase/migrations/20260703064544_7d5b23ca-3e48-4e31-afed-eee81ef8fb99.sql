ALTER TABLE public.deposits
  ADD COLUMN IF NOT EXISTS amount_source NUMERIC;
COMMENT ON COLUMN public.deposits.amount_source IS 'Actual deposited amount in source-token units (TXC, wTXC, ETH, USDC, ...). Authoritative for 1:1 wrap/unwrap payouts.';