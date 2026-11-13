-- WRKOUT scheduler: calls the app every 15 minutes (Garmin polling, morning push,
-- missed-session handling, Sunday review, rolling plan detail).
-- Run once in Supabase → SQL Editor after replacing <CRON_SECRET> with your secret.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'wrkout-tick',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://wrkout.hermanostengen.com/api/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
    timeout_milliseconds := 5000
  );
  $$
);

-- Recent runs:  select * from cron.job_run_details order by start_time desc limit 10;
-- HTTP results: select * from net._http_response order by created desc limit 10;
-- Remove:       select cron.unschedule('wrkout-tick');
