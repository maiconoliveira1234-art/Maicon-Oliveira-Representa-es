-- MIGRATION: ADD GEOLOCATION AND NEIGHBORHOOD COLUMNS
-- Execute este código no SQL Editor do seu projeto Supabase

-- 1. Habilitar a extensão PostGIS (para cálculos geográficos precisos)
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Adicionar colunas na tabela de clientes
ALTER TABLE public.clientes 
ADD COLUMN IF NOT EXISTS bairro TEXT,
ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 8),
ADD COLUMN IF NOT EXISTS longitude NUMERIC(11, 8);

-- 3. Adicionar colunas na tabela de agenda_visitas
ALTER TABLE public.agenda_visitas
ADD COLUMN IF NOT EXISTS bairro TEXT,
ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 8),
ADD COLUMN IF NOT EXISTS longitude NUMERIC(11, 8);

-- 4. Sincronizar dados existentes (se houver)
UPDATE public.agenda_visitas av
SET bairro = c.bairro
FROM public.clientes c
WHERE av.cliente_id = c.id AND av.bairro IS NULL;

-- 5. Função para sincronizar coordenadas
CREATE OR REPLACE FUNCTION sync_agenda_coordinates()
RETURNS void AS $$
BEGIN
  UPDATE public.agenda_visitas av
  SET 
    latitude = c.latitude,
    longitude = c.longitude,
    bairro = c.bairro
  FROM public.clientes c
  WHERE av.cliente_id = c.id
    AND av.latitude IS NULL 
    AND c.latitude IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- 5. Comentários para ajudar na organização
COMMENT ON COLUMN public.clientes.latitude IS 'Latitude aproximada do endereço do cliente.';
COMMENT ON COLUMN public.clientes.longitude IS 'Longitude aproximada do endereço do cliente.';
COMMENT ON COLUMN public.agenda_visitas.latitude IS 'Latitude da visita (copiada do cliente).';
COMMENT ON COLUMN public.agenda_visitas.longitude IS 'Longitude da visita (copiada do cliente).';

-- 6. Garantir permissões de acesso (RLS)
-- Execute estas linhas se o botão de otimizar não estiver salvando as alterações
ALTER TABLE public.agenda_visitas ENABLE ROW LEVEL SECURITY;

-- Política para permitir que usuários autenticados vejam e editem a agenda
-- (Ajuste conforme sua lógica de multi-usuário se necessário)
CREATE POLICY "Permitir update para usuários autenticados" 
ON public.agenda_visitas 
FOR UPDATE 
TO authenticated 
USING (true) 
WITH CHECK (true);

CREATE POLICY "Permitir select para usuários autenticados" 
ON public.agenda_visitas 
FOR SELECT 
TO authenticated 
USING (true);

-- 7. Função para reordenação automática baseada em proximidade (Greedy TSP)
-- Esta função pode ser chamada passando a semana, o dia e o ID do vendedor
CREATE OR REPLACE FUNCTION reorder_agenda_by_proximity(
    p_vendedor_id UUID,
    p_semana INTEGER,
    p_dia_semana TEXT,
    p_start_lat NUMERIC,
    p_start_lon NUMERIC
) RETURNS void AS $$
DECLARE
    r RECORD;
    v_current_lat NUMERIC := p_start_lat;
    v_current_lon NUMERIC := p_start_lon;
    v_ordem INTEGER := 1;
    v_nearest_id UUID;
BEGIN
    -- Cria uma tabela temporária para processar
    CREATE TEMP TABLE temp_visitas AS
    SELECT id, latitude, longitude
    FROM public.agenda_visitas
    WHERE vendedor_id = p_vendedor_id 
      AND semana = p_semana 
      AND dia_semana = p_dia_semana
      AND latitude IS NOT NULL;

    WHILE EXISTS (SELECT 1 FROM temp_visitas) LOOP
        -- Encontra a visita mais próxima da posição atual
        SELECT id, latitude, longitude INTO v_nearest_id, v_current_lat, v_current_lon
        FROM temp_visitas
        ORDER BY ST_Distance(
            ST_SetSRID(ST_MakePoint(longitude, latitude), 4326),
            ST_SetSRID(ST_MakePoint(v_current_lon, v_current_lat), 4326)
        )
        LIMIT 1;

        -- Atualiza a ordem na tabela original
        UPDATE public.agenda_visitas
        SET ordem_visita = v_ordem
        WHERE id = v_nearest_id;

        -- Remove da tabela temporária e incrementa ordem
        DELETE FROM temp_visitas WHERE id = v_nearest_id;
        v_ordem := v_ordem + 1;
    END LOOP;

    DROP TABLE temp_visitas;
END;
$$ LANGUAGE plpgsql;
