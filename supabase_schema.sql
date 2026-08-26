-- SQL PARA CRIAÇÃO DA TABELA DE EMPRÉSTIMOS E CONTA DE VERBA FLEX NO SUPABASE
-- Copie e cole este código no SQL Editor do seu projeto Supabase

-- 1. Criar a tabela de empréstimos
CREATE TABLE IF NOT EXISTS public.emprestimos (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    data_emprestimo DATE NOT NULL DEFAULT CURRENT_DATE,
    cliente_origem_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
    cliente_destino_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
    produto_id UUID REFERENCES public.produtos(id) ON DELETE SET NULL,
    quantidade DECIMAL(10, 2) NOT NULL,
    status TEXT DEFAULT 'pendente' CHECK (status IN ('pendente', 'pago')),
    data_devolucao DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.emprestimos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Acesso total" ON public.emprestimos;
CREATE POLICY "Acesso total" ON public.emprestimos FOR ALL USING (true);
COMMENT ON TABLE public.emprestimos IS 'Tabela que controla mercadorias emprestadas entre clientes.';


-- ------------------------------------------------------------------
-- SISTEMA DE "VERBA FLEX COMERCIAL"
-- ------------------------------------------------------------------

-- 2. Adicionar coluna de saldo de Verba Flex na tabela de clientes
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS flex_saldo NUMERIC(10, 2) DEFAULT 0.00;

-- 3. Criar a tabela de extrato interno de Verba Flex (Transações)
CREATE TABLE IF NOT EXISTS public.verba_flex_extrato (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    cliente_id UUID REFERENCES public.clientes(id) ON DELETE CASCADE NOT NULL,
    data TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    tipo TEXT NOT NULL, -- 'GERADO', 'BONIFICACAO', 'DESCONTO', 'RESET_TRIMESTRAL'
    valor NUMERIC(10, 2) NOT NULL,
    descricao TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT chk_tipo CHECK (tipo IN ('GERADO', 'BONIFICACAO', 'DESCONTO', 'RESET_TRIMESTRAL'))
);

-- Correção de herança do tipo para evitar erros de fk:
ALTER TABLE public.verba_flex_extrato DROP CONSTRAINT IF EXISTS verba_flex_extrato_tipo_fkey1;
ALTER TABLE public.verba_flex_extrato DROP CONSTRAINT IF EXISTS verba_flex_extrato_tipo_fkey;

-- 4. Habilitar RLS para o Extrato Flex
ALTER TABLE public.verba_flex_extrato ENABLE ROW LEVEL SECURITY;

-- 5. Criar políticas de acesso simplificadas de leitura e escrita
DROP POLICY IF EXISTS "Acesso total extrato flex" ON public.verba_flex_extrato;
CREATE POLICY "Acesso total extrato flex" ON public.verba_flex_extrato FOR ALL USING (true);

COMMENT ON TABLE public.verba_flex_extrato IS 'Histórico interno de lançamentos de Verba Flex (gerações, bonificações, descontos e resets).';


-- ------------------------------------------------------------------
-- PROTEÇÃO IDEMPOTENTE PARA IMPORTAÇÃO DE FATURAMENTO (HIST_VENDAS)
-- ------------------------------------------------------------------

-- 6. Adicionar colunas de controle na tabela existente hist_vendas
ALTER TABLE public.hist_vendas ADD COLUMN IF NOT EXISTS numero_pedido_erp TEXT;
ALTER TABLE public.hist_vendas ADD COLUMN IF NOT EXISTS pedido_id TEXT;
ALTER TABLE public.hist_vendas ADD COLUMN IF NOT EXISTS importado_em TIMESTAMP WITH TIME ZONE DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_hist_vendas_pedido_id ON public.hist_vendas(pedido_id);

-- 7. Remoção de índices compostos (garantimos lote-único atômico via verificação e transações na aplicação)
-- De conformidade com as diretivas, não utilizamos UNIQUE composto para permitir importação íntegra multi-linhas.
DROP INDEX IF EXISTS public.idx_hist_vendas_numero_pedido_produto;

COMMENT ON COLUMN public.hist_vendas.numero_pedido_erp IS 'Identificador mestre único (número do pedido/faturamento vindo do ERP).';
COMMENT ON COLUMN public.hist_vendas.importado_em IS 'Data e hora em que este faturamento foi importado no CRM.';


-- ------------------------------------------------------------------
-- 8. FUNÇÃO DE IMPORTAÇÃO TRANSACIONAL ATÔMICA (DATABASE-LEVEL BEGIN/COMMIT/ROLLBACK)
-- ------------------------------------------------------------------
-- Esta função e seu bloco de execução rodam dentro de uma transação única
-- auto-gerida pelo PostgreSQL. Qualquer erro de validação ou de constraint
-- fará um ROLLBACK integral automático do banco (Tudo ou Nada).

CREATE OR REPLACE FUNCTION public.importar_faturamento_transacional(
    p_cliente_id UUID,
    p_numero_pedido_erp TEXT,
    p_order_date TEXT,
    p_itens JSONB,
    p_incremento_saldo NUMERIC,
    p_extratos JSONB
) RETURNS VOID AS $body$
DECLARE
    v_exists BOOLEAN;
    v_item RECORD;
    v_extrato RECORD;
BEGIN
    SELECT EXISTS (
        SELECT 1 
        FROM public.hist_vendas 
        WHERE numero_pedido_erp = p_numero_pedido_erp
    ) INTO v_exists;

    IF v_exists THEN
        RAISE EXCEPTION 'Este faturamento já foi importado anteriormente.';
    END IF;

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
        numero_pedido_erp TEXT
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
            now()
        );
    END LOOP;

    UPDATE public.clientes
    SET flex_saldo = COALESCE(flex_saldo, 0) + p_incremento_saldo
    WHERE id = p_cliente_id;

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
$body$ LANGUAGE plpgsql SECURITY DEFINER;


