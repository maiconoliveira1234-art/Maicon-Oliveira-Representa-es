import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, 
  Trash2, 
  Plus, 
  Calendar, 
  User, 
  AlertTriangle, 
  Save, 
  Search, 
  Package, 
  ArrowRightLeft,
  Check
} from 'lucide-react';
import { Cliente, Produto, HistVenda } from '../../types';
import { useDataManager, UpdateOrderItemPayload, NewOrderItemPayload } from '../../lib/dataManager';
import { cn, formatCurrency, formatWeight } from '../../lib/utils';

export interface EditableOrderGroup {
  key: string;
  pedidoId?: string;
  numeroPedidoErp?: string;
  date: string;
  clienteId: string;
  clienteNome: string;
  items: HistVenda[];
  total: number;
  totalWeight: number;
}

interface OrderEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: EditableOrderGroup;
  clienteOriginal: Cliente;
  clientes: Cliente[];
  produtos: Produto[];
  onSaved?: () => void;
}

interface ItemRowState {
  tempKey: string;
  id?: string;
  produto_id: string;
  produtos: string;
  qtd: number;
  r_total: number;
  vendas: string;
  tabela: string;
  xdt: number;
  acresc_val: number;
  numero_pedido_erp?: string;
  isNew?: boolean;
}

export function OrderEditModal({
  isOpen,
  onClose,
  order,
  clienteOriginal,
  clientes,
  produtos,
  onSaved
}: OrderEditModalProps) {
  const { updateOrderSales } = useDataManager();

  // State
  const [selectedClienteId, setSelectedClienteId] = useState<string>(order.clienteId || clienteOriginal.id);
  const [orderDate, setOrderDate] = useState<string>(order.date ? order.date.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [items, setItems] = useState<ItemRowState[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  
  // UI states
  const [isChangingClient, setIsChangingClient] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Confirmation modals
  const [showTransferConfirm, setShowTransferConfirm] = useState(false);
  const [showDeleteLastItemConfirm, setShowDeleteLastItemConfirm] = useState<string | null>(null);

  // Initialize items from order
  useEffect(() => {
    if (!isOpen) return;

    setSelectedClienteId(order.clienteId || clienteOriginal.id);
    setOrderDate(order.date ? order.date.slice(0, 10) : new Date().toISOString().slice(0, 10));
    setRemovedIds([]);
    setErrorMessage(null);
    setIsChangingClient(false);
    setClientSearch('');

    const initialItems: ItemRowState[] = order.items.map((h, idx) => ({
      tempKey: `orig-${h.id || idx}`,
      id: h.id,
      produto_id: h.produto_id,
      produtos: h.produtos,
      qtd: Number(h.qtd) || 0,
      r_total: Number(h["r$_total"]) || 0,
      vendas: h.vendas || 'VENDA',
      tabela: h.tabela || 'TABELA PADRAO',
      xdt: Number(h.xdt) || 0,
      acresc_val: Number(h["acresc."]) || 0,
      numero_pedido_erp: h.numero_pedido_erp
    }));

    setItems(initialItems);
  }, [isOpen, order, clienteOriginal]);

  const produtosMap = useMemo(() => {
    return produtos.reduce((acc, p) => {
      acc[p.id] = p;
      return acc;
    }, {} as Record<string, Produto>);
  }, [produtos]);

  const selectedCliente = useMemo(() => {
    return clientes.find(c => c.id === selectedClienteId) || clienteOriginal;
  }, [clientes, selectedClienteId, clienteOriginal]);

  const isClientTransferred = selectedClienteId !== clienteOriginal.id;

  const filteredClientes = useMemo(() => {
    if (!clientSearch.trim()) return clientes.slice(0, 20);
    const q = clientSearch.toLowerCase();
    return clientes
      .filter(c => c.cliente.toLowerCase().includes(q) || c.cidade?.toLowerCase().includes(q))
      .slice(0, 30);
  }, [clientes, clientSearch]);

  // Totals
  const totalValue = useMemo(() => {
    return items.reduce((acc, item) => acc + (Number(item.r_total) || 0), 0);
  }, [items]);

  const totalWeight = useMemo(() => {
    return items.reduce((acc, item) => {
      const prod = produtosMap[item.produto_id];
      return acc + ((Number(item.qtd) || 0) * (prod?.peso_embalagem || 0));
    }, 0);
  }, [items, produtosMap]);

  // Handlers for Items
  const handleAddItem = () => {
    const defaultProd = produtos[0];
    if (!defaultProd) return;

    const newItem: ItemRowState = {
      tempKey: `new-${Date.now()}-${Math.random()}`,
      produto_id: defaultProd.id,
      produtos: defaultProd.produto,
      qtd: 1,
      r_total: Number(defaultProd.livre || 0),
      vendas: 'VENDA',
      tabela: 'TABELA PADRAO',
      xdt: 0,
      acresc_val: 0,
      isNew: true
    };

    setItems(prev => [...prev, newItem]);
  };

  const handleProductChange = (tempKey: string, newProdId: string) => {
    const prod = produtosMap[newProdId];
    if (!prod) return;

    setItems(prev => prev.map(item => {
      if (item.tempKey !== tempKey) return item;
      const unitPrice = prod.livre || (item.qtd > 0 ? item.r_total / item.qtd : 0);
      return {
        ...item,
        produto_id: prod.id,
        produtos: prod.produto,
        r_total: Number((unitPrice * item.qtd).toFixed(2))
      };
    }));
  };

  const handleQuantityChange = (tempKey: string, newQtd: number) => {
    const safeQtd = Math.max(0, newQtd);
    setItems(prev => prev.map(item => {
      if (item.tempKey !== tempKey) return item;
      const currentUnit = item.qtd > 0 ? item.r_total / item.qtd : (produtosMap[item.produto_id]?.livre || 0);
      return {
        ...item,
        qtd: safeQtd,
        r_total: Number((currentUnit * safeQtd).toFixed(2))
      };
    }));
  };

  const handleValueChange = (tempKey: string, newTotal: number) => {
    const safeTotal = Math.max(0, newTotal);
    setItems(prev => prev.map(item => {
      if (item.tempKey !== tempKey) return item;
      return {
        ...item,
        r_total: safeTotal
      };
    }));
  };

  const handleRemoveItem = (tempKey: string) => {
    const itemToRemove = items.find(i => i.tempKey === tempKey);
    if (!itemToRemove) return;

    // Se for o último item restante no pedido
    if (items.length === 1) {
      setShowDeleteLastItemConfirm(tempKey);
      return;
    }

    if (itemToRemove.id) {
      setRemovedIds(prev => [...prev, itemToRemove.id!]);
    }
    setItems(prev => prev.filter(i => i.tempKey !== tempKey));
  };

  const confirmDeleteLastItem = (tempKey: string) => {
    const itemToRemove = items.find(i => i.tempKey === tempKey);
    if (itemToRemove?.id) {
      setRemovedIds(prev => [...prev, itemToRemove.id!]);
    }
    setItems(prev => prev.filter(i => i.tempKey !== tempKey));
    setShowDeleteLastItemConfirm(null);
  };

  // Canonical Pedido ID resolver
  const canonicalPedidoId = useMemo(() => {
    if (order.pedidoId && order.pedidoId.trim().length > 0) {
      return order.pedidoId.trim();
    }
    if (order.items[0]?.pedido_id && order.items[0].pedido_id.trim().length > 0) {
      return order.items[0].pedido_id.trim();
    }
    // Para pedidos legados que estão sendo editados agora, gera um UUID canônico
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return `ped_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }, [order]);

  // Submit Handler
  const handleSaveClick = () => {
    setErrorMessage(null);

    if (!orderDate) {
      setErrorMessage('Informe uma data válida para o pedido.');
      return;
    }

    if (items.length === 0 && removedIds.length === 0) {
      setErrorMessage('O pedido precisa conter ao menos um produto.');
      return;
    }

    // Se houve transferência de cliente, pede confirmação explícita
    if (isClientTransferred) {
      setShowTransferConfirm(true);
      return;
    }

    executeSave();
  };

  const executeSave = async () => {
    setSaving(true);
    setErrorMessage(null);

    try {
      // 1. Identificar apenas itens existentes que realmente foram alterados
      const itensAtualizados: UpdateOrderItemPayload[] = [];
      
      items.forEach(item => {
        if (!item.id) return; // Novo item, tratado em itensNovos
        const original = order.items.find(orig => orig.id === item.id);
        
        // Verifica se houve mudança nos campos do item ou se houve mudança em nível de pedido (data/cliente)
        const itemChanged = !original || 
          original.produto_id !== item.produto_id ||
          original.produtos !== item.produtos ||
          Number(original.qtd) !== Number(item.qtd) ||
          Number(original["r$_total"]) !== Number(item.r_total) ||
          (original.vendas || 'VENDA') !== item.vendas ||
          (original.tabela || 'TABELA PADRAO') !== item.tabela ||
          Number(original.xdt || 0) !== Number(item.xdt || 0) ||
          Number(original["acresc."] || 0) !== Number(item.acresc_val || 0);

        if (itemChanged || isClientTransferred || orderDate !== order.date?.slice(0, 10) || !order.pedidoId) {
          itensAtualizados.push({
            id: item.id,
            produto_id: item.produto_id,
            produtos: item.produtos,
            qtd: Number(item.qtd),
            "r$_total": Number(item.r_total),
            vendas: item.vendas,
            tabela: item.tabela,
            xdt: Number(item.xdt || 0),
            "acresc.": Number(item.acresc_val || 0)
          });
        }
      });

      // 2. Identificar itens novos adicionados
      const itensNovos: NewOrderItemPayload[] = items
        .filter(item => !item.id)
        .map(item => ({
          produto_id: item.produto_id,
          produtos: item.produtos,
          qtd: Number(item.qtd),
          "r$_total": Number(item.r_total),
          vendas: item.vendas || 'VENDA',
          tabela: item.tabela || 'TABELA PADRAO',
          xdt: Number(item.xdt || 0),
          "acresc.": Number(item.acresc_val || 0),
          numero_pedido_erp: order.numeroPedidoErp
        }));

      // 3. Executar atualização atômica via DataManager
      const result = await updateOrderSales({
        pedidoId: canonicalPedidoId,
        clienteOriginalId: clienteOriginal.id,
        novoClienteId: selectedCliente.id,
        novoClienteNome: selectedCliente.cliente,
        novaData: orderDate,
        itensAtualizados,
        itensNovos,
        itensRemovidosIds: removedIds
      });

      if (!result.success) {
        throw new Error(result.error || 'Falha ao salvar as alterações do pedido.');
      }

      setShowTransferConfirm(false);
      if (onSaved) onSaved();
      onClose();
    } catch (err: any) {
      console.error('Erro ao salvar pedido:', err);
      setErrorMessage(err.message || 'Erro inesperado ao salvar pedido.');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs overflow-y-auto">
      <div 
        id="order-edit-modal-container"
        className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] border border-neutral-200 animate-in fade-in zoom-in-95 duration-200 my-auto"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-neutral-100 flex justify-between items-center bg-neutral-50/80">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <h3 className="text-lg sm:text-xl font-black text-neutral-900">Editar Pedido</h3>
              {order.numeroPedidoErp && (
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 bg-neutral-200 text-neutral-700 rounded-md">
                  ERP: {order.numeroPedidoErp}
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-500 font-medium">
              ID Canônico: <span className="font-mono text-neutral-700">{canonicalPedidoId.slice(0, 13)}...</span>
            </p>
          </div>
          <button 
            type="button"
            onClick={onClose}
            disabled={saving}
            className="p-2 hover:bg-neutral-200/80 rounded-full transition-colors text-neutral-400 hover:text-neutral-700"
          >
            <X size={20} />
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-red-700 text-xs">
            <AlertTriangle size={16} className="shrink-0 mt-0.5" />
            <p className="font-bold">{errorMessage}</p>
          </div>
        )}

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          
          {/* Order Header / Client & Date Config */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-neutral-50/70 rounded-xl border border-neutral-200/80">
            {/* Cliente */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider flex items-center gap-1.5">
                <User size={13} className="text-orange-600" />
                Cliente do Pedido
              </label>
              
              {!isChangingClient ? (
                <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-neutral-200 shadow-2xs">
                  <div className="truncate pr-2">
                    <p className="font-bold text-neutral-900 text-sm truncate">{selectedCliente.cliente}</p>
                    <p className="text-[11px] text-neutral-400">{selectedCliente.cidade || 'Sem cidade'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsChangingClient(true)}
                    className="text-xs font-bold text-orange-600 hover:text-orange-700 shrink-0 px-2 py-1 bg-orange-50 hover:bg-orange-100 rounded-md transition-colors flex items-center gap-1"
                  >
                    <ArrowRightLeft size={12} />
                    Alterar
                  </button>
                </div>
              ) : (
                <div className="space-y-2 bg-white p-2.5 rounded-lg border border-orange-200 shadow-sm">
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-2.5 text-neutral-400" />
                    <input
                      type="text"
                      placeholder="Buscar outro cliente..."
                      value={clientSearch}
                      onChange={e => setClientSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-neutral-50 border border-neutral-200 rounded-md focus:outline-none focus:ring-1 focus:ring-orange-500 font-medium"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-36 overflow-y-auto divide-y divide-neutral-100 border border-neutral-100 rounded-md">
                    {filteredClientes.map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedClienteId(c.id);
                          setIsChangingClient(false);
                        }}
                        className={cn(
                          "w-full text-left px-2.5 py-1.5 text-xs hover:bg-neutral-50 transition-colors flex justify-between items-center",
                          c.id === selectedClienteId && "bg-orange-50/70 font-bold text-orange-900"
                        )}
                      >
                        <span className="truncate pr-2">{c.cliente}</span>
                        <span className="text-[10px] text-neutral-400 shrink-0">{c.cidade}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsChangingClient(false)}
                    className="w-full text-center text-[10px] font-bold text-neutral-500 hover:text-neutral-700 py-1"
                  >
                    Cancelar alteração
                  </button>
                </div>
              )}

              {isClientTransferred && (
                <p className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200/80 px-2 py-1 rounded-md flex items-center gap-1">
                  <AlertTriangle size={12} className="shrink-0" />
                  Pedido será transferido de {clienteOriginal.cliente}
                </p>
              )}
            </div>

            {/* Data do Pedido */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-neutral-500 uppercase tracking-wider flex items-center gap-1.5">
                <Calendar size={13} className="text-orange-600" />
                Data de Faturamento
              </label>
              <input
                type="date"
                value={orderDate}
                onChange={e => setOrderDate(e.target.value)}
                className="w-full p-2.5 text-sm bg-white border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 font-bold text-neutral-800 shadow-2xs"
              />
            </div>
          </div>

          {/* Items Section */}
          <div className="space-y-2.5">
            <div className="flex justify-between items-center">
              <h4 className="text-xs font-black uppercase text-neutral-500 tracking-wider flex items-center gap-1.5">
                <Package size={14} className="text-orange-600" />
                Produtos do Pedido ({items.length})
              </h4>
              <button
                type="button"
                onClick={handleAddItem}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-lg transition-colors"
              >
                <Plus size={14} />
                Adicionar Produto
              </button>
            </div>

            {items.length === 0 ? (
              <div className="p-6 text-center bg-neutral-50 rounded-xl border border-dashed border-neutral-200">
                <p className="text-xs text-neutral-500 font-medium">Nenhum produto no pedido.</p>
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="mt-2 text-xs font-bold text-orange-600 hover:underline"
                >
                  Clique aqui para adicionar um produto
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {items.map((item, index) => {
                  const currentProd = produtosMap[item.produto_id];
                  const pesoLinha = (Number(item.qtd) || 0) * (currentProd?.peso_embalagem || 0);
                  const unitPrice = item.qtd > 0 ? (item.r_total / item.qtd) : 0;

                  return (
                    <div 
                      key={item.tempKey}
                      className="p-3 bg-white rounded-xl border border-neutral-200 shadow-2xs space-y-2.5 hover:border-neutral-300 transition-colors"
                    >
                      {/* Product Selector Row */}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded">
                          #{index + 1}
                        </span>
                        
                        <div className="flex-1">
                          <select
                            value={item.produto_id}
                            onChange={e => handleProductChange(item.tempKey, e.target.value)}
                            className="w-full text-xs font-bold text-neutral-900 bg-neutral-50 p-2 rounded-lg border border-neutral-200 focus:outline-none focus:ring-1 focus:ring-orange-500"
                          >
                            {produtos.map(p => (
                              <option key={p.id} value={p.id}>
                                {p.produto} ({p.peso_embalagem || 0}kg)
                              </option>
                            ))}
                          </select>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveItem(item.tempKey)}
                          title="Remover este item"
                          className="p-2 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      {/* Quantity & Total Value Inputs */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-neutral-100 text-xs">
                        {/* Qtd */}
                        <div>
                          <label className="text-[10px] font-bold text-neutral-400 uppercase">Quantidade</label>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={item.qtd}
                            onChange={e => handleQuantityChange(item.tempKey, parseFloat(e.target.value) || 0)}
                            className="w-full mt-0.5 p-1.5 bg-neutral-50 rounded-md border border-neutral-200 font-bold text-neutral-800 focus:outline-none focus:ring-1 focus:ring-orange-500"
                          />
                        </div>

                        {/* Valor Total R$ */}
                        <div>
                          <label className="text-[10px] font-bold text-neutral-400 uppercase">Valor Total (R$)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.r_total}
                            onChange={e => handleValueChange(item.tempKey, parseFloat(e.target.value) || 0)}
                            className="w-full mt-0.5 p-1.5 bg-neutral-50 rounded-md border border-neutral-200 font-bold text-neutral-800 focus:outline-none focus:ring-1 focus:ring-orange-500"
                          />
                        </div>

                        {/* Unit Price Calc */}
                        <div className="bg-neutral-50/60 p-1.5 rounded-md flex flex-col justify-center">
                          <span className="text-[9px] font-bold text-neutral-400 uppercase">Preço Unit.</span>
                          <span className="font-bold text-neutral-700 truncate">{formatCurrency(unitPrice)}</span>
                        </div>

                        {/* Weight Calc */}
                        <div className="bg-neutral-50/60 p-1.5 rounded-md flex flex-col justify-center">
                          <span className="text-[9px] font-bold text-neutral-400 uppercase">Peso Total</span>
                          <span className="font-bold text-neutral-700 truncate">{formatWeight(pesoLinha)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {/* Footer / Summary & Actions */}
        <div className="p-4 sm:p-5 bg-neutral-50 border-t border-neutral-200 flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-start">
            <div>
              <p className="text-[10px] font-bold text-neutral-400 uppercase">Total do Pedido</p>
              <p className="text-xl font-black text-orange-600">{formatCurrency(totalValue)}</p>
            </div>
            <div className="border-l border-neutral-200 pl-4">
              <p className="text-[10px] font-bold text-neutral-400 uppercase">Peso Total</p>
              <p className="text-sm font-black text-neutral-800">{formatWeight(totalWeight)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-xs font-bold text-neutral-600 hover:bg-neutral-200/60 rounded-xl transition-colors w-1/2 sm:w-auto"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSaveClick}
              disabled={saving}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-orange-600 hover:bg-orange-700 text-white text-xs font-black rounded-xl shadow-sm transition-colors disabled:opacity-50 w-1/2 sm:w-auto"
            >
              <Save size={15} />
              {saving ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </div>
      </div>

      {/* MODAL DE CONFIRMAÇÃO DE TRANSFERÊNCIA DE CLIENTE */}
      {showTransferConfirm && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-md rounded-2xl p-5 shadow-2xl border border-neutral-200 space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <div className="p-2.5 bg-amber-100 rounded-xl">
                <ArrowRightLeft size={22} />
              </div>
              <h4 className="text-base font-black text-neutral-900">Confirmar Transferência de Cliente</h4>
            </div>

            <p className="text-xs text-neutral-600 leading-relaxed font-medium">
              Este pedido será transferido de <strong className="text-neutral-900">{clienteOriginal.cliente}</strong> para <strong className="text-orange-600">{selectedCliente.cliente}</strong>. 
              O pedido deixará de fazer parte do histórico de <strong className="text-neutral-900">{clienteOriginal.cliente}</strong> e passará a fazer parte do histórico de <strong className="text-orange-600">{selectedCliente.cliente}</strong>.
            </p>

            <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-100 text-[11px] text-neutral-500 font-medium">
              Todos os indicadores de ambos os clientes (recompra, médias e faturamentos) serão recalculados automaticamente.
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowTransferConfirm(false)}
                disabled={saving}
                className="px-4 py-2 text-xs font-bold text-neutral-600 hover:bg-neutral-100 rounded-xl transition-colors"
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={executeSave}
                disabled={saving}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-xs font-black rounded-xl transition-colors flex items-center gap-1.5 shadow-sm"
              >
                <Check size={15} />
                {saving ? 'Transferindo...' : 'Confirmar e Transferir'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE CONFIRMAÇÃO DE EXCLUSÃO DO ÚLTIMO ITEM */}
      {showDeleteLastItemConfirm && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-md rounded-2xl p-5 shadow-2xl border border-neutral-200 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <div className="p-2.5 bg-red-100 rounded-xl">
                <Trash2 size={22} />
              </div>
              <h4 className="text-base font-black text-neutral-900">Excluir Último Item do Pedido?</h4>
            </div>

            <p className="text-xs text-neutral-600 leading-relaxed font-medium">
              Este é o único item restante do pedido. Se você excluí-lo, o pedido inteiro será removido do histórico do cliente ao salvar.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteLastItemConfirm(null)}
                className="px-4 py-2 text-xs font-bold text-neutral-600 hover:bg-neutral-100 rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => confirmDeleteLastItem(showDeleteLastItemConfirm)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-black rounded-xl transition-colors"
              >
                Sim, Remover Item
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
