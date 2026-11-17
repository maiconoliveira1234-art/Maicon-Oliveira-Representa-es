-- WhatsApp images: stored privately and read by AI (same retry pipeline as audio).
-- tipo_mensagem = 'imagem'; the reading goes to transcricao_audio and mensagem gets "📷 legenda + leitura".

alter table public.whatsapp_mensagens
  add column if not exists midia_legenda text,
  add column if not exists midia_path text;

alter table public.whatsapp_mensagens drop constraint if exists whatsapp_mensagens_tipo_mensagem_ck;
alter table public.whatsapp_mensagens add constraint whatsapp_mensagens_tipo_mensagem_ck
  check (tipo_mensagem = any (array['texto','audio','imagem']));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('whatsapp-midia', 'whatsapp-midia', false, 16777216, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do nothing;

-- Only authorized CRM users can view the photos (signed URLs); writes are done by the service role.
drop policy if exists whatsapp_midia_crm_read on storage.objects;
create policy whatsapp_midia_crm_read on storage.objects
  for select to authenticated
  using (bucket_id = 'whatsapp-midia'
    and exists (select 1 from public.crm_usuarios_autorizados a where a.user_id = (select auth.uid())));

-- Retry job now covers images too.
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
    where m.app_package = 'easycoexistence.cloud_api' and m.tipo_mensagem in ('audio','imagem')
      and m.transcricao_audio is null and m.recebida_em > now() - interval '7 days'
      and m.criado_em < now() - interval '2 minutes' and m.transcricao_tentativas < 5
      and ((m.audio_status in ('pendente','erro') and coalesce(m.transcricao_proxima_tentativa, now()) <= now())
        or (m.audio_status = 'transcrevendo' and coalesce(m.transcricao_iniciada_em, m.criado_em) < now() - interval '5 minutes'))
  );
$job$);
