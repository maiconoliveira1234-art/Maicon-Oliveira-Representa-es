import { createClient } from "npm:@supabase/supabase-js@2.101.1";

// WhatsApp Cloud API webhook. Never accept unsigned POST requests.
// Required secrets: META_WHATSAPP_VERIFY_TOKEN, META_APP_SECRET,
// META_PHONE_NUMBER_ID. No message is accepted until configured.
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" }
});
const enc = new TextEncoder();
const configured = (key: string) => (Deno.env.get(key) || "").trim();
const hex = (bytes: Uint8Array) => [...bytes].map(x => x.toString(16).padStart(2, "0")).join("");
async function digest(data: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(data))));
}
async function validSignature(payload: string, header: string, secret: string) {
  if (!/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
  const supplied = new Uint8Array(header.slice(7).match(/.{2}/g)!.map(x => parseInt(x, 16)));
  if (expected.length !== supplied.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ supplied[i];
  return diff === 0;
}
Deno.serve(async req => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const verifyToken = configured("META_WHATSAPP_VERIFY_TOKEN");
    if (!verifyToken) return json({error: "not_configured"}, 503);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode !== "subscribe" || token !== verifyToken || !challenge) return json({error: "forbidden"}, 403);
    return new Response(challenge, {status: 200, headers: {"content-type": "text/plain"}});
  }
  if (req.method !== "POST") return json({error: "method_not_allowed"}, 405);
  const secret = configured("META_APP_SECRET");
  const expectedPhoneId = configured("META_PHONE_NUMBER_ID");
  const dbUrl = configured("SUPABASE_URL");
  const dbSecret = configured("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !expectedPhoneId || !dbUrl || !dbSecret) return json({error: "not_configured"}, 503);
  const raw = await req.text();
  if (raw.length > 2_000_000) return json({error: "payload_too_large"}, 413);
  if (!await validSignature(raw, req.headers.get("x-hub-signature-256") || "", secret))
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
        if (message.type !== "text" || !message.text?.body) { unsupported++; continue; }
        const phone = String(message.from).replace(/\D/g, "");
        if (!phone) continue;
        const sender = "WA " + phone;
        const body = String(message.text.body).trim();
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
        let {data: mapping, error: mapError} = await db.from("whatsapp_contatos_map")
          .select("id,cliente_id,status,total_mensagens")
          .eq("nome_normalizado", sender.toLowerCase()).maybeSingle();
        if (mapError) throw mapError;
        if (!mapping) {
          const insert = await db.from("whatsapp_contatos_map")
            .insert({whatsapp_nome: sender, status: "pendente", total_mensagens: 0})
            .select("id,cliente_id,status,total_mensagens").single();
          if (insert.error) {
            const retry = await db.from("whatsapp_contatos_map")
              .select("id,cliente_id,status,total_mensagens").eq("nome_normalizado", sender.toLowerCase()).maybeSingle();
            if (retry.error || !retry.data) throw insert.error;
            mapping = retry.data;
          } else mapping = insert.data;
        }
        // Keep existing manual links; never reassign an already linked contact.
        if (mapping.status === "pendente" && matchedClientId) {
          const updated = await db.from("whatsapp_contatos_map")
            .update({cliente_id: matchedClientId, status: "vinculado"})
            .eq("id", mapping.id).eq("status", "pendente")
            .select("id,cliente_id,status,total_mensagens").maybeSingle();
          if (updated.error) throw updated.error;
          if (updated.data) mapping = updated.data;
        }
        const inserted = await db.from("whatsapp_mensagens").insert({
          contato_map_id: mapping.id,
          cliente_id: mapping.status === "vinculado" ? mapping.cliente_id : null,
          whatsapp_nome: sender,
          mensagem: body,
          app_package: "meta.cloud_api",
          tipo_mensagem: "texto",
          dedupe_key: await digest("meta:" + String(message.id)),
          recebida_em: receivedAt
        }).select("id").single();
        if (inserted.error) {
          if (inserted.error.code === "23505") continue;
          throw inserted.error;
        }
        received++;
        // Analyze apparent order requests asynchronously. This only writes to
        // whatsapp_pedidos_analise; never creates or updates actual orders.
        if (/\\bpedido\\b|\\b\\d+\\s*(?:sacos?|caixas?|unidades?|un|kg)\\b/i.test(body)) {
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
    console.error("meta-whatsapp-webhook:", e instanceof Error ? e.message : String(e));
    // Non-2xx tells Meta to retry transient failures.
    return json({error: "processing_failed"}, 500);
  }
});
