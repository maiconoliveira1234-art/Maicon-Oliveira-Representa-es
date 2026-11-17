import { createClient } from "npm:@supabase/supabase-js@2.101.1";
import { claudeCheck, generate, hasAnyModel, ModelError, toBase64 as imageBase64 } from "./llm.ts";

// Processes WhatsApp Cloud media (received and sent):
// - audio: transcribed by Groq Whisper (free tier), Gemini as fallback;
// - images: read by Claude (Haiku), Gemini as fallback; the photo is kept in Storage (whatsapp-midia).
// The result goes to transcricao_audio (name kept for both kinds). Temporary provider failures
// (quota, overload, network) are retried later by the "sweep" mode, which pg_cron calls every few
// minutes (job promax-whatsapp-audio-retry).

const url = Deno.env.get("SUPABASE_URL") || "";
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const gemini = (Deno.env.get("GEMINI_API_KEY") || "").trim();
const groq = (Deno.env.get("GROQ_API_KEY") || "").trim();
// The secret was registered as EASYCOEXISTENCE_ACCCESS_TOKEN (three C); accept it until it is renamed.
const mediaToken = (Deno.env.get("EASYCOEXISTENCE_ACCESS_TOKEN") ||
  Deno.env.get("EASYCOEXISTENCE_ACCCESS_TOKEN") ||
  Deno.env.get("META_WHATSAPP_ACCESS_TOKEN") ||
  Deno.env.get("WHATSAPP_CLOUD_ACCESS_TOKEN") ||
  Deno.env.get("META_ACCESS_TOKEN") || "").trim();
const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_ATTEMPTS = 5;
// Minutes to wait before attempt n+1 (index = attempts already made).
const BACKOFF_MIN = [2, 5, 15, 30, 60];
const STALE_MS = 5 * 60 * 1000;
const SWEEP_BATCH = 6;
const BUCKET = "whatsapp-midia";
const ORDER_LINE = /^\s*\d{1,4}\s*(?:(?:cxs?|caixas?|unidades?|un|sacos?|sc)\s*)?[-.)x]?\s+\S/i;
const VOCAB = "Adimax, Fórmula Natural, FN Life, Magnus, Origens, Origens Class, Fresh Meat, sachê, saco, caixa, pet shop, agropecuária, boleto, pedido.";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Error that should not be retried (bad media id, unsupported format, file too large...). */
class PermanentError extends Error {}

class ProviderError extends Error {
  constructor(message: string, readonly temporary: boolean) { super(message); }
}

const isTemporaryStatus = (status: number) => status === 408 || status === 429 || status >= 500;

// Whisper sometimes "hears" these stock captions in silence; a transcript made only of them is empty.
const HALLUCINATION = /^(?:\s*(?:legendas? (?:pela|por) (?:comunidade )?amara\.org|obrigad[oa] por assistir!?|inscreva-se no canal!?)\s*[.!]?)+$/i;

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  // One quick retry inside the same run for transient failures; longer waits are left to the sweep.
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ProviderError && error.temporary) {
      await sleep(3000);
      return await fn();
    }
    throw error;
  }
}

