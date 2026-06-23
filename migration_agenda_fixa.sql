-- MIGRATION: ADD AGENDA_FIXA COLUMN TO CLIENTS
-- Execute este código no SQL Editor do seu projeto Supabase

-- 1. Adicionar coluna agenda_fixa na tabela de clientes
ALTER TABLE public.clientes 
ADD COLUMN IF NOT EXISTS agenda_fixa BOOLEAN DEFAULT false;

-- 2. Garantir que os registros antigos com valor NULL sejam falsos por padrão
UPDATE public.clientes 
SET agenda_fixa = false 
WHERE agenda_fixa IS NULL;

-- 3. Forçar recarregamento do cache do PostgREST
NOTIFY pgrst, 'reload schema';

COMMENT ON COLUMN public.clientes.agenda_fixa IS 'Se verdadeiro, indica que a agenda deste cliente é fixa e não pode ser alterada por algoritmos de rebalanceamento ou otimização.';
