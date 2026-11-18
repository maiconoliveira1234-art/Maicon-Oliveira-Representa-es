-- Dicionário de termos aprendidos para o reconhecimento de produtos do WhatsApp.
-- O dicionário base (abreviações conhecidas) fica no código: src/lib/productMatch.ts.
-- Aqui ficam os termos que a IA deduz das correções (status 'sugerido') e que só passam a valer
-- depois de aprovados ('ativo'). Termos recusados nunca são sugeridos de novo.

create table if not exists public.whatsapp_dicionario_termos (
  id uuid primary key default gen_random_uuid(),
  termo text not null check (length(termo) between 1 and 60),
  atributo text not null check (atributo in ('marca','familia','especie','porte','fase','sabor','cuidado','raca','sinonimo')),
  valor text not null check (length(valor) between 1 and 80),
  -- null = vale para todos os clientes; preenchido = apelido usado só por este cliente.
  cliente_id uuid references public.clientes(id) on delete cascade,
  status text not null default 'sugerido' check (status in ('sugerido','ativo','recusado','inativo')),
  origem text not null default 'aprendido' check (origem in ('aprendido','manual')),
  ocorrencias integer not null default 1,
  clientes_distintos uuid[] not null default '{}',
  -- Últimos exemplos: [{mensagem_id, expressao, produto}]
  exemplos jsonb not null default '[]'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  decidido_em timestamptz,
  decidido_por uuid
);

create unique index if not exists whatsapp_dicionario_termos_unico
  on public.whatsapp_dicionario_termos (termo, atributo, valor, coalesce(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists whatsapp_dicionario_termos_status_idx on public.whatsapp_dicionario_termos (status, ocorrencias desc);

alter table public.whatsapp_dicionario_termos enable row level security;

drop policy if exists crm_admin_authenticated on public.whatsapp_dicionario_termos;
create policy crm_admin_authenticated on public.whatsapp_dicionario_termos
  for all to authenticated
  using (exists (select 1 from public.crm_usuarios_autorizados a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.crm_usuarios_autorizados a where a.user_id = (select auth.uid())));

drop policy if exists whatsapp_dicionario_termos_service_role_all on public.whatsapp_dicionario_termos;
create policy whatsapp_dicionario_termos_service_role_all on public.whatsapp_dicionario_termos
  for all to service_role using (true) with check (true);

-- Registra uma sugestão vinda de uma confirmação. A mesma mensagem não conta duas vezes,
-- e termos recusados ou já ativos não voltam para a fila.
create or replace function public.registrar_termo_sugerido(
  p_termo text, p_atributo text, p_valor text, p_cliente_id uuid,
  p_mensagem_id uuid, p_expressao text, p_produto text, p_cliente_origem uuid
) returns void
language plpgsql
set search_path = public
as $$
declare
  atual public.whatsapp_dicionario_termos%rowtype;
  exemplo jsonb := jsonb_build_object('mensagem_id', p_mensagem_id, 'expressao', left(p_expressao, 200), 'produto', left(p_produto, 120));
begin
  select * into atual from public.whatsapp_dicionario_termos
   where termo = p_termo and atributo = p_atributo and valor = p_valor
     and coalesce(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p_cliente_id, '00000000-0000-0000-0000-000000000000'::uuid)
   for update;
  if not found then
    insert into public.whatsapp_dicionario_termos (termo, atributo, valor, cliente_id, clientes_distintos, exemplos)
    values (p_termo, p_atributo, p_valor, p_cliente_id,
            case when p_cliente_origem is null then '{}' else array[p_cliente_origem] end,
            jsonb_build_array(exemplo))
    on conflict do nothing;
    return;
  end if;
  if atual.status <> 'sugerido' then return; end if;
  if p_mensagem_id is not null and atual.exemplos @> jsonb_build_array(jsonb_build_object('mensagem_id', p_mensagem_id)) then return; end if;
  update public.whatsapp_dicionario_termos set
    ocorrencias = ocorrencias + 1,
    clientes_distintos = case when p_cliente_origem is null or p_cliente_origem = any(clientes_distintos)
      then clientes_distintos else clientes_distintos || p_cliente_origem end,
    exemplos = (select coalesce(jsonb_agg(e), '[]'::jsonb) from (
      select e from jsonb_array_elements(atual.exemplos || jsonb_build_array(exemplo)) with ordinality as t(e, n)
      order by n desc limit 5) x),
    atualizado_em = now()
  where id = atual.id;
end;
$$;
revoke all on function public.registrar_termo_sugerido(text,text,text,uuid,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.registrar_termo_sugerido(text,text,text,uuid,uuid,text,text,uuid) to service_role;

-- Quantas vezes cada produto foi faturado no último ano (todos os clientes).
-- Usado só para desempatar produtos igualmente compatíveis com o pedido.
create or replace function public.produtos_popularidade()
returns table (produto_id uuid, vendas bigint)
language sql stable
set search_path = public
as $$
  select h.produto_id, count(*)::bigint
  from public.hist_vendas h
  where h.produto_id is not null and h.faturamento >= (current_date - 365)
  group by h.produto_id
$$;
revoke all on function public.produtos_popularidade() from public, anon, authenticated;
grant execute on function public.produtos_popularidade() to service_role;
