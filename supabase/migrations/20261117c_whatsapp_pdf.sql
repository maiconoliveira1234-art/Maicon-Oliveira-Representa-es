-- WhatsApp PDFs (tipo_mensagem 'documento'): stored privately and read by AI, same pipeline as images.

alter table public.whatsapp_mensagens add column if not exists midia_nome text;

alter table public.whatsapp_mensagens drop constraint if exists whatsapp_mensagens_tipo_mensagem_ck;
alter table public.whatsapp_mensagens add constraint whatsapp_mensagens_tipo_mensagem_ck
  check (tipo_mensagem = any (array['texto','audio','imagem','documento']));

update storage.buckets
set allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','application/pdf']
where id = 'whatsapp-midia';

select cron.unschedule('promax-whatsapp-audio-retry')
where exists (select 1 from cron.job where jobname = 'promax-whatsapp-audio-retry');

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
    where m.app_package = 'easycoexistence.cloud_api' and m.tipo_mensagem in ('audio','imagem','documento')
      and m.transcricao_audio is null and m.recebida_em > now() - interval '7 days'
      and m.criado_em < now() - interval '2 minutes' and m.transcricao_tentativas < 5
      and ((m.audio_status in ('pendente','erro') and coalesce(m.transcricao_proxima_tentativa, now()) <= now())
        or (m.audio_status = 'transcrevendo' and coalesce(m.transcricao_iniciada_em, m.criado_em) < now() - interval '5 minutes'))
  );
$job$);
