-- Pairs "what the AI suggested" / "what Maicon actually sent" captured when a reply is sent from the CRM.
-- Used to teach the suggestion prompt and the style profile from his edits.

create table if not exists public.whatsapp_ai_correcoes (
  id uuid primary key default gen_random_uuid(),
  contato_map_id uuid references public.whatsapp_contatos_map(id) on delete cascade,
  mensagem_alvo_id uuid references public.whatsapp_mensagens(id) on delete set null,
  mensagem_enviada_id uuid references public.whatsapp_mensagens(id) on delete set null,
  pergunta text,
  sugestao_ia text not null,
  texto_enviado text not null,
  alterado boolean not null,
  criado_em timestamptz not null default now()
);

create index if not exists whatsapp_ai_correcoes_contato_idx on public.whatsapp_ai_correcoes (contato_map_id, criado_em desc);
create index if not exists whatsapp_ai_correcoes_criado_idx on public.whatsapp_ai_correcoes (criado_em desc);

alter table public.whatsapp_ai_correcoes enable row level security;

drop policy if exists crm_admin_authenticated on public.whatsapp_ai_correcoes;
create policy crm_admin_authenticated on public.whatsapp_ai_correcoes
  for all to authenticated
  using (exists (select 1 from public.crm_usuarios_autorizados a where a.user_id = (select auth.uid())))
  with check (exists (select 1 from public.crm_usuarios_autorizados a where a.user_id = (select auth.uid())));

drop policy if exists whatsapp_ai_correcoes_service_role_all on public.whatsapp_ai_correcoes;
create policy whatsapp_ai_correcoes_service_role_all on public.whatsapp_ai_correcoes
  for all to service_role using (true) with check (true);
