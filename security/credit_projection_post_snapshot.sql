-- Alinhamento da projeção de crédito aos saldos oficiais em 30/10/2026.
-- Executado no projeto ljrzmbxposgfxcymamwk em 01/11/2026.
-- Apenas libera boletos cujo vencimento seja POSTERIOR ao snapshot e
-- anterior à data consultada; vencidos contam como pagos no dia seguinte
-- independentemente de feriados e fins de semana.
-- Não recontabilizar títulos vencidos antes da fotografia oficial.
-- Considera reservas reais em reservas_credito (status reservado).
-- Mantenha uma cópia anterior da função antes de futuras alterações.
create or replace function public.saldo_credito_projetado(p_entidade uuid, p_data date default current_date)
returns table (
  limite numeric,
  disponivel_oficial numeric,
  disponivel_estimado numeric,
  titulos_conferidos boolean,
  titulos_total numeric,
  reservas_total numeric
)
language plpgsql stable
set search_path=public
as $$
declare
  e public.entidades_financeiras%rowtype;
  v_total numeric := 0;
  v_liberados numeric := 0;
  v_reservas numeric := 0;
begin
  select * into e from public.entidades_financeiras where id=p_entidade;
  if not found then raise exception 'Entidade financeira inexistente'; end if;

  select coalesce(sum(t.valor),0),
         coalesce(sum(t.valor) filter (
           where t.vencimento > e.data_snapshot
             and (
               t.vencimento < p_data
               or (t.baixado_em is not null
                   and t.baixado_em > e.data_snapshot
                   and t.baixado_em < p_data)
             )
         ),0)
    into v_total,v_liberados
    from public.titulos_credito t
    where t.entidade_financeira_id=p_entidade;

  select coalesce(sum(r.valor),0) into v_reservas
    from public.reservas_credito r
    where r.entidade_financeira_id=p_entidade and r.status='reservado';

  return query select
    e.limite_total,
    e.disponivel_oficial_snapshot,
    greatest(0,least(e.limite_total,
      e.disponivel_oficial_snapshot
      + case when e.titulos_conferidos then v_liberados else 0 end
      - v_reservas)),
    e.titulos_conferidos,
    v_total,
    v_reservas;
end $$;
