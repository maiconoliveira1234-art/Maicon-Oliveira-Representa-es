-- Uso e custo das chamadas de IA feitas pelas edge functions.
-- Cada resposta cobrada pelo provedor vira uma linha, gravada por supabase/functions/_shared/llm.ts
-- com os tokens que a própria API informou. O custo é calculado na hora, com a tabela de preços
-- vigente, para que uma mudança de preço não altere o histórico.

create table if not exists public.ia_uso (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  -- sugestao, estilo, pedido, imagem, pdf, teste
  tarefa text not null check (length(tarefa) between 1 and 40),
  provedor text not null check (provedor in ('anthropic','google')),
  modelo text not null check (length(modelo) between 1 and 80),
  tokens_entrada integer not null default 0 check (tokens_entrada >= 0),
  tokens_saida integer not null default 0 check (tokens_saida >= 0),
  tokens_cache_escrita integer not null default 0 check (tokens_cache_escrita >= 0),
  tokens_cache_leitura integer not null default 0 check (tokens_cache_leitura >= 0),
  -- null quando o preço do modelo não está na tabela do llm.ts
  custo_usd numeric(14,8) check (custo_usd is null or custo_usd >= 0)
);

create index if not exists ia_uso_criado_em_idx on public.ia_uso (criado_em desc);

alter table public.ia_uso enable row level security;

-- O CRM só lê; quem grava são as edge functions, com a service role.
drop policy if exists crm_admin_select on public.ia_uso;
create policy crm_admin_select on public.ia_uso
  for select to authenticated
  using (exists (select 1 from public.crm_usuarios_autorizados a where a.user_id = (select auth.uid())));

drop policy if exists ia_uso_service_role_all on public.ia_uso;
create policy ia_uso_service_role_all on public.ia_uso
  for all to service_role using (true) with check (true);

revoke all on public.ia_uso from anon;
revoke insert, update, delete, truncate, references, trigger on public.ia_uso from authenticated;
