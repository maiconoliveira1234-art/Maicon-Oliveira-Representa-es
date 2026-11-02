-- CRM Pro Max v1.20.184: registrar loja/CNPJ da importação de faturamento.
-- Sem alteração retroativa dos históricos anteriores. Null significa loja desconhecida.
BEGIN;
ALTER TABLE public.hist_vendas
  ADD COLUMN IF NOT EXISTS entidade_financeira_id uuid;
DO $ddl$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid='public.hist_vendas'::regclass
      AND conname='hist_vendas_entidade_financeira_id_fkey'
  ) THEN
    ALTER TABLE public.hist_vendas ADD CONSTRAINT hist_vendas_entidade_financeira_id_fkey
      FOREIGN KEY (entidade_financeira_id) REFERENCES public.entidades_financeiras(id);
  END IF;
END $ddl$;
CREATE INDEX IF NOT EXISTS idx_hist_vendas_entidade_data
  ON public.hist_vendas (entidade_financeira_id, faturamento)
  WHERE entidade_financeira_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.importar_faturamento_transacional(p_cliente_id uuid, p_numero_pedido_erp text, p_order_date text, p_itens jsonb, p_incremento_saldo numeric, p_extratos jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_exists BOOLEAN;
    v_item RECORD;
    v_extrato RECORD;
    v_entidade_id UUID;
    v_lojas_distintas INTEGER;
BEGIN
    -- A. Verificar duplicidade em transação isolada
    SELECT EXISTS (
        SELECT 1 
        FROM public.hist_vendas 
        WHERE numero_pedido_erp = p_numero_pedido_erp
    ) INTO v_exists;

    IF v_exists THEN
        RAISE EXCEPTION 'Este faturamento já foi importado anteriormente.';
    END IF;

    -- O cadastro financeiro e por CNPJ: todos os itens do mesmo pedido ERP
    -- devem informar a mesma loja e esta deve pertencer ao cliente comercial.
    SELECT count(DISTINCT coalesce(item->>'entidade_financeira_id', ''))
      INTO v_lojas_distintas
      FROM jsonb_array_elements(p_itens) AS item;
    IF v_lojas_distintas > 1 THEN
      RAISE EXCEPTION 'Um mesmo pedido ERP não pode misturar lojas financeiras';
    END IF;
    v_entidade_id := nullif(p_itens->0->>'entidade_financeira_id','')::uuid;
    IF v_entidade_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.entidades_financeiras e
      WHERE e.id=v_entidade_id AND e.cliente_comercial_id=p_cliente_id
    ) THEN
      RAISE EXCEPTION 'Loja financeira não pertence ao cliente selecionado';
    END IF;

    -- B. Gravar itens faturados agrupados de forma atômica
    FOR v_item IN SELECT * FROM jsonb_to_recordset(p_itens) AS x(
        cliente_id UUID,
        cliente TEXT,
        faturamento TEXT,
        produtos TEXT,
        qtd NUMERIC,
        r_total NUMERIC,
        vendas TEXT,
        xdt NUMERIC,
        acresc_val NUMERIC,
        tabela TEXT,
        produto_id UUID,
        numero_pedido_erp TEXT,
        entidade_financeira_id UUID
    ) LOOP
        INSERT INTO public.hist_vendas (
            cliente_id,
            cliente,
            faturamento,
            produtos,
            qtd,
            "r$_total",
            vendas,
            xdt,
            "acresc.",
            tabela,
            produto_id,
            numero_pedido_erp,
            entidade_financeira_id,
            importado_em
        ) VALUES (
            v_item.cliente_id,
            v_item.cliente,
            CAST(v_item.faturamento AS DATE),
            v_item.produtos,
            v_item.qtd,
            v_item.r_total,
            v_item.vendas,
            v_item.xdt,
            v_item.acresc_val,
            v_item.tabela,
            v_item.produto_id,
            v_item.numero_pedido_erp,
            v_entidade_id,
            now()
        );
    END LOOP;

    -- C. Atualizar o saldo da conta Flex do cliente
    UPDATE public.clientes
    SET flex_saldo = COALESCE(flex_saldo, 0) + p_incremento_saldo
    WHERE id = p_cliente_id;

    -- D. Gravar os logs do Extrato correspondentes
    IF jsonb_array_length(p_extratos) > 0 THEN
        FOR v_extrato IN SELECT * FROM jsonb_to_recordset(p_extratos) AS y(
            cliente_id UUID,
            tipo TEXT,
            valor NUMERIC,
            descricao TEXT
        ) LOOP
            INSERT INTO public.verba_flex_extrato (
                cliente_id,
                tipo,
                valor,
                descricao,
                data,
                created_at
            ) VALUES (
                v_extrato.cliente_id,
                v_extrato.tipo,
                v_extrato.valor,
                v_extrato.descricao,
                now(),
                now()
            );
        END LOOP;
    END IF;

END;
$function$

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
               t.vencimento < p_data
               or (t.baixado_em is not null and t.baixado_em > e.data_snapshot and t.baixado_em < p_data)
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
      + case when e.titulos_conferidos then v_liberados else 0 end
      - v_reservas - v_faturamentos)),
    e.titulos_conferidos,v_total,v_reservas;
end $function$;
COMMIT;