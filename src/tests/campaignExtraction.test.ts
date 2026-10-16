import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { createCampaignExtractHandler } from '../../supabase/functions/campaign-extract/handler';
import { campaignExtractionError } from '../lib/campaignExtractionError';

const image = 'data:image/png;base64,aGVsbG8=';
const request = (body: unknown = { image }) => new Request('https://example.supabase.co/functions/v1/campaign-extract', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const draft = {
  titulo: 'Campanha de teste', inicio: '2026-10-16', fim: '2026-10-31',
  regras: [{ tipo: 'bonificacao', produtos_nomes: ['Produto A', 'Produto B'], minimo: 15, bonus_quantidade: 1 }],
};
const invoke = async (handler: (req: Request) => Promise<Response>) => {
  const client = createClient('https://example.supabase.co', 'test-anon-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, init) => handler(new Request(url, init)) },
  });
  return client.functions.invoke('campaign-extract', { body: { image } });
};

await test('successful image extraction crosses the Supabase client without losing grouped SKUs', async () => {
  const handler = createCampaignExtractHandler({
    apiKey: 'test-server-key',
    generate: async (input) => {
      assert.deepEqual(input, { apiKey: 'test-server-key', mimeType: 'image/png', data: 'aGVsbG8=' });
      return JSON.stringify(draft);
    },
  });
  const { data, error } = await invoke(handler);
  assert.equal(error, null);
  assert.equal(data.campanha.titulo, draft.titulo);
  assert.deepEqual(data.campanha.regras[0].produtos_nomes, ['Produto A', 'Produto B']);
  assert.equal(data.campanha.regras[0].minimo, 15);
});

await test('missing server key displays the actual failure instead of non-2xx', async () => {
  const { error, response } = await invoke(createCampaignExtractHandler({
    generate: async () => { assert.fail('No provider call without a configured key'); },
  }));
  assert.equal(response?.status, 503);
  assert.match(await campaignExtractionError(error), /ainda não está configurada/);
  assert.equal(response?.bodyUsed, false, 'Reading the message must preserve the original response');
});

await test('invalid and oversized uploads never reach the AI provider', async () => {
  const handler = createCampaignExtractHandler({
    apiKey: 'test-key', generate: async () => { assert.fail('Invalid images must not reach the AI'); },
  });
  for (const body of [null, {}, { image: 'not an image' }, { image: 'data:application/pdf;base64,AAAA' }, { image: 'data:image/png;base64,' + 'A'.repeat(1_400_001) }]) {
    assert.equal((await handler(request(body))).status, 400);
  }
});

await test('preflight and unsupported methods do not call the AI', async () => {
  const handler = createCampaignExtractHandler({ generate: async () => { assert.fail('Unexpected provider call'); } });
  const preflight = await handler(new Request(request().url, { method: 'OPTIONS' }));
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://maicon-oliveira-representa-es.vercel.app');
  assert.equal((await handler(new Request(request().url))).status, 405);
});

for (const [status, expectedStatus, message] of [
  [400, 503, /verificar a configuração/],
  [401, 503, /verificar a configuração/],
  [403, 503, /verificar a configuração/],
  [404, 503, /modelo de IA/],
  [429, 429, /limite de uso/],
  [500, 503, /temporariamente indisponível/],
  [503, 503, /temporariamente indisponível/],
  [504, 504, /demorou demais/],
] as const) {
  await test(`provider HTTP ${status} yields an actionable error through Supabase`, async () => {
    const { error, response } = await invoke(createCampaignExtractHandler({
      apiKey: 'test-key', generate: async () => { throw Object.assign(new Error('sensitive upstream details'), { status }); },
    }));
    assert.equal(response?.status, expectedStatus);
    const text = await campaignExtractionError(error);
    assert.match(text, message);
    assert.doesNotMatch(text, /non-2xx|sensitive upstream details/);
  });
}

await test('provider timeouts and unexpected failures remain understandable', async () => {
  for (const failure of [new DOMException('secret timeout details', 'AbortError'), new Error('secret failure details')]) {
    const { error } = await invoke(createCampaignExtractHandler({
      apiKey: 'test-key', generate: async () => { throw failure; },
    }));
    assert.match(await campaignExtractionError(error), /Tente novamente/);
    assert.doesNotMatch(await campaignExtractionError(error), /secret/);
  }
});

await test('invalid AI results do not become successful drafts or unhandled errors', async () => {
  for (const output of ['not JSON', 'null', '{}', '{"regras":[]}', '{"regras":[null]}', '{"regras":[[]]}']) {
    const { data, error, response } = await invoke(createCampaignExtractHandler({ apiKey: 'test-key', generate: async () => output }));
    assert.equal(data, null);
    assert.ok([422, 502].includes(response!.status));
    assert.doesNotMatch(await campaignExtractionError(error), /non-2xx/);
  }
});

for (const [status, body, expected] of [
  [401, { message: 'Invalid JWT' }, /autorizar/],
  [403, { message: 'Forbidden' }, /autorizar/],
  [404, { code: 'NOT_FOUND', message: 'Function not found' }, /não está disponível/],
  [503, { code: 'BOOT_ERROR', message: 'Worker boot error' }, /não conseguiu iniciar/],
  [413, null, /máximo 1 MB/],
  [429, null, /limite de uso/],
  [504, null, /demorou demais/],
  [502, '<html>Bad gateway</html>', /temporariamente indisponível/],
] as const) {
  await test(`gateway HTTP ${status} handles its response body safely`, async () => {
    const { error } = await invoke(async () => new Response(typeof body === 'object' ? JSON.stringify(body) : body, {
      status, headers: { 'Content-Type': 'application/json' },
    }));
    assert.match(await campaignExtractionError(error), expected);
  });
}

await test('network failures and local validation errors retain useful messages', async () => {
  const { error } = await invoke(async () => { throw new TypeError('fetch failed'); });
  assert.match(await campaignExtractionError(error), /Verifique a conexão/);
  assert.equal(await campaignExtractionError(new Error('A IA não retornou regras válidas.')), 'A IA não retornou regras válidas.');
  assert.match(await campaignExtractionError(null), /Não foi possível/);
});
