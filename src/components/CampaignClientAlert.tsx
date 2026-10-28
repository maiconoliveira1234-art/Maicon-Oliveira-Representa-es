import React, { useEffect, useMemo, useState } from 'react';
import { Megaphone, Send } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { Cliente, HistVenda, Produto } from '../types';
import type { Campanha } from '../lib/campaignEngine';
import { campanhasParaHistorico } from '../lib/campaignEngine';
import { ClientDetailModal } from './ui/ClientDetailModal';

export function CampaignClientAlert({ cliente, historico, produtos }: {
  cliente: Cliente;
  historico: HistVenda[];
  produtos: Produto[];
}) {
  const [campanhas, setCampanhas] = useState<Campanha[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let mounted = true;
    supabase.from('campanhas_comerciais').select('*').eq('status', 'ativa').then(({ data, error }) => {
      if (mounted && !error) setCampanhas((data || []) as Campanha[]);
    });
    return () => { mounted = false; };
  }, []);

  const elegiveis = useMemo(() => {
    const limite = new Date();
    limite.setFullYear(limite.getFullYear() - 1);
    const comprasRecentes = historico.filter(h =>
      h.faturamento && new Date(h.faturamento) >= limite &&
      (!h.vendas || !/bonifica|merchand/i.test(h.vendas))
    );
    return campanhasParaHistorico(campanhas, comprasRecentes, produtos);
  }, [campanhas, historico, produtos]);

  const phone = String(cliente.telefone || '').replace(/\D/g, '');
  const dest = phone.length >= 10 && phone.length <= 11 ? '55' + phone : phone;
  const canSend = /^55\d{10,11}$/.test(dest);
  const whatsappLink = (c: Campanha) => {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    const nome = cliente.contato || cliente.cliente;
    const message = greeting + ', ' + nome + '! Tudo bem? Estou com uma campanha vigente de ' + c.titulo +
      '. Posso te apresentar as condições para sua próxima reposição?';
    return 'https://wa.me/' + dest + '?text=' + encodeURIComponent(message);
  };

  if (!elegiveis.length) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-xl border border-orange-200 bg-orange-50 p-4 text-left text-sm font-bold text-orange-900 hover:bg-orange-100">
        <span className="flex items-center gap-2"><Megaphone size={18}/> Campanhas para oferecer ({elegiveis.length})</span>
        <span className="text-xs">Ver campanhas</span>
      </button>
      {open && <ClientDetailModal title={`Campanhas para oferecer (${elegiveis.length})`} onClose={() => setOpen(false)}>
      <div className="space-y-3">
      <p className="text-xs text-neutral-600">Baseado em produtos comprados nos últimos 12 meses. O envio é sempre manual.</p>
      {elegiveis.map(c => <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white p-3">
        <div className="min-w-0 flex-1"><p className="text-sm font-bold text-neutral-900">{c.titulo}</p>
          <p className="text-xs text-neutral-500">Válida até {new Date(c.fim + 'T12:00:00').toLocaleDateString('pt-BR')}</p>
        </div>
        {canSend ? <a href={whatsappLink(c)} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-xs font-bold text-white">
          <Send size={14}/> Oferecer no WhatsApp
        </a> : <span className="text-xs text-neutral-500">Telefone não disponível</span>}
      </div>)}
      </div>
      </ClientDetailModal>}
    </>
  );
}
