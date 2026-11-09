import { createClient } from "npm:@supabase/supabase-js@2.101.1";
const url = Deno.env.get("SUPABASE_URL") || "";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
const admin = createClient(url, service, {auth:{persistSession:false,autoRefreshToken:false}});
const asJson=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store","access-control-allow-origin":"https://maicon-oliveira-representa-es.vercel.app","access-control-allow-headers":"authorization,apikey,content-type,x-client-info","access-control-allow-methods":"POST,OPTIONS","vary":"Origin"}});
function normalize(s:string) {return String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase()
.replace(/\bRACAS?\s+PEQUENAS?\b/g," PEQ PORTE ")
.replace(/\bPEQUENAS?\b/g," PEQ PORTE ")
.replace(/\bTODO\s+DIA\b/g," T D ")
.replace(/\bADULTO\b/g," AD ")
.replace(/[^A-Z0-9]+/g," ").trim().replace(/\s+/g," ");}
const isUuid=(x:string)=>/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
Deno.serve(async req=>{
 if(req.method==="OPTIONS") return asJson({ok:true});
 if(req.method!=="POST") return asJson({error:"method_not_allowed"},405);
 const token=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
 if(!token || !anon || !service) return asJson({error:"unauthorized"},401);
 const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:identity,error:identityError}=await client.auth.getUser(token);
 if(identityError || !identity.user) return asJson({error:"unauthorized"},401);
 const {data:allow,error:allowError}=await admin.from("crm_usuarios_autorizados")
    .select("user_id").eq("user_id",identity.user.id).maybeSingle();
 if(allowError || !allow) return asJson({error:"forbidden"},403);
 const body=await req.json().catch(()=>({}));
 const action=String(body.action||"");
 if(action==="list"){
    const contactId=String(body.contato_map_id||"");
    if(!isUuid(contactId)) return asJson({error:"invalid_contact"},400);
    const {data:messages,error:msgError}=await admin.from("whatsapp_mensagens")
      .select("id,mensagem,recebida_em").eq("contato_map_id",contactId)
      .order("recebida_em",{ascending:false}).limit(100);
    if(msgError) return asJson({error:"lookup_failed"},500);
    const ids=(messages||[]).map(m=>m.id);
    if(!ids.length) return asJson({ok:true,analises:[]});
    const {data:analyses,error:analysisError}=await admin.from("whatsapp_pedidos_analise")
      .select("id,mensagem_id,cliente_id,status,itens,observacoes,atualizado_em")
      .in("mensagem_id",ids).order("criado_em",{ascending:false});
    if(analysisError) return asJson({error:"lookup_failed"},500);
    return asJson({ok:true,analises:(analyses||[]).map(a=>({...a,mensagem:(messages||[]).find(m=>m.id===a.mensagem_id)?.mensagem||""}))});
 }
 if(action!=="confirm") return asJson({error:"unknown_action"},400);
 const analysisId=String(body.analise_id||"");
 const productId=String(body.produto_id||"");
 const itemIndex=Number(body.item_index);
 const scope=body.escopo==="cliente"?"cliente":"global";
 if(!isUuid(analysisId)||!isUuid(productId)||!Number.isInteger(itemIndex)||itemIndex<0||itemIndex>=50) return asJson({error:"invalid_input"},400);
 const {data:analysis,error:analysisError}=await admin.from("whatsapp_pedidos_analise")
  .select("id,mensagem_id,cliente_id,itens,status").eq("id",analysisId).maybeSingle();
 if(analysisError||!analysis) return asJson({error:"analysis_not_found"},404);
 if(analysis.status!=="revisar" || !Array.isArray(analysis.itens) || !analysis.itens[itemIndex]) return asJson({error:"analysis_not_reviewable"},409);
 const item=analysis.itens[itemIndex];
 if(!item || typeof item.descricao!=="string" || !Number.isFinite(Number(item.quantidade))) return asJson({error:"invalid_analysis_item"},409);
 const {data:product,error:productError}=await admin.from("produtos")
    .select("id,produto,ativo").eq("id",productId).eq("ativo",true).maybeSingle();
 if(productError||!product) return asJson({error:"product_not_active"},409);
 const clienteId=scope==="cliente"?analysis.cliente_id:null;
 if(scope==="cliente"&&!clienteId) return asJson({error:"client_not_linked"},409);
 const expression=[item.descricao,item.embalagem].filter(Boolean).join(" ").trim().slice(0,300);
 const normalized=normalize(expression);
 if(normalized.length<2) return asJson({error:"invalid_expression"},400);
 const q=admin.from("whatsapp_produtos_aprendizados").select("id,produto_id,confirmacoes,origem")
   .eq("expressao_normalizada",normalized);
 const {data:prior,error:priorError}=clienteId?await q.eq("cliente_id",clienteId).maybeSingle():await q.is("cliente_id",null).maybeSingle();
 if(priorError) return asJson({error:"lookup_failed"},500);
 let learningId:string;
 let actionName:"confirmar"|"corrigir"="confirmar";
 const now=new Date().toISOString();
 if(prior){
   learningId=prior.id;
   actionName=prior.produto_id===productId?"confirmar":"corrigir";
   const {error:updateError}=await admin.from("whatsapp_produtos_aprendizados").update({
      produto_id:productId,status:"ativo",confirmacoes:Number(prior.confirmacoes||0)+1,
      origem:actionName==="corrigir"?"correcao_manual":prior.origem,
      ultima_confirmacao_em:now,atualizado_em:now
   }).eq("id",prior.id);
   if(updateError) return asJson({error:"learning_update_failed"},500);
 } else {
   const {data:created,error:createError}=await admin.from("whatsapp_produtos_aprendizados").insert({
      expressao_original:expression,expressao_normalizada:normalized,cliente_id:clienteId,produto_id:productId,
      confirmacoes:1,origem:"confirmacao_manual"
   }).select("id").single();
   if(createError) return asJson({error:"learning_create_failed"},500);
   learningId=created.id;
 }
 const {error:historyError}=await admin.from("whatsapp_produtos_aprendizados_historico").insert({
   aprendizado_id:learningId,produto_anterior_id:prior?.produto_id||null,produto_novo_id:productId,
   acao:actionName,mensagem_id:analysis.mensagem_id,confirmado_por:identity.user.id
 });
 if(historyError) {console.error("learning_history_failed",historyError.message);return asJson({error:"history_write_failed"},500);}
 const items=analysis.itens.map((row:any,index:number)=>index===itemIndex?{
   ...row,produto_id:productId,resolvido:true,sugestao_produto_id:productId,
   origem_sugestao:"confirmacao_manual",confianca:"confirmado"
 }:row);
 const {error:itemError}=await admin.from("whatsapp_pedidos_analise").update({
   itens:items,atualizado_em:now
 }).eq("id",analysisId);
 if(itemError) return asJson({error:"analysis_update_failed"},500);
 return asJson({ok:true,acao:actionName,produto:product.produto,escopo:scope,aprendizado_id:learningId});
});
