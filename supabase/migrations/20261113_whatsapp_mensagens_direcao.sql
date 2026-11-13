-- Direction of each captured WhatsApp message. Every existing row is an incoming
-- customer message, so the default keeps all current data and behavior unchanged.
alter table public.whatsapp_mensagens
  add column if not exists direcao text not null default 'recebida';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'whatsapp_mensagens_direcao_check'
      and conrelid = 'public.whatsapp_mensagens'::regclass
  ) then
    alter table public.whatsapp_mensagens
      add constraint whatsapp_mensagens_direcao_check check (direcao in ('recebida', 'enviada'));
  end if;
end $$;

create index if not exists whatsapp_mensagens_contato_recebida_idx
  on public.whatsapp_mensagens (contato_map_id, recebida_em desc);
