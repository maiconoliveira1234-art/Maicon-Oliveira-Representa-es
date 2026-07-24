-- Flex: 1,5% a partir de julho/2026 e reset automatico por trimestre.
-- Pode ser executada mais de uma vez.

alter table public.clientes
  add column if not exists flex_reset_trimestre date;

alter table public.verba_flex_extrato
  drop constraint if exists chk_tipo;

alter table public.verba_flex_extrato
  drop constraint if exists verba_flex_extrato_tipo_check;

alter table public.verba_flex_extrato
  add constraint chk_tipo check (
    tipo in ('GERADO', 'BONIFICACAO', 'DESCONTO', 'AJUSTE', 'RESET_TRIMESTRAL')
  );

create or replace function public.garantir_reset_flex_trimestral()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inicio_trimestre date := date_trunc('quarter', current_date)::date;
  v_total integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('reset_flex_trimestral'));

  insert into public.verba_flex_extrato (
    cliente_id,
    data,
    tipo,
    valor,
    descricao,
    created_at
  )
  select
    c.id,
    now(),
    'RESET_TRIMESTRAL',
    -coalesce(c.flex_saldo, 0),
    'Zeramento automatico do saldo Flex - trimestre iniciado em '
      || to_char(v_inicio_trimestre, 'DD/MM/YYYY'),
    now()
  from public.clientes c
  where c.flex_reset_trimestre is distinct from v_inicio_trimestre
    and coalesce(c.flex_saldo, 0) <> 0;

  update public.clientes
  set
    flex_saldo = 0,
    flex_reset_trimestre = v_inicio_trimestre
  where flex_reset_trimestre is distinct from v_inicio_trimestre;

  get diagnostics v_total = row_count;
  return v_total;
end;
$$;

grant execute on function public.garantir_reset_flex_trimestral() to anon, authenticated;

-- Ao aplicar a migracao, regulariza imediatamente o trimestre atual.
select public.garantir_reset_flex_trimestral();

notify pgrst, 'reload schema';
