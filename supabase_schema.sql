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
ALTER TABLE public.hist_vendas ADD COLUMN IF NOT EXISTS importado_em TIMESTAMP WITH TIME ZONE DEFAULT now();

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

-- Forçar recarregamento adicional do schema cache do PostgREST
NOTIFY pgrst, 'reload schema';



