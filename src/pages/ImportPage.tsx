import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Cliente, Produto, HistVenda } from '../types';
import { Loader2, FileUp, Save, AlertCircle, CheckCircle2, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { format } from 'date-fns';

interface RawRow {
  id: string;
  tabela: string;
  produto: string;
  qtd: number;
  valor_total: number;
  tipo: string;
  desconto: number;
  acrescimo: number;
  peso_total: number;
  isValid: boolean;
  error?: string;
}

export function ImportPage() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmSave, setShowConfirmSave] = useState(false);

  // Form states
  const [selectedClienteId, setSelectedClienteId] = useState('');
  const [orderDate, setOrderDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [rawData, setRawData] = useState('');

  // Processed data
  const [processedRows, setProcessedRows] = useState<RawRow[]>([]);

  useEffect(() => {
    async function fetchData() {
      try {
        const [clientesRes, produtosRes] = await Promise.all([
          supabase.from('clientes').select('*').order('cliente'),
          supabase.from('produtos').select('*').order('produto')
        ]);

        if (clientesRes.error) throw clientesRes.error;
        if (produtosRes.error) throw produtosRes.error;

        setClientes(clientesRes.data || []);
        setProdutos(produtosRes.data || []);
      } catch (err) {
        console.error('Erro ao carregar dados:', err);
        setError('Falha ao carregar clientes e produtos.');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const handleProcess = () => {
    if (!selectedClienteId) {
      setError('Selecione um cliente antes de processar.');
      return;
    }
    if (!orderDate) {
      setError('Selecione uma data antes de processar.');
      return;
    }

    setProcessing(true);
    setError(null);
    setSuccess(false);

    try {
      const lines = rawData.split('\n').filter(line => line.trim() !== '');
      const newRows: RawRow[] = lines.map((line, index) => {
        const cols = line.split('\t');
        
        if (cols.length < 7) {
          return {
            id: `row-${index}`,
            tabela: '',
            produto: line,
            qtd: 0,
            valor_total: 0,
            tipo: '',
            desconto: 0,
            acrescimo: 0,
            isValid: false,
            error: 'Número insuficiente de colunas (mínimo 7)'
          };
        }

        // Col 1: Tabela (Ignore)
        // Col 2: Produto
        // Col 3: Qtd
        // Col 4: Valor Total
        // Col 5: Vendas (Tipo)
        // Col 6: XDT (Desconto)
        // Col 7: Acresc (Acrescimo)

        const parseValorTotal = (val: string) => {
          if (!val) return 0;
          return parseFloat(val.trim().replace(',', '.')) || 0;
        };

        const parseAcrescido = (val: string) => {
          if (!val) return 0;
          const v = val.trim().replace(',', '.') + '.00';
          return parseFloat(v) || 0;
        };

        const qtd = parseAcrescido(cols[2]);
        const matchedProduto = produtos.find(p => p.produto.toLowerCase() === cols[1].trim().toLowerCase());
        const pesoTotal = matchedProduto 
          ? qtd * (matchedProduto.peso_embalagem || 0)
          : 0;

        return {
          id: `row-${index}`,
          tabela: cols[0].trim(),
          produto: cols[1].trim(),
          qtd,
          valor_total: parseValorTotal(cols[3]),
          tipo: cols[4].trim(),
          desconto: parseAcrescido(cols[5]),
          acrescimo: parseAcrescido(cols[6]),
          peso_total: pesoTotal,
          isValid: true
        };
      });

      setProcessedRows(newRows);
    } catch (err) {
      console.error('Erro ao processar dados:', err);
      setError('Erro ao processar o texto colado. Verifique o formato.');
    } finally {
      setProcessing(false);
    }
  };

  const handleSave = async () => {
    if (processedRows.length === 0) return;
    const validRows = processedRows.filter(r => r.isValid);
    if (validRows.length === 0) {
      setError('Não há linhas válidas para salvar.');
      return;
    }

    setShowConfirmSave(true);
  };

  const confirmSave = async () => {
    setShowConfirmSave(false);
    setSaving(true);
    setError(null);

    try {
      const selectedCliente = clientes.find(c => c.id === selectedClienteId);
      
      const dataToInsert = validRowsToSave.map(row => {
        // Try to find product ID by name
        const matchedProduto = produtos.find(p => p.produto.toLowerCase() === row.produto.toLowerCase());
        
        const record: any = {
          cliente_id: selectedClienteId,
          cliente: selectedCliente?.cliente || '',
          faturamento: orderDate,
          produtos: row.produto,
          qtd: row.qtd,
          "r$_total": row.valor_total,
          vendas: row.tipo,
          xdt: row.desconto,
          "acresc.": row.acrescimo,
          tabela: row.tabela
        };

        // Only add produto_id if we found a match to avoid foreign key issues if null is not allowed
        if (matchedProduto?.id) {
          record.produto_id = matchedProduto.id;
        }
        
        return record;
      });

      const { error: insertError } = await supabase
        .from('hist_vendas')
        .insert(dataToInsert);

      if (insertError) {
        throw insertError;
      }

      setSuccess(true);
      setProcessedRows([]);
      setRawData('');
    } catch (err: any) {
      console.error('Erro ao salvar no banco:', err);
      setError(`Erro ao salvar os dados: ${err.message || 'Erro desconhecido'}`);
    } finally {
      setSaving(false);
    }
  };

  const validRowsToSave = useMemo(() => processedRows.filter(r => r.isValid), [processedRows]);

  const totalPesoPreview = useMemo(() => {
    return processedRows.reduce((acc, row) => acc + (row.peso_total || 0), 0);
  }, [processedRows]);

  const updateRow = (id: string, field: keyof RawRow, value: any) => {
    setProcessedRows(prev => prev.map(row => {
      if (row.id === id) {
        const updatedRow = { ...row, [field]: value };
        
        // Recalculate weight if product or qty changes
        if (field === 'produto' || field === 'qtd') {
          const matchedProduto = produtos.find(p => p.produto.toLowerCase() === updatedRow.produto.toLowerCase());
          updatedRow.peso_total = matchedProduto 
            ? updatedRow.qtd * (matchedProduto.peso_embalagem || 0)
            : 0;
        }
        
        return updatedRow;
      }
      return row;
    }));
  };

  const removeRow = (id: string) => {
    setProcessedRows(prev => prev.filter(row => row.id !== id));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-orange-600" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-black text-neutral-900 flex items-center gap-2">
          <FileUp className="text-orange-600" />
          Importação de Pedidos
        </h1>
        <p className="text-neutral-500 text-sm">
          Cole os dados da planilha para importar registros para o histórico de vendas.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Input Section */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white p-4 rounded-2xl border border-neutral-200 shadow-sm space-y-4">
            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Cliente</label>
              <select
                value={selectedClienteId}
                onChange={(e) => setSelectedClienteId(e.target.value)}
                className="w-full p-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all text-sm"
              >
                <option value="">Selecione o Cliente</option>
                {clientes.map(c => (
                  <option key={c.id} value={c.id}>{c.cliente}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Data do Pedido</label>
              <input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="w-full p-2.5 bg-neutral-50 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-500 uppercase mb-1">Dados Brutos (Cole aqui)</label>
              <textarea
                value={rawData}
                onChange={(e) => setRawData(e.target.value)}
                placeholder="Cole as linhas da planilha aqui..."
                className="w-full h-64 p-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all text-sm font-mono resize-none"
              />
            </div>

            <button
              onClick={handleProcess}
              disabled={processing || !rawData.trim()}
              className="w-full py-3 bg-neutral-900 text-white rounded-xl font-bold hover:bg-neutral-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {processing ? <Loader2 className="animate-spin" size={20} /> : <FileUp size={20} />}
              Processar Dados
            </button>
          </div>
        </div>

        {/* Preview Section */}
        <div className="lg:col-span-2 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-xl flex items-start gap-3">
              <AlertCircle className="shrink-0 mt-0.5" size={18} />
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-100 text-green-600 p-4 rounded-xl flex items-start gap-3">
              <CheckCircle2 className="shrink-0 mt-0.5" size={18} />
              <p className="text-sm font-medium">Dados importados com sucesso!</p>
            </div>
          )}

          {processedRows.length > 0 && (
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden flex flex-col h-full max-h-[800px]">
              <div className="p-4 border-b border-neutral-100 bg-neutral-50 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <h2 className="font-bold text-neutral-900">Preview ({processedRows.length} linhas)</h2>
                </div>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                  Salvar no Banco
                </button>
              </div>

              <div className="overflow-auto flex-1">
                <table className="w-full text-left border-collapse">
                  <thead className="sticky top-0 bg-white z-10">
                    <tr className="bg-neutral-50 text-[10px] uppercase font-bold text-neutral-500 border-b border-neutral-200">
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Produto</th>
                      <th className="px-4 py-3 text-right">Qtd</th>
                      <th className="px-4 py-3 text-right">Peso Total</th>
                      <th className="px-4 py-3 text-right">Valor Total</th>
                      <th className="px-4 py-3">Tipo</th>
                      <th className="px-4 py-3 text-right">Desc</th>
                      <th className="px-4 py-3 text-right">Acresc</th>
                      <th className="px-4 py-3">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {processedRows.map((row) => (
                      <tr key={row.id} className={cn("text-xs hover:bg-neutral-50 transition-colors", !row.isValid && "bg-red-50")}>
                        <td className="px-4 py-2">
                          {row.isValid ? (
                            <CheckCircle2 className="text-green-500" size={16} />
                          ) : (
                            <div className="flex items-center gap-1 text-red-500" title={row.error}>
                              <AlertCircle size={16} />
                              <span className="text-[10px] truncate max-w-[80px]">{row.error}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={row.produto}
                            onChange={(e) => updateRow(row.id, 'produto', e.target.value)}
                            className="w-full bg-transparent outline-none focus:bg-white p-1 rounded border border-transparent focus:border-neutral-200"
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <input
                            type="number"
                            value={row.qtd}
                            onChange={(e) => updateRow(row.id, 'qtd', parseFloat(e.target.value))}
                            className="w-16 bg-transparent outline-none focus:bg-white p-1 rounded border border-transparent focus:border-neutral-200 text-right"
                          />
                        </td>
                        <td className="px-4 py-2 text-right font-bold text-orange-600">
                          {row.peso_total.toFixed(2)}kg
                        </td>
                        <td className="px-4 py-2 text-right">
                          <input
                            type="number"
                            value={row.valor_total}
                            onChange={(e) => updateRow(row.id, 'valor_total', parseFloat(e.target.value))}
                            className="w-24 bg-transparent outline-none focus:bg-white p-1 rounded border border-transparent focus:border-neutral-200 text-right"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="text"
                            value={row.tipo}
                            onChange={(e) => updateRow(row.id, 'tipo', e.target.value)}
                            className="w-24 bg-transparent outline-none focus:bg-white p-1 rounded border border-transparent focus:border-neutral-200"
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <input
                            type="number"
                            value={row.desconto}
                            onChange={(e) => updateRow(row.id, 'desconto', parseFloat(e.target.value))}
                            className="w-16 bg-transparent outline-none focus:bg-white p-1 rounded border border-transparent focus:border-neutral-200 text-right"
                          />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <input
                            type="number"
                            value={row.acrescimo}
                            onChange={(e) => updateRow(row.id, 'acrescimo', parseFloat(e.target.value))}
                            className="w-16 bg-transparent outline-none focus:bg-white p-1 rounded border border-transparent focus:border-neutral-200 text-right"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <button
                            onClick={() => removeRow(row.id)}
                            className="p-1 text-neutral-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="sticky bottom-0 bg-neutral-900 text-white z-10">
                    <tr className="text-xs font-bold">
                      <td colSpan={2} className="px-4 py-3 text-right uppercase tracking-wider opacity-70">Total Geral</td>
                      <td className="px-4 py-3 text-right">
                        {processedRows.reduce((acc, r) => acc + r.qtd, 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right text-orange-400">
                        {totalPesoPreview.toFixed(2)}kg
                      </td>
                      <td className="px-4 py-3 text-right">
                        R$ {processedRows.reduce((acc, r) => acc + r.valor_total, 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </td>
                      <td colSpan={4}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {processedRows.length === 0 && !error && !success && (
            <div className="h-full flex flex-col items-center justify-center text-neutral-400 bg-neutral-50 rounded-2xl border-2 border-dashed border-neutral-200 p-12">
              <FileUp size={48} className="mb-4 opacity-20" />
              <p className="font-medium">Nenhum dado processado</p>
              <p className="text-xs">Cole os dados e clique em "Processar Dados" para ver o preview.</p>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmSave && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-orange-600">
              <AlertCircle size={24} />
              <h3 className="font-bold text-lg">Confirmar Importação</h3>
            </div>
            <p className="text-neutral-600 text-sm">
              Deseja salvar <strong>{validRowsToSave.length}</strong> registros no histórico de vendas?
            </p>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowConfirmSave(false)}
                className="flex-1 py-2.5 bg-neutral-100 text-neutral-700 rounded-xl font-bold hover:bg-neutral-200 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={confirmSave}
                className="flex-1 py-2.5 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-200"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
