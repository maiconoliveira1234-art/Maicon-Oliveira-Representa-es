import { FormEvent, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, ChevronDown, ClipboardCheck, MapPin, Search, X } from 'lucide-react';
import { Cliente } from '../../types';
import { cn } from '../../lib/utils';
import { AgendaPendencia, AgendaPendenciaInput, AgendaPendenciaPrioridade, AgendaPendenciaTipo } from '../../types/agendaPendencia';

type Props = {
  open: boolean;
  item: AgendaPendencia | null;
  defaultDate: string;
  clientes: Cliente[];
  saving: boolean;
  onClose: () => void;
  onSave: (input: AgendaPendenciaInput) => Promise<void>;
  onCancelItem?: () => Promise<void>;
};

export function AgendaPendenciaModal({ open, item, defaultDate, clientes, saving, onClose, onSave, onCancelItem }: Props) {
  const [tipo, setTipo] = useState<AgendaPendenciaTipo>('VISITA_EXTRA');
  const [titulo, setTitulo] = useState('');
  const [descricao, setDescricao] = useState('');
  const [clienteId, setClienteId] = useState('');
  const [data, setData] = useState(defaultDate);
  const [horario, setHorario] = useState('');
  const [prioridade, setPrioridade] = useState<AgendaPendenciaPrioridade>('NORMAL');
  const [clientOpen, setClientOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState('');

  useEffect(() => {
    if (!open) return;
    setTipo(item?.tipo || 'VISITA_EXTRA');
    setTitulo(item?.titulo || '');
    setDescricao(item?.descricao || '');
    setClienteId(item?.cliente_id || '');
    setData(item?.data_prevista || defaultDate);
    setHorario(item?.horario_inicio?.slice(0, 5) || '');
    setPrioridade(item?.prioridade || 'NORMAL');
    setClientOpen(false);
    setClientSearch('');
  }, [open, item, defaultDate]);

  const filteredClients = useMemo(() => {
    const term = clientSearch.trim().toLocaleLowerCase('pt-BR');
    return clientes
      .filter((cliente) => cliente.ativo && (!term || `${cliente.cliente} ${cliente.cidade}`.toLocaleLowerCase('pt-BR').includes(term)))
      .sort((a, b) => a.cliente.localeCompare(b.cliente, 'pt-BR'));
  }, [clientes, clientSearch]);

  if (!open) return null;
  const selectedClient = clientes.find((cliente) => cliente.id === clienteId);
  const visitInvalid = tipo === 'VISITA_EXTRA' && (!clienteId || !data);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!titulo.trim() || visitInvalid) return;
    await onSave({
      tipo,
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      cliente_id: clienteId || null,
      data_prevista: data || null,
      horario_inicio: horario || null,
      horario_fim: null,
      dia_inteiro: !horario,
      prioridade
    });
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/45 p-0 sm:items-center sm:p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form onSubmit={submit} className="max-h-[92dvh] w-full overflow-y-auto rounded-t-lg bg-white shadow-2xl sm:max-w-xl sm:rounded-lg">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-orange-600">{item ? 'Editar registro' : 'Novo registro'}</p>
            <h2 className="text-lg font-black text-neutral-950">{tipo === 'VISITA_EXTRA' ? 'Visita extra' : 'Tarefa'}</h2>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100" title="Fechar"><X size={20} /></button>
        </div>

        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 rounded-lg border border-neutral-200 bg-neutral-50 p-1">
            <button type="button" onClick={() => setTipo('VISITA_EXTRA')} className={cn('flex h-10 items-center justify-center gap-2 rounded-lg text-xs font-black', tipo === 'VISITA_EXTRA' && 'bg-white text-orange-600 shadow-sm')}><MapPin size={15} />Visita extra</button>
            <button type="button" onClick={() => setTipo('TAREFA')} className={cn('flex h-10 items-center justify-center gap-2 rounded-lg text-xs font-black', tipo === 'TAREFA' && 'bg-white text-sky-600 shadow-sm')}><ClipboardCheck size={15} />Tarefa</button>
          </div>

          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase text-neutral-500">Titulo</span>
            <input value={titulo} onChange={(event) => setTitulo(event.target.value)} required className="h-11 w-full rounded-lg border border-neutral-200 px-3 text-sm font-bold outline-none focus:border-orange-500" />
          </label>

          <div className="relative">
            <span className="mb-1 block text-[10px] font-black uppercase text-neutral-500">Cliente {tipo === 'TAREFA' && '(opcional)'}</span>
            <button type="button" onClick={() => setClientOpen(!clientOpen)} className="flex h-11 w-full items-center justify-between rounded-lg border border-neutral-200 px-3 text-left text-sm font-bold">
              <span className={cn('truncate', !selectedClient && 'text-neutral-400')}>{selectedClient?.cliente || 'Selecionar cliente'}</span>
              <ChevronDown size={16} className="shrink-0 text-neutral-400" />
            </button>
            {clientOpen && (
              <div className="absolute z-30 mt-1 w-full rounded-lg border border-neutral-200 bg-white p-2 shadow-xl">
                <div className="relative mb-2">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                  <input autoFocus value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Buscar cliente" className="h-10 w-full rounded-lg border border-neutral-200 pl-9 pr-3 text-sm outline-none focus:border-orange-500" />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {tipo === 'TAREFA' && <button type="button" onClick={() => { setClienteId(''); setClientOpen(false); }} className="w-full rounded-lg px-3 py-2 text-left text-sm font-bold text-neutral-500 hover:bg-neutral-50">Sem cliente</button>}
                  {filteredClients.map((cliente) => (
                    <button key={cliente.id} type="button" onClick={() => { setClienteId(cliente.id); setClientOpen(false); }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-neutral-50">
                      <span className="truncate text-sm font-bold text-neutral-900">{cliente.cliente}</span>
                      {clienteId === cliente.id && <Check size={15} className="shrink-0 text-orange-600" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-3">
            <label className="min-w-0">
              <span className="mb-1 block text-[10px] font-black uppercase text-neutral-500">Data {tipo === 'TAREFA' && '(opcional)'}</span>
              <div className="relative">
                <CalendarDays size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input type="date" value={data} onChange={(event) => setData(event.target.value)} className="h-11 min-w-0 w-full rounded-lg border border-neutral-200 pl-9 pr-2 text-sm font-bold outline-none focus:border-orange-500" />
              </div>
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-black uppercase text-neutral-500">Horario</span>
              <input type="time" value={horario} onChange={(event) => setHorario(event.target.value)} className="h-11 w-full rounded-lg border border-neutral-200 px-2 text-sm font-bold outline-none focus:border-orange-500" />
            </label>
          </div>

          <div>
            <span className="mb-1 block text-[10px] font-black uppercase text-neutral-500">Prioridade</span>
            <div className="grid grid-cols-3 gap-2">
              {(['NORMAL', 'ALTA', 'URGENTE'] as const).map((value) => (
                <button key={value} type="button" onClick={() => setPrioridade(value)} className={cn('h-10 rounded-lg border text-[10px] font-black', prioridade === value ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-200 text-neutral-500')}>{value}</button>
              ))}
            </div>
          </div>

          <label className="block">
            <span className="mb-1 block text-[10px] font-black uppercase text-neutral-500">Descricao</span>
            <textarea value={descricao} onChange={(event) => setDescricao(event.target.value)} rows={3} className="w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-orange-500" />
          </label>
        </div>

        <div className="sticky bottom-0 flex gap-2 border-t border-neutral-200 bg-white p-4">
          {item && onCancelItem && <button type="button" disabled={saving} onClick={onCancelItem} className="h-11 rounded-lg px-3 text-xs font-black text-rose-600 hover:bg-rose-50">Cancelar registro</button>}
          <button type="button" onClick={onClose} className="ml-auto h-11 rounded-lg border border-neutral-200 px-4 text-xs font-black text-neutral-600">Voltar</button>
          <button type="submit" disabled={saving || !titulo.trim() || visitInvalid} className="h-11 rounded-lg bg-orange-600 px-5 text-xs font-black text-white disabled:opacity-40">{saving ? 'Salvando...' : 'Salvar'}</button>
        </div>
      </form>
    </div>,
    document.body
  );
}
