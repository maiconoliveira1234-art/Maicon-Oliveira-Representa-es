-- Mensagens do WhatsApp contadas pela Meta, por dia (fuso da conta), categoria e tipo de preço.
-- Preenchida pela edge function whatsapp-custos a partir do pricing_analytics da conta (WABA).
-- A Meta guarda só os últimos meses; esta tabela mantém o histórico. O custo só vem preenchido
-- quando o token tem permissão para ele; sem isso a tela estima pela tabela de preços da Meta.

create table if not exists public.whatsapp_custo_diario (
  dia date not null,
  -- SERVICE, UTILITY, MARKETING, AUTHENTICATION...
  categoria text not null check (length(categoria) between 1 and 60),
  -- REGULAR (cobrada), FREE_CUSTOMER_SERVICE, FREE_ENTRY_POINT...
  tipo text not null check (length(tipo) between 1 and 60),
  volume integer not null default 0 check (volume >= 0),
  -- Na moeda da conta da Meta; null quando a Meta não informa o custo.
  custo numeric(14,6) check (custo is null or custo >= 0),
  moeda text check (moeda is null or moeda ~ '^[A-Z]{3}$'),
  atualizado_em timestamptz not null default now(),
  primary key (dia, categoria, tipo)
);

alter table public.whatsapp_custo_diario enable row level security;

-- O CRM só lê; quem grava é a edge function, com a service role.
drop policy if exists crm_admin_select on public.whatsapp_custo_diario;
create policy crm_admin_select on public.whatsapp_custo_diario
  for select to authenticated
  using (exists (select 1 from public.crm_usuarios_autorizados a where a.user_id = (select auth.uid())));

drop policy if exists whatsapp_custo_diario_service_role_all on public.whatsapp_custo_diario;
create policy whatsapp_custo_diario_service_role_all on public.whatsapp_custo_diario
  for all to service_role using (true) with check (true);

revoke all on public.whatsapp_custo_diario from anon;
revoke insert, update, delete, truncate, references, trigger on public.whatsapp_custo_diario from authenticated;

-- Atualização diária, além da que a tela Custos pede ao abrir. Usa o mesmo token do cron de áudio.
select cron.unschedule('promax-whatsapp-custos')
where exists (select 1 from cron.job where jobname = 'promax-whatsapp-custos');

select cron.schedule('promax-whatsapp-custos', '23 9 * * *', $job$
  select net.http_post(
    url := 'https://ljrzmbxposgfxcymamwk.supabase.co/functions/v1/whatsapp-custos',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || c.token),
    body := '{"sync":true}'::jsonb,
    timeout_milliseconds := 60000
  )
  from public.whatsapp_audio_cron c where c.id;
$job$);
