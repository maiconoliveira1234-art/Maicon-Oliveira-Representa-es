-- Automatic retry of WhatsApp audio transcriptions that failed for temporary reasons
-- (provider quota/overload, network) or got stuck in "transcrevendo".

alter table public.whatsapp_mensagens
  add column if not exists transcricao_tentativas integer not null default 0,
  add column if not exists transcricao_proxima_tentativa timestamptz,
  add column if not exists transcricao_iniciada_em timestamptz;

create index if not exists whatsapp_mensagens_audio_retry_idx
  on public.whatsapp_mensagens (recebida_em desc)
  where tipo_mensagem = 'audio' and transcricao_audio is null;

-- Token the cron job uses to call the sweep. Readable only by service_role.
create table if not exists public.whatsapp_audio_cron (
  id boolean primary key default true check (id),
  token text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
alter table public.whatsapp_audio_cron enable row level security;
revoke all on public.whatsapp_audio_cron from anon, authenticated;
insert into public.whatsapp_audio_cron default values on conflict (id) do nothing;

select cron.unschedule('promax-whatsapp-audio-retry')
where exists (select 1 from cron.job where jobname = 'promax-whatsapp-audio-retry');

-- Every 3 minutes; only calls the function when there is something to retry.
select cron.schedule('promax-whatsapp-audio-retry', '*/3 * * * *', $job$
  select net.http_post(
    url := 'https://ljrzmbxposgfxcymamwk.supabase.co/functions/v1/whatsapp-cloud-audio-transcribe',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || c.token),
    body := '{"sweep":true}'::jsonb,
    timeout_milliseconds := 140000
  )
  from public.whatsapp_audio_cron c
  where exists (
    select 1 from public.whatsapp_mensagens m
    where m.app_package = 'easycoexistence.cloud_api' and m.tipo_mensagem = 'audio'
      and m.transcricao_audio is null and m.recebida_em > now() - interval '7 days'
      and m.criado_em < now() - interval '2 minutes' and m.transcricao_tentativas < 5
      and ((m.audio_status in ('pendente','erro') and coalesce(m.transcricao_proxima_tentativa, now()) <= now())
        or (m.audio_status = 'transcrevendo' and coalesce(m.transcricao_iniciada_em, m.criado_em) < now() - interval '5 minutes'))
  );
$job$);
