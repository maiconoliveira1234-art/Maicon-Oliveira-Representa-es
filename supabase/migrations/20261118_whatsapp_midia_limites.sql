-- Limites de armazenamento do modulo WhatsApp (plano Free: 500 MB de banco e 1 GB de arquivos).

-- 1) Cada foto/PDF guardado pode ter no maximo 2 MB; acima disso so a descricao da IA fica no CRM.
update storage.buckets set file_size_limit = 2097152 where id = 'whatsapp-midia';

-- 2) Uso atual, para o alerta de 70% no CRM. Apenas usuarios autorizados do CRM.
create or replace function public.whatsapp_uso_armazenamento()
returns table(armazenamento_bytes bigint, armazenamento_limite bigint, banco_bytes bigint, banco_limite bigint)
language plpgsql
stable
security definer
set search_path = public, storage
as $$
begin
  if not exists (select 1 from public.crm_usuarios_autorizados a where a.user_id = (select auth.uid())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query select
    coalesce((select sum((o.metadata->>'size')::bigint) from storage.objects o), 0)::bigint,
    1073741824::bigint,
    pg_database_size(current_database())::bigint,
    524288000::bigint;
end;
$$;
revoke all on function public.whatsapp_uso_armazenamento() from public, anon;
grant execute on function public.whatsapp_uso_armazenamento() to authenticated;

-- 3) Fotos e PDFs com mais de 12 meses saem do Storage todo dia; a descricao da IA continua na mensagem.
select cron.unschedule('promax-whatsapp-midia-limpeza')
where exists (select 1 from cron.job where jobname = 'promax-whatsapp-midia-limpeza');

select cron.schedule('promax-whatsapp-midia-limpeza', '10 7 * * *', $job$
  select net.http_post(
    url := 'https://ljrzmbxposgfxcymamwk.supabase.co/functions/v1/whatsapp-midia-limpeza',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || c.token),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
  from public.whatsapp_audio_cron c
  where exists (
    select 1 from public.whatsapp_mensagens m
    where m.midia_path is not null and m.recebida_em < now() - interval '365 days'
  );
$job$);
