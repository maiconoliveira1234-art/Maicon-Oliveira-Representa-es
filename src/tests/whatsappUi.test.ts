import assert from 'node:assert/strict';
import {
  audioState,
  groupIntoBursts,
  isSuggestionStale,
  matchesQuery,
  messageForErrorCode,
  normalizeBrPhone,
  phoneFromWhatsAppName,
  readFunctionError,
  relativeTime,
  resolveReplyPhone,
  whatsAppLink,
} from '../lib/whatsappUi';

const at = (hhmm: string) => `2026-11-13T${hhmm}:00.000Z`;
const msg = (id: string, hhmm: string) => ({ id, recebida_em: at(hhmm) });

const bursts = groupIntoBursts([msg('c', '15:20'), msg('a', '15:00'), msg('b', '15:03'), msg('d', '15:24')]);
assert.deepEqual(bursts.map(b => b.map(m => m.id)), [['a', 'b'], ['c', 'd']], 'bursts split on gaps over 5 minutes, in chronological order');
assert.deepEqual(groupIntoBursts([]), []);

assert.equal(normalizeBrPhone('(47) 99999-1234'), '5547999991234');
assert.equal(normalizeBrPhone('5547999991234'), '5547999991234');
assert.equal(normalizeBrPhone('12345'), null);
assert.equal(phoneFromWhatsAppName('WA 5547999991234'), '5547999991234');
assert.equal(phoneFromWhatsAppName('Maria da Loja'), null);

assert.deepEqual(resolveReplyPhone('WA 5547999991234', '(47) 3333-0000'), { phone: '5547999991234', source: 'conversa' }, 'the number that wrote wins over the registry');
assert.deepEqual(resolveReplyPhone('Maria da Loja', '(47) 99999-1234'), { phone: '5547999991234', source: 'cadastro' });
assert.deepEqual(resolveReplyPhone('Maria da Loja', null), { phone: null, source: null });
assert.equal(whatsAppLink('5547999991234', 'Olá, tudo bem?'), 'https://wa.me/5547999991234?text=Ol%C3%A1%2C%20tudo%20bem%3F');

assert.equal(matchesQuery('pet vale', 'Pet Shop do Vale', 'Joinville'), true);
assert.equal(matchesQuery('acai', 'Açaí Pet'), true, 'search ignores accents');
assert.equal(matchesQuery('xyz', 'Pet Shop'), false);
assert.equal(matchesQuery('', 'qualquer'), true);

const now = new Date('2026-11-13T18:00:00.000Z');
assert.equal(relativeTime('2026-11-13T17:59:30.000Z', now), 'agora');
assert.equal(relativeTime('2026-11-13T17:48:00.000Z', now), '12 min');
assert.equal(relativeTime('2026-11-13T15:00:00.000Z', now), '3 h');
assert.equal(relativeTime('2026-11-10T18:00:00.000Z', now), '3 d');

assert.equal(messageForErrorCode('contact_not_linked'), 'Vincule este contato a um cliente do CRM antes de gerar a sugestão.');
assert.equal(messageForErrorCode(undefined, 'Edge Function returned a non-2xx status code'), 'Não foi possível concluir agora. Tente de novo.');
assert.equal(messageForErrorCode(undefined, 'Falha específica'), 'Falha específica');

const httpError = { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'audio_not_transcribed' }) } };
assert.match(await readFunctionError(httpError), /não tem texto/, 'reads the error code hidden behind the generic SDK message');
assert.match(await readFunctionError(null, { error: 'contact_not_linked' }), /Vincule/);

const baseAudio = { tipo_mensagem: 'audio', transcricao_audio: null, audio_status: null, transcricao_erro: null, recebida_em: '2026-11-13T17:55:00.000Z' };
assert.equal(audioState({ ...baseAudio, transcricao_audio: 'texto' }, now), null);
assert.equal(audioState({ ...baseAudio, tipo_mensagem: 'texto' }, now), null);
assert.equal(audioState({ ...baseAudio, audio_status: 'transcrevendo' }, now)?.tone, 'wait');
assert.equal(audioState({ ...baseAudio, audio_status: 'transcrevendo', recebida_em: '2026-10-14T12:00:00.000Z' }, now)?.tone, 'error', 'a transcription stuck for weeks is not shown as in progress');
assert.equal(audioState({ ...baseAudio, audio_status: 'pendente', recebida_em: '2026-10-01T12:00:00.000Z' }, now)?.tone, 'error');
assert.match(audioState({ ...baseAudio, audio_status: 'erro', transcricao_erro: 'Credencial da Meta para download de mídia não configurada.' }, now)?.text || '', /não está configurada/);

assert.equal(isSuggestionStale('2026-11-13T15:00:00.000Z', '2026-11-13T15:10:00.000Z'), true);
assert.equal(isSuggestionStale('2026-11-13T15:10:00.000Z', '2026-11-13T15:00:00.000Z'), false);
assert.equal(isSuggestionStale(null, '2026-11-13T15:00:00.000Z'), false);

console.log('WhatsApp UI helpers: bursts, phone resolution, search, errors, audio states and stale suggestion passed.');
