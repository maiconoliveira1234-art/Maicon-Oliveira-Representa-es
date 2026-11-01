-- CRM Pro Max | ROLLBACK da migracao security/staged_auth_cutover.sql
-- Aplicar apenas se o cutover foi executado e houver falha funcional.
-- Pressupoe snapshot no schema crm_security_rollback criado pelo cutover.
begin;
do $restore$
declare p record; grant_row record; grantee_sql text;
begin
 if to_regclass('crm_security_rollback.policy_snapshot') is null
   or to_regclass('crm_security_rollback.privilege_snapshot') is null then
   raise exception 'Snapshot indisponivel: nao executar rollback sem backup';
 end if;

 for p in
   select * from crm_security_rollback.policy_snapshot order by table_name,policy_name
 loop
   execute format('drop policy if exists %I on public.%I',p.policy_name,p.table_name);
   execute format(
     'create policy %I on public.%I for %s to %s %s %s',
     p.policy_name,p.table_name,p.cmd,
     array_to_string(p.roles,', '),
     case when p.qual is not null then 'using (' || p.qual || ')' else '' end,
     case when p.with_check is not null then 'with check (' || p.with_check || ')' else '' end
   );
 end loop;

 for grant_row in
   select * from crm_security_rollback.privilege_snapshot
 loop
   grantee_sql := case when grant_row.grantee='PUBLIC' then 'PUBLIC'
                       else format('%I',grant_row.grantee) end;
   execute format('grant %s on table public.%I to %s%s',
     grant_row.privilege_type,
     grant_row.table_name,
     grantee_sql,
     case when grant_row.is_grantable then ' with grant option' else '' end);
 end loop;
end;
$restore$;

alter function public.importar_faturamento_transacional(uuid,text,text,jsonb,numeric,jsonb) security definer;
alter function public.editar_pedido_venda_transacional(text,text,text,text,date,jsonb,jsonb,text[]) security definer;
alter function public.editar_pedido_venda_transacional(text,uuid,uuid,text,date,jsonb,jsonb,uuid[]) security definer;
alter function public.garantir_reset_flex_trimestral() security definer;
alter function public.whatsapp_recalcular_ocultacao() security definer;
grant execute on function public.importar_faturamento_transacional(uuid,text,text,jsonb,numeric,jsonb) to PUBLIC;
grant execute on function public.editar_pedido_venda_transacional(text,text,text,text,date,jsonb,jsonb,text[]) to PUBLIC;
grant execute on function public.editar_pedido_venda_transacional(text,uuid,uuid,text,date,jsonb,jsonb,uuid[]) to PUBLIC;
grant execute on function public.garantir_reset_flex_trimestral() to PUBLIC;
grant execute on function public.whatsapp_recalcular_ocultacao() to PUBLIC;
commit;
