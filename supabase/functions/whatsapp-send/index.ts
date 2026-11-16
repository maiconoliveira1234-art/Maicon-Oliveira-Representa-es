import { createClient } from "npm:@supabase/supabase-js@2.101.1";

// Sends a text reply to a customer through the WhatsApp Cloud API (Coexistence number).
// Always triggered by an explicit tap in the CRM; nothing here sends on its own.
const url = Deno.env.get("SUPABASE_URL") || "";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
const phoneNumberId = (Deno.env.get("EASYCOEXISTENCE_PHONE_NUMBER_ID") || "").trim();
const accessToken = (Deno.env.get("EASYCOEXISTENCE_ACCESS_TOKEN") ||
  Deno.env.get("EASYCOEXISTENCE_ACCCESS_TOKEN") ||
  Deno.env.get("META_WHATSAPP_ACCESS_TOKEN") ||
  Deno.env.get("WHATSAPP_CLOUD_ACCESS_TOKEN") ||
  Deno.env.get("META_ACCESS_TOKEN") || "").trim();
const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

const cors = {
  "access-control-allow-origin": "https://maicon-oliveira-representa-es.vercel.app",
  "access-control-allow-headers": "authorization,apikey,content-type,x-client-info",
  "access-control-allow-methods": "POST,OPTIONS",
  "vary": "Origin",
};
const asJson = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" },
});
const isUuid = (x: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const flat = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const mask = (s: string) => String(s || "").replace(/\d{9,}/g, "[número]").replace(/\s+/g, " ").trim();
async function digest(data: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)));
  return [...bytes].map(x => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return asJson({ ok: true });
  if (req.method !== "POST") return asJson({ error: "method_not_allowed" }, 405);
  if (!url || !service || !anon || !phoneNumberId || !accessToken) return asJson({ error: "not_configured" }, 503);

  try {
    const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return asJson({ error: "unauthorized" }, 401);
    const userClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: identity, error: identityError } = await userClient.auth.getUser(jwt);
    if (identityError || !identity.user) return asJson({ error: "unauthorized" }, 401);
    const { data: allow, error: allowError } = await admin.from("crm_usuarios_autorizados")
      .select("user_id").eq("user_id", identity.user.id).maybeSingle();
    if (allowError || !allow) return asJson({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const messageId = String(body?.message_id || "");
    const texto = String(body?.texto || "").replace(/\r\n/g, "\n").trim();
    if (!isUuid(messageId)) return asJson({ error: "invalid_message" }, 400);
    if (!texto) return asJson({ error: "texto_vazio" }, 400);
    if (texto.length > 4000) return asJson({ error: "texto_longo" }, 400);

    const { data: target, error: targetError } = await admin.from("whatsapp_mensagens")
      .select("id, contato_map_id, direcao, mensagem, transcricao_audio, sugestao_resposta")
      .eq("id", messageId).maybeSingle();
    if (targetError) return asJson({ error: "lookup_failed" }, 500);
    if (!target) return asJson({ error: "message_not_found" }, 404);
    if (target.direcao !== "recebida" || !target.contato_map_id) return asJson({ error: "message_not_inbound" }, 409);

    const { data: mapping, error: mappingError } = await admin.from("whatsapp_contatos_map")
      .select("id, cliente_id, status, whatsapp_nome, total_mensagens").eq("id", target.contato_map_id).maybeSingle();
    if (mappingError) return asJson({ error: "lookup_failed" }, 500);
    if (!mapping) return asJson({ error: "message_not_found" }, 404);

    // Meta only allows free-form text within 24h of the customer's last message.
    const { data: lastIncoming, error: lastError } = await admin.from("whatsapp_mensagens")
      .select("recebida_em").eq("contato_map_id", mapping.id).eq("direcao", "recebida")
      .order("recebida_em", { ascending: false }).limit(1).maybeSingle();
    if (lastError) return asJson({ error: "lookup_failed" }, 500);
    if (!lastIncoming || Date.now() - new Date(lastIncoming.recebida_em).getTime() > 24 * 3600 * 1000) {
      return asJson({ error: "janela_24h" }, 409);
    }

    const { data: numbers, error: numbersError } = await admin.from("whatsapp_numeros_map")
      .select("phone_e164, origem, atualizado_em").eq("contato_map_id", mapping.id);
    if (numbersError) return asJson({ error: "lookup_failed" }, 500);
    const phone = [...(numbers || [])]
      .sort((a, b) => (a.origem === "cloud" ? 0 : 1) - (b.origem === "cloud" ? 0 : 1)
        || new Date(b.atualizado_em).getTime() - new Date(a.atualizado_em).getTime())
      .map(n => String(n.phone_e164 || "").replace(/\D/g, "")).find(p => p.length >= 10 && p.length <= 15);
    if (!phone) return asJson({ error: "sem_telefone" }, 409);

    // Double tap guard: same text to the same contact in the last 60 seconds.
    const since = new Date(Date.now() - 60_000).toISOString();
    const { data: recentSent } = await admin.from("whatsapp_mensagens")
      .select("mensagem").eq("contato_map_id", mapping.id).eq("direcao", "enviada").gte("recebida_em", since).limit(10);
    if ((recentSent || []).some(r => flat(r.mensagem) === flat(texto))) return asJson({ error: "envio_duplicado" }, 409);

    const graph = await fetch(`https://graph.facebook.com/v25.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp", recipient_type: "individual", to: phone,
        type: "text", text: { preview_url: false, body: texto },
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const graphBody = await graph.json().catch(() => ({}));
    if (!graph.ok) {
      const code = Number(graphBody?.error?.code || 0);
      console.warn("whatsapp send failed", graph.status, code, graphBody?.error?.error_subcode || "");
      if (code === 131047) return asJson({ error: "janela_24h" }, 409);
      if (code === 190 || graph.status === 401) return asJson({ error: "token_invalido" }, 502);
      return asJson({ error: "envio_falhou", codigo: code || graph.status }, 502);
    }
    const wamid = String(graphBody?.messages?.[0]?.id || "");
    if (!wamid) return asJson({ error: "envio_falhou", codigo: 0 }, 502);

    // From here on the message is already sent: record problems but never report a failed send.
    const nowIso = new Date().toISOString();
    let warning: string | null = null;
    let sentRowId: string | null = null;
    const inserted = await admin.from("whatsapp_mensagens").insert({
      contato_map_id: mapping.id,
      cliente_id: mapping.status === "vinculado" ? mapping.cliente_id : null,
      whatsapp_nome: mapping.whatsapp_nome,
      mensagem: texto,
      app_package: "easycoexistence.cloud_api",
      tipo_mensagem: "texto",
      direcao: "enviada",
      visualizada_em: nowIso,
      // Same key the echo webhook would use, so a late echo of this message is ignored.
      dedupe_key: await digest("easycoexistence-echo:" + wamid),
      recebida_em: nowIso,
    }).select("id").single();
    if (inserted.error) {
      if (inserted.error.code !== "23505") { warning = "registro_falhou"; console.warn("sent row insert failed", inserted.error.code); }
    } else sentRowId = inserted.data.id;

    await admin.from("whatsapp_contatos_map")
      .update({ total_mensagens: (mapping.total_mensagens || 0) + 1, ultima_vez_em: nowIso })
      .eq("id", mapping.id);

    const suggestion = String(target.sugestao_resposta || "").trim();
    let alterado: boolean | null = null;
    if (suggestion) {
      alterado = flat(suggestion) !== flat(texto);
      const { error: learnError } = await admin.from("whatsapp_ai_correcoes").insert({
        contato_map_id: mapping.id,
        mensagem_alvo_id: target.id,
        mensagem_enviada_id: sentRowId,
        pergunta: mask(String(target.transcricao_audio || target.mensagem || "")).slice(0, 600),
        sugestao_ia: mask(suggestion).slice(0, 2000),
        texto_enviado: mask(texto).slice(0, 2000),
        alterado,
      });
      if (learnError) console.warn("correction insert failed", learnError.code);
      // The suggestion has been consumed; a later send for the same message must not be compared with it again.
      else await admin.from("whatsapp_mensagens").update({ sugestao_resposta: null }).eq("id", target.id);
    }

    return asJson({ ok: true, message_id: sentRowId, wamid, alterado, ...(warning ? { warning } : {}) });
  } catch (error) {
    console.error("whatsapp-send", error instanceof Error ? error.message : "unknown");
    return asJson({ error: "operation_failed" }, 500);
  }
});