async function transcribeGroq(bytes: ArrayBuffer, mime: string): Promise<{ text: string; model: string }> {
  const ext = mime === "audio/ogg" ? "ogg" : mime === "audio/mp4" ? "m4a" : mime === "audio/mpeg" ? "mp3"
    : mime === "audio/wav" || mime === "audio/x-wav" ? "wav" : mime === "audio/webm" ? "webm" : "";
  if (!ext) throw new ProviderError(`groq: formato ${mime} não suportado`, false);
  const model = "whisper-large-v3";
  return await withRetry("groq", async () => {
    const form = new FormData();
    form.append("file", new File([bytes], `audio.${ext}`, { type: mime }));
    form.append("model", model);
    form.append("language", "pt");
    form.append("temperature", "0");
    form.append("response_format", "json");
    form.append("prompt", VOCAB);
    let response: Response;
    try {
      response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST", headers: { Authorization: `Bearer ${groq}` }, body: form,
        signal: AbortSignal.timeout(45000),
      });
    } catch (error) {
      throw new ProviderError(`groq: ${error instanceof Error ? error.message : String(error)}`, true);
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 160);
      throw new ProviderError(`groq ${response.status}: ${detail}`, isTemporaryStatus(response.status));
    }
    const data = await response.json();
    return { text: String(data?.text || "").trim(), model: `groq/${model}` };
  });
}

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function transcribeGemini(bytes: ArrayBuffer, mime: string): Promise<{ text: string; model: string }> {
  const prompt = `Transcreva fielmente este áudio em português do Brasil. Vocabulário provável: ${VOCAB} Responda somente com a transcrição, sem comentários.`;
  const data = toBase64(bytes);
  let last: ProviderError | null = null;
  for (const model of ["gemini-3.5-flash", "gemini-3.5-flash-lite"]) {
    try {
      return await withRetry(model, async () => {
        let response: Response;
        try {
          response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: "POST",
            headers: { "content-type": "application/json", "x-goog-api-key": gemini },
            body: JSON.stringify({ contents: [{ role: "user", parts: [{ inlineData: { mimeType: mime, data } }, { text: prompt }] }] }),
            signal: AbortSignal.timeout(60000),
          });
        } catch (error) {
          throw new ProviderError(`${model}: ${error instanceof Error ? error.message : String(error)}`, true);
        }
        if (!response.ok) {
          const detail = (await response.text().catch(() => "")).slice(0, 160);
          throw new ProviderError(`${model} ${response.status}: ${detail}`, isTemporaryStatus(response.status));
        }
        const result = await response.json();
        const text = (result?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("").trim();
        if (!text) throw new ProviderError(`${model}: transcrição vazia (${result?.candidates?.[0]?.finishReason || "sem motivo"})`, false);
        return { text, model };
      });
    } catch (error) {
      last = error instanceof ProviderError ? error : new ProviderError(String(error), true);
    }
  }
  throw last || new ProviderError("gemini: sem resposta", true);
}

async function downloadMedia(mediaId: string, kind: "audio" | "imagem"): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const authHeader = { Authorization: `Bearer ${mediaToken}` };
  const meta = await fetch(`https://graph.facebook.com/v26.0/${mediaId}`, { headers: authHeader });
  if (!meta.ok) {
    // Meta keeps media for a limited time; 400/404 means it is gone, retrying will not help.
    if (meta.status === 400 || meta.status === 404) throw new PermanentError(`media_lookup_http_${meta.status}`);
    throw new ProviderError(`media_lookup_http_${meta.status}`, true);
  }
  const info = await meta.json();
  const mediaUrl = new URL(String(info.url || ""));
  if (mediaUrl.protocol !== "https:" || !/(^|\.)(?:fbsbx\.com|fbcdn\.net|facebook\.com)$/.test(mediaUrl.hostname))
    throw new PermanentError("untrusted_media_host");
  if (Number(info.file_size) > MAX_BYTES) throw new PermanentError("audio_too_large");
  const audioResponse = await fetch(mediaUrl, { headers: authHeader });
  if (!audioResponse.ok) throw new ProviderError(`media_download_http_${audioResponse.status}`, true);
  const bytes = await audioResponse.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) throw new PermanentError("invalid_audio_length");
  const mime = String(info.mime_type || audioResponse.headers.get("content-type") || "audio/ogg")
    .split(";")[0].trim().toLowerCase();
  if (kind === "imagem") {
    const image = mime === "image/jpg" ? "image/jpeg" : mime;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(image)) throw new PermanentError("unsupported_mime");
    return { bytes, mime: image };
  }
  const normalized = mime === "audio/opus" || mime === "application/ogg" ? "audio/ogg" : mime;
  if (!/^audio\/(ogg|mp4|mpeg|aac|wav|webm|amr|3gpp|x-wav)$/.test(normalized)) throw new PermanentError("unsupported_mime");
  return { bytes, mime: normalized };
}

