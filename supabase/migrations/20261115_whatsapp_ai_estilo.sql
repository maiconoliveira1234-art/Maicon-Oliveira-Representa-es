-- Style profile and style examples for the WhatsApp reply suggestions.
-- The profile is a short, editable description of how Maicon writes; examples are his real sent replies.

create table if not exists public.whatsapp_ai_estilo (
  id integer primary key default 1 check (id = 1),
  perfil text not null default '',
  ativo boolean not null default true,
  editado_manual boolean not null default false,
  amostras integer not null default 0,
  gerado_em timestamptz,
  atualizado_em timestamptz not null default now()
);

alter table public.whatsapp_ai_estilo enable row level security;

drop policy if exists crm_admin_authenticated on public.whatsapp_ai_estilo;
create policy crm_admin_authenticated on public.whatsapp_ai_estilo
  for all to authenticated
  using (exists (select 1 from public.crm_usuarios_autorizados a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.crm_usuarios_autorizados a where a.user_id = (select auth.uid())));

drop policy if exists whatsapp_ai_estilo_service_role_all on public.whatsapp_ai_estilo;
create policy whatsapp_ai_estilo_service_role_all on public.whatsapp_ai_estilo
  for all to service_role using (true) with check (true);

-- Pairs "customer message -> Maicon's reply". Long digit sequences (CNPJ, phone, boleto) are masked.
-- SECURITY INVOKER: row level security of whatsapp_mensagens applies to the caller.
create or replace function public.whatsapp_estilo_pares(p_limit integer default 200)
returns table (resposta text, pergunta text, enviada_em timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select
    regexp_replace(r.texto, '\d{9,}', '[número]', 'g') as resposta,
    case when q.texto is null then null
         else regexp_replace(q.texto, '\d{9,}', '[número]', 'g') end as pergunta,
    r.recebida_em as enviada_em
  from (
    select m.id, m.contato_map_id, m.recebida_em,
           btrim(regexp_replace(coalesce(nullif(m.transcricao_audio, ''), m.mensagem), '^🎤\s*', '')) as texto
    from public.whatsapp_mensagens m
    where m.direcao = 'enviada'
      and m.tipo_mensagem in ('texto', 'audio')
  ) r
  left join lateral (
    select btrim(regexp_replace(coalesce(nullif(c.transcricao_audio, ''), c.mensagem), '^🎤\s*', '')) as texto
    from public.whatsapp_mensagens c
    where c.contato_map_id = r.contato_map_id
      and c.direcao = 'recebida'
      and c.recebida_em < r.recebida_em
      and c.recebida_em > r.recebida_em - interval '24 hours'
    order by c.recebida_em desc
    limit 1
  ) q on true
  where char_length(r.texto) between 12 and 600
    and r.texto !~* '^https?://'
  order by r.recebida_em desc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

revoke all on function public.whatsapp_estilo_pares(integer) from public, anon;
grant execute on function public.whatsapp_estilo_pares(integer) to authenticated, service_role;
