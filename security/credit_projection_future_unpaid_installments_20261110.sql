-- 2026-11-10: corrected credit projection from future not-yet-paid titles.
-- Vencimento <= date is presumed paid (does not create bank settlement).
-- New invoices already represented by titles must not be counted twice.
-- SCL COM LTDA ME at 2026-11-10: 12000.00 - 2485.52 = 9514.48.
CREATE OR REPLACE FUNCTION public.saldo_credito_projetado(p_entidade uuid, p_data date DEFAULT CURRENT_DATE)
 RETURNS TABLE(limite numeric, disponivel_oficial numeric, disponivel_estimado numeric, titulos_conferidos boolean, titulos_total numeric, reservas_total numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  e public.entidades_financeiras%rowtype;
  v_total numeric := 0;
  v_em_aberto numeric := 0;
  v_reservas numeric := 0;
  v_faturamentos_sem_titulo numeric := 0;
begin
  select * into e from public.entidades_financeiras where id=p_entidade;
  if not found then raise exception 'Entidade financeira inexistente'; end if;

  -- A projection treats every installment due on or before the reference date
  -- as paid. A future title with an explicitly recorded prior settlement is also paid.
  select coalesce(sum(t.valor),0),
         coalesce(sum(t.valor) filter(
           where t.vencimento > p_data
             and (t.baixado_em is null or t.baixado_em > p_data)
         ),0)
    into v_total,v_em_aberto
    from public.titulos_credito t
    where t.entidade_financeira_id=p_entidade;

  select coalesce(sum(r.valor),0) into v_reservas
    from public.reservas_credito r
    where r.entidade_financeira_id=p_entidade and r.status='reservado';

  -- Imported invoices already create entries in titulos_credito, so never
  -- debit the same sale twice. Only subtract a sale not yet represented
  -- by an invoice-origin title (conservative when invoice processing lags).
  select coalesce(sum(greatest(h."r$_total",0)),0)
    into v_faturamentos_sem_titulo
    from public.hist_vendas h
    where h.entidade_financeira_id=p_entidade
      and h.faturamento>e.data_snapshot
      and h.faturamento<=p_data
      and upper(trim(coalesce(h.vendas,'')))='VENDAS'
      and not exists (
        select 1 from public.titulos_credito t
        where t.entidade_financeira_id=p_entidade
          and t.origem='faturamento'
          and t.referencia_externa=h.numero_pedido_erp
      );

  return query select
    e.limite_total,
    e.disponivel_oficial_snapshot,
    greatest(0,least(e.limite_total,
      e.limite_total - v_em_aberto - v_reservas - v_faturamentos_sem_titulo)),
    e.titulos_conferidos, v_total, v_reservas;
end;
$function$
;
