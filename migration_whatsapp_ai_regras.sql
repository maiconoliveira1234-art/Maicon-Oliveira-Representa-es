create table if not exists public.whatsapp_ai_regras (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  categoria text not null default 'Geral',
  regra text not null,
  prioridade smallint not null default 2 check (prioridade between 1 and 3),
  escopo_tipo text not null default 'todos' check (escopo_tipo in ('todos','cliente','linha','familia')),
  escopo_valor text null,
  cliente_id uuid null references public.clientes(id) on delete cascade,
  ativo boolean not null default true,
  valido_de date null,
  valido_ate date null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint whatsapp_ai_regras_periodo_ck check (valido_de is null or valido_ate is null or valido_de <= valido_ate),
  constraint whatsapp_ai_regras_escopo_ck check (
    (escopo_tipo = 'todos' and cliente_id is null)
    or (escopo_tipo = 'cliente' and cliente_id is not null)
    or (escopo_tipo in ('linha','familia') and nullif(btrim(escopo_valor), '') is not null and cliente_id is null)
  )
);

create index if not exists whatsapp_ai_regras_ativas_idx on public.whatsapp_ai_regras (ativo, prioridade, atualizado_em desc);
create index if not exists whatsapp_ai_regras_cliente_idx on public.whatsapp_ai_regras (cliente_id) where cliente_id is not null;

alter table public.whatsapp_ai_regras enable row level security;

create or replace function public.set_whatsapp_ai_regras_updated_at()
returns trigger language plpgsql as $$
begin
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists trg_whatsapp_ai_regras_updated_at on public.whatsapp_ai_regras;
create trigger trg_whatsapp_ai_regras_updated_at before update on public.whatsapp_ai_regras
for each row execute function public.set_whatsapp_ai_regras_updated_at();
