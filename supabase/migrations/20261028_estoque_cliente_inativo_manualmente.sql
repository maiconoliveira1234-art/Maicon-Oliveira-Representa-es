alter table public.estoque_cliente
  add column if not exists inativo_manualmente boolean not null default false;
