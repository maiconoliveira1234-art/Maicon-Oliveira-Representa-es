import { createClient } from 'npm:@supabase/supabase-js@2.101.1';
import { generate } from './llm.ts';
import { descreverTabela, hojeSaoPaulo, normalizarDesconto, precoNaFaixa, tabelaDoCliente } from './priceTable.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://maicon-oliveira-representa-es.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

type AiRule = {
  titulo:string; categoria:string; regra:string; prioridade:number; escopo_tipo:string;
  escopo_valor:string|null; cliente_id:string|null; valido_de:string|null; valido_ate:string|null;
};
type ContextMessage = {
  id:string; contato_map_id:string|null; mensagem:string; recebida_em:string;
  tipo_mensagem:string|null; transcricao_audio:string|null; direcao?:string|null;
};
type Product = {
  id:string; produto:string; familia:string|null; ativo:boolean|null;
  livre:number|null; '200kg':number|null; '500kg':number|null; '1000kg':number|null;
  '2000kg':number|null; '4000kg':number|null; custo_total:number|null; custo_und:number|null;
  sugestao:number|null; peso_embalagem:number|null; quant_embalagem:number|null;
};
type Sale = {
  faturamento:string|null; numero_pedido_erp:string|null; produtos:string|null; qtd:number|null;
  'r$_total':number|null; tabela:string|null; vendas:string|null; xdt:number|null; produto_id:string|null;
};
type Stock = { produto_id:string; quantidade_atual:number|null; ultima_contagem:string|null };

// Audio: the transcript. Image/PDF: mensagem already holds caption + what the file shows ("📷 ..." / "📄 ...").
function msgText(m: { tipo_mensagem?:string|null; transcricao_audio?:string|null; mensagem?:string|null }) {
  return m.tipo_mensagem === 'imagem' || m.tipo_mensagem === 'documento' ? String(m.mensagem || '') : String(m.transcricao_audio || m.mensagem || '');
}
function n(v: unknown) { const x = Number(v); return Number.isFinite(x) ? x : 0; }
function money(v: number) { return v.toLocaleString('pt-BR', { style:'currency', currency:'BRL' }); }
function norm(v: string) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/formula natural/g,' fn ').replace(/fresh meat/g,' fm ')
    .replace(/adulto/g,' ad ').replace(/filhote/g,' filh ').replace(/filhotes/g,' filh ')
    .replace(/pequeno/g,' pq ').replace(/pequena/g,' pq ').replace(/mini/g,' mini ')
    .replace(/medio/g,' med ').replace(/media/g,' med ').replace(/grande/g,' gr ')
    .replace(/caes/g,' cao ').replace(/cachorro/g,' cao ').replace(/gatos/g,' gato ')
    .replace(/castrado/g,' castr ').replace(/castrados/g,' castr ')
    .replace(/[^a-z0-9,./]+/g,' ').trim();
}
function tokens(v:string) {
  return [...new Set(norm(v).split(/\s+/).filter(t => t.length >= 2))];
}
function productScore(p:Product, query:string) {
  const q = tokens(query);
  if (!q.length) return 0;
  const hay = norm((p.produto || '') + ' ' + (p.familia || ''));
  let score = 0;
  for (const t of q) {
    if (hay.includes(t)) score += t.length >= 5 ? 3 : 1.5;
  }
  const nq = norm(query);
  if (nq && hay.includes(nq)) score += 8;
  return score;
}


// ---- Maicon's writing style -------------------------------------------------------------
type StylePair = { resposta:string; pergunta:string|null; enviada_em:string };
const STYLE_MIN_SAMPLES = 10;
const STYLE_REFRESH_DAYS = 7;

async function loadStylePairs(db:any, limit = 200): Promise<StylePair[]> {
  const { data, error } = await db.rpc('whatsapp_estilo_pares', { p_limit:limit });
  if (error) throw error;
  return (data || []) as StylePair[];
}

