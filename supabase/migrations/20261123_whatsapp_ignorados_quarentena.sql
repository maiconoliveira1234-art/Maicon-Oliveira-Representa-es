-- Ignorados com período de segurança de 48 horas (substitui a exclusão imediata de 20261118c).
-- Mensagens de contato "Não é cliente" saem da conversa e vão para whatsapp_mensagens_quarentena:
-- não aparecem no CRM nem disparam transcrição/análise (essas funções não as encontram), mas
-- "Reavaliar" em até 48 h devolve tudo. Depois de 48 h a limpeza horária apaga de vez.
-- Obs.: colunas novas criadas em whatsapp_mensagens no futuro precisam ser criadas aqui também.

create table if not exists public.whatsapp_mensagens_quarentena
  (like public.whatsapp_mensagens including defaults);
alter table public.whatsapp_mensagens_quarentena add column if not exists quarentena_em timestamptz not null default now();
do $$ begin
  alter table public.whatsapp_mensagens_quarentena add primary key (id);
exception when invalid_table_definition then null; end $$;
create index if not exists whatsapp_mensagens_quarentena_contato_idx on public.whatsapp_mensagens_quarentena (contato_map_id);
create index if not exists whatsapp_mensagens_quarentena_em_idx on public.whatsapp_mensagens_quarentena (quarentena_em);
alter table public.whatsapp_mensagens_quarentena enable row level security;
drop policy if exists whatsapp_mensagens_quarentena_service_role_all on public.whatsapp_mensagens_quarentena;
create policy whatsapp_mensagens_quarentena_service_role_all on public.whatsapp_mensagens_quarentena
  for all to service_role using (true) with check (true);

alter table public.whatsapp_contatos_map add column if not exists ignorado_em timestamptz;

-- Mover para a quarentena não é descartar: a foto/PDF continua no Storage até a limpeza final.
create or replace function public.whatsapp_mensagem_descartar_midia()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.midia_path is not null and coalesce(current_setting('whatsapp.movendo', true), '') <> '1' then
    insert into public.whatsapp_midia_descarte(path) values (old.midia_path) on conflict do nothing;
  end if;
  return old;
end;
$$;

-- Move as mensagens de um contato (ou uma só) para a quarentena.
create or replace function public.whatsapp_quarentena_mover(p_contato uuid, p_mensagem uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.whatsapp_mensagens_quarentena
  select (jsonb_populate_record(null::public.whatsapp_mensagens_quarentena,
           to_jsonb(m) || jsonb_build_object('quarentena_em', now()))).*
  from public.whatsapp_mensagens m
  where m.contato_map_id = p_contato and (p_mensagem is null or m.id = p_mensagem)
  on conflict (id) do nothing;
  perform set_config('whatsapp.movendo', '1', true);
  delete from public.whatsapp_mensagens m
  where m.contato_map_id = p_contato and (p_mensagem is null or m.id = p_mensagem);
  perform set_config('whatsapp.movendo', '', true);
end;
$$;

-- Mensagem nova de contato ignorado: vai direto para a quarentena (o webhook recebe a resposta normal).
create or replace function public.whatsapp_mensagem_ignorada_nao_guardar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.contato_map_id is not null and exists (
    select 1 from public.whatsapp_contatos_map c where c.id = new.contato_map_id and c.status = 'ignorado'
  ) then
    perform public.whatsapp_quarentena_mover(new.contato_map_id, new.id);
  end if;
  return null;
end;
$$;

-- Registra quando o contato foi ignorado.
create or replace function public.whatsapp_map_ignorado_zerar()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'ignorado' then
    new.total_mensagens := 0;
    new.cliente_id := null;
    if tg_op = 'INSERT' or old.status is distinct from 'ignorado' then new.ignorado_em := now(); end if;
  else
    new.ignorado_em := null;
  end if;
  return new;
end;
$$;

-- Ignorar: histórico vai para a quarentena. Reavaliar: o que ainda está na quarentena volta.
create or replace function public.whatsapp_map_ignorado_apagar_historico()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ignorado' and old.status is distinct from 'ignorado' then
    perform public.whatsapp_quarentena_mover(new.id);
  elsif old.status = 'ignorado' and new.status is distinct from 'ignorado' then
    insert into public.whatsapp_mensagens
    select (jsonb_populate_record(null::public.whatsapp_mensagens, to_jsonb(q))).*
    from public.whatsapp_mensagens_quarentena q
    where q.contato_map_id = new.id
    on conflict do nothing;
    delete from public.whatsapp_mensagens_quarentena where contato_map_id = new.id;
    update public.whatsapp_contatos_map c set
      total_mensagens = (select count(*) from public.whatsapp_mensagens m where m.contato_map_id = new.id),
      ultima_vez_em = greatest(c.ultima_vez_em,
        coalesce((select max(recebida_em) from public.whatsapp_mensagens m where m.contato_map_id = new.id), c.ultima_vez_em))
    where c.id = new.id;
  end if;
  return null;
end;
$$;

-- Limpeza: quarentena com mais de 48 h sai de vez (fotos/PDFs vão para a fila do Storage).
create or replace function public.whatsapp_quarentena_limpar()
returns integer language plpgsql security definer set search_path = public as $$
declare apagadas integer;
begin
  insert into public.whatsapp_midia_descarte(path)
  select q.midia_path from public.whatsapp_mensagens_quarentena q
  where q.midia_path is not null and q.quarentena_em < now() - interval '48 hours'
  on conflict do nothing;
  delete from public.whatsapp_mensagens_quarentena where quarentena_em < now() - interval '48 hours';
  get diagnostics apagadas = row_count;
  delete from public.whatsapp_ai_correcoes r
  using public.whatsapp_contatos_map c
  where c.id = r.contato_map_id and c.status = 'ignorado'
    and coalesce(c.ignorado_em, '-infinity'::timestamptz) < now() - interval '48 hours';
  return apagadas;
end;
$$;
revoke all on function public.whatsapp_quarentena_limpar() from public, anon, authenticated;
revoke all on function public.whatsapp_quarentena_mover(uuid, uuid) from public, anon, authenticated;

select cron.unschedule('promax-whatsapp-quarentena')
where exists (select 1 from cron.job where jobname = 'promax-whatsapp-quarentena');
select cron.schedule('promax-whatsapp-quarentena', '17 * * * *', $job$ select public.whatsapp_quarentena_limpar(); $job$);

-- Para a lista de contatos: números de WhatsApp de cada cadastro e o que está na quarentena.
create or replace function public.whatsapp_contatos_info()
returns table(contato_map_id uuid, telefones text[], quarentena integer, quarentena_ate timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.crm_usuarios_autorizados a where a.user_id = (select auth.uid())) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select c.id,
    coalesce((select array_agg(n.phone_e164 order by n.phone_e164) from public.whatsapp_numeros_map n where n.contato_map_id = c.id), '{}'),
    (select count(*)::integer from public.whatsapp_mensagens_quarentena q where q.contato_map_id = c.id),
    (select max(q.quarentena_em) + interval '48 hours' from public.whatsapp_mensagens_quarentena q where q.contato_map_id = c.id)
  from public.whatsapp_contatos_map c;
end;
$$;
revoke all on function public.whatsapp_contatos_info() from public, anon;
grant execute on function public.whatsapp_contatos_info() to authenticated;
