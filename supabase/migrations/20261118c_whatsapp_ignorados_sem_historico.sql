-- Contatos marcados como "Não é cliente" (status 'ignorado') não guardam histórico.
-- O contato continua cadastrado (para ser reconhecido como ignorado), mas:
--   1) ao ser ignorado, todas as mensagens dele são apagadas (análises de pedido e proteções
--      de retenção vão junto por cascata; correções de resposta dele também);
--   2) mensagens novas dele são apagadas no mesmo instante em que são gravadas. Assim os
--      webhooks (Meta, easyCoexistence, app Android) continuam recebendo a resposta normal e
--      não entram em reenvio, e transcrição/análise não encontram a mensagem e param;
--   3) fotos/PDFs dessas mensagens entram numa fila e saem do Storage na limpeza diária.
-- "Reavaliar" volta o contato para pendente; só mensagens novas passam a ser guardadas.

-- Fila de arquivos do Storage a remover (o banco não pode apagar arquivos do Storage direto).
create table if not exists public.whatsapp_midia_descarte (
  path text primary key,
  criado_em timestamptz not null default now()
);
alter table public.whatsapp_midia_descarte enable row level security;
drop policy if exists whatsapp_midia_descarte_service_role_all on public.whatsapp_midia_descarte;
create policy whatsapp_midia_descarte_service_role_all on public.whatsapp_midia_descarte
  for all to service_role using (true) with check (true);

-- Toda mensagem apagada (por qualquer motivo) manda sua foto/PDF para a fila.
create or replace function public.whatsapp_mensagem_descartar_midia()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.midia_path is not null then
    insert into public.whatsapp_midia_descarte(path) values (old.midia_path) on conflict do nothing;
  end if;
  return old;
end;
$$;
drop trigger if exists whatsapp_mensagem_descartar_midia_trigger on public.whatsapp_mensagens;
create trigger whatsapp_mensagem_descartar_midia_trigger
  after delete on public.whatsapp_mensagens
  for each row execute function public.whatsapp_mensagem_descartar_midia();

-- Mensagem nova de contato ignorado: apagada logo após gravar.
create or replace function public.whatsapp_mensagem_ignorada_nao_guardar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.contato_map_id is not null and exists (
    select 1 from public.whatsapp_contatos_map c where c.id = new.contato_map_id and c.status = 'ignorado'
  ) then
    delete from public.whatsapp_mensagens where id = new.id;
  end if;
  return null;
end;
$$;
drop trigger if exists whatsapp_mensagem_ignorada_trigger on public.whatsapp_mensagens;
create trigger whatsapp_mensagem_ignorada_trigger
  after insert on public.whatsapp_mensagens
  for each row execute function public.whatsapp_mensagem_ignorada_nao_guardar();

-- Contato ignorado não acumula contagem de mensagens.
create or replace function public.whatsapp_map_ignorado_zerar()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'ignorado' then
    new.total_mensagens := 0;
    new.cliente_id := null;
  end if;
  return new;
end;
$$;
drop trigger if exists whatsapp_map_ignorado_zerar_trigger on public.whatsapp_contatos_map;
create trigger whatsapp_map_ignorado_zerar_trigger
  before insert or update on public.whatsapp_contatos_map
  for each row execute function public.whatsapp_map_ignorado_zerar();

-- Ao marcar "Não é cliente": apaga o histórico do contato.
create or replace function public.whatsapp_map_ignorado_apagar_historico()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ignorado' and old.status is distinct from 'ignorado' then
    delete from public.whatsapp_mensagens where contato_map_id = new.id;
    delete from public.whatsapp_ai_correcoes where contato_map_id = new.id;
  end if;
  return null;
end;
$$;
drop trigger if exists whatsapp_map_ignorado_apagar_historico_trigger on public.whatsapp_contatos_map;
create trigger whatsapp_map_ignorado_apagar_historico_trigger
  after update of status on public.whatsapp_contatos_map
  for each row execute function public.whatsapp_map_ignorado_apagar_historico();

-- Limpeza única: contatos que já estavam ignorados.
delete from public.whatsapp_mensagens m
using public.whatsapp_contatos_map c
where c.id = m.contato_map_id and c.status = 'ignorado';
delete from public.whatsapp_ai_correcoes r
using public.whatsapp_contatos_map c
where c.id = r.contato_map_id and c.status = 'ignorado';
update public.whatsapp_contatos_map set total_mensagens = 0 where status = 'ignorado' and total_mensagens <> 0;

-- A limpeza diária de mídia também roda quando há arquivos na fila de descarte.
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
  where exists (select 1 from public.whatsapp_midia_descarte)
     or exists (
    select 1 from public.whatsapp_mensagens m
    where m.midia_path is not null and m.recebida_em < now() - interval '365 days'
  );
$job$);
