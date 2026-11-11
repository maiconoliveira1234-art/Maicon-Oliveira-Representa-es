import { createClient } from "npm:@supabase/supabase-js@2.101.1";

// EasyCoexistence incoming WhatsApp webhook; dedicated callback URL access secret.
// Signature is signed by provider app so do not pretend to validate Meta HMAC here.
// Reject all posts until commercial phone ID has been configured.
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" }
});
const enc = new TextEncoder();
const configured = (key: string) => (Deno.env.get(key) || "").trim();
const hex = (bytes: Uint8Array) => [...bytes].map(x => x.toString(16).padStart(2, "0")).join("");
async function digest(data: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(data))));
}
Deno.serve(async req => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const verifyToken = configured("EASYCOEXISTENCE_WEBHOOK_SECRET");
    if (!verifyToken) return json({error: "not_configured"}, 503);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode !== "subscribe" || token !== verifyToken || !challenge || url.searchParams.get("access") !== verifyToken) return json({error: "forbidden"}, 403);
    return new Response(challenge, {status: 200, headers: {"content-type": "text/plain"}});
  }
  if (req.method !== "POST") return json({error: "method_not_allowed"}, 405);
  const secret = configured("EASYCOEXISTENCE_WEBHOOK_SECRET");
  const expectedPhoneId = configured("EASYCOEXISTENCE_PHONE_NUMBER_ID");
  const dbUrl = configured("SUPABASE_URL");
  const dbSecret = configured("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !expectedPhoneId || !dbUrl || !dbSecret) return json({error: "not_configured"}, 503);
  const raw = await req.text();
  if (raw.length > 2_000_000) return json({error: "payload_too_large"}, 413);
  if (url.searchParams.get("access") !== secret)
    return json({error: "invalid_signature"}, 401);
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return json({error: "invalid_json"}, 400); }
  if (payload?.object !== "whatsapp_business_account") return json({ok: true, ignored: true});
  const db = createClient(dbUrl, dbSecret, {auth: {persistSession: false, autoRefreshToken: false}});
  try {
    let received = 0;
    let unsupported = 0;
    for (const entry of payload.entry || []) for (const change of entry.changes || []) {
      if (change.field !== "messages") continue;
      const value = change.value || {};
      if (String(value.metadata?.phone_number_id || "") !== expectedPhoneId) continue;
      // Statuses and other echo/history events require their own processing;
      // do not treat them as incoming customer messages.
      for (const message of value.messages || []) {
        if (!message?.id || !message?.from) continue;
        const isText = message.type === "text" && typeof message.text?.body === "string";
        const isAudio = message.type === "audio" && typeof message.audio?.id === "string";
        if (!isText && !isAudio) { unsupported++; continue; }
        const phone = String(message.from).replace(/\D/g, "");
        if (!phone) continue;
        const sender = "WA " + phone;
        const body = isAudio ? "🎤 Áudio recebido — aguardando transcrição" : String(message.text.body).trim();
        if (!body) continue;
        const receivedAt = /^\d{9,13}$/.test(String(message.timestamp || ""))
          ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString();
        // Match only a unique phone; never guess by contact name.
        const {data: customers, error: customerError} = await db.from("clientes")
          .select("id,telefone").not("telefone", "is", null);
        if (customerError) throw customerError;
        const matches = (customers || []).filter((c: any) => {
          const digits = String(c.telefone ?? "").replace(/\D/g, "");
          return (digits.length === 10 || digits.length === 11 ? "55" + digits : digits) === phone;
        });
        const matchedClientId = matches.length === 1 ? matches[0].id : null;
        const profileName = String((value.contacts || []).find((c: any) => String(c.wa_id || "").replace(/\D/g, "") === phone)?.profile?.name || "").trim().slice(0,120);
        const {data: phoneMapping, error: phoneMapError} = await db.from("whatsapp_numeros_map")
          .select("contato_map_id").eq("phone_e164",phone).maybeSingle();
        if (phoneMapError) throw phoneMapError;
        let {data: mapping, error: mapError} = await db.from("whatsapp_contatos_map")
          .select("id,cliente_id,status,total_mensagens,whatsapp_nome,whatsapp_perfil_nome")
          .eq(phoneMapping?.contato_map_id ? "id" : "nome_normalizado",
            phoneMapping?.contato_map_id || sender.toLowerCase()).maybeSingle();
        if (mapError) throw mapError;
        if (!mapping) {
          const insert = await db.from("whatsapp_contatos_map")
            .insert({whatsapp_nome: sender, status: "pendente", total_mensagens: 0})
            .select("id,cliente_id,status,total_mensagens,whatsapp_nome,whatsapp_perfil_nome").single();
          if (insert.error) {
            const retry = await db.from("whatsapp_contatos_map")
              .select("id,cliente_id,status,total_mensagens,whatsapp_nome,whatsapp_perfil_nome").eq("nome_normalizado", sender.toLowerCase()).maybeSingle();
            if (retry.error || !retry.data) throw insert.error;
            mapping = retry.data;
          } else mapping = insert.data;
        }
        // Stabilize identity by WhatsApp number; display names never determine a client link.
        if (!phoneMapping) {
          const {error: phoneInsertError} = await db.from("whatsapp_numeros_map")
            .insert({phone_e164:phone,contato_map_id:mapping.id,origem:"cloud"});
          if (phoneInsertError && phoneInsertError.code !== "23505") throw phoneInsertError;
          if (phoneInsertError?.code === "23505") {
            const {data: winner, error: winnerError} = await db.from("whatsapp_numeros_map")
              .select("contato_map_id").eq("phone_e164",phone).single();
            if (winnerError) throw winnerError;
            if (winner.contato_map_id !== mapping.id) {
              const {data: resolved,error: resolvedError} = await db.from("whatsapp_contatos_map")
                .select("id,cliente_id,status,total_mensagens,whatsapp_nome,whatsapp_perfil_nome")
                .eq("id",winner.contato_map_id).single();
              if (resolvedError) throw resolvedError;
              mapping=resolved;
            }
          }
        }
        if (profileName && profileName !== mapping.whatsapp_perfil_nome) {
          const {error: profileError} = await db.from("whatsapp_contatos_map")
            .update({whatsapp_perfil_nome:profileName}).eq("id",mapping.id);
          if (profileError) console.warn("profile name update failed",profileError.code);
        }
        // Keep existing manual links; never reassign an already linked contact.
        if (mapping.status === "pendente" && matchedClientId) {
          const updated = await db.from("whatsapp_contatos_map")
            .update({cliente_id: matchedClientId, status: "vinculado"})
            .eq("id", mapping.id).eq("status", "pendente")
            .select("id,cliente_id,status,total_mensagens,whatsapp_nome,whatsapp_perfil_nome").maybeSingle();
          if (updated.error) throw updated.error;
          if (updated.data) mapping = updated.data;
        }
        const inserted = await db.from("whatsapp_mensagens").insert({
          contato_map_id: mapping.id,
          cliente_id: mapping.status === "vinculado" ? mapping.cliente_id : null,
          whatsapp_nome: sender,
          mensagem: body,
          app_package: "easycoexistence.cloud_api",
          tipo_mensagem: isAudio ? "audio" : "texto",
          ...(isAudio ? {audio_status: "pendente", audio_arquivo_nome: "meta-media:" + String(message.audio.id).slice(0,200)} : {}),
          dedupe_key: await digest("easycoexistence:" + String(message.id)),
          recebida_em: receivedAt
        }).select("id").single();
        if (inserted.error) {
          if (inserted.error.code === "23505") continue;
          throw inserted.error;
        }
        received++;
        if (isAudio) {
          // Cloud audio must be downloaded by its Meta media ID; the Android
          // notification uploader has been deliberately disabled.
          const transcription = fetch(dbUrl + "/functions/v1/whatsapp-cloud-audio-transcribe",{
            method:"POST",
            headers:{"content-type":"application/json","authorization":"Bearer "+dbSecret,"apikey":dbSecret},
            body:JSON.stringify({message_id:inserted.data.id})
          }).then(async response=>{
            if(!response.ok)console.warn("cloud audio transcription status",response.status);
          }).catch(error=>console.warn("cloud audio request failed",String(error)));
          const runtime=(globalThis as any).EdgeRuntime;
          if(runtime?.waitUntil)runtime.waitUntil(transcription);
          else await transcription;
        }
        // Analyze apparent order requests asynchronously. This only writes to
        // whatsapp_pedidos_analise; never creates or updates actual orders.
        const productLines = body.split(/\r?\n/).filter(line => /^\s*\d{1,4}\s*(?:(?:cxs?|caixas?|unidades?|un)\s*)?[-.)]?\s+\S/i.test(line)).length;
        const hasOrderList = productLines >= 2;
        const likelyCorrection = /\b(aumentei|diminui|reduzi|altere[ia]|corrigi|troquei|acrescentei|faltou)\b/i.test(body);
        let correctionToList = false;
        if (isText && !hasOrderList && likelyCorrection) {
          const {data: previous, error: contextError} = await db.from("whatsapp_mensagens")
            .select("mensagem").eq("contato_map_id",mapping.id).eq("tipo_mensagem","texto")
            .gte("recebida_em",new Date(new Date(receivedAt).getTime()-10*60*1000).toISOString())
            .lte("recebida_em",receivedAt).order("recebida_em",{ascending:false}).limit(12);
          if (contextError) throw contextError;
          correctionToList = (previous||[]).some((row:any) =>
            String(row.mensagem).split(/\r?\n/).filter((line:string)=>/^\s*\d{1,4}\s*(?:(?:cxs?|caixas?|unidades?|un)\s*)?[-.)]?\s+\S/i.test(line)).length>=2);
        }
        if (isText && (hasOrderList || correctionToList || /\bpedido\b|\b\d+\s*(?:sacos?|caixas?|unidades?|un|kg)\b/i.test(body))) {
          const analysis = fetch(dbUrl + "/functions/v1/whatsapp-order-analyze", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "authorization": "Bearer " + dbSecret,
              "apikey": dbSecret
            },
            body: JSON.stringify({message_id: inserted.data.id})
          }).then(async response => {
            if (!response.ok) console.warn("order analysis failed", response.status, (await response.text()).slice(0,250));
          }).catch(error => console.warn("order analysis request error", String(error)));
          const runtime = (globalThis as any).EdgeRuntime;
          if (runtime?.waitUntil) runtime.waitUntil(analysis);
          else await analysis;
        }
        await db.from("whatsapp_contatos_map").update({
          total_mensagens: Number(mapping.total_mensagens || 0) + 1,
          ultima_vez_em: new Date().toISOString()
        }).eq("id", mapping.id);
      }
    }
    return json({ok: true, received, unsupported});
  } catch (e) {
    console.error("easycoexistence-whatsapp-webhook:", e instanceof Error ? e.message : JSON.stringify(e));
    // Non-2xx tells Meta to retry transient failures.
    return json({error: "processing_failed"}, 500);
  }
});