-- 9. FORÇAR RECARREGAMENTO DO CACHE DO POSTGREST (SCHEMA CACHE REFRESH)
-- Execute isto para atualizar o cache de tabelas de forma imediata.
NOTIFY pgrst, 'reload schema';


-- ------------------------------------------------------------------
-- 10. TABELA DE PEDIDOS EM ABERTO (SINCRONIZAÇÃO ENTRE DISPOSITIVOS)
-- ------------------------------------------------------------------
-- Esta tabela armazena os rascunhos salvos temporariamente para que fiquem
-- visíveis e sincronizados de forma cross-device.

CREATE TABLE IF NOT EXISTS public.pedidos_em_aberto (
    cliente_id UUID PRIMARY KEY REFERENCES public.clientes(id) ON DELETE CASCADE,
    items JSONB NOT NULL DEFAULT '[]'::jsonb,
    prazo TEXT,
    obs TEXT,
    manual_faixa JSONB,
    desconto_extra NUMERIC(10, 2) DEFAULT 0.00,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Habilitar RLS
ALTER TABLE public.pedidos_em_aberto ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Acesso total pedidos em aberto" ON public.pedidos_em_aberto;
CREATE POLICY "Acesso total pedidos em aberto" ON public.pedidos_em_aberto FOR ALL USING (true);

COMMENT ON TABLE public.pedidos_em_aberto IS 'Guarda os rascunhos de pedidos em andamento sincronizados em tempo real entre múltiplos dispositivos.';

-- ------------------------------------------------------------------
-- 11. FUNÇÃO DE EDIÇÃO TRANSACIONAL DE PEDIDOS (HIST_VENDAS)
-- ------------------------------------------------------------------
-- Compatível com identificadores UUID, TEXT, VARCHAR e SERIAL/INT.
CREATE OR REPLACE FUNCTION public.editar_pedido_venda_transacional(
    p_pedido_id TEXT,
    p_cliente_id_origem TEXT,
    p_cliente_id_destino TEXT,
    p_cliente_nome_destino TEXT,
    p_nova_data DATE,
    p_itens_atualizados JSONB DEFAULT '[]'::jsonb,
    p_itens_novos JSONB DEFAULT '[]'::jsonb,
    p_itens_removidos_ids TEXT[] DEFAULT '{}'::text[]
) RETURNS JSONB AS $body$
DECLARE
    v_item RECORD;
    v_novo RECORD;
    v_removido_id TEXT;
    v_updated_count INT := 0;
    v_inserted_count INT := 0;
    v_deleted_count INT := 0;
BEGIN
    -- 1. Excluir itens removidos pertencentes ao pedido
    IF p_itens_removidos_ids IS NOT NULL AND array_length(p_itens_removidos_ids, 1) > 0 THEN
        FOREACH v_removido_id IN ARRAY p_itens_removidos_ids LOOP
            DELETE FROM public.hist_vendas 
            WHERE id::text = v_removido_id;
            v_deleted_count := v_deleted_count + 1;
        END LOOP;
    END IF;

    -- 2. Atualizar itens existentes modificados
    IF p_itens_atualizados IS NOT NULL AND jsonb_array_length(p_itens_atualizados) > 0 THEN
        FOR v_item IN SELECT * FROM jsonb_to_recordset(p_itens_atualizados) AS x(
            id TEXT,
            produto_id TEXT,
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
            WHERE id::text = v_item.id;
            v_updated_count := v_updated_count + 1;
        END LOOP;
    END IF;

    -- 3. Inserir novos itens adicionados ao pedido
    IF p_itens_novos IS NOT NULL AND jsonb_array_length(p_itens_novos) > 0 THEN
        FOR v_novo IN SELECT * FROM jsonb_to_recordset(p_itens_novos) AS y(
            produto_id TEXT,
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

-- Forçar recarregamento adicional do schema cache do PostgREST
NOTIFY pgrst, 'reload schema';



