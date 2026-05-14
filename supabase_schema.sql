-- SQL PARA CRIAÇÃO DA TABELA DE EMPRÉSTIMOS NO SUPABASE
-- Copie e cole este código no SQL Editor do seu projeto Supabase

-- 1. Criar a tabela
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

-- 2. Habilitar Row Level Security (RLS)
ALTER TABLE public.emprestimos ENABLE ROW LEVEL SECURITY;

-- 3. Criar política de acesso (Ajuste conforme sua necessidade de autenticação)
-- Esta política permite acesso total para fins de desenvolvimento/demonstração
DROP POLICY IF EXISTS "Acesso total" ON public.emprestimos;
CREATE POLICY "Acesso total" ON public.emprestimos FOR ALL USING (true);

-- Comentário opcional para organização
COMMENT ON TABLE public.emprestimos IS 'Tabela que controla mercadorias emprestadas entre clientes.';
