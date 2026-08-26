-- ==============================================================================
-- MIGRATION: EDIÇÃO TRANSACIONAL DE PEDIDOS DE VENDA (HIST_VENDAS)
-- Permite alteração atômica de pedido: data, cliente, itens (edição/deleção/inclusão)
-- ==============================================================================

-- 1. Garantir coluna canônica pedido_id na tabela hist_vendas
ALTER TABLE public.hist_vendas ADD COLUMN IF NOT EXISTS pedido_id TEXT;
CREATE INDEX IF NOT EXISTS idx_hist_vendas_pedido_id ON public.hist_vendas(pedido_id);

-- 2. Função RPC transacional para edição atômica de pedidos
CREATE OR REPLACE FUNCTION public.editar_pedido_venda_transacional(
    p_pedido_id TEXT,
    p_cliente_id_origem UUID,
    p_cliente_id_destino UUID,
    p_cliente_nome_destino TEXT,
    p_nova_data DATE,
    p_itens_atualizados JSONB DEFAULT '[]'::jsonb,
    p_itens_novos JSONB DEFAULT '[]'::jsonb,
    p_itens_removidos_ids UUID[] DEFAULT '{}'::uuid[]
) RETURNS JSONB AS $body$
DECLARE
    v_item RECORD;
    v_novo RECORD;
    v_removido_id UUID;
    v_updated_count INT := 0;
    v_inserted_count INT := 0;
    v_deleted_count INT := 0;
BEGIN
    -- 1. Excluir itens removidos pertencentes ao pedido
    IF p_itens_removidos_ids IS NOT NULL AND array_length(p_itens_removidos_ids, 1) > 0 THEN
        FOREACH v_removido_id IN ARRAY p_itens_removidos_ids LOOP
            DELETE FROM public.hist_vendas 
            WHERE id = v_removido_id;
            v_deleted_count := v_deleted_count + 1;
        END LOOP;
    END IF;

    -- 2. Atualizar itens existentes modificados
    IF p_itens_atualizados IS NOT NULL AND jsonb_array_length(p_itens_atualizados) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_to_recordset(p_itens_atualizados) AS x(
            id UUID,
            produto_id UUID,
            produtos TEXT,
            qtd NUMERIC,
            r_total NUMERIC,
            vendas TEXT,
            tabela TEXT,
            xdt NUMERIC,
            acresc_val NUMERIC
        ) LOOP
            UPDATE public.hist_vendas
            SET 
                pedido_id = p_pedido_id,
                cliente_id = p_cliente_id_destino,
                cliente = COALESCE(p_cliente_nome_destino, cliente),
                faturamento = p_nova_data,
                produto_id = COALESCE(v_item.produto_id, produto_id),
                produtos = COALESCE(v_item.produtos, produtos),
                qtd = COALESCE(v_item.qtd, qtd),
                "r$_total" = COALESCE(v_item.r_total, "r$_total"),
                vendas = COALESCE(v_item.vendas, vendas),
                tabela = COALESCE(v_item.tabela, tabela),
                xdt = COALESCE(v_item.xdt, xdt),
                "acresc." = COALESCE(v_item.acresc_val, "acresc.")
            WHERE id = v_item.id;
            v_updated_count := v_updated_count + 1;
        END LOOP;
    END IF;

    -- 3. Inserir novos itens adicionados ao pedido
    IF p_itens_novos IS NOT NULL AND jsonb_array_length(p_itens_novos) > 0 THEN
        FOR v_novo IN SELECT * FROM jsonb_to_recordset(p_itens_novos) AS y(
            produto_id UUID,
            produtos TEXT,
            qtd NUMERIC,
            r_total NUMERIC,
            vendas TEXT,
            tabela TEXT,
            xdt NUMERIC,
            acresc_val NUMERIC,
            numero_pedido_erp TEXT
        ) LOOP
            INSERT INTO public.hist_vendas (
                pedido_id,
                cliente_id,
                cliente,
                faturamento,
                produto_id,
                produtos,
                qtd,
                "r$_total",
                vendas,
                tabela,
                xdt,
                "acresc.",
                numero_pedido_erp,
                importado_em
            ) VALUES (
                p_pedido_id,
                p_cliente_id_destino,
                p_cliente_nome_destino,
                p_nova_data,
                v_novo.produto_id,
                v_novo.produtos,
                v_novo.qtd,
                v_novo.r_total,
                COALESCE(v_novo.vendas, 'VENDA'),
                COALESCE(v_novo.tabela, 'TABELA PADRAO'),
                COALESCE(v_novo.xdt, 0),
                COALESCE(v_novo.acresc_val, 0),
                v_novo.numero_pedido_erp,
                now()
            );
            v_inserted_count := v_inserted_count + 1;
        END LOOP;
    END IF;

    -- 4. Garantir que todas as linhas remanescentes deste pedido_id também atualizem cliente_id, cliente e data caso não tenham entrado em p_itens_atualizados
    UPDATE public.hist_vendas
    SET 
        pedido_id = p_pedido_id,
        cliente_id = p_cliente_id_destino,
        cliente = COALESCE(p_cliente_nome_destino, cliente),
        faturamento = p_nova_data
    WHERE pedido_id = p_pedido_id;

    RETURN jsonb_build_object(
        'success', true,
        'pedido_id', p_pedido_id,
        'updated', v_updated_count,
        'inserted', v_inserted_count,
        'deleted', v_deleted_count
    );
END;
$body$ LANGUAGE plpgsql SECURITY DEFINER;
