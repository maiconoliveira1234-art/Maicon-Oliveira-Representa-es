-- CRM Pro Max | Restricao de acesso apos login em producao
-- ESTAGIADO / NAO EXECUTADO.
-- Precondicoes: login obrigatorio implantado e validado, testes funcionais de
-- pedidos/estoque/importacao APROVADOS, backup recente recuperavel, janela de rollback.
-- ATENCAO: esta migracao revoga o acesso anonimo utilizado pela producao atual.
-- Nunca executar antes da liberacao autenticada em producao.
begin;

-- 1. Guardas fail-closed: sem administrador e sem politicas, abortar.
do $preflight$
declare n integer;
begin
  if not exists (
    select 1 from public.crm_usuarios_autorizados a
    join auth.users u on u.id=a.user_id
    where u.email = 'maicon.oliveira1234@gmail.com' and u.email_confirmed_at is not null
  ) then
    raise exception 'CRM: administrador autenticado nao encontrado; abortando';
  end if;
  select count(*) into n
  from pg_policies where schemaname='public' and policyname='crm_admin_authenticated';
  if n < 21 then
    raise exception 'CRM: % politicas administrativas (esperado >=21); abortando', n;
  end if;
end;
$preflight$;

-- 2. Arquivamento para restauração integral de politicas e grants.
create schema if not exists crm_security_rollback;
revoke all on schema crm_security_rollback from public, anon, authenticated;
create table if not exists crm_security_rollback.policy_snapshot (
  table_name text not null,
  policy_name text not null,
  cmd text not null,
  roles name[] not null,
  qual text,
  with_check text,
  primary key(table_name,policy_name)
);
create table if not exists crm_security_rollback.privilege_snapshot (
  table_name text not null,
  grantee text not null,
  privilege_type text not null,
  is_grantable boolean not null,
  primary key(table_name,grantee,privilege_type)
);
truncate crm_security_rollback.policy_snapshot, crm_security_rollback.privilege_snapshot;

insert into crm_security_rollback.policy_snapshot(table_name,policy_name,cmd,roles,qual,with_check)
select p.tablename,p.policyname,p.cmd,p.roles,p.qual,p.with_check
from pg_policies p
where p.schemaname='public'
  and (p.roles && array['anon','public']::name[])
  and exists (
    select 1 from pg_policies admin
    where admin.schemaname='public' and admin.tablename=p.tablename
      and admin.policyname='crm_admin_authenticated'
  );

insert into crm_security_rollback.privilege_snapshot(table_name,grantee,privilege_type,is_grantable)
select c.relname,
  case when acl.grantee=0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end,
  acl.privilege_type, acl.is_grantable
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl
where n.nspname='public'
  and c.relkind in ('r','p')
  and (acl.grantee=0 or acl.grantee='anon'::regrole)
  and exists (
    select 1 from pg_policies admin
    where admin.schemaname='public' and admin.tablename=c.relname
      and admin.policyname='crm_admin_authenticated'
  );

-- 3. Desativar LEGADO anon/public apenas em tabelas cobertas pela politica CRM.
do $policies$
declare p record; t record;
begin
  for p in
    select tablename, policyname
    from pg_policies
    where schemaname='public'
      and roles && array['anon','public']::name[]
      and exists (
        select 1 from pg_policies a
        where a.schemaname='public'
          and a.tablename=pg_policies.tablename
          and a.policyname='crm_admin_authenticated')
  loop
    execute format('drop policy %I on public.%I',p.policyname,p.tablename);
  end loop;
  for t in
    select distinct tablename from pg_policies
    where schemaname='public' and policyname='crm_admin_authenticated'
  loop
    execute format('revoke all privileges on table public.%I from PUBLIC, anon',t.tablename);
    execute format('grant select,insert,update,delete on table public.%I to authenticated',t.tablename);
    execute format('grant select,insert,update,delete on table public.%I to service_role',t.tablename);
  end loop;
end;
$policies$;

-- 4. RPC: preservar funcionalidade via RLS do usuário logado (SECURITY INVOKER).
-- Postgres 'authenticated' ja tem INSERT/UPDATE/DELETE e a sequencia hist_vendas_id_seq.
-- Inclui AMBAS as assinaturas de edicao, para nao deixar uma rota alternativa.
alter function public.importar_faturamento_transacional(uuid,text,text,jsonb,numeric,jsonb)
  security invoker;
alter function public.editar_pedido_venda_transacional(text,text,text,text,date,jsonb,jsonb,text[])
  security invoker;
alter function public.editar_pedido_venda_transacional(text,uuid,uuid,text,date,jsonb,jsonb,uuid[])
  security invoker;
alter function public.garantir_reset_flex_trimestral() security invoker;
alter function public.whatsapp_recalcular_ocultacao() security invoker;

-- Eliminar EXECUTE do PUBLIC (inclui anon) nas rotinas sensiveis.
revoke all on function public.importar_faturamento_transacional(uuid,text,text,jsonb,numeric,jsonb) from PUBLIC,anon;
revoke all on function public.editar_pedido_venda_transacional(text,text,text,text,date,jsonb,jsonb,text[]) from PUBLIC,anon;
revoke all on function public.editar_pedido_venda_transacional(text,uuid,uuid,text,date,jsonb,jsonb,uuid[]) from PUBLIC,anon;
revoke all on function public.garantir_reset_flex_trimestral() from PUBLIC,anon;
revoke all on function public.whatsapp_recalcular_ocultacao() from PUBLIC,anon;
grant execute on function public.importar_faturamento_transacional(uuid,text,text,jsonb,numeric,jsonb) to authenticated;
grant execute on function public.editar_pedido_venda_transacional(text,text,text,text,date,jsonb,jsonb,text[]) to authenticated;
grant execute on function public.editar_pedido_venda_transacional(text,uuid,uuid,text,date,jsonb,jsonb,uuid[]) to authenticated;
grant execute on function public.garantir_reset_flex_trimestral() to authenticated;
-- Funcao de trigger: nao concede EXECUTE direto para clientes.

-- 5. Verificacao de integridade do corte no MESMO commit SQL.
do $verify$
declare n integer;
begin
  select count(*) into n from pg_policies
  where schemaname='public'
    and roles && array['anon','public']::name[]
    and exists(select 1 from pg_policies a
      where a.schemaname='public' and a.tablename=pg_policies.tablename
      and a.policyname='crm_admin_authenticated');
  if n <> 0 then raise exception 'Politicas anon/public ainda ativas: %',n; end if;
  if has_function_privilege('anon',
    'public.importar_faturamento_transacional(uuid,text,text,jsonb,numeric,jsonb)',
    'EXECUTE') then
    raise exception 'RPC de importacao continua acessivel por anon';
  end if;
  if not has_table_privilege('authenticated','public.pedidos','INSERT')
     or not has_table_privilege('authenticated','public.estoque_cliente','UPDATE')
     or not has_sequence_privilege('authenticated','public.hist_vendas_id_seq','USAGE') then
    raise exception 'Falta privilegio de escrita para pedidos/estoque/historico';
  end if;
end;
$verify$;
commit;
