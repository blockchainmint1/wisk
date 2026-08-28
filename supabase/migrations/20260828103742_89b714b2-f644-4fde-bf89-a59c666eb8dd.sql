-- lovable-cron-fallback-reviewed: 1440 runs/day; chain-deposit watcher requires continuous polling — no push/webhook exists for arbitrary address activity on the ISK or EVM chains
SELECT cron.unschedule('swap-tick');
SELECT cron.schedule(
  'swap-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wisk.iskandercoin.com/api/public/hooks/swap-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'sb_publishable_eEYTAB0qXphIftk3JD2CAA_rKaYXSBe'
    ),
    body := '{}'::jsonb
  );
  $$
);