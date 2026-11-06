-- Pagamento presumido no próprio vencimento; títulos anteriores à base não são liberados novamente.
CREATE OR REPLACE FUNCTION public.saldo_credito_projetado(p_entidade uuid, p_data date DEFAULT CURRENT_DATE)
 RETURNS TABLE(limite numeric, disponivel_oficial numeric, disponivel_estimado numeric, titulos_conferidos boolean, titulos_total numeric, reservas_total numeric)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  e public.entidades_financeiras%rowtype;
  v_total numeric := 0;
  v_liberados numeric := 0;
  v_reservas numeric := 0;
  v_faturamentos numeric := 0;
begin
  select * into e from public.entidades_financeiras where id=p_entidade;
  if not found then raise exception 'Entidade financeira inexistente'; end if;
  select coalesce(sum(t.valor),0),
         coalesce(sum(t.valor) filter (
           where t.vencimento > e.data_snapshot
             and (
               t.vencimento <= p_data
               or (t.baixado_em is not null and t.baixado_em > e.data_snapshot and t.baixado_em <= p_data)
             )
         ),0)
    into v_total,v_liberados
    from public.titulos_credito t
    where t.entidade_financeira_id=p_entidade;
  select coalesce(sum(r.valor),0) into v_reservas
    from public.reservas_credito r
    where r.entidade_financeira_id=p_entidade and r.status='reservado';

  -- Novos faturamentos por loja após a fotografia do ERP consomem limite.
  -- Somente VENDAS: bonificações/brindes não geram dívida de crédito.
  -- Histórico sem loja informada não pode ser atribuído automaticamente.
  select coalesce(sum(greatest(h."r$_total",0)),0)
    into v_faturamentos
    from public.hist_vendas h
    where h.entidade_financeira_id=p_entidade
      and h.faturamento>e.data_snapshot
      and h.faturamento<=p_data
      and upper(trim(coalesce(h.vendas,'')))='VENDAS';

  return query select
    e.limite_total, e.disponivel_oficial_snapshot,
    greatest(0,least(e.limite_total,
      e.disponivel_oficial_snapshot
      + v_liberados
      - v_reservas - v_faturamentos)),
    e.titulos_conferidos,v_total,v_reservas;
end $function$

