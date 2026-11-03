-- v1.20.186: exclusao intencional tem precedencia sobre rascunhos antigos.
-- Nao altera nem apaga pedidos existentes.
BEGIN;
CREATE TABLE IF NOT EXISTS public.pedidos_em_aberto_excluidos (
  cliente_id uuid PRIMARY KEY REFERENCES public.clientes(id) ON DELETE CASCADE,
  deleted_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.pedidos_em_aberto_excluidos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_authorized_order_deletions ON public.pedidos_em_aberto_excluidos;
CREATE POLICY crm_authorized_order_deletions
  ON public.pedidos_em_aberto_excluidos
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.crm_usuarios_autorizados a WHERE a.user_id=auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.crm_usuarios_autorizados a WHERE a.user_id=auth.uid()));
GRANT SELECT,INSERT,UPDATE ON public.pedidos_em_aberto_excluidos TO authenticated;

-- A marca e o DELETE sao uma unica transacao. O bloqueio por cliente impede
-- que outro dispositivo reinsira o mesmo pedido durante a exclusao.
CREATE OR REPLACE FUNCTION public.excluir_pedido_em_aberto(p_cliente_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public AS $fn$
BEGIN
  IF p_cliente_id IS NULL THEN RAISE EXCEPTION 'Cliente obrigatorio'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_cliente_id::text, 23941));
  INSERT INTO public.pedidos_em_aberto_excluidos (cliente_id,deleted_at)
    VALUES (p_cliente_id,clock_timestamp())
    ON CONFLICT (cliente_id) DO UPDATE SET deleted_at=EXCLUDED.deleted_at;
  DELETE FROM public.pedidos_em_aberto WHERE cliente_id=p_cliente_id;
END;
$fn$;
REVOKE ALL ON FUNCTION public.excluir_pedido_em_aberto(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.excluir_pedido_em_aberto(uuid) TO authenticated;

-- Impede ressuscitar pedido antigo mesmo a partir de aplicativos desatualizados
-- ou de filas offline. So uma NOVA venda iniciada apos a exclusao e aceita.
CREATE OR REPLACE FUNCTION public.bloquear_retorno_pedido_excluido()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $fn$
DECLARE v_excluido_em timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.cliente_id::text, 23941));
  SELECT deleted_at INTO v_excluido_em
    FROM public.pedidos_em_aberto_excluidos WHERE cliente_id=NEW.cliente_id;
  IF v_excluido_em IS NOT NULL AND NEW.started_at <= v_excluido_em THEN
    RAISE EXCEPTION 'Pedido anterior foi limpo intencionalmente; inicie um novo pedido'
      USING ERRCODE='P0001';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_bloquear_pedido_excluido ON public.pedidos_em_aberto;
CREATE TRIGGER trg_bloquear_pedido_excluido
  BEFORE INSERT OR UPDATE ON public.pedidos_em_aberto
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_retorno_pedido_excluido();
COMMIT;
