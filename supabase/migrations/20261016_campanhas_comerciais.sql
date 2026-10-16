-- Cadastro de campanhas; regras aprovadas pela pessoa usuária são JSON estruturado.
-- CRM atual usa chave anon no navegador e políticas abertas nas tabelas operacionais.
-- A política abaixo segue esse modelo legado; requer login/RLS restritiva para multiusuário.
create table if not exists public.campanhas_comerciais (
  id uuid primary key default gen_random_uuid(),
  titulo text not null check(length(trim(titulo)) between 1 and 150),
  descricao text not null default '',
  status text not null default 'rascunho'
    check(status in ('rascunho','ativa','pausada','encerrada')),
  inicio date not null,
  fim date not null,
  imagem_data text check(imagem_data is null or length(imagem_data) <= 1400000),
  regras jsonb not null default '[]'::jsonb check(jsonb_typeof(regras) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campanhas_periodo_valido check (inicio <= fim)
);
create index if not exists campanhas_comerciais_vigentes_idx on public.campanhas_comerciais(status, inicio, fim);
alter table public.campanhas_comerciais enable row level security;
grant select, insert, update on public.campanhas_comerciais to anon, authenticated;
create policy "campanhas_crm_legado_leitura" on public.campanhas_comerciais
  for select to anon, authenticated using (true);
create policy "campanhas_crm_legado_insercao" on public.campanhas_comerciais
  for insert to anon, authenticated with check (true);
create policy "campanhas_crm_legado_edicao" on public.campanhas_comerciais
  for update to anon, authenticated using (true) with check (true);