// Picks the replies Maicon sent to the most similar customer messages (word overlap), newest first on ties.
const STYLE_STOPWORDS = new Set(['de','da','do','em','um','uma','os','as','no','na','ta','te','me','eu','tu','se','ao','ou','ja','la','ok','vc','pra','por','com','que','mas','tem','mais']);
const styleTokens = (v:string) => tokens(v).filter(t => t.length >= 2 && !STYLE_STOPWORDS.has(t));

function pickStyleExamples(pairs:StylePair[], queryText:string, max = 4): StylePair[] {
  const withQuestion = pairs.filter(p => p.pergunta && p.pergunta.trim().length >= 3);
  const wanted = new Set(styleTokens(queryText));
  const scored = withQuestion.map((p, index) => {
    const own = styleTokens(p.pergunta || '');
    const hits = own.filter(t => wanted.has(t)).length;
    return { p, index, score: own.length ? hits / Math.sqrt(own.length * Math.max(1, wanted.size)) : 0 };
  });
  const relevant = scored.filter(x => x.score > 0).sort((a,b) => b.score - a.score || a.index - b.index);
  const chosen = relevant.slice(0, max).map(x => x.p);
  // Fill with the most recent replies so the tone is always represented.
  for (const x of scored) {
    if (chosen.length >= Math.min(max, 3)) break;
    if (!chosen.includes(x.p)) chosen.push(x.p);
  }
  return chosen;
}