const IMAGE_PROMPT = `Esta imagem foi enviada pelo WhatsApp numa conversa entre Maicon, representante comercial de rações e produtos pet da Adimax (marcas ${VOCAB}), e um cliente (pet shop ou agropecuária).

Descreva o conteúdo de forma objetiva, em português do Brasil, para que o CRM possa usar o texto:
- Se for uma LISTA DE PEDIDO (escrita à mão, impressa ou print), transcreva cada item numa linha própria, no formato "quantidade produto embalagem" (ex.: "6 Magnus Todo Dia carne 15kg"). Não some nem converta quantidades.
- Se tiver texto relevante (nota fiscal, boleto, tabela de preços, print de conversa ou de sistema), transcreva o essencial: valores, datas, vencimentos, códigos, produtos e quantidades.
- Se for foto de produto, embalagem, prateleira ou estoque, diga marca, linha, sabor, peso e quantidade visível de cada produto que der para identificar.
- Se for outra coisa (foto pessoal, figurinha, paisagem), descreva em uma frase curta.

Regras: não invente nada; o que estiver ilegível ou incerto, marque como [ilegível] ou "parece ser". Comece com uma frase curta dizendo o que é a imagem. Sem markdown, sem asteriscos, sem comentários finais.`;

async function readImage(bytes: ArrayBuffer, mime: string, caption: string): Promise<{ text: string; model: string }> {
  const prompt = caption ? `${IMAGE_PROMPT}\n\nLegenda que veio com a imagem: ${caption}` : IMAGE_PROMPT;
  try {
    const result = await generate({ prompt, images: [{ mime, base64: imageBase64(bytes) }], maxTokens: 1200, temperature: 0 });
    return { text: result.text.replace(/\*\*/g, "").trim(), model: result.model };
  } catch (error) {
    if (error instanceof ModelError) throw new ProviderError(error.message, error.temporary);
    throw error;
  }
}

async function storeImage(messageId: string, bytes: ArrayBuffer, mime: string): Promise<string | null> {
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "jpg";
  const path = `imagens/${messageId}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, new Blob([bytes], { type: mime }), { contentType: mime, upsert: true });
  if (error) { console.warn("image storage failed", messageId, error.message); return null; }
  return path;
}

function looksLikeOrder(text: string): boolean {
  return text.split(/\r?\n/).filter(line => ORDER_LINE.test(line)).length >= 2 || /\bpedido\b/i.test(text);
}

/** Claims the message (pending/error, or a run stuck in "transcrevendo") so only one run processes it. */
async function claim(id: string, attempts: number): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
  const now = new Date().toISOString();
  const fields = { audio_status: "transcrevendo", transcricao_iniciada_em: now, transcricao_tentativas: attempts + 1 };
  const first = await db.from("whatsapp_mensagens").update(fields)
    .eq("id", id).in("audio_status", ["pendente", "erro"]).is("transcricao_audio", null)
    .select("id").maybeSingle();
  if (first.error) throw first.error;
  if (first.data) return true;
  const stale = await db.from("whatsapp_mensagens").update(fields)
    .eq("id", id).eq("audio_status", "transcrevendo").is("transcricao_audio", null)
    .or(`transcricao_iniciada_em.is.null,transcricao_iniciada_em.lt.${staleBefore}`)
    .select("id").maybeSingle();
  if (stale.error) throw stale.error;
  return Boolean(stale.data);
}

async function fail(id: string, attempts: number, detail: string, retryable: boolean) {
  const again = retryable && attempts < MAX_ATTEMPTS;
  const wait = BACKOFF_MIN[Math.min(attempts - 1, BACKOFF_MIN.length - 1)];
  await db.from("whatsapp_mensagens").update({
    audio_status: again ? "pendente" : "erro",
    transcricao_erro: `Falha ao transcrever: ${detail}`.slice(0, 350),
    transcricao_tentativas: again ? attempts : MAX_ATTEMPTS,
    transcricao_proxima_tentativa: again ? new Date(Date.now() + wait * 60000).toISOString() : null,
    transcricao_iniciada_em: null,
  }).eq("id", id);
}

type Outcome = { id: string; result: string; detail?: string };

async function finishImage(message: any, bytes: ArrayBuffer, mime: string): Promise<Outcome> {
  const caption = String(message.midia_legenda || "").trim();
  const path = message.midia_path || await storeImage(message.id, bytes, mime);
  const { text, model } = await readImage(bytes, mime, caption);
  const { error: writeError } = await db.from("whatsapp_mensagens").update({
    mensagem: `📷 ${caption ? `${caption}\n` : ""}${text}`,
    transcricao_audio: text, transcricao_modelo: model, transcricao_gerada_em: new Date().toISOString(),
    audio_status: "transcrito", transcricao_erro: null, audio_tamanho_bytes: bytes.byteLength,
    transcricao_proxima_tentativa: null, transcricao_iniciada_em: null, midia_path: path,
  }).eq("id", message.id);
  if (writeError) throw new ProviderError(`image_save_failed_${writeError.code}`, true);
  console.info("cloud image read", message.id, model);
  // A photographed order list goes to the same review as a typed one (never creates an order by itself).
  if (message.direcao !== "enviada" && looksLikeOrder(`${caption}\n${text}`)) {
    const analysis = fetch(`${url}/functions/v1/whatsapp-order-analyze`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${service}`, apikey: service },
      body: JSON.stringify({ message_id: message.id }),
    }).then(r => { if (!r.ok) console.warn("image order analysis status", r.status); })
      .catch(error => console.warn("image order analysis failed", String(error)));
    const runtime = (globalThis as any).EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(analysis); else await analysis;
  }
  return { id: message.id, result: "transcribed" };
}

async function processMessage(messageId: string): Promise<Outcome> {
  const { data: message, error } = await db.from("whatsapp_mensagens")
    .select("id,tipo_mensagem,app_package,audio_arquivo_nome,audio_status,transcricao_audio,transcricao_tentativas,direcao,midia_legenda,midia_path")
    .eq("id", messageId).maybeSingle();
  if (error) throw error;
  const kind = message?.tipo_mensagem === "imagem" ? "imagem" : "audio";
  if (!message || !["audio", "imagem"].includes(message.tipo_mensagem) || message.app_package !== "easycoexistence.cloud_api")
    return { id: messageId, result: "audio_not_found" };
  if (message.transcricao_audio) return { id: messageId, result: "already_transcribed" };
  const attemptsBefore = Number(message.transcricao_tentativas || 0);

  const mediaId = String(message.audio_arquivo_nome || "").replace(/^meta-media:/, "");
  if (!/^\d{8,32}$/.test(mediaId)) {
    await fail(messageId, MAX_ATTEMPTS, "Identificador de mídia Meta inválido.", false);
    return { id: messageId, result: "invalid_media_id" };
  }
  const modelReady = kind === "imagem" ? hasAnyModel() : Boolean(groq || gemini);
  if (!mediaToken || !modelReady) {
    const missing = !mediaToken ? "Credencial da Meta para download de mídia não configurada."
      : kind === "imagem" ? "Credencial de leitura de imagens não configurada." : "Credencial de transcrição não configurada.";
    await db.from("whatsapp_mensagens").update({ audio_status: "erro", transcricao_erro: missing }).eq("id", messageId);
    return { id: messageId, result: "not_configured", detail: missing };
  }
  if (!(await claim(messageId, attemptsBefore))) return { id: messageId, result: "already_processing" };
  const attempts = attemptsBefore + 1;

  try {
    const { bytes, mime } = await downloadMedia(mediaId, kind);
    if (kind === "imagem") return await finishImage(message, bytes, mime);
    const errors: ProviderError[] = [];
    let transcript = "";
    let usedModel = "";
    const providers: Array<() => Promise<{ text: string; model: string }>> = [];
    if (groq) providers.push(() => transcribeGroq(bytes, mime));
    if (gemini) providers.push(() => transcribeGemini(bytes, mime));
    for (const provider of providers) {
      try {
        const { text, model } = await provider();
        if (text && !HALLUCINATION.test(text)) { transcript = text; usedModel = model; break; }
        errors.push(new ProviderError(`${model}: transcrição vazia`, false));
      } catch (providerError) {
        errors.push(providerError instanceof ProviderError ? providerError : new ProviderError(String(providerError), true));
      }
    }
    if (!transcript) {
      const detail = errors.map(e => e.message).join(" | ") || "transcrição vazia";
      console.error("audio transcription failed", messageId, detail);
      await fail(messageId, attempts, detail, errors.some(e => e.temporary));
      return { id: messageId, result: "failed", detail };
    }
    const { error: writeError } = await db.from("whatsapp_mensagens").update({
      mensagem: `🎤 ${transcript}`, transcricao_audio: transcript, transcricao_modelo: usedModel,
      transcricao_gerada_em: new Date().toISOString(), audio_status: "transcrito", transcricao_erro: null,
      audio_tamanho_bytes: bytes.byteLength, transcricao_proxima_tentativa: null, transcricao_iniciada_em: null,
    }).eq("id", messageId);
    if (writeError) throw new ProviderError(`transcription_save_failed_${writeError.code}`, true);
    console.info("cloud audio transcribed", messageId, usedModel);
    return { id: messageId, result: "transcribed" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("audio transcription failed", messageId, detail);
    await fail(messageId, attempts, detail, !(error instanceof PermanentError));
    return { id: messageId, result: "failed", detail };
  }
}

async function sweep(): Promise<Outcome[]> {
  const nowIso = new Date().toISOString();
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const settled = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
  const { data, error } = await db.from("whatsapp_mensagens")
    .select("id")
    .eq("app_package", "easycoexistence.cloud_api").in("tipo_mensagem", ["audio", "imagem"])
    .is("transcricao_audio", null).gte("recebida_em", since).lt("criado_em", settled)
    .lt("transcricao_tentativas", MAX_ATTEMPTS)
    .or([
      `and(audio_status.in.(pendente,erro),or(transcricao_proxima_tentativa.is.null,transcricao_proxima_tentativa.lte.${nowIso}))`,
      `and(audio_status.eq.transcrevendo,or(transcricao_iniciada_em.is.null,transcricao_iniciada_em.lt.${staleBefore}))`,
    ].join(","))
    .order("recebida_em", { ascending: false }).limit(SWEEP_BATCH);
  if (error) throw error;
  const outcomes: Outcome[] = [];
  for (const row of data || []) outcomes.push(await processMessage(row.id));
  return outcomes;
}

async function sweepAuthorized(token: string): Promise<boolean> {
  if (!token) return false;
  const { data } = await db.from("whatsapp_audio_cron").select("token").eq("id", true).maybeSingle();
  return Boolean(data?.token) && data!.token === token;
}

Deno.serve(async req => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const body = await req.json().catch(() => ({}));
  try {
    if (body?.selftest === true) {
      // Health check for the cron token holder: which AI answers right now (no data, no secrets returned).
      if (!(bearer && (bearer === service || await sweepAuthorized(bearer)))) return json({ error: "unauthorized" }, 401);
      return json({ ok: true, groq: Boolean(groq), gemini: Boolean(gemini), claude: await claudeCheck() });
    }
    if (body?.sweep === true) {
      if (!(bearer && (bearer === service || await sweepAuthorized(bearer)))) return json({ error: "unauthorized" }, 401);
      return json({ ok: true, processed: await sweep() });
    }
    if (!service || bearer !== service) return json({ error: "unauthorized" }, 401);
    const messageId = String(body.message_id || "");
    if (!UUID.test(messageId)) return json({ error: "invalid_id" }, 400);
    const outcome = await processMessage(messageId);
    const status = outcome.result === "transcribed" || outcome.result.startsWith("already") ? 200
      : outcome.result === "audio_not_found" ? 404 : outcome.result === "not_configured" ? 503 : 502;
    return json(outcome, status);
  } catch (error) {
    console.error("whatsapp-cloud-audio-transcribe:", error instanceof Error ? error.message : JSON.stringify(error));
    return json({ error: "internal_error" }, 500);
  }
});
