import { createClient } from "npm:@supabase/supabase-js@2.101.1";

// Removes from Storage: (1) files queued in whatsapp_midia_descarte (their message was deleted, e.g. the
// contact was marked "Não é cliente"); (2) WhatsApp photos/PDFs older than RETENTION_DAYS. For the old ones
// the AI description stays in the message text; only the file (and its midia_path) goes away. Called daily by pg_cron
// (promax-whatsapp-midia-limpeza) with the same token used by the audio sweep.
const url = Deno.env.get("SUPABASE_URL") || "";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const BUCKET = "whatsapp-midia";
const RETENTION_DAYS = 365;
const BATCH = 200;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function authorized(token: string): Promise<boolean> {
  if (!token) return false;
  if (token === service) return true;
  const { data } = await db.from("whatsapp_audio_cron").select("token").eq("id", true).maybeSingle();
  return Boolean(data?.token) && data!.token === token;
}

Deno.serve(async req => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!(await authorized(bearer))) return json({ error: "unauthorized" }, 401);
  try {
    // Files whose message no longer exists.
    const { data: queued, error: queueError } = await db.from("whatsapp_midia_descarte").select("path")
      .order("criado_em", { ascending: true }).limit(BATCH);
    if (queueError) throw queueError;
    const discarded = (queued || []).map(r => r.path as string).filter(Boolean);
    if (discarded.length) {
      const { error: discardError } = await db.storage.from(BUCKET).remove(discarded);
      if (discardError) throw discardError;
      const { error: dequeueError } = await db.from("whatsapp_midia_descarte").delete().in("path", discarded);
      if (dequeueError) throw dequeueError;
      console.info("midia discard removed", discarded.length);
    }
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();
    const { data, error } = await db.from("whatsapp_mensagens").select("id, midia_path")
      .not("midia_path", "is", null).lt("recebida_em", cutoff)
      .order("recebida_em", { ascending: true }).limit(BATCH);
    if (error) throw error;
    const rows = (data || []).filter(r => r.midia_path);
    if (!rows.length) return json({ ok: true, removed: 0, discarded: discarded.length });
    const { error: removeError } = await db.storage.from(BUCKET).remove(rows.map(r => r.midia_path as string));
    if (removeError) throw removeError;
    const { error: updateError } = await db.from("whatsapp_mensagens").update({ midia_path: null }).in("id", rows.map(r => r.id));
    if (updateError) throw updateError;
    console.info("midia cleanup removed", rows.length);
    // More than one batch: the next daily run continues.
    return json({ ok: true, removed: rows.length, discarded: discarded.length, more: rows.length === BATCH || discarded.length === BATCH });
  } catch (error) {
    console.error("whatsapp-midia-limpeza", error instanceof Error ? error.message : JSON.stringify(error));
    return json({ error: "internal_error" }, 500);
  }
});
