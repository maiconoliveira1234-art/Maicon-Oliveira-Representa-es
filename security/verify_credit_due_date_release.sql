-- Teste de integração transacional: não deixa dados persistidos.
begin;
do $test$
declare
 c uuid; e uuid; saldo numeric; n integer; nome text; produto text; pid uuid;
 ref text := 'codex-test-' || gen_random_uuid()::text;
begin
 select ef.cliente_comercial_id, cl.cliente into c,nome from public.entidades_financeiras ef join public.clientes cl on cl.id=ef.cliente_comercial_id limit 1;
 select id, p.produto into pid,produto from public.produtos p limit 1;
 insert into public.entidades_financeiras(cliente_comercial_id,razao_social,limite_total,disponivel_oficial_snapshot,data_snapshot,titulos_conferidos,situacao)
 values(c,'TESTE TRANSACIONAL SEM PERSISTENCIA',1000,1000,'2026-11-01',false,'ativo') returning id into e;
 perform public.importar_faturamento_transacional(c,ref,'2026-11-06',
 jsonb_build_array(jsonb_build_object('cliente_id',c,'cliente',nome,'faturamento','2026-11-06','produtos',produto,'produto_id',pid,'qtd',1,'r_total',300,'vendas','VENDAS','xdt',0,'acresc_val',0,'numero_pedido_erp',ref,'entidade_financeira_id',e,
 'parcelas_credito',jsonb_build_array(jsonb_build_object('vencimento','2026-11-28','valor',100),jsonb_build_object('vencimento','2026-12-05','valor',200)))),0,'[]'::jsonb);
 select count(*) into n from public.titulos_credito where entidade_financeira_id=e;
 if n <> 2 then raise exception 'Falha: importação não criou dois boletos'; end if;
 select disponivel_estimado into saldo from public.saldo_credito_projetado(e,'2026-11-27');
 if saldo <> 700 then raise exception 'Falha antes do vencimento: %',saldo; end if;
 select disponivel_estimado into saldo from public.saldo_credito_projetado(e,'2026-11-28');
 if saldo <> 800 then raise exception 'Falha no vencimento: %',saldo; end if;
 select disponivel_estimado into saldo from public.saldo_credito_projetado(e,'2026-11-28');
 if saldo <> 800 then raise exception 'Falha na idempotência: %',saldo; end if;
 select disponivel_estimado into saldo from public.saldo_credito_projetado(e,'2026-12-05');
 if saldo <> 1000 then raise exception 'Falha na liberação final: %',saldo; end if;
end $test$;
rollback;
