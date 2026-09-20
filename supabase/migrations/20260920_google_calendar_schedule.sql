create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
-- Check the named timezone so the job remains at 03:00 if UTC offsets change.
-- The hourly trigger only sends a request at 03:00, once per local day.
select cron.schedule('promax-google-calendar-3h', '0 * * * *', $job$
  select net.http_post(
    url := 'https://ljrzmbxposgfxcymamwk.supabase.co/functions/v1/google-calendar/sync',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || cron_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  ) from public.google_calendar_connection
  where id and refresh_token is not null
    and extract(hour from now() at time zone 'America/Sao_Paulo') = 3
    and last_sync_date is distinct from (now() at time zone 'America/Sao_Paulo')::date;
$job$);
