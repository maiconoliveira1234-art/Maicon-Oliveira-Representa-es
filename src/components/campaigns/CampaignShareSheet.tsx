import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, ImageUp, Loader2, Search, Send, X } from 'lucide-react';
import type { Cliente, Produto } from '../../types';
import type { Campanha } from '../../lib/campaignEngine';
import { FAIXAS, hojeSaoPaulo, mensagemCampanha, rotuloFaixa, tabelaDoCliente, type Faixa } from '../../lib/campaignShare';
import { matchesQuery, normalizeBrPhone } from '../../lib/whatsappUi';
import { formatPersonName } from '../../lib/personName';
import { useDataManager } from '../../lib/dataManager';
import { ClientDetailModal } from '../ui/ClientDetailModal';

const inputClass = 'w-full rounded-xl border border-neutral-200 bg-white p-2.5 text-sm outline-none focus:border-orange-500';
const labelClass = 'block space-y-1 text-xs font-semibold text-neutral-700';
const capitalizar = (s: string) => s.charAt(0).toLocaleUpperCase('pt-BR') + s.slice(1);

export function CampaignShareSheet({ campanha, produtos, onClose }: {
  campanha: Campanha;
  produtos: Produto[];
  onClose: () => void;
}) {
  const { clientes, loadClientDetails } = useDataManager();
  const [busca, setBusca] = useState('');
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [faixa, setFaixa] = useState<Faixa>('livre');
  const [carregandoTabela, setCarregandoTabela] = useState(false);
  const [texto, setTexto] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState('');
  const pedidoTabela = useRef('');
  const ultimoGerado = useRef('');

  const resultado = useMemo(() => mensagemCampanha(campanha, produtos, {
    faixa,
    nomeCliente: cliente?.contato ? formatPersonName(cliente.contato).split(' ')[0] : '',
  }), [campanha, produtos, faixa, cliente]);
  // Só substitui o texto editado quando a mensagem gerada realmente muda (cliente, tabela, campanha).
  useEffect(() => {
    if (resultado.texto === ultimoGerado.current) return;
    ultimoGerado.current = resultado.texto;
    setTexto(resultado.texto);
  }, [resultado]);

  const sugestoes = useMemo(() => {
    if (cliente || !busca.trim()) return [];
    return clientes
      .filter(c => matchesQuery(busca, c.cliente, c.contato, c.cidade))
      .sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.cliente.localeCompare(b.cliente, 'pt-BR'))
      .slice(0, 6);
  }, [clientes, busca, cliente]);

  const escolherCliente = async (c: Cliente) => {
    setCliente(c); setBusca(''); setErro('');
    pedidoTabela.current = c.id;
    setCarregandoTabela(true);
    try {
      const detalhes = await loadClientDetails(c.id, false, true);
      if (pedidoTabela.current !== c.id) return;
      const vendas = (detalhes?.historico || []).map(h => ({
        faturamento: h.faturamento, produto_id: h.produto_id, produtos: h.produtos, qtd: h.qtd,
      }));
      setFaixa(tabelaDoCliente(vendas, produtos, hojeSaoPaulo()).faixa);
    } catch {
      if (pedidoTabela.current === c.id) setErro('Não foi possível consultar a tabela do cliente. Confira a tabela antes de enviar.');
    } finally {
      if (pedidoTabela.current === c.id) setCarregandoTabela(false);
    }
  };
  const limparCliente = () => { pedidoTabela.current = ''; setCliente(null); setCarregandoTabela(false); setErro(''); };

  const telefone = cliente ? normalizeBrPhone(cliente.telefone) : null;
  const link = (telefone ? `https://wa.me/${telefone}` : 'https://wa.me/') + '?text=' + encodeURIComponent(texto.trim());
  const podeEnviar = !!texto.trim() && !carregandoTabela;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto.trim());
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch { setErro('Não foi possível copiar. Selecione o texto e copie manualmente.'); }
  };

  const podeCompartilharImagem = !!campanha.imagem_data && typeof navigator !== 'undefined' && !!navigator.share && !!navigator.canShare;
  const compartilharEncarte = async () => {
    if (!campanha.imagem_data) return;
    try {
      const blob = await (await fetch(campanha.imagem_data)).blob();
      const extensao = blob.type.split('/')[1] || 'jpg';
      const nome = (campanha.titulo || 'campanha').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase();
      const file = new File([blob], `${nome}.${extensao}`, { type: blob.type });
      if (!navigator.canShare({ files: [file] })) { setErro('Este aparelho não permite compartilhar a imagem.'); return; }
      await navigator.share({ files: [file] });
    } catch (e: unknown) {
      if ((e as { name?: string })?.name !== 'AbortError') setErro('Não foi possível compartilhar o encarte.');
    }
  };

  return (
    <ClientDetailModal title="Compartilhar no WhatsApp" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm font-black text-neutral-900">{campanha.titulo}</p>
        {(resultado.avisos.length > 0 || erro) && (
          <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <ul className="space-y-1">
              {erro && <li>{erro}</li>}
              {resultado.avisos.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className={labelClass}>
            <span>Cliente</span>
            {cliente ? (
              <div className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-neutral-900">{cliente.cliente}</p>
                  {!telefone && <p className="text-xs font-semibold text-amber-700">Sem telefone válido no cadastro</p>}
                </div>
                <button type="button" onClick={limparCliente} aria-label="Remover cliente"
                  className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-200"><X size={18} /></button>
              </div>
            ) : (
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
                <input className={inputClass + ' pl-9'} value={busca} onChange={e => setBusca(e.target.value)}
                  placeholder="Opcional" aria-label="Buscar cliente" />
              </div>
            )}
            {sugestoes.length > 0 && (
              <ul className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
                {sugestoes.map(c => (
                  <li key={c.id}>
                    <button type="button" onClick={() => void escolherCliente(c)}
                      className="flex min-h-11 w-full flex-col items-start justify-center border-b border-neutral-100 px-3 py-2 text-left last:border-b-0 hover:bg-orange-50">
                      <span className="text-sm font-bold text-neutral-900">{c.cliente}</span>
                      {c.cidade && <span className="text-xs font-normal text-neutral-500">{c.cidade}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <label className={labelClass}>
            <span className="flex items-center gap-1.5">Tabela {carregandoTabela && <Loader2 size={13} className="animate-spin" aria-label="Consultando tabela do cliente" />}</span>
            <select className={inputClass} value={faixa} onChange={e => setFaixa(e.target.value as Faixa)}>
              {FAIXAS.map(f => <option key={f} value={f}>{capitalizar(rotuloFaixa(f))}</option>)}
            </select>
          </label>
        </div>
        <label className={labelClass}>
          <span>Mensagem</span>
          <textarea className={inputClass + ' leading-relaxed'} rows={14} value={texto} onChange={e => setTexto(e.target.value)} />
        </label>
        <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 pt-3">
          {podeCompartilharImagem && (
            <button type="button" onClick={() => void compartilharEncarte()}
              className="flex min-h-11 items-center gap-1.5 rounded-lg border border-neutral-300 px-3 text-sm font-bold text-neutral-800">
              <ImageUp size={16} /> Encarte
            </button>
          )}
          <button type="button" onClick={() => void copiar()} disabled={!texto.trim()}
            className="flex min-h-11 items-center gap-1.5 rounded-lg border border-neutral-300 px-3 text-sm font-bold text-neutral-800 disabled:opacity-50">
            {copiado ? <Check size={16} /> : <Copy size={16} />} {copiado ? 'Copiado' : 'Copiar'}
          </button>
          <a href={podeEnviar ? link : undefined} target="_blank" rel="noopener noreferrer"
            aria-disabled={!podeEnviar}
            onClick={e => { if (!podeEnviar) e.preventDefault(); }}
            className={'flex min-h-11 items-center gap-1.5 rounded-lg bg-green-600 px-4 text-sm font-bold text-white' + (podeEnviar ? '' : ' pointer-events-none opacity-50')}>
            <Send size={16} /> Abrir no WhatsApp
          </a>
        </div>
      </div>
    </ClientDetailModal>
  );
}
