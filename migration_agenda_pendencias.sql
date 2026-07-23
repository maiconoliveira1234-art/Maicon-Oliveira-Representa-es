-- =====================================================================
-- AGENDA: VISITAS EXTRAS E TAREFAS
-- Mantem agenda_visitas exclusiva para a rota recorrente.
-- Este arquivo pode ser executado mais de uma vez no SQL Editor.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.agenda_pendencias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo TEXT NOT NULL,
    titulo VARCHAR(160) NOT NULL,
    descricao TEXT,
    cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
    data_prevista DATE,
    horario_inicio TIME WITHOUT TIME ZONE,
    horario_fim TIME WITHOUT TIME ZONE,
    dia_inteiro BOOLEAN NOT NULL DEFAULT FALSE,
    prioridade TEXT NOT NULL DEFAULT 'NORMAL',
    status TEXT NOT NULL DEFAULT 'PENDENTE',
    ordem_dia INTEGER NOT NULL DEFAULT 0,
    lembrete_em TIMESTAMP WITH TIME ZONE,
    concluida_em TIMESTAMP WITH TIME ZONE,
    cancelada_em TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT timezone('utc', now()),

    CONSTRAINT agenda_pendencias_tipo_check
        CHECK (tipo IN ('VISITA_EXTRA', 'TAREFA')),
    CONSTRAINT agenda_pendencias_prioridade_check
        CHECK (prioridade IN ('NORMAL', 'ALTA', 'URGENTE')),
    CONSTRAINT agenda_pendencias_status_check
        CHECK (status IN ('PENDENTE', 'EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA')),
    CONSTRAINT agenda_pendencias_titulo_check
        CHECK (length(btrim(titulo)) > 0),
    CONSTRAINT agenda_pendencias_ordem_check
        CHECK (ordem_dia >= 0),
    CONSTRAINT agenda_pendencias_horario_check
        CHECK (
            horario_fim IS NULL
            OR horario_inicio IS NULL
            OR horario_fim > horario_inicio
        ),
    CONSTRAINT agenda_pendencias_visita_extra_check
        CHECK (
            tipo <> 'VISITA_EXTRA'
            OR (cliente_id IS NOT NULL AND data_prevista IS NOT NULL)
        )
);

COMMENT ON TABLE public.agenda_pendencias IS
    'Visitas extras e tarefas pontuais. A rota recorrente permanece em agenda_visitas.';
COMMENT ON COLUMN public.agenda_pendencias.tipo IS
    'VISITA_EXTRA exige cliente e data. TAREFA pode existir sem cliente ou prazo.';
COMMENT ON COLUMN public.agenda_pendencias.data_prevista IS
    'Data da visita ou prazo da tarefa. Nulo representa tarefa ainda nao programada.';
COMMENT ON COLUMN public.agenda_pendencias.ordem_dia IS
    'Ordem manual entre os compromissos do mesmo dia.';
COMMENT ON COLUMN public.agenda_pendencias.lembrete_em IS
    'Reservado para notificacoes e lembretes futuros.';

-- Atualiza metadados e registra automaticamente conclusao/cancelamento.
CREATE OR REPLACE FUNCTION public.atualizar_agenda_pendencia()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $body$
BEGIN
    NEW.updated_at := timezone('utc', now());
    NEW.titulo := btrim(NEW.titulo);

    IF NEW.status = 'CONCLUIDA' THEN
        NEW.concluida_em := COALESCE(NEW.concluida_em, timezone('utc', now()));
        NEW.cancelada_em := NULL;
    ELSIF NEW.status = 'CANCELADA' THEN
        NEW.cancelada_em := COALESCE(NEW.cancelada_em, timezone('utc', now()));
        NEW.concluida_em := NULL;
    ELSE
        NEW.concluida_em := NULL;
        NEW.cancelada_em := NULL;
    END IF;

    RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS trg_atualizar_agenda_pendencia
    ON public.agenda_pendencias;

CREATE TRIGGER trg_atualizar_agenda_pendencia
BEFORE INSERT OR UPDATE ON public.agenda_pendencias
FOR EACH ROW
EXECUTE FUNCTION public.atualizar_agenda_pendencia();

-- Agenda diaria e itens pendentes/atrasados.
CREATE INDEX IF NOT EXISTS idx_agenda_pendencias_data_status
    ON public.agenda_pendencias (data_prevista, status, ordem_dia);

-- Historico e pendencias dentro da tela do cliente.
CREATE INDEX IF NOT EXISTS idx_agenda_pendencias_cliente
    ON public.agenda_pendencias (cliente_id, status, data_prevista DESC);

-- Lista de tarefas ainda sem programacao.
CREATE INDEX IF NOT EXISTS idx_agenda_pendencias_sem_data
    ON public.agenda_pendencias (prioridade, created_at)
    WHERE tipo = 'TAREFA'
      AND data_prevista IS NULL
      AND status IN ('PENDENTE', 'EM_ANDAMENTO');

-- Consulta rapida da Home: pendentes, em andamento e vencidas.
CREATE INDEX IF NOT EXISTS idx_agenda_pendencias_ativas
    ON public.agenda_pendencias (status, prioridade, data_prevista)
    WHERE status IN ('PENDENTE', 'EM_ANDAMENTO');

ALTER TABLE public.agenda_pendencias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acesso total agenda pendencias"
    ON public.agenda_pendencias;

CREATE POLICY "Acesso total agenda pendencias"
    ON public.agenda_pendencias
    FOR ALL
    USING (true)
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE
    ON public.agenda_pendencias
    TO anon, authenticated;

-- Permite receber INSERT/UPDATE/DELETE em tempo real entre dispositivos.
ALTER TABLE public.agenda_pendencias REPLICA IDENTITY FULL;

DO $body$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'agenda_pendencias'
    ) THEN
        ALTER PUBLICATION supabase_realtime
            ADD TABLE public.agenda_pendencias;
    END IF;
END;
$body$;

NOTIFY pgrst, 'reload schema';
