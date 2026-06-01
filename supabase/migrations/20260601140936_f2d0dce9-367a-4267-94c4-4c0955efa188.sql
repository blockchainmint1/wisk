CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE UNIQUE INDEX IF NOT EXISTS deposits_chain_tx_log_uidx
  ON public.deposits (chain, tx_hash, log_index);