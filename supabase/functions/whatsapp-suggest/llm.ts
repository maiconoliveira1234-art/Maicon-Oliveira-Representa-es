// Shared AI helper: Claude (Anthropic API) first, Gemini as fallback.
// Edge functions are deployed one folder at a time, so each function keeps an identical copy
// named llm.ts next to its index.ts. Edit this file and run `node scripts/sync-llm.mjs`.

export const CLAUDE_MODEL = "claude-haiku-5-5";
const GEMINI_FALLBACK = ["gemini-3.5-flash-lite", "gemini-3.5-flash"];

const anthropicKey = () => (Deno.env.get("ANTHROPIC_API_KEY") || "").trim();
const geminiKey = () => (Deno.env.get("GEMINI_API_KEY") || "").trim();

export const hasClaude = () => Boolean(anthropicKey());
export const hasAnyModel = () => Boolean(anthropicKey() || geminiKey());

export class ModelError extends Error {
  constructor(message: string, readonly temporary: boolean) { super(message); }
}

export type ImageInput = { mime: string; base64: string };
/** PDF file, base64. */
export type DocumentInput = { base64: string };
export type GenerateOptions = {
  prompt: string;
  system?: string;
  images?: ImageInput[];
  documents?: DocumentInput[];
  maxTokens?: number;
  temperature?: number;
  /** Ask for a JSON object; the text returned is the raw JSON. */
  json?: boolean;
  /** Label stored with the token usage in public.ia_uso (sugestao, estilo, pedido, imagem, pdf...). */
  task?: string;
};
export type GenerateResult = { text: string; model: string };

// ---- Token usage and cost -------------------------------------------------------------------
// Every billed reply is stored in public.ia_uso with the tokens the API reported, so the CRM can
// show what the AI costs. Recording is best-effort: it never fails or blocks the AI call.

export type Usage = { input: number; output: number; cacheWrite: number; cacheRead: number };
type Price = { input: number; output: number; cacheWrite: number; cacheRead: number };
/** USD per million tokens. Long prompts (all input tokens, cache included, above `limit`) cost more. */
const CLAUDE_PRICES: Record<string, { limit: number; base: Price; long: Price }> = {
  "claude-haiku-5-5": {
    limit: 100_000,
    base: { input: 0.10, output: 0.50, cacheWrite: 0.125, cacheRead: 0.01 },
    long: { input: 0.50, output: 2.50, cacheWrite: 0.625, cacheRead: 0.05 },
  },
};

const tokenCount = (value: unknown) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.round(n) : 0; };

/** Cost in USD of one Claude reply; null when the model has no price in CLAUDE_PRICES. */
export function claudeCost(model: string, u: Usage): number | null {
  const table = CLAUDE_PRICES[model];
  if (!table) return null;
  const price = u.input + u.cacheWrite + u.cacheRead > table.limit ? table.long : table.base;
  const usd = (u.input * price.input + u.output * price.output + u.cacheWrite * price.cacheWrite + u.cacheRead * price.cacheRead) / 1_000_000;
  return Math.round(usd * 1e8) / 1e8;
}

async function recordUsage(task: string | undefined, provider: "anthropic" | "google", model: string, u: Usage, cost: number | null) {
  const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !key) return;
  try {
    const response = await fetch(`${url}/rest/v1/ia_uso`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}`, prefer: "return=minimal" },
      body: JSON.stringify({
        tarefa: String(task || "outra").slice(0, 40), provedor: provider, modelo: model.slice(0, 80),
        tokens_entrada: u.input, tokens_saida: u.output, tokens_cache_escrita: u.cacheWrite, tokens_cache_leitura: u.cacheRead,
        custo_usd: cost,
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) console.warn("ia_uso insert failed", response.status, (await response.text().catch(() => "")).slice(0, 200));
  } catch (error) {
    console.warn("ia_uso insert failed", error instanceof Error ? error.message : String(error));
  }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const temporaryStatus = (status: number) => status === 408 || status === 429 || status === 529 || status >= 500;
// Image formats the Anthropic API accepts directly.
const CLAUDE_IMAGE = /^image\/(jpeg|png|gif|webp)$/;
const CLAUDE_IMAGE_MAX = 5 * 1024 * 1024;
const CLAUDE_MIN_TOKENS = 4096;

async function callClaude(o: GenerateOptions): Promise<GenerateResult> {
  const content: unknown[] = [];
  for (const doc of o.documents || []) {
    content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: doc.base64 } });
  }
  for (const image of o.images || []) {
    content.push({ type: "image", source: { type: "base64", media_type: image.mime, data: image.base64 } });
  }
  content.push({ type: "text", text: o.prompt });
  const messages: unknown[] = [{ role: "user", content }];
  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": anthropicKey(), "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        // Current Claude models reject `temperature`; it is only used by the Gemini fallback.
        // The model may think before answering and that counts against max_tokens, so keep a
        // generous floor; only tokens actually generated are billed.
        model: CLAUDE_MODEL, max_tokens: Math.max(o.maxTokens ?? 1024, CLAUDE_MIN_TOKENS),
        ...(o.system ? { system: o.system } : {}), messages,
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (error) {
    throw new ModelError(`claude: ${error instanceof Error ? error.message : String(error)}`, true);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new ModelError(`claude ${response.status}: ${detail}`, temporaryStatus(response.status));
  }
  const data = await response.json();
  // Recorded before the reply is checked: an empty or cut reply is billed all the same.
  const usage: Usage = {
    input: tokenCount(data?.usage?.input_tokens),
    output: tokenCount(data?.usage?.output_tokens),
    cacheWrite: tokenCount(data?.usage?.cache_creation_input_tokens),
    cacheRead: tokenCount(data?.usage?.cache_read_input_tokens),
  };
  await recordUsage(o.task, "anthropic", CLAUDE_MODEL, usage, claudeCost(CLAUDE_MODEL, usage));
  let text = (data?.content || []).filter((b: any) => b?.type === "text").map((b: any) => b.text).join("").trim();
  if (data?.stop_reason === "max_tokens") console.warn("claude reply cut at max_tokens", CLAUDE_MODEL);
  if (o.json) text = extractJson(text);
  if (!text) throw new ModelError(`claude: resposta vazia (${data?.stop_reason || "sem motivo"})`, false);
  return { text, model: CLAUDE_MODEL };
}

async function callGemini(model: string, o: GenerateOptions): Promise<GenerateResult> {
  const parts: unknown[] = [
    ...(o.documents || []).map(d => ({ inlineData: { mimeType: "application/pdf", data: d.base64 } })),
    ...(o.images || []).map(i => ({ inlineData: { mimeType: i.mime, data: i.base64 } })),
  ];
  parts.push({ text: o.prompt });
  let response: Response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": geminiKey() },
      body: JSON.stringify({
        ...(o.system ? { systemInstruction: { parts: [{ text: o.system }] } } : {}),
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: o.temperature ?? 0.3, maxOutputTokens: o.maxTokens ?? 1024,
          ...(o.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
      signal: AbortSignal.timeout(60000),
    });
  } catch (error) {
    throw new ModelError(`${model}: ${error instanceof Error ? error.message : String(error)}`, true);
  }
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new ModelError(`${model} ${response.status}: ${detail}`, temporaryStatus(response.status));
  }
  const data = await response.json();
  // Gemini: tokens only; the price depends on the plan, so no cost is computed.
  const meta = data?.usageMetadata;
  await recordUsage(o.task, "google", model, {
    input: Math.max(0, tokenCount(meta?.promptTokenCount) - tokenCount(meta?.cachedContentTokenCount)),
    output: tokenCount(meta?.candidatesTokenCount) + tokenCount(meta?.thoughtsTokenCount),
    cacheWrite: 0,
    cacheRead: tokenCount(meta?.cachedContentTokenCount),
  }, null);
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p?.text || "").join("").trim();
  if (!text) throw new ModelError(`${model}: resposta vazia (${data?.candidates?.[0]?.finishReason || "sem motivo"})`, false);
  return { text, model };
}

async function once(fn: () => Promise<GenerateResult>): Promise<GenerateResult> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof ModelError && error.temporary) {
      await sleep(2500);
      return await fn();
    }
    throw error;
  }
}

/** Health check: asks Claude alone; returns the error text instead of falling back. */
export async function claudeCheck(): Promise<{ configured: boolean; ok: boolean; detail: string }> {
  if (!anthropicKey()) return { configured: false, ok: false, detail: "ANTHROPIC_API_KEY ausente" };
  try {
    const r = await callClaude({ prompt: "Responda apenas: ok", maxTokens: 10, temperature: 0, task: "teste" });
    return { configured: true, ok: true, detail: r.text.slice(0, 20) };
  } catch (error) {
    return { configured: true, ok: false, detail: error instanceof Error ? error.message.slice(0, 300) : String(error) };
  }
}

/** Claude first (one quick retry on temporary errors), then the Gemini models. */
export async function generate(o: GenerateOptions): Promise<GenerateResult> {
  const errors: ModelError[] = [];
  const claudeCanSee = (o.images || []).every(i => CLAUDE_IMAGE.test(i.mime) && i.base64.length * 0.75 <= CLAUDE_IMAGE_MAX);
  if (anthropicKey() && claudeCanSee) {
    try { return await once(() => callClaude(o)); }
    catch (error) { errors.push(error instanceof ModelError ? error : new ModelError(String(error), true)); }
  }
  if (geminiKey()) {
    for (const model of GEMINI_FALLBACK) {
      try { return await once(() => callGemini(model, o)); }
      catch (error) { errors.push(error instanceof ModelError ? error : new ModelError(String(error), true)); }
    }
  }
  if (!errors.length) throw new ModelError("nenhum modelo de IA configurado", false);
  throw new ModelError(errors.map(e => e.message).join(" | ").slice(0, 600), errors.some(e => e.temporary));
}

/** The JSON object inside a reply that may carry a code fence or a sentence around it. */
export function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}

export function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(binary);
}