function properName(raw: unknown) {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
  if (!text || text === "undefined" || text === "null") return "";
  return text.split(" ").map((w, i) => i > 0 && ["da", "de", "di", "do", "das", "dos", "e"].includes(w)
    ? w : w.replace(/(^|[-'])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase("pt-BR"))).join(" ");
}
function clip(text:string, size:number) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > size ? t.slice(0, size - 1) + '…' : t;
}

type Correction = { contato_map_id:string|null; pergunta:string|null; sugestao_ia:string; texto_enviado:string; alterado:boolean; criado_em:string };

async function loadCorrections(db:any, limit = 60): Promise<Correction[]> {
  const { data, error } = await db.from('whatsapp_ai_correcoes')
    .select('contato_map_id, pergunta, sugestao_ia, texto_enviado, alterado, criado_em')
    .order('criado_em', { ascending:false }).limit(limit);
  if (error) { console.warn('corrections lookup failed', error.code); return []; }
  return (data || []) as Correction[];
}

// Edits Maicon made to earlier suggestions: same customer first, then the most similar customer message.
function pickCorrections(rows:Correction[], contactId:string|null, queryText:string, max = 4): Correction[] {
  const edited = rows.filter(r => r.alterado);
  const wanted = new Set(styleTokens(queryText));
  const similarity = (r:Correction) => {
    const own = styleTokens(r.pergunta || '');
    return own.length ? own.filter(t => wanted.has(t)).length / Math.sqrt(own.length * Math.max(1, wanted.size)) : 0;
  };
  const sameContact = edited.filter(r => contactId && r.contato_map_id === contactId).slice(0, 2);
  const rest = edited.filter(r => !sameContact.includes(r))
    .map((r, index) => ({ r, index, score:similarity(r) }))
    .sort((a,b) => b.score - a.score || a.index - b.index)
    .map(x => x.r);
  return [...sameContact, ...rest].slice(0, max);
}

async function generateStyleProfile(db:any): Promise<{ ok:true; perfil:string; amostras:number } | { ok:false; error:string; amostras:number }> {
  const pairs = await loadStylePairs(db, 200);
  if (pairs.length < STYLE_MIN_SAMPLES) return { ok:false, error:'poucas_amostras', amostras:pairs.length };
  const used = pairs.slice(0, 120);
  const edits = (await loadCorrections(db, 40)).filter(r => r.alterado).slice(0, 15);
  const editsText = edits.length ? edits.map((r,i) =>
    `#${i+1}\nIA sugeriu: ${clip(r.sugestao_ia, 350)}\nMaicon enviou: ${clip(r.texto_enviado, 350)}`).join('\n\n') : '';
  const sample = used.map((p,i) => {
    const q = p.pergunta ? `Cliente: ${clip(p.pergunta, 200)}\n` : '';
    return `#${i+1}\n${q}Maicon: ${clip(p.resposta, 400)}`;
  }).join('\n\n');
  const prompt = `Abaixo estão respostas reais que Maicon, representante comercial, enviou a clientes pelo WhatsApp (algumas eram áudios transcritos).

Descreva o ESTILO DE ESCRITA dele em 6 a 10 linhas curtas, cada uma começando com "- ". Cubra, só quando houver evidência nas amostras: tom e formalidade, tamanho típico das mensagens, como abre e como fecha a conversa, expressões e gírias que ele repete, uso de emoji e de pontuação, como trata o cliente (você, senhor, nome), e como costuma falar de preço e de pedido.

REGRAS:
- Descreva apenas o estilo. NÃO inclua nomes de clientes, preços, quantidades, datas, produtos específicos nem números.
- Não invente hábitos que as amostras não mostrem. Se algo aparece poucas vezes, diga "às vezes".
- Escreva em português do Brasil, sem markdown além dos hífens, sem introdução e sem conclusão.

AMOSTRAS
${sample}${editsText ? `

CORREÇÕES: textos que a IA sugeriu e que Maicon alterou antes de enviar. Use-as para entender o que ele muda (tamanho, tom, saudação, emoji, ordem das informações) e registre esses hábitos no perfil, sem citar os textos:
${editsText}` : ''}`;
  const response = await generate({ prompt, maxTokens:900, temperature:0.3 });
  const perfil = String(response.text || '').trim().slice(0, 2500);
  if (perfil.length < 40) return { ok:false, error:'empty_model_response', amostras:used.length };
  const now = new Date().toISOString();
  const { error } = await db.from('whatsapp_ai_estilo').upsert({
    id:1, perfil, amostras:used.length, gerado_em:now, atualizado_em:now, editado_manual:false,
  }, { onConflict:'id' });
  if (error) throw error;
  return { ok:true, perfil, amostras:used.length };
}

Deno.serve(async (req:Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers:corsHeaders });
  if (req.method !== 'POST') return json({ error:'method_not_allowed' }, 405);

  try {
    const auth = req.headers.get('authorization') || '';
    const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth:{ persistSession:false, autoRefreshToken:false },
      global:{ headers: auth ? { Authorization:auth } : {} },
    });

    const body = await req.json().catch(() => ({}));
    const messageId = String(body?.message_id || '').trim();
    const requestedContextIds = Array.isArray(body?.context_message_ids)
      ? [...new Set(body.context_message_ids.map((id:unknown) => String(id || '').trim()).filter(Boolean))].slice(0,20)
      : [];
    if (body?.action === 'gerar_estilo') {
      const generated = await generateStyleProfile(db);
      return json(generated, generated.ok ? 200 : (generated.error === 'poucas_amostras' ? 409 : 502));
    }
    if (!messageId) return json({ error:'message_id_required' }, 400);

    const { data:message, error:messageError } = await db.from('whatsapp_mensagens')
      .select('id, contato_map_id, cliente_id, whatsapp_nome, mensagem, recebida_em, tipo_mensagem, transcricao_audio, direcao')
      .eq('id', messageId).maybeSingle();
    if (messageError) throw messageError;
    if (!message) return json({ error:'message_not_found' }, 404);
    if (message.direcao === 'enviada') return json({ error:'message_not_inbound' }, 409);
    if (!message.cliente_id) return json({ error:'contact_not_linked' }, 409);
    if (message.tipo_mensagem === 'audio' && !message.transcricao_audio) return json({ error:'audio_not_transcribed' }, 409);
    if ((message.tipo_mensagem === 'imagem' || message.tipo_mensagem === 'documento') && !message.transcricao_audio) return json({ error:'image_not_read' }, 409);

    let contextMessages:ContextMessage[] = [{
      id:message.id, contato_map_id:message.contato_map_id, mensagem:message.mensagem,
      recebida_em:message.recebida_em, tipo_mensagem:message.tipo_mensagem, transcricao_audio:message.transcricao_audio,
    }];

    if (requestedContextIds.length) {
      const ids = [...new Set([...requestedContextIds, message.id])].slice(0,20);
      const { data:selected, error } = await db.from('whatsapp_mensagens')
        .select('id, contato_map_id, mensagem, recebida_em, tipo_mensagem, transcricao_audio, direcao')
        .in('id', ids);
      if (error) throw error;
      if ((selected || []).length !== ids.length) return json({ error:'context_message_not_found' }, 400);
      if ((selected || []).some((x:any) => x.contato_map_id !== message.contato_map_id || x.direcao === 'enviada')) return json({ error:'invalid_context_contact' }, 400);
      contextMessages = (selected as ContextMessage[]).sort((a,b) => new Date(a.recebida_em).getTime() - new Date(b.recebida_em).getTime());
    }

    // Recent conversation (both sides) so the reply stays consistent with what Maicon already said.
    const contextIdSet = new Set(contextMessages.map(m => m.id));
    const { data:recentRows, error:recentError } = await db.from('whatsapp_mensagens')
      .select('id, mensagem, recebida_em, tipo_mensagem, transcricao_audio, direcao')
      .eq('contato_map_id', message.contato_map_id)
      .lte('recebida_em', message.recebida_em)
      .order('recebida_em', { ascending:false }).limit(24);
    if (recentError) throw recentError;
    const recentConversation = ((recentRows || []) as ContextMessage[])
      .filter(m => !contextIdSet.has(m.id))
      .slice(0,14).reverse()
      .map(m => `[${m.recebida_em}] ${m.direcao === 'enviada' ? 'Maicon' : 'Cliente'}: ${msgText(m)}`)
      .join('\n');

    // Maicon's own earlier replies to THIS customer: the pattern to follow in this specific conversation.
    const { data:ownRows, error:ownError } = await db.from('whatsapp_mensagens')
      .select('mensagem, transcricao_audio')
      .eq('contato_map_id', message.contato_map_id).eq('direcao', 'enviada')
      .in('tipo_mensagem', ['texto', 'audio'])
      .lte('recebida_em', message.recebida_em)
      .order('recebida_em', { ascending:false }).limit(20);
    if (ownError) console.warn('contact style lookup failed', ownError);
    const contactReplies = ((ownRows || []) as { mensagem:string|null; transcricao_audio:string|null }[])
      .map(r => String(r.transcricao_audio || r.mensagem || '').replace(/^\s*🎤\s*/, '').replace(/\d{9,}/g, '[número]').replace(/\s+/g, ' ').trim())
      .filter(t => t.length >= 12 && t.length <= 600)
      .slice(0, 6);

    // Style is best-effort: a failure here must never block the suggestion.
    const stylePromise = Promise.all([
      db.from('whatsapp_ai_estilo').select('perfil, ativo, editado_manual, gerado_em').eq('id', 1).maybeSingle(),
      loadStylePairs(db, 200),
      loadCorrections(db, 60),
    ]).catch((e) => { console.warn('style lookup failed', e); return null; });

    const [clientResult, salesResult, rulesResult, productsResult, stockResult] = await Promise.all([
      db.from('clientes').select('cliente, contato, cidade, bairro, flex_saldo, ativo').eq('id', message.cliente_id).maybeSingle(),
      db.from('hist_vendas')
        .select('faturamento, numero_pedido_erp, produtos, qtd, r$_total, tabela, vendas, xdt, produto_id')
        .eq('cliente_id', message.cliente_id).order('faturamento', { ascending:false }).limit(400),
      db.from('whatsapp_ai_regras')
        .select('titulo, categoria, regra, prioridade, escopo_tipo, escopo_valor, cliente_id, valido_de, valido_ate')
        .eq('ativo', true).order('prioridade', { ascending:true }).order('atualizado_em', { ascending:false }),
      db.from('produtos')
        .select('id, produto, familia, ativo, livre, "200kg", "500kg", "1000kg", "2000kg", "4000kg", custo_total, custo_und, sugestao, peso_embalagem, quant_embalagem')
        .eq('ativo', true),
      db.from('estoque_cliente').select('produto_id, quantidade_atual, ultima_contagem').eq('cliente_id', message.cliente_id),
    ]);

    for (const result of [clientResult, salesResult, rulesResult, productsResult, stockResult]) if (result.error) throw result.error;
    const cliente = clientResult.data;
    if (!cliente) return json({ error:'client_not_found' }, 404);

    const sales = (salesResult.data || []) as Sale[];
    const products = (productsResult.data || []) as Product[];
    const stocks = (stockResult.data || []) as Stock[];
    const productById = new Map(products.map(p => [p.id,p]));
    const stockById = new Map(stocks.map(s => [s.produto_id,s]));

    const saleLines = sales.filter(s => String(s.vendas || '').toUpperCase() === 'VENDAS');
    const hoje = hojeSaoPaulo();
    const latestDate = saleLines.find(s => s.faturamento)?.faturamento || null;
    const daysSinceLast = latestDate ? Math.max(0, Math.round((Date.parse(hoje + 'T00:00:00Z') - Date.parse(latestDate.slice(0,10) + 'T00:00:00Z')) / 86400000)) : null;
    // Tabela que a IA usa para informar preço: ativa, senão a última que o cliente teve, senão livre.
    const tabela = tabelaDoCliente(sales, products, hoje);
    const availableTier = tabela.faixa;

    const contextText = contextMessages.map((m,i) => `${i+1}. [${m.recebida_em}] ${msgText(m)}`).join('\n');
    const queryText = contextMessages.map(m => msgText(m)).join(' ');
    const scored = products
      .map(p => ({ p, score:productScore(p,queryText) }))
      .filter(x => x.score > 0)
      .sort((a,b) => b.score - a.score)
      .slice(0,15);

    // Só o preço da unidade vai para a IA: o valor da caixa nunca é informado ao cliente.
    const priceContext = scored.length ? scored.map(({p,score},i) => {
      const pr = precoNaFaixa(p, availableTier);
      const commercialQty = Math.max(1,n(p.quant_embalagem));
      const preco = pr.unidade > 0 ? money(pr.unidade) : 'sem preço cadastrado';
      const sugestao = pr.sugestao > 0 ? money(pr.sugestao) : 'não cadastrada';
      return `${i+1}. ${p.produto} | família ${p.familia || '-'} | preço por unidade ${preco} | sugestão de venda por unidade ${sugestao} | ${commercialQty} un por caixa | relevância ${score.toFixed(1)}`;
    }).join('\n') : 'Nenhum produto pôde ser identificado com segurança pela mensagem.';

    const cutoff90 = Date.now() - 90*86400000;
    const metrics = new Map<string,{qty:number; last:string|null}>();
    for (const s of saleLines) {
      if (!s.produto_id || !s.faturamento) continue;
      const ts = new Date(s.faturamento + 'T12:00:00Z').getTime();
      if (ts < cutoff90) continue;
      const m = metrics.get(s.produto_id) || {qty:0,last:null};
      m.qty += n(s.qtd);
      if (!m.last || s.faturamento > m.last) m.last = s.faturamento;
      metrics.set(s.produto_id,m);
    }
    const orderContext = [...metrics.entries()].map(([id,m]) => {
      const p = productById.get(id); if (!p) return null;
      const stock = stockById.get(id);
      const monthly = m.qty / 3;
      const current = stock ? n(stock.quantidade_atual) : null;
      const suggested = current === null ? null : Math.max(0, Math.ceil(monthly - current));
      const pr = precoNaFaixa(p, availableTier);
      return { name:p.produto, qty90:m.qty, monthly, stock:current, stockDate:stock?.ultima_contagem || null, suggested, box:pr.caixa };
    }).filter(Boolean).sort((a:any,b:any) => (b.suggested || 0) - (a.suggested || 0) || b.monthly-a.monthly).slice(0,25);
    const orderText = orderContext.length ? orderContext.map((x:any,i) =>
      `${i+1}. ${x.name} | comprado 90d ${x.qty90} | média/mês ${x.monthly.toFixed(1)} | estoque ${x.stock === null ? 'sem contagem' : x.stock} ${x.stockDate ? '('+x.stockDate+')' : ''} | sugestão estimada ${x.suggested === null ? 'indisponível' : x.suggested} emb. | valor da caixa ${money(x.box)} (só para somar o total do pedido; nunca informe como preço)`
    ).join('\n') : 'Sem histórico suficiente para sugestão.';

    const today = new Date().toISOString().slice(0,10);
    const rules = ((rulesResult.data || []) as AiRule[]).filter(r => {
      if (r.valido_de && r.valido_de > today) return false;
      if (r.valido_ate && r.valido_ate < today) return false;
      if (r.escopo_tipo === 'cliente' && r.cliente_id !== message.cliente_id) return false;
      return true;
    });
    const rulesText = rules.length ? rules.map((r,i) =>
      `${i+1}. prioridade ${r.prioridade}; categoria ${r.categoria}; escopo ${r.escopo_tipo}${r.escopo_valor ? ' ('+r.escopo_valor+')' : ''}; ${r.titulo}: ${r.regra}`
    ).join('\n') : 'Nenhuma regra comercial editável cadastrada.';

    const styleData = await stylePromise;
    const styleRow = styleData?.[0]?.data as { perfil:string; ativo:boolean; editado_manual:boolean; gerado_em:string|null } | null | undefined;
    const ownStyleReplies = styleRow && styleRow.ativo === false ? [] : contactReplies;
    const stylePairs = (styleData?.[1] || []) as StylePair[];
    const allCorrections = (styleData?.[2] || []) as Correction[];
    const corrections = styleRow && styleRow.ativo === false ? [] : pickCorrections(allCorrections, message.contato_map_id, queryText, 4);
    const recentDecisions = allCorrections.slice(0, 30);
    const approvedAsIs = recentDecisions.filter(r => !r.alterado).length;
    const styleProfile = styleRow && styleRow.ativo ? String(styleRow.perfil || '').trim() : '';
    const styleExamples = styleRow && styleRow.ativo === false ? [] : pickStyleExamples(stylePairs, queryText, ownStyleReplies.length >= 3 ? 2 : 4);
    const styleText = styleProfile || styleExamples.length || ownStyleReplies.length || corrections.length ? [
      ownStyleReplies.length ? `COMO MAICON JÁ FALA COM ESTE CLIENTE (respostas dele nesta conversa, da mais recente para a mais antiga; siga este padrão de tratamento, formalidade, emoji, tamanho e jeito de abrir e fechar):\n` +
        ownStyleReplies.map((t,i) => `${i+1}. ${clip(t, 320)}`).join('\n') : '',
      corrections.length ? `CORREÇÕES QUE MAICON FEZ EM SUGESTÕES ANTERIORES (aprenda o tipo de ajuste: tamanho, tom, saudação, emoji, ordem das informações; nunca copie valores, quantidades, datas ou nomes delas)` +
        (recentDecisions.length >= 5 ? ` — das últimas ${recentDecisions.length} sugestões enviadas, ${approvedAsIs} saíram sem alteração` : '') + `:\n` +
        corrections.map((c,i) => `${i+1}. Cliente: ${clip(c.pergunta || '', 200)}\n   IA sugeriu: ${clip(c.sugestao_ia, 300)}\n   Maicon enviou: ${clip(c.texto_enviado, 300)}`).join('\n') : '',
      styleProfile ? `PERFIL DO ESTILO DO MAICON:\n${styleProfile}` : '',
      styleExamples.length ? `EXEMPLOS DE COMO MAICON JÁ RESPONDEU (use só como referência de tom, vocabulário e tamanho):\n` +
        styleExamples.map((x,i) => `${i+1}. Cliente: ${clip(x.pergunta || '', 220)}\n   Maicon: ${clip(x.resposta, 320)}`).join('\n') : '',
    ].filter(Boolean).join('\n\n') : 'Ainda sem histórico de respostas do Maicon para imitar.';

    // Keep the profile fresh without making the user wait: refresh weekly in the background unless he edited it by hand.
    const stale = !styleRow || (!styleRow.editado_manual &&
      (!styleRow.gerado_em || Date.now() - new Date(styleRow.gerado_em).getTime() > STYLE_REFRESH_DAYS*86400000));
    if (stale && stylePairs.length >= STYLE_MIN_SAMPLES) {
      const refresh = generateStyleProfile(db).catch((e) => console.warn('style refresh failed', e));
      try { (globalThis as any).EdgeRuntime?.waitUntil?.(refresh); } catch { /* best effort */ }
    }

    const purchases = saleLines.slice(0,30).map((s,i) =>
      `${i+1}. ${s.faturamento || ''} | ${s.produtos || ''} | qtd ${n(s.qtd)} | valor ${money(n(s['r$_total']))} | desconto registrado ${(normalizarDesconto(s.xdt)*100).toFixed(1)}%`
    ).join('\n');

    // Greeting is based on the current São Paulo local time, never the UTC server clock.
    const saoPauloHour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23',
    }).format(new Date()));
    const saudacaoAtual = saoPauloHour >= 5 && saoPauloHour < 12 ? 'Bom dia'
      : saoPauloHour >= 12 && saoPauloHour < 18 ? 'Boa tarde' : 'Boa noite';
    const agoraLocal = new Intl.DateTimeFormat('pt-BR', {
      timeZone:'America/Sao_Paulo', dateStyle:'full', timeStyle:'short'
    }).format(new Date());
    const finalMessage = msgText(message);
    const prompt = `Você escreve respostas de WhatsApp Business em nome de Maicon, representante comercial da Adimax.

OBJETIVO: responda usando os dados reais do CRM. Quando houver preço disponível, INFORME O PREÇO; não responda que vai verificar. Quando o cliente pedir reposição, pedido, sugestão ou “o que precisa”, use histórico e estoque abaixo para sugerir quantidades. Nunca invente dados.

REGRAS DE RESPOSTA:
- Português do Brasil, natural, cordial, objetivo e comercial, normalmente 1 a 4 frases.
- Não diga que é IA. Não use markdown, títulos, listas ou aspas.
- Para pergunta de preço: identifique produto e versão. Se houver uma única opção claramente correspondente em PREÇOS PARA INFORMAR AO CLIENTE, informe o preço por unidade dela, mesmo que o cliente pergunte pela caixa, e a sugestão de venda quando houver. Se houver várias opções plausíveis, peça apenas o detalhe que falta (peso/versão), sem inventar.
- A TABELA DO CLIENTE e os preços já foram calculados pelo CRM. Use exatamente esses valores; não recalcule, não troque de tabela e não cite outras tabelas nem regra de volume.
- Para sugestão de pedido: use SOMENTE a seção SUGESTÃO/ESTOQUE. A quantidade sugerida é uma estimativa baseada em compras dos últimos 90 dias menos o estoque contado; se o estoque estiver sem contagem, não invente quantidade.
- Respeite pedido mínimo, boleto mínimo, campanhas e demais regras editáveis.
- Responda às mensagens selecionadas. Use a CONVERSA RECENTE apenas para manter coerência com o que Maicon já respondeu ou prometeu: não repita informações que ele já deu e não contradiga o que ele disse.
- A conversa recente pode estar incompleta (respostas enviadas só aparecem quando capturadas).
- Transcrições de áudio podem conter pequenas imprecisões.
- Mensagens que começam com 📷 são fotos e as que começam com 📄 são PDFs enviados, já descritos em texto (lista de pedido, print, nota, boleto, produto). Trate o conteúdo como o que o cliente mostrou; se algo estiver marcado como ilegível ou incerto, confirme com o cliente em vez de supor.
- NOMES: ao citar o nome do cliente ou do contato, escreva só a inicial de cada nome em maiúscula e o restante em minúsculas (ex.: "Carla", "Racao Facil"), nunca tudo em maiúsculas.
- ESTILO: escreva como o Maicon escreve (tom, vocabulário, tamanho, jeito de abrir e fechar), seguindo a seção ESTILO DO MAICON. Quando houver respostas dele a ESTE cliente, o padrão dessa conversa vale mais que o estilo geral. Se houver CORREÇÕES dele a sugestões anteriores, evite repetir o que ele costuma mudar. Os exemplos servem só como referência de jeito de falar: nunca copie deles preços, quantidades, datas, nomes ou condições, que podem estar desatualizados. Fatos vêm somente dos dados do CRM acima. Estilo nunca prevalece sobre as regras comerciais nem sobre as proteções acima.

DADOS DO CLIENTE
Cliente: ${properName(cliente.cliente)}
Contato: ${properName(cliente.contato) || 'não informado'}
Cidade/bairro: ${[cliente.cidade,cliente.bairro].filter(Boolean).join(' / ') || 'não informado'}
Saldo Flex: ${money(n(cliente.flex_saldo))}
Último faturamento: ${latestDate || 'não encontrado'}
Dias desde o último faturamento: ${daysSinceLast ?? 'não calculado'}
TABELA DO CLIENTE: ${descreverTabela(tabela)}

REGRAS COMERCIAIS ATIVAS
${rulesText}

ESTILO DO MAICON
${styleText}

CONVERSA RECENTE (apenas contexto; não responda a estas)
${recentConversation || 'Sem mensagens anteriores capturadas.'}

MENSAGENS SELECIONADAS COMO CONTEXTO
${contextText}

PREÇOS PARA INFORMAR AO CLIENTE (produtos mais relacionados à mensagem; já na TABELA DO CLIENTE, por unidade)
${priceContext}

SUGESTÃO/ESTOQUE DO CLIENTE
${orderText}

COMPRAS RECENTES
${purchases || 'Nenhuma compra recente encontrada'}

MENSAGEM QUE DEVE SER RESPONDIDA
[${message.recebida_em}] ${finalMessage}

Retorne somente a resposta sugerida.`;

    const response = await generate({ prompt, maxTokens:700, temperature:0.4 });
    const usedModel = response.model;
    let suggestion = String(response.text || '').trim();
    // Enforce the greeting if the model begins with one from the wrong period.
    suggestion = suggestion.replace(/^(bom dia|boa tarde|boa noite)(?=[!,.:;\\s]|$)/i,
      () => saudacaoAtual);
    if (!suggestion) return json({ error:'empty_model_response' }, 502);

    const generatedAt = new Date().toISOString();
    const { error:updateError } = await db.from('whatsapp_mensagens').update({
      sugestao_resposta:suggestion, sugestao_gerada_em:generatedAt, sugestao_modelo:usedModel,
      sugestao_erro:null, status:'sugerida',
    }).eq('id', message.id);
    if (updateError) throw updateError;

    return json({
      ok:true, suggestion, model:usedModel, generated_at:generatedAt,
      rules_applied:rules.length, context_messages:contextMessages.length,
      client_tier:availableTier, client_table:tabela.tipo, weight_28d:tabela.pesoAtivo, days_since_last:daysSinceLast,
      matched_products:scored.length, stock_items:stocks.length,
      style_examples:styleExamples.length, style_contact_replies:ownStyleReplies.length, style_corrections:corrections.length, style_profile:Boolean(styleProfile),
    });
  } catch (error) {
    console.error(error);
    return json({ error:'operation_failed' }, 500);
  }
});