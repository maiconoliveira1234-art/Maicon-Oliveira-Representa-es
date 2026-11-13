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
 if(action==="analyze"){
   const contactId=String(body.contato_map_id||"");
   if(!isUuid(contactId)) return asJson({error:"invalid_contact"},400);
   const {data:messages,error:messageError}=await admin.from("whatsapp_mensagens")
     .select("id,mensagem,recebida_em,tipo_mensagem").eq("contato_map_id",contactId)
     .eq("tipo_mensagem","texto").eq("direcao","recebida").order("recebida_em",{ascending:false}).limit(60);
   if(messageError) return asJson({error:"lookup_failed"},500);
   const sorted=[...(messages||[])].sort((a,b)=>new Date(a.recebida_em).getTime()-new Date(b.recebida_em).getTime());
   const validOrder=(s:string)=>String(s).split(/\r?\n/).filter(line=>/^\s*\d{1,4}\s*(?:(?:cxs?|caixas?|unidades?|un)\s*)?[-.)]?\s+\S/i.test(line)).length>=2;
   const anchor=[...sorted].reverse().find(row=>validOrder(row.mensagem));
   if(!anchor) return asJson({error:"no_order_list_found"},404);
   const newer=sorted.filter(row=>new Date(row.recebida_em).getTime()>=new Date(anchor.recebida_em).getTime()
      && new Date(row.recebida_em).getTime()-new Date(anchor.recebida_em).getTime()<=10*60*1000);
   const last=newer[newer.length-1]||anchor;
   const response=await fetch(url+"/functions/v1/whatsapp-order-analyze",{
     method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+service,"apikey":service},
     body:JSON.stringify({message_id:last.id})
   });
   const result=await response.json().catch(()=>({}));
   if(!response.ok) return asJson({error:"analysis_failed",detail:result?.error||response.status},response.status>=500?503:502);
   return asJson({ok:true,resultado:result});
 }
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
    const {data:currentMap,error:currentMapError}=await admin.from("whatsapp_contatos_map")
      .select("id,cliente_id,status").eq("id",contactId).maybeSingle();
    if(currentMapError) return asJson({error:"contact_lookup_failed"},500);
    const currentClientId=currentMap?.status==="vinculado"?currentMap.cliente_id:null;
    return asJson({ok:true,analises:(analyses||[]).map(a=>({
      ...a,
      cliente_id:currentClientId||null,
      mensagem:(messages||[]).find(m=>m.id===a.mensagem_id)?.mensagem||""
    }))});
 }
 if(action==="approve") {
   const analysisId=String(body.analise_id||"");
   if(!isUuid(analysisId)) return asJson({error:"invalid_analysis"},400);
   const {data:analysis,error:analysisError}=await admin.from("whatsapp_pedidos_analise")
      .select("id,mensagem_id,cliente_id,itens,status,observacoes").eq("id",analysisId).maybeSingle();
   if(analysisError||!analysis) return asJson({error:"analysis_not_found"},404);
   // Always resolve the customer from the conversation's CURRENT approved mapping.
   // An earlier order analysis may have been created before the customer was linked.
   const {data:msg,error:msgError}=await admin.from("whatsapp_mensagens")
      .select("contato_map_id").eq("id",analysis.mensagem_id).maybeSingle();
   if(msgError || !msg?.contato_map_id) return asJson({error:"contact_not_found"},409);
   const {data:map,error:mapError}=await admin.from("whatsapp_contatos_map")
      .select("cliente_id,status").eq("id",msg.contato_map_id).maybeSingle();
   if(mapError) return asJson({error:"contact_lookup_failed"},500);
   const approvedClientId=map?.status==="vinculado"?map.cliente_id:null;
   if(analysis.status!=="revisar" || !approvedClientId || !Array.isArray(analysis.itens)
     || analysis.itens.length===0 || analysis.itens.some((x:any)=>!x.resolvido || !isUuid(String(x.produto_id||""))
       || !Number.isFinite(Number(x.quantidade)) || Number(x.quantidade)<=0 || Number(x.quantidade)>100000))
     return asJson({error:"review_or_client_link_required"},409);
   const ids=[...new Set(analysis.itens.map((x:any)=>x.produto_id))];
   const {data:catalog,error:catalogError}=await admin.from("produtos").select("id,ativo,produto,quant_embalagem,peso_embalagem").in("id",ids);
   if(catalogError || (catalog||[]).filter((x:any)=>x.ativo).length!==ids.length)
     return asJson({error:"inactive_or_missing_product"},409);
   const {data:existing,error:existingError}=await admin.from("pedidos_em_aberto")
     .select("cliente_id").eq("cliente_id",approvedClientId).maybeSingle();
   if(existingError) return asJson({error:"draft_check_failed"},500);
   if(existing) return asJson({error:"existing_draft_must_be_reviewed_first"},409);
   // Quantities extracted from WhatsApp are customer-requested units unless explicit "caixa".
   // The CRM stores the commercial quantity in boxes for multipacks.
   const catalogById=new Map((catalog||[]).map((p:any)=>[p.id,p]));
   const converted:any[]=[];
   const conversions:any[]=[];
   for(const x of analysis.itens){
     const product:any=catalogById.get(x.produto_id);
     const registered=Number(product?.quant_embalagem);
     if(!product||!Number.isInteger(registered)||registered<1) return asJson({error:"invalid_package_quantity"},409);
     const label=String(product.produto||"");
     const nested=label.match(/([0-9]{1,4})\s*[xX×]\s*\(\s*([0-9]{1,4})\s*[xX×]\s*[0-9]+(?:[.,][0-9]+)?\s*(?:KG|G)\s*\)/i);
     const single=label.match(/(?:^|[^0-9])([0-9]{1,4})\s*[xX×]\s*[0-9]+(?:[.,][0-9]+)?\s*(?:KG|G)\b/i);
     const written=nested?Number(nested[1])*Number(nested[2]):single?Number(single[1]):null;
     if(written!==null && written!==registered) return asJson({error:"package_catalog_mismatch",produto:label,descricao_unidades:written,cadastro_unidades:registered},409);
     // A pack containing several retail units always uses whole boxes in the CRM.
     const raw=Number(x.quantidade);
     if(!Number.isInteger(raw)||raw<=0) return asJson({error:"invalid_requested_quantity"},409);
     const unit=String(x.unidade||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim();
     const explicitlyBoxes=/^(cx|cxs|caixa|caixas|box|boxes)$/.test(unit);
     const requestedUnits=explicitlyBoxes?raw*registered:raw;
     const boxes=explicitlyBoxes||registered===1?raw:Math.ceil(raw/registered);
     const extra=boxes*registered-requestedUnits;
     if(extra>0&&!body.aceitar_arredondamento)
       return asJson({error:"box_rounding_confirmation_required",produto:label,unidades_pedidas:requestedUnits,unidades_por_caixa:registered,caixas:boxes,unidades_extras:extra},409);
     converted.push({produto_id:x.produto_id,quantidade:boxes,tipo_operacao:"VENDA",campanhas_aplicadas:[]});
     conversions.push({produto:label,unidades_pedidas:requestedUnits,caixas:boxes,unidades_por_caixa:registered,unidades_extras:extra});
   }
   const items=converted;
   const {error:createError}=await admin.from("pedidos_em_aberto").insert({
      cliente_id:approvedClientId,items,obs:[String(analysis.observacoes||""),
       "Rascunho recebido via WhatsApp. Conversão: "+conversions.map(x=>`${x.produto}: ${x.unidades_pedidas} un solicitadas, ${x.caixas} CX de ${x.unidades_por_caixa} un${x.unidades_extras?` (${x.unidades_extras} un extras por caixa fechada)`:``}`).join("; "),
       "Conferir preços, campanhas, limites e prazos antes de finalizar."]
       .filter(Boolean).join("\\n")
   });
   if(createError) return asJson({error:createError.code==="23505"?"existing_draft_must_be_reviewed_first":"draft_creation_failed"},500);
   const {error:markError}=await admin.from("whatsapp_pedidos_analise").update({
      cliente_id:approvedClientId,status:"aprovado",aprovado_por:identity.user.id,aprovado_em:new Date().toISOString(),
      atualizado_em:new Date().toISOString()
   }).eq("id",analysis.id).eq("status","revisar");
   if(markError) console.error("analysis_mark_approved_failed",markError.message);
   return asJson({ok:true,cliente_id:approvedClientId,created_draft:true,conversoes:conversions});
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
