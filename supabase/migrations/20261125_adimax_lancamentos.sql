-- Registro dos pedidos do CRM lançados no Adimax Pro pelo agente.
-- Serve para não lançar o mesmo pedido duas vezes (mesmo cliente + mesmo valor no CRM)
-- e para montar o relatório semanal de divergências (quartas-feiras).
create table if not exists public.adimax_lancamentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id),
  cliente_crm text not null,
  cliente_adimax text,
  lote text,
  valor_crm numeric(12,2) not null,
  valor_adimax numeric(12,2),
  prazo text,
  itens_crm jsonb not null default '[]'::jsonb,
  -- lista de {tipo, produto, quantidade, crm, adimax, valor, detalhe}
  divergencias jsonb not null default '[]'::jsonb,
  status text not null default 'salvo_edicao',
  lancado_em timestamptz not null default now(),
  relatorio_em timestamptz
);

create index if not exists adimax_lancamentos_cliente_valor_idx
  on public.adimax_lancamentos (cliente_id, valor_crm);

-- Identifica o rascunho do CRM (pedidos_em_aberto.created_at não muda nos upserts):
-- o mesmo rascunho editado depois do lançamento não é tratado como pedido novo.
alter table public.adimax_lancamentos add column if not exists crm_criado_em timestamptz;
create index if not exists adimax_lancamentos_cliente_rascunho_idx
  on public.adimax_lancamentos (cliente_id, crm_criado_em);

-- Uso interno do agente (service role / MCP). Sem políticas: nada exposto ao app.
alter table public.adimax_lancamentos enable row level security;
