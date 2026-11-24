import { createClient } from "npm:@supabase/supabase-js@2.101.1";
import { parsePricing, pricingFields, syncWindow } from "./pricing.ts";

// Busca na Meta (pricing_analytics da conta do WhatsApp) quanto as mensagens custaram por dia e
// grava em public.whatsapp_custo_diario. Chamada pela tela Custos ao abrir (usuário do CRM) e uma
// vez por dia pelo pg_cron (token de public.whatsapp_audio_cron). Não envia nada a ninguém.
const url = Deno.env.get("SUPABASE_URL") || "";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
// Conta do WhatsApp Business (WABA) do número conectado pelo easyCoexistence.
const wabaId = (Deno.env.get("EASYCOEXISTENCE_WABA_ID") || "100932372740462").trim();
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

async function authorized(bearer: string): Promise<boolean> {
  if (!bearer) return false;
  if (bearer === service) return true;
  const { data: cron } = await admin.from("whatsapp_audio_cron").select("token").eq("id", true).maybeSingle();
  if (cron?.token && cron.token === bearer) return true;
  const userClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: identity, error } = await userClient.auth.getUser(bearer);
  if (error || !identity.user) return false;
  const { data: allow } = await admin.from("crm_usuarios_autorizados").select("user_id").eq("user_id", identity.user.id).maybeSingle();
  return Boolean(allow);
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return asJson({ ok: true });
  if (req.method !== "POST") return asJson({ error: "method_not_allowed" }, 405);
  if (!url || !service || !anon || !wabaId || !accessToken) return asJson({ error: "not_configured" }, 503);
  try {
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!(await authorized(bearer))) return asJson({ error: "unauthorized" }, 401);

    const { start, end, firstDay } = syncWindow();
    const ask = async (withCost: boolean) => {
      const graph = await fetch(`https://graph.facebook.com/v25.0/${wabaId}?fields=${encodeURIComponent(pricingFields(start, end, withCost))}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(20000),
      });
      return { graph, body: await graph.json().catch(() => ({})) };
    };
    // Custo quando a Meta permite; sem permissão (código 10), só o volume.
    let { graph, body } = await ask(true);
    let comCusto = true;
    if (!graph.ok && Number(body?.error?.code) === 10) {
      ({ graph, body } = await ask(false));
      comCusto = false;
    }
    if (!graph.ok) {
      const codigo = Number(body?.error?.code || graph.status);
      console.warn("pricing_analytics failed", graph.status, codigo, String(body?.error?.message || "").slice(0, 200));
      return asJson({ error: "meta_falhou", codigo }, 502);
    }

    const rows = parsePricing(body);
    const stamp = new Date().toISOString();
    if (rows.length) {
      const { error } = await admin.from("whatsapp_custo_diario")
        .upsert(rows.map(r => ({ ...r, atualizado_em: stamp })), { onConflict: "dia,categoria,tipo" });
      if (error) throw error;
    }
    // Dias da janela que a Meta não devolveu mais (corrigidos para zero) saem da tabela.
    // Só quando a resposta trouxe o bloco de custos: resposta sem ele não apaga nada.
    if (body?.pricing_analytics) {
      const { error } = await admin.from("whatsapp_custo_diario").delete()
        .gte("dia", firstDay).lt("atualizado_em", stamp);
      if (error) console.warn("stale cost rows cleanup failed", error.code);
    }
    return asJson({ ok: true, linhas: rows.length, com_custo: comCusto, moeda: rows[0]?.moeda || body?.currency || null, desde: firstDay });
  } catch (error) {
    console.error("whatsapp-custos", error instanceof Error ? error.message : String(error));
    return asJson({ error: "internal_error" }, 500);
  }
});
