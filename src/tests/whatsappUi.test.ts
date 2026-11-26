import assert from 'node:assert/strict';
import {
  audioState,
  groupIntoBursts,
  isSuggestionStale,
  matchesQuery,
  replyContext,
  messageForErrorCode,
  normalizeBrPhone,
  phoneFromWhatsAppName,
  readMarksFor,
  readFunctionError,
  relativeTime,
  resolveReplyPhone,
  serviceWindowHoursLeft,
  whatsAppLink,
} from '../lib/whatsappUi';

const at = (hhmm: string) => `2026-11-13T${hhmm}:00.000Z`;
const msg = (id: string, hhmm: string) => ({ id, recebida_em: at(hhmm) });

const bursts = groupIntoBursts([msg('c', '15:20'), msg('a', '15:00'), msg('b', '15:03'), msg('d', '15:24')]);
assert.deepEqual(bursts.map(b => b.map(m => m.id)), [['a', 'b'], ['c', 'd']], 'bursts split on gaps over 5 minutes, in chronological order');
assert.deepEqual(groupIntoBursts([]), []);

const sides = groupIntoBursts(
  [{ id: 'a', recebida_em: at('15:00'), direcao: 'recebida' }, { id: 'b', recebida_em: at('15:01'), direcao: 'enviada' }, { id: 'c', recebida_em: at('15:02'), direcao: 'enviada' }],
  undefined,
  (x, y) => x.direcao === y.direcao
);
assert.deepEqual(sides.map(b => b.map(m => m.id)), [['a'], ['b', 'c']], 'a change of sender starts a new burst');

const chat = (id: string, hhmm: string, direcao: 'recebida' | 'enviada') => ({ id, recebida_em: at(hhmm), direcao });
assert.deepEqual(replyContext([chat('1', '10:00', 'recebida'), chat('2', '10:05', 'enviada'), chat('3', '11:00', 'recebida'), chat('4', '11:01', 'recebida')]).messages.map(m => m.id), ['3', '4'], 'only what came after the last reply');
const answered = replyContext([chat('1', '10:00', 'recebida'), chat('2', '10:01', 'recebida'), chat('3', '10:30', 'enviada')]);
assert.deepEqual([answered.messages.map(m => m.id), answered.answered], [['1', '2'], true], 'already answered falls back to the last customer burst');
assert.deepEqual(replyContext([chat('1', '10:00', 'recebida')]), { messages: [chat('1', '10:00', 'recebida')], answered: false });
assert.deepEqual(replyContext([]), { messages: [], answered: false });

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
assert.equal(audioState({ ...baseAudio, audio_status: 'pendente', transcricao_erro: 'Falha ao transcrever: groq 429' }, now)?.tone, 'wait', 'a failure that will be retried is not shown as final');
assert.equal(audioState({ ...baseAudio, audio_status: 'erro', transcricao_erro: 'Falha ao transcrever: x' }, now)?.tone, 'error');
assert.match(audioState({ ...baseAudio, tipo_mensagem: 'imagem', audio_status: 'transcrevendo' }, now)?.text || '', /Lendo a imagem/);
assert.equal(audioState({ ...baseAudio, tipo_mensagem: 'imagem', transcricao_audio: 'Lista com 3 itens' }, now), null);
assert.equal(audioState({ ...baseAudio, tipo_mensagem: 'imagem', audio_status: 'erro', transcricao_erro: 'x' }, now)?.tone, 'error');
assert.match(audioState({ ...baseAudio, tipo_mensagem: 'documento', audio_status: 'transcrevendo' }, now)?.text || '', /Lendo o PDF/);
assert.equal(audioState({ ...baseAudio, tipo_mensagem: 'documento', transcricao_audio: 'Nota fiscal' }, now), null);
assert.match(audioState({ ...baseAudio, audio_status: 'erro', transcricao_erro: 'Credencial da Meta para download de mídia não configurada.' }, now)?.text || '', /não está configurada/);

assert.equal(isSuggestionStale('2026-11-13T15:00:00.000Z', '2026-11-13T15:10:00.000Z'), true);
assert.equal(isSuggestionStale('2026-11-13T15:10:00.000Z', '2026-11-13T15:00:00.000Z'), false);
assert.equal(isSuggestionStale(null, '2026-11-13T15:00:00.000Z'), false);

const windowNow = new Date('2026-11-16T12:00:00.000Z');
assert.equal(Math.round(serviceWindowHoursLeft('2026-11-16T10:00:00.000Z', windowNow)), 22);
assert.equal(serviceWindowHoursLeft('2026-11-15T11:59:00.000Z', windowNow), 0);
assert.equal(serviceWindowHoursLeft(null, windowNow), 0);
assert.match(messageForErrorCode('janela_24h'), /24 horas/);
assert.match(messageForErrorCode('envio_falhou'), /não foi enviada/);

assert.deepEqual(
  readMarksFor([
    { id: 'a', unseen: 2, knownTimes: ['2026-11-26T10:00:00.000Z', '2026-11-26T10:00:03.500Z'] },
    { id: 'b', unseen: 0, knownTimes: ['2026-11-26T09:00:00.000Z'] },
    { id: 'c', unseen: 1, knownTimes: [null, undefined, 'x'] },
  ]),
  [{ id: 'a', until: '2026-11-26T10:00:03.500Z' }, { id: 'c', until: null }],
  'bulk read marks skip conversations without news and stop at the newest moment the list knew of'
);

console.log('WhatsApp UI helpers: bursts, phone resolution, search, errors, audio states, stale suggestion, 24h window and bulk read marks passed.');
