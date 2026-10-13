import { createClient } from 'npm:@supabase/supabase-js@2.101.1';
import { GoogleGenAI } from 'npm:@google/genai';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ai = new GoogleGenAI({ apiKey: Deno.env.get('GEMINI_API_KEY')! });

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
  tipo_mensagem:string|null; transcricao_audio:string|null;
};
type Product = {
  id:string; produto:string; familia:string|null; ativo:boolean|null;
  livre:number|null; '200kg':number|null; '500kg':number|null; '1000kg':number|null;
  '2000kg':number|null; '4000kg':number|null; custo_total:number|null; custo_und:number|null;
  peso_embalagem:number|null; quant_embalagem:number|null;
};
type Sale = {
  faturamento:string|null; numero_pedido_erp:string|null; produtos:string|null; qtd:number|null;
  'r$_total':number|null; tabela:string|null; vendas:string|null; xdt:number|null; produto_id:string|null;
};
type Stock = { produto_id:string; quantidade_atual:number|null; ultima_contagem:string|null };

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
function tierFromWeight(weight:number) {
  if (weight >= 4000) return '4000kg';
  if (weight >= 2000) return '2000kg';
  if (weight >= 1000) return '1000kg';
  if (weight >= 500) return '500kg';
  if (weight >= 200) return '200kg';
  return 'livre';
}
function daysBetween(date:string|null, now = new Date()) {
  if (!date) return null;
  const d = new Date(date + 'T12:00:00Z');
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86400000));
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
function priceForTier(p:Product, tier:string) {
  const discount = n((p as any)[tier]);
  const box = n(p.custo_total) * (1 - discount);
  const unit = n(p.custo_und) * (1 - discount);
  return { discount, box, unit };
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
    if (!messageId) return json({ error:'message_id_required' }, 400);

    const { data:message, error:messageError } = await db.from('whatsapp_mensagens')
      .select('id, contato_map_id, cliente_id, whatsapp_nome, mensagem, recebida_em, tipo_mensagem, transcricao_audio')
      .eq('id', messageId).maybeSingle();
    if (messageError) throw messageError;
    if (!message) return json({ error:'message_not_found' }, 404);
    if (!message.cliente_id) return json({ error:'contact_not_linked' }, 409);
    if (message.tipo_mensagem === 'audio' && !message.transcricao_audio) return json({ error:'audio_not_transcribed' }, 409);

    let contextMessages:ContextMessage[] = [{
      id:message.id, contato_map_id:message.contato_map_id, mensagem:message.mensagem,
      recebida_em:message.recebida_em, tipo_mensagem:message.tipo_mensagem, transcricao_audio:message.transcricao_audio,
    }];

    if (requestedContextIds.length) {
      const ids = [...new Set([...requestedContextIds, message.id])].slice(0,20);
      const { data:selected, error } = await db.from('whatsapp_mensagens')
        .select('id, contato_map_id, mensagem, recebida_em, tipo_mensagem, transcricao_audio')
        .in('id', ids);
      if (error) throw error;
      if ((selected || []).length !== ids.length) return json({ error:'context_message_not_found' }, 400);
      if ((selected || []).some((x:any) => x.contato_map_id !== message.contato_map_id)) return json({ error:'invalid_context_contact' }, 400);
      contextMessages = (selected as ContextMessage[]).sort((a,b) => new Date(a.recebida_em).getTime() - new Date(b.recebida_em).getTime());
    }

    const [clientResult, salesResult, rulesResult, productsResult, stockResult] = await Promise.all([
      db.from('clientes').select('cliente, contato, cidade, bairro, flex_saldo, ativo').eq('id', message.cliente_id).maybeSingle(),
      db.from('hist_vendas')
        .select('faturamento, numero_pedido_erp, produtos, qtd, r$_total, tabela, vendas, xdt, produto_id')
        .eq('cliente_id', message.cliente_id).order('faturamento', { ascending:false }).limit(400),
      db.from('whatsapp_ai_regras')
        .select('titulo, categoria, regra, prioridade, escopo_tipo, escopo_valor, cliente_id, valido_de, valido_ate')
        .eq('ativo', true).order('prioridade', { ascending:true }).order('atualizado_em', { ascending:false }),
      db.from('produtos')
        .select('id, produto, familia, ativo, livre, "200kg", "500kg", "1000kg", "2000kg", "4000kg", custo_total, custo_und, peso_embalagem, quant_embalagem')
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
    const latestSale = saleLines.find(s => s.faturamento) || null;
    const latestDate = latestSale?.faturamento || null;
    const latestOrderKey = latestSale?.numero_pedido_erp || null;
    const latestOrderLines = latestSale
      ? saleLines.filter(s => latestOrderKey ? s.numero_pedido_erp === latestOrderKey : s.faturamento === latestDate)
      : [];
    const latestWeight = latestOrderLines.reduce((sum,s) => {
      const p = s.produto_id ? productById.get(s.produto_id) : null;
      return sum + n(s.qtd) * n(p?.peso_embalagem);
    },0);
    const daysSinceLast = daysBetween(latestDate);
    const retained = daysSinceLast !== null && daysSinceLast <= 28;
    const lastTier = tierFromWeight(latestWeight);
    const availableTier = retained ? lastTier : 'livre';

    const contextText = contextMessages.map((m,i) => `${i+1}. [${m.recebida_em}] ${m.transcricao_audio || m.mensagem}`).join('\n');
    const queryText = contextMessages.map(m => m.transcricao_audio || m.mensagem).join(' ');
    const scored = products
      .map(p => ({ p, score:productScore(p,queryText) }))
      .filter(x => x.score > 0)
      .sort((a,b) => b.score - a.score)
      .slice(0,15);

    const priceContext = scored.length ? scored.map(({p,score},i) => {
      const pr = priceForTier(p, availableTier);
      const commercialQty = Math.max(1,n(p.quant_embalagem));
      return `${i+1}. ${p.produto} | família ${p.familia || '-'} | faixa ${availableTier} | desconto ${(pr.discount*100).toFixed(1)}% | embalagem comercial ${money(pr.box)} | unidade ${money(pr.unit)} | ${commercialQty} un/embalagem | peso ${n(p.peso_embalagem)} kg | relevância ${score.toFixed(1)}`;
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
      const pr = priceForTier(p, availableTier);
      return { name:p.produto, qty90:m.qty, monthly, stock:current, stockDate:stock?.ultima_contagem || null, suggested, box:pr.box };
    }).filter(Boolean).sort((a:any,b:any) => (b.suggested || 0) - (a.suggested || 0) || b.monthly-a.monthly).slice(0,25);
    const orderText = orderContext.length ? orderContext.map((x:any,i) =>
      `${i+1}. ${x.name} | comprado 90d ${x.qty90} | média/mês ${x.monthly.toFixed(1)} | estoque ${x.stock === null ? 'sem contagem' : x.stock} ${x.stockDate ? '('+x.stockDate+')' : ''} | sugestão estimada ${x.suggested === null ? 'indisponível' : x.suggested} emb. | valor atual/emb. ${money(x.box)}`
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

    const purchases = saleLines.slice(0,30).map((s,i) =>
      `${i+1}. ${s.faturamento || ''} | ${s.produtos || ''} | qtd ${n(s.qtd)} | valor ${money(n(s['r$_total']))} | desconto registrado ${(n(s.xdt)*100).toFixed(1)}%`
    ).join('\n');

    const finalMessage = message.transcricao_audio || message.mensagem;
    const prompt = `Você escreve respostas de WhatsApp Business em nome de Maicon, representante comercial da Adimax.

OBJETIVO: responda usando os dados reais do CRM. Quando houver preço disponível, INFORME O PREÇO; não responda que vai verificar. Quando o cliente pedir reposição, pedido, sugestão ou “o que precisa”, use histórico e estoque abaixo para sugerir quantidades. Nunca invente dados.

REGRAS DE RESPOSTA:
- Português do Brasil, natural, cordial, objetivo e comercial, normalmente 1 a 4 frases.
- Não diga que é IA. Não use markdown, títulos, listas ou aspas.
- Para pergunta de preço: identifique produto e embalagem. Se houver uma única opção claramente correspondente em PREÇOS ATUAIS, use o valor da embalagem/unidade adequado à pergunta. Se houver várias opções plausíveis, peça apenas o detalhe que falta (peso/versão), sem inventar.
- A faixa comercial disponível do cliente já foi calculada pelo CRM. Use-a. Se a recompra de 28 dias expirou, a faixa disponível será livre.
- Para sugestão de pedido: use SOMENTE a seção SUGESTÃO/ESTOQUE. A quantidade sugerida é uma estimativa baseada em compras dos últimos 90 dias menos o estoque contado; se o estoque estiver sem contagem, não invente quantidade.
- Respeite pedido mínimo, boleto mínimo, campanhas e demais regras editáveis.
- Use exclusivamente as mensagens selecionadas para interpretar a conversa; não misture outras mensagens.
- O histórico contém mensagens recebidas e pode não conter respostas já enviadas.
- Transcrições de áudio podem conter pequenas imprecisões.

DADOS DO CLIENTE
Cliente: ${cliente.cliente}
Contato: ${cliente.contato || 'não informado'}
Cidade/bairro: ${[cliente.cidade,cliente.bairro].filter(Boolean).join(' / ') || 'não informado'}
Saldo Flex: ${money(n(cliente.flex_saldo))}
Último faturamento: ${latestDate || 'não encontrado'}
Dias desde o último faturamento: ${daysSinceLast ?? 'não calculado'}
Peso estimado do último pedido: ${latestWeight.toFixed(1)} kg
Faixa do último pedido: ${lastTier}
Recompra dentro de 28 dias: ${retained ? 'sim' : 'não'}
FAIXA COMERCIAL DISPONÍVEL AGORA: ${availableTier}

REGRAS COMERCIAIS ATIVAS
${rulesText}

MENSAGENS SELECIONADAS COMO CONTEXTO
${contextText}

PREÇOS ATUAIS DOS PRODUTOS MAIS RELACIONADOS À MENSAGEM
${priceContext}

SUGESTÃO/ESTOQUE DO CLIENTE
${orderText}

COMPRAS RECENTES
${purchases || 'Nenhuma compra recente encontrada'}

MENSAGEM QUE DEVE SER RESPONDIDA
[${message.recebida_em}] ${finalMessage}

Retorne somente a resposta sugerida.`;

    const response = await ai.models.generateContent({ model:'gemini-3.5-flash-lite', contents:prompt });
    const suggestion = String(response.text || '').trim();
    if (!suggestion) return json({ error:'empty_model_response' }, 502);

    const generatedAt = new Date().toISOString();
    const { error:updateError } = await db.from('whatsapp_mensagens').update({
      sugestao_resposta:suggestion, sugestao_gerada_em:generatedAt, sugestao_modelo:'gemini-3.5-flash-lite',
      sugestao_erro:null, status:'sugerida',
    }).eq('id', message.id);
    if (updateError) throw updateError;

    return json({
      ok:true, suggestion, model:'gemini-3.5-flash-lite', generated_at:generatedAt,
      rules_applied:rules.length, context_messages:contextMessages.length,
      client_tier:availableTier, last_order_weight:latestWeight, days_since_last:daysSinceLast,
      matched_products:scored.length, stock_items:stocks.length,
    });
  } catch (error) {
    console.error(error);
    return json({ error:'operation_failed' }, 500);
  }
});