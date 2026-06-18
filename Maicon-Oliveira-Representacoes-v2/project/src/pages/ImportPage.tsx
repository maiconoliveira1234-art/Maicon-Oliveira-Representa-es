import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { Cliente, Produto, HistVenda } from '../types';
import { Loader2, FileUp, Save, AlertCircle, CheckCircle2, Trash2, Plus, X, Package, Search, ChevronDown, ShieldAlert, Sparkles, TrendingDown, TrendingUp, Coins, EyeOff, Layers } from 'lucide-react';
import { cn, deduplicateSales, formatCurrency, formatWeight } from '../lib/utils';
import { format, differenceInDays, parseISO } from 'date-fns';
import { auditRowCost, CostAuditResult } from '../lib/costAuditer';
import { useDataManager } from '../lib/dataManager';
import { getFaixaPreco, getValorUnitario } from '../lib/calculations';

interface RawRow {
  id: string;
  tabela: string;
  produto: string;
  qtd: number;
  valor_total: number;
  tipo: string;
  desconto: number;
  acrescimo: number;
  peso_total?: number;
  isValid: boolean;
  isMissingProduct?: boolean;
  error?: string;
}

interface NewProductData {
  produto: string;
  familia: string;
  custo_total: number;
  custo_und: number;
  sugestao: number;
  peso_embalagem: number;
  quant_embalagem: number;
  comissao: number;
  livre: number;
  "200kg": number;
  "500kg": number;
  "1000kg": number;
  "2000kg": number;
  "4000kg": number;
}

export function ImportPage() {
  const { loadClientDetails, clientCache } = useDataManager();

  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmSave, setShowConfirmSave] = useState(false);
  const [statusImportacao, setStatusImportacao] = useState<'IDLE' | 'PROCESSANDO'>('IDLE');
  const [showNewProductModal, setShowNewProductModal] = useState(false);
  const [newProductData, setNewProductData] = useState<NewProductData>({
    produto: '',
    familia: '',
    custo_total: 0,
    custo_und: 0,
    sugestao: 0,
    peso_embalagem: 0,
    quant_embalagem: 1,
    comissao: 0,
    livre: 0,
    "200kg": 0,
    "500kg": 0,
    "1000kg": 0,
    "2000kg": 0,
    "4000kg": 0
  });
  const [savingNewProduct, setSavingNewProduct] = useState(false);

  // Form states
  const [selectedClienteId, setSelectedClienteId] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [orderDate, setOrderDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [rawData, setRawData] = useState('');
  const [numeroPedidoErp, setNumeroPedidoErp] = useState<string>(() => {
    return sessionStorage.getItem('last_pedido_erp') || '';
  });

  // Processed data
  const [processedRows, setProcessedRows] = useState<RawRow[]>([]);

  // Intelligent Cost Auditing states
  const [activeTab, setActiveTab] = useState<'pedido' | 'auditoria'>('pedido');
  const [toleranceVal, setToleranceVal] = useState<number>(1.0); // Default ±1% tolerance
  const [ignoredProductIds, setIgnoredProductIds] = useState<Set<string>>(new Set());
  const [updatingProducts, setUpdatingProducts] = useState<Set<string>>(new Set());
  const [isBatchUpdating, setIsBatchUpdating] = useState(false);
  const [auditSuccessMessage, setAuditSuccessMessage] = useState<string | null>(null);

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

  useEffect(() => {
    if (selectedClienteId) {
      loadClientDetails(selectedClienteId);
    }
  }, [selectedClienteId, loadClientDetails]);

  const families = useMemo(() => {
    const fams = new Set(produtos.map(p => p.familia).filter(Boolean));
    return Array.from(fams).sort();
  }, [produtos]);

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
        const productName = cols[1].trim();
        const matchedProduto = produtos.find(p => p.produto.toLowerCase() === productName.toLowerCase());
        const pesoTotal = matchedProduto 
          ? qtd * (matchedProduto.peso_embalagem || 0)
          : 0;

        return {
          id: `row-${index}`,
          tabela: cols[0].trim(),
          produto: productName,
          qtd,
          valor_total: parseValorTotal(cols[3]),
          tipo: cols[4].trim(),
          desconto: parseAcrescido(cols[5]),
          acrescimo: parseAcrescido(cols[6]),
          peso_total: pesoTotal,
          isValid: !!matchedProduto,
          isMissingProduct: !matchedProduto,
          error: !matchedProduto ? 'Produto não cadastrado' : undefined
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
    if (saving || statusImportacao === 'PROCESSANDO') return;

    if (!selectedClienteId) {
      setError('Selecione um cliente antes de importar o pedido');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (processedRows.length === 0) return;

    if (!numeroPedidoErp.trim()) {
      setError('O "Número do Pedido ERP" é obrigatório para realizar a importação protegida contra duplicidades.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const missingProducts = processedRows.filter(r => r.isMissingProduct);
    if (missingProducts.length > 0) {
      setError(`Existem ${missingProducts.length} produtos não cadastrados. Cadastre-os antes de continuar.`);
      return;
    }

    const validRows = processedRows.filter(r => r.isValid);
    if (validRows.length === 0) {
      setError('Não há linhas válidas para salvar.');
      return;
    }

    // Early database check for duplicate import
    setSaving(true);
    setStatusImportacao('PROCESSANDO');
    setError(null);
    try {
      const { data: existingSales, error: checkError } = await supabase
        .from('hist_vendas')
        .select('id')
        .eq('numero_pedido_erp', numeroPedidoErp.trim())
        .limit(1);

      if (checkError) {
        throw new Error(`Erro ao verificar duplicidade de pedido no banco: ${checkError.message}`);
      }

      if (existingSales && existingSales.length > 0) {
        setError('Este faturamento já foi importado anteriormente. (Proteção Idempotente ativa)');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      setShowConfirmSave(true);
    } catch (err: any) {
      setError(err.message || 'Erro inesperado na verificação do faturamento.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
      setStatusImportacao('IDLE');
    }
  };

  const confirmSave = async () => {
    if (saving || statusImportacao === 'PROCESSANDO') return;

    setSaving(true);
    setStatusImportacao('PROCESSANDO');
    setError(null);
    let salesInserted = false;

    try {
      if (!numeroPedidoErp.trim()) {
        throw new Error('Número do pedido ERP ausente.');
      }

      const selectedCliente = clientes.find(c => c.id === selectedClienteId);
      
      const dataToInsert = deduplicateSales(validRowsToSave.map(row => {
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
          tabela: row.tabela,
          numero_pedido_erp: numeroPedidoErp.trim(),
          importado_em: new Date().toISOString()
        };

        if (matchedProduto?.id) {
          record.produto_id = matchedProduto.id;
        }
        
        return record;
      })) as any[];

      // Ensure that client details are loaded for historical weight calculation
      let cache = clientCache[selectedClienteId];
      if (!cache) {
        cache = await loadClientDetails(selectedClienteId);
      }

      // Calculate pesoConquistado in the 28 days preceding the order date
      let pesoConquistado = 0;
      if (cache && cache.historico && cache.historico.length > 0) {
        const refDate = orderDate ? parseISO(orderDate) : new Date();
        cache.historico.forEach(h => {
          try {
            const saleDate = parseISO(h.faturamento);
            const daysSince = differenceInDays(refDate, saleDate);
            if (daysSince >= 0 && daysSince <= 28) {
              const prod = produtos.find(p => p.id === h.produto_id || p.produto.toLowerCase() === h.produtos?.toLowerCase());
              if (prod) {
                pesoConquistado += (h.qtd * prod.peso_embalagem);
              }
            }
          } catch (e) {
            console.error('Erro ao calcular peso conquistado do histórico de compras:', e);
          }
        });
      }

      // Calculate total weight of this newly imported order (using all valid items)
      const pesoTotalOrder = dataToInsert.reduce((acc, row) => {
        const prod = produtos.find(p => p.produto.toLowerCase() === row.produtos.toLowerCase());
        if (prod) {
          return acc + (row.qtd * prod.peso_embalagem);
        }
        return acc;
      }, 0);

      // Effective weight determines standard discount tier
      const pesoEfetivo = Math.max(pesoTotalOrder, pesoConquistado);
      const currentFaixa = getFaixaPreco(pesoEfetivo);

      // Calculate Verba Flex Comercial metrics
      let totalVendaValor = 0;
      let totalBonificacaoValor = 0;
      let totalMerchandisingValor = 0;
      const totalDescontoVenda = 0; // Removed discount consumption rule from orders

      dataToInsert.forEach(record => {
        const vUpper = (record.vendas || '').toUpperCase().trim();
        const tUpper = (record.tabela || '').toUpperCase().trim();
        
        const isVenda = vUpper === 'VENDAS';
        const isPromo = vUpper.includes('BONIFICACAO') || vUpper.includes('DOACAO') || vUpper.includes('BRINDE');
        const isMerchandising = isPromo && (tUpper.includes('BRINDES') || vUpper.includes('BRINDE'));
        const isBonificacao = isPromo && !isMerchandising;

        if (isVenda) {
          totalVendaValor += Number(record["r$_total"] || 0);
        } else if (isBonificacao) {
          let value = Number(record["r$_total"] || 0);
          if (value <= 0) {
            const prod = produtos.find(p => p.produto.toLowerCase() === record.produtos.toLowerCase());
            if (prod) {
              value = Number(record.qtd || 0) * (prod.custo_und || 0);
            }
          }
          totalBonificacaoValor += value;
        } else if (isMerchandising) {
          let value = Number(record["r$_total"] || 0);
          if (value <= 0) {
            const prod = produtos.find(p => p.produto.toLowerCase() === record.produtos.toLowerCase());
            if (prod) {
              value = Number(record.qtd || 0) * (prod.custo_und || 0);
            }
          }
          totalMerchandisingValor += value;
        }
      });

      const flexGerado = totalVendaValor * 0.02;
      const totalConsumido = totalBonificacaoValor + totalMerchandisingValor;
      const incrementoSaldo = Number((flexGerado - totalConsumido).toFixed(2));

      // Build Extrato logs
      const extratoEntries = [];

      if (flexGerado > 0) {
        extratoEntries.push({
          cliente_id: selectedClienteId,
          tipo: 'GERADO',
          valor: Number(flexGerado.toFixed(2)),
          descricao: `Pedido faturado (${format(new Date(orderDate), 'dd/MM/yyyy')}) - Vendas: ${formatCurrency(totalVendaValor)}`
        });
      }

      if (totalBonificacaoValor > 0) {
        extratoEntries.push({
          cliente_id: selectedClienteId,
          tipo: 'BONIFICACAO',
          valor: Number((-totalBonificacaoValor).toFixed(2)),
          descricao: `Utilização para Bonificação no faturamento (${format(new Date(orderDate), 'dd/MM/yyyy')})`
        });
      }

      if (totalMerchandisingValor > 0) {
        extratoEntries.push({
          cliente_id: selectedClienteId,
          tipo: 'BONIFICACAO',
          valor: Number((-totalMerchandisingValor).toFixed(2)),
          descricao: `Utilização para Merchandising/Brindes (${format(new Date(orderDate), 'dd/MM/yyyy')})`
        });
      }

      // --- TENTATIVA 1: EXECUÇÃO TRANSACIONAL ATÔMICA REAL DO POSTGRES (Supabase RPC) ---
      let rpcSuccess = false;
      try {
        const mappedItensForRpc = dataToInsert.map(r => ({
          cliente_id: r.cliente_id,
          cliente: r.cliente,
          faturamento: r.faturamento,
          produtos: r.produtos,
          qtd: Number(r.qtd || 0),
          r_total: Number(r["r$_total"] || 0),
          vendas: r.vendas,
          xdt: Number(r.xdt || 0),
          acresc_val: Number(r["acresc."] || 0),
          tabela: r.tabela,
          produto_id: r.produto_id || null,
          numero_pedido_erp: r.numero_pedido_erp
        }));

        const mappedExtratosForRpc = extratoEntries.map(e => ({
          cliente_id: e.cliente_id,
          tipo: e.tipo,
          valor: Number(e.valor),
          descricao: e.descricao
        }));

        const { error: rpcError } = await supabase.rpc('importar_faturamento_transacional', {
          p_cliente_id: selectedClienteId,
          p_numero_pedido_erp: numeroPedidoErp.trim(),
          p_order_date: orderDate,
          p_itens: mappedItensForRpc,
          p_incremento_saldo: incrementoSaldo,
          p_extratos: mappedExtratosForRpc
        });

        if (rpcError) {
          // Se for erro de duplicidade lançado explicitamente
          if (rpcError.message.includes('já foi importado') || rpcError.details?.includes('importado')) {
            throw new Error('Este faturamento já foi importado anteriormente. (Proteção Transacional Ativa)');
          }
          // Se for erro de rpc inexistente, logamos e ativamos o Fallback consistente por aplicação
          if (rpcError.code === 'P0001' || rpcError.message.includes('function') || rpcError.message.includes('does not exist') || rpcError.message.includes('not found')) {
            console.warn('RPC importar_faturamento_transacional não detectada no Supabase. Utilizando fallback cliente-side transacional com rollback.');
          } else {
            throw rpcError;
          }
        } else {
          rpcSuccess = true;
          console.log('Faturamento importado com absoluto sucesso via Transação Real PostgreSQL (RPC atômica)!');
        }
      } catch (rpcErr: any) {
        if (rpcErr.message.includes('já foi importado')) {
          throw rpcErr;
        }
        console.error('Falha genérica no RPC, prosseguindo para o Fallback:', rpcErr);
      }

      // --- TENTATIVA 2: FALLBACK COM TRANSAÇÃO POR APLICAÇÃO (E ROLLBACK SEGURO) ---
      if (!rpcSuccess) {
        // Definitive database check for idempotency immediately before insert
        const { data: existingSales, error: checkError } = await supabase
          .from('hist_vendas')
          .select('id')
          .eq('numero_pedido_erp', numeroPedidoErp.trim())
          .limit(1);

        if (checkError) {
          throw new Error(`Erro ao verificar duplicidade de pedido no fallback: ${checkError.message}`);
        }

        if (existingSales && existingSales.length > 0) {
          throw new Error('Este faturamento já foi importado anteriormente.');
        }

        // 1. Insert into historical sales log
        const { error: insertError } = await supabase
          .from('hist_vendas')
          .insert(dataToInsert);

        if (insertError) {
          throw insertError;
        }

        // Flag used in catch to clean up (rollback) in case any follow-up query crashes
        salesInserted = true;

        // 2. Fetch client current flex balance to apply the formula safely
        const { data: clientDb, error: clientFetchError } = await supabase
          .from('clientes')
          .select('*')
          .eq('id', selectedClienteId)
          .single();

        if (clientFetchError) {
          throw new Error(`Erro ao obter saldo atual do cliente durante fallback: ${clientFetchError.message}`);
        }

        let saldoAnterior = 0;
        if (clientDb) {
          saldoAnterior = clientDb.flex_saldo || 0;
        }

        const novoSaldo = Number((saldoAnterior + incrementoSaldo).toFixed(2));

        // 3. Update client balance in DB
        const { error: updateClientError } = await supabase
          .from('clientes')
          .update({ flex_saldo: novoSaldo })
          .eq('id', selectedClienteId);

        if (updateClientError) {
          throw new Error(`Erro ao atualizar saldo do cliente: ${updateClientError.message}`);
        }

        // 4. Write Extrato logs for auditability
        if (extratoEntries.length > 0) {
          const { error: insertExtratoError } = await supabase
            .from('verba_flex_extrato')
            .insert(extratoEntries);
          if (insertExtratoError) {
            const errMsg = insertExtratoError.message || '';
            const isMissingTable = errMsg.includes('verba_flex_extrato') || 
                                   errMsg.includes('relation') || 
                                   errMsg.includes('schema cache') || 
                                   insertExtratoError.code === '42P01';
            if (isMissingTable) {
              console.warn('Tabela verba_flex_extrato não foi encontrada no banco. Pulando gravação de logs de verba flex.', insertExtratoError);
            } else {
              throw new Error(`Erro ao criar logs do extrato da Conta Flex: ${insertExtratoError.message}`);
            }
          }
        }
      }

      setShowConfirmSave(false);
      setSuccess(true);
      setProcessedRows([]);
      setRawData('');
      setSelectedClienteId(''); // Reset client selection after success
    } catch (err: any) {
      console.error('Erro ao salvar no banco (Executando Rollback se necessário):', err);
      if (salesInserted) {
        try {
          // Manual atomic application-level rollback to avoid ghost sales without financial flow execution
          await supabase
            .from('hist_vendas')
            .delete()
            .eq('numero_pedido_erp', numeroPedidoErp.trim());
          console.log('Rollback do pedido bem-sucedido. Nenhuma linha parcial persistida.');
        } catch (rollbackErr) {
          console.error('Falha crítica ao tentar reverter gravação parcial:', rollbackErr);
        }
      }
      setError(`Erro ao salvar os faturamentos: ${err.message || 'Erro desconhecido'}`);
      setShowConfirmSave(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setSaving(false);
      setStatusImportacao('IDLE');
    }
  };

  const filteredClientes = useMemo(() => {
    return clientes.filter(c => c.ativo || showInactive);
  }, [clientes, showInactive]);

  const clientSearchResults = useMemo(() => {
    const search = clientSearch.toLowerCase().trim();
    if (!search && !isDropdownOpen) return [];
    if (!search) return filteredClientes;
    
    return filteredClientes.filter(c => 
      c.cliente.toLowerCase().includes(search) || 
      c.id.toLowerCase().includes(search)
    );
  }, [filteredClientes, clientSearch, isDropdownOpen]);

  const selectedCliente = useMemo(() => 
    clientes.find(c => c.id === selectedClienteId),
  [clientes, selectedClienteId]);

  // Sync search input with selected client initially or after reset
  useEffect(() => {
    if (selectedCliente) {
      setClientSearch(selectedCliente.cliente);
    } else {
      setClientSearch('');
    }
  }, [selectedCliente]);

  const validRowsToSave = useMemo(() => processedRows.filter(r => r.isValid), [processedRows]);

  const totalPesoPreview = useMemo(() => {
    return processedRows.reduce((acc, row) => acc + (row.peso_total || 0), 0);
  }, [processedRows]);

  // Computed audited list of items with price/cost discrepancies
  const auditedItems = useMemo(() => {
    const list: CostAuditResult[] = [];
    processedRows.forEach(row => {
      if (!row.isValid) return;
      const prod = produtos.find(p => p.produto.toLowerCase() === row.produto.toLowerCase());
      if (prod) {
        const audit = auditRowCost(
          {
            produto: row.produto,
            qtd: row.qtd,
            valor_total: row.valor_total,
            desconto: row.desconto,
            tipo: row.tipo,
            tabela: row.tabela,
          },
          prod,
          toleranceVal
        );
        if (audit && (audit.status === 'DIVERGENTE' || audit.status === 'ALERTA_BONIF')) {
          list.push(audit);
        }
      }
    });

    // De-duplicate by product ID to prevent multiple actions on the same product if it has duplicate rows
    const uniqueItemsMap: Record<string, CostAuditResult> = {};
    list.forEach(item => {
      uniqueItemsMap[item.produtoId] = item;
    });
    return Object.values(uniqueItemsMap);
  }, [processedRows, produtos, toleranceVal]);

  // Non-ignored audited items (active alerts)
  const activeAuditAlerts = useMemo(() => {
    return auditedItems.filter(item => !ignoredProductIds.has(item.produtoId));
  }, [auditedItems, ignoredProductIds]);

  const handleUpdateCost = async (item: CostAuditResult) => {
    setUpdatingProducts(prev => {
      const s = new Set(prev);
      s.add(item.produtoId);
      return s;
    });
    setAuditSuccessMessage(null);
    try {
      const { error: updateErr } = await supabase
        .from('produtos')
        .update({
          custo_total: item.custoCaculadoTotal,
          custo_und: item.custoCalculadoUnd
        })
        .eq('id', item.produtoId);

      if (updateErr) throw updateErr;

      // Update local products list
      setProdutos(prev => prev.map(p => 
        p.id === item.produtoId 
          ? { ...p, custo_total: item.custoCaculadoTotal, ...({ custo_und: item.custoCalculadoUnd }) }
          : p
      ));

      setAuditSuccessMessage(`Cadastro do produto "${item.produtoNome}" atualizado com sucesso para Custo de R$ ${item.custoCaculadoTotal.toFixed(2)}.`);
      
      // Auto-ignore resolved product
      setIgnoredProductIds(prev => {
        const s = new Set(prev);
        s.add(item.produtoId);
        return s;
      });
    } catch (err: any) {
      console.error('Erro ao atualizar custo do produto:', err);
      alert(`Erro ao atualizar custo: ${err.message}`);
    } finally {
      setUpdatingProducts(prev => {
        const s = new Set(prev);
        s.delete(item.produtoId);
        return s;
      });
    }
  };

  const handleBatchUpdateCosts = async (items: CostAuditResult[]) => {
    setIsBatchUpdating(true);
    setAuditSuccessMessage(null);
    try {
      const promises = items.map(async (item) => {
        const { error } = await supabase
          .from('produtos')
          .update({
            custo_total: item.custoCaculadoTotal,
            custo_und: item.custoCalculadoUnd
          })
          .eq('id', item.produtoId);
        if (error) throw error;
        return item;
      });

      await Promise.all(promises);

      // Update all local products
      setProdutos(prev => {
        const lookup = new Map(items.map(i => [i.produtoId, i]));
        return prev.map(p => {
          const item = lookup.get(p.id);
          if (item) {
            return {
              ...p,
              custo_total: item.custoCaculadoTotal,
              custo_und: item.custoCalculadoUnd
            };
          }
          return p;
        });
      });

      setAuditSuccessMessage(`Lote de ${items.length} produtos atualizados com sucesso no cadastro!`);
      
      // Add all to ignored/done list
      setIgnoredProductIds(prev => {
        const s = new Set(prev);
        items.forEach(i => s.add(i.produtoId));
        return s;
      });
    } catch (err: any) {
      console.error('Erro ao atualizar lote de produtos:', err);
      alert(`Erro ao atualizar produtos em lote: ${err.message}`);
    } finally {
      setIsBatchUpdating(false);
    }
  };

  const handleIgnoreProduct = (productId: string) => {
    setIgnoredProductIds(prev => {
      const s = new Set(prev);
      s.add(productId);
      return s;
    });
  };

  const handleIgnoreAllProducts = (items: CostAuditResult[]) => {
    setIgnoredProductIds(prev => {
      const s = new Set(prev);
      items.forEach(i => s.add(i.produtoId));
      return s;
    });
  };

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

  const openNewProductModal = (productName: string) => {
    setNewProductData({
      produto: productName,
      familia: '',
      custo_total: 0,
      custo_und: 0,
      sugestao: 0,
      peso_embalagem: 0,
      quant_embalagem: 1,
      comissao: 0,
      livre: 0,
      "200kg": 0,
      "500kg": 0,
      "1000kg": 0,
      "2000kg": 0,
      "4000kg": 0
    });
    setShowNewProductModal(true);
  };

  const handleFamilyChange = (familia: string) => {
    // Find a product from this family to inherit defaults
    const template = produtos.find(p => p.familia === familia);
    if (template) {
      setNewProductData(prev => ({
        ...prev,
        familia,
        comissao: template.comissao || 0,
        livre: template.livre || 0,
        "200kg": template["200kg"] || 0,
        "500kg": template["500kg"] || 0,
        "1000kg": template["1000kg"] || 0,
        "2000kg": template["2000kg"] || 0,
        "4000kg": template["4000kg"] || 0
      }));
    } else {
      setNewProductData(prev => ({ ...prev, familia }));
    }
  };

  const handleSaveNewProduct = async () => {
    if (!newProductData.produto || !newProductData.familia) {
      alert('Preencha o nome e a família do produto.');
      return;
    }

    setSavingNewProduct(true);
    try {
      const { data, error } = await supabase
        .from('produtos')
        .insert([{
          ...newProductData,
          ativo: true
        }])
        .select()
        .single();

      if (error) throw error;

      // Update local products list
      const updatedProdutos = [...produtos, data];
      setProdutos(updatedProdutos);

      // Update processed rows to mark this product as valid
      setProcessedRows(prev => prev.map(row => {
        if (row.produto.toLowerCase() === newProductData.produto.toLowerCase()) {
          return {
            ...row,
            isValid: true,
            isMissingProduct: false,
            error: undefined,
            peso_total: row.qtd * (data.peso_embalagem || 0)
          };
        }
        return row;
      }));

      setShowNewProductModal(false);
    } catch (err: any) {
      console.error('Erro ao cadastrar produto:', err);
      alert(`Erro ao cadastrar produto: ${err.message}`);
    } finally {
      setSavingNewProduct(false);
    }
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
        <h1 className="text-2xl font-black text-neutral-900 tracking-tight">
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
            <div className="relative">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-bold text-neutral-500 uppercase">Cliente</label>
                <button 
                  onClick={() => setShowInactive(!showInactive)}
                  className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-lg transition-all border",
                    showInactive 
                      ? "bg-orange-50 border-orange-200 text-orange-600 shadow-sm" 
                      : "bg-white border-neutral-200 text-neutral-400 hover:bg-neutral-50"
                  )}
                >
                  {showInactive ? "Ocultar Inativos" : "Inativos"}
                </button>
              </div>
              
              <div className="relative">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Buscar cliente..."
                    value={clientSearch}
                    onChange={(e) => {
                      setClientSearch(e.target.value);
                      setIsDropdownOpen(true);
                      if (!e.target.value) setSelectedClienteId('');
                    }}
                    onFocus={() => setIsDropdownOpen(true)}
                    className="w-full p-2.5 pl-10 bg-neutral-50 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all text-sm font-bold"
                  />
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={18} />
                  <button 
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600"
                  >
                    <ChevronDown size={18} className={cn("transition-transform", isDropdownOpen && "rotate-180")} />
                  </button>
                </div>

                {isDropdownOpen && (
                  <>
                    <div 
                      className="fixed inset-0 z-10" 
                      onClick={() => {
                        setIsDropdownOpen(false);
                        if (selectedCliente) setClientSearch(selectedCliente.cliente);
                      }} 
                    />
                    <div className="absolute left-0 right-0 mt-2 bg-white border border-neutral-200 rounded-xl shadow-xl z-20 max-h-60 overflow-y-auto">
                      {clientSearchResults.length > 0 ? (
                        clientSearchResults.map(c => (
                          <button
                            key={c.id}
                            onClick={() => {
                              setSelectedClienteId(c.id);
                              setClientSearch(c.cliente);
                              setIsDropdownOpen(false);
                            }}
                            className={cn(
                              "w-full text-left px-4 py-2.5 text-sm hover:bg-orange-50 transition-colors flex flex-col gap-0.5",
                              selectedClienteId === c.id && "bg-orange-50 text-orange-600"
                            )}
                          >
                            <span className="font-bold">{c.cliente}</span>
                            {!c.ativo && <span className="text-[10px] text-red-500 font-bold uppercase">Inativo</span>}
                          </button>
                        ))
                      ) : (
                        <div className="px-4 py-3 text-sm text-neutral-500 italic">
                          Nenhum cliente encontrado
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Número do Pedido ERP Field */}
            <div className="bg-orange-50/50 p-3.5 rounded-2xl border border-orange-100 space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-black text-orange-850 uppercase tracking-wider flex items-center gap-1.5">
                  <Coins size={14} className="text-orange-600" />
                  Pedido ERP (Identificador Mestre)
                </label>
                {numeroPedidoErp && (
                  <button
                    type="button"
                    onClick={() => {
                      setNumeroPedidoErp('');
                      sessionStorage.removeItem('last_pedido_erp');
                    }}
                    className="text-[10px] text-red-500 font-extrabold hover:underline transition-all"
                  >
                    Mudar/Limpar
                  </button>
                )}
              </div>
              <input
                type="text"
                placeholder="Exemplo: PEDIDO-94812"
                value={numeroPedidoErp}
                onChange={(e) => {
                  const val = e.target.value;
                  setNumeroPedidoErp(val);
                  sessionStorage.setItem('last_pedido_erp', val);
                }}
                className="w-full p-2.5 bg-white border border-orange-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 outline-none transition-all text-sm font-bold text-neutral-800 placeholder-neutral-400 shadow-3xs"
              />
              <p className="text-[9px] text-orange-700/80 font-medium leading-tight">
                Proteção Idempotente ativa contra reimportações acidentais ou duplicidades.
              </p>
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
          {statusImportacao === 'PROCESSANDO' && (
            <div className="bg-orange-50 border border-orange-100 text-orange-700 p-4 rounded-xl flex items-center gap-3 animate-pulse shadow-sm">
              <Loader2 className="animate-spin text-orange-600 shrink-0" size={18} />
              <p className="text-sm font-bold">Importando faturamento... Por favor, aguarde a sincronização.</p>
            </div>
          )}
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
            <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden flex flex-col h-full max-h-[850px]">
              <div className="p-4 border-b border-neutral-100 bg-neutral-50 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab('pedido')}
                    className={cn(
                      "px-4 py-2 text-xs font-black uppercase rounded-xl transition-all",
                      activeTab === 'pedido'
                        ? "bg-neutral-900 text-white shadow-sm"
                        : "text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100"
                    )}
                  >
                    Itens do Pedido ({processedRows.length})
                  </button>
                  <button
                    onClick={() => setActiveTab('auditoria')}
                    className={cn(
                      "px-4 py-2 text-xs font-black uppercase rounded-xl transition-all flex items-center gap-1.5",
                      activeTab === 'auditoria'
                        ? "bg-orange-600 text-white shadow-sm shadow-orange-100"
                        : "text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100"
                    )}
                  >
                    <ShieldAlert size={14} />
                    Auditoria de Custos
                    {activeAuditAlerts.length > 0 && (
                      <span className="bg-white text-orange-600 px-1.5 py-0.5 rounded-full text-[9px] font-black leading-none animate-pulse">
                        {activeAuditAlerts.length}
                      </span>
                    )}
                  </button>
                </div>

                {activeTab === 'pedido' ? (
                  <button
                    onClick={handleSave}
                    disabled={saving || statusImportacao === 'PROCESSANDO'}
                    className="px-6 py-2 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    {saving || statusImportacao === 'PROCESSANDO' ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                    {saving || statusImportacao === 'PROCESSANDO' ? 'Importando faturamento...' : 'Salvar no Banco'}
                  </button>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5 bg-white border border-neutral-200 px-3 py-1.5 rounded-xl text-xs font-bold text-neutral-600">
                      <Layers size={13} className="text-neutral-400" />
                      <span>Limiar Tolerância:</span>
                      <select
                        value={toleranceVal}
                        onChange={(e) => setToleranceVal(parseFloat(e.target.value))}
                        className="font-black text-neutral-900 bg-transparent outline-none cursor-pointer focus:underline"
                      >
                        <option value={0.5}>±0.5%</option>
                        <option value={1.0}>±1.0%</option>
                        <option value={2.0}>±2.0%</option>
                        <option value={5.0}>±5.0%</option>
                      </select>
                    </div>
                    {activeAuditAlerts.length > 0 && (
                      <button
                        onClick={() => handleBatchUpdateCosts(activeAuditAlerts)}
                        disabled={isBatchUpdating}
                        className="px-4 py-2 bg-orange-600 text-white rounded-xl text-xs font-black hover:bg-orange-700 transition-all flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
                      >
                        {isBatchUpdating ? <Loader2 className="animate-spin" size={13} /> : <CheckCircle2 size={13} />}
                        Corrigir Lote ({activeAuditAlerts.length})
                      </button>
                    )}
                  </div>
                )}
              </div>

              {activeTab === 'pedido' ? (
                <div className="overflow-auto flex-1">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-white z-10">
                      <tr className="bg-neutral-50 text-[10px] uppercase font-bold text-neutral-500 border-b border-neutral-200">
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 min-w-[450px]">Produto</th>
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
                            ) : row.isMissingProduct ? (
                              <button 
                                onClick={() => openNewProductModal(row.produto)}
                                className="flex items-center gap-1 text-orange-600 hover:text-orange-700 font-bold"
                              >
                                <Plus size={14} />
                                <span className="text-[10px]">Cadastrar</span>
                              </button>
                            ) : (
                              <div className="flex items-center gap-1 text-red-500" title={row.error}>
                                <AlertCircle size={16} />
                                <span className="text-[10px] truncate max-w-[80px]">{row.error}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2 min-w-[450px]">
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
              ) : (
                <div className="overflow-auto flex-1 p-6 space-y-6">
                  {/* Summary / Info Banner */}
                  <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-4 flex gap-3 text-neutral-600">
                    <ShieldAlert size={20} className="text-orange-600 shrink-0 mt-0.5" />
                    <div className="text-xs space-y-1">
                      <p className="font-bold text-neutral-950 uppercase tracking-wide">Auditoria de Preços Comerciais vs. Custos</p>
                      <p>
                        Esta ferramenta analisa as linhas importadas de vendas para buscar inconsistências no custo de tabelas.
                        Ela reconfigura o valor real do parceiro antes do desconto ERP (campo <strong>XDT</strong>) e compara com <strong>custo_total</strong> esperado do cadastro sem modificar nenhum outro fluxo.
                      </p>
                      <div className="flex flex-wrap gap-4 pt-2 text-[10px] font-bold uppercase text-neutral-500">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-600"></span> Vendas: São validadas</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500"></span> Bonificação: Alertas informativos</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-neutral-400"></span> Brindes/Promo: São ignorados</span>
                      </div>
                    </div>
                  </div>

                  {/* Audit alert messages */}
                  {auditSuccessMessage && (
                    <div className="bg-green-50 border border-green-200 text-green-700 p-3.5 rounded-xl text-xs font-bold flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <CheckCircle2 size={16} />
                        {auditSuccessMessage}
                      </span>
                      <button onClick={() => setAuditSuccessMessage(null)} className="text-green-500 hover:text-green-800 font-bold">X</button>
                    </div>
                  )}

                  {activeAuditAlerts.length === 0 ? (
                    <div className="p-12 text-center bg-neutral-50 rounded-2xl border border-neutral-200/60 flex flex-col items-center justify-center space-y-3">
                      <div className="bg-green-50 p-4 rounded-full text-green-600">
                        <CheckCircle2 size={36} className="stroke-[3]" />
                      </div>
                      <div>
                        <h3 className="text-sm font-black text-neutral-900 uppercase tracking-widest">Preços e Custos Coerentes</h3>
                        <p className="text-neutral-500 text-xs mt-1 max-w-sm leading-relaxed">
                          Nenhuma divergência maior que ±{toleranceVal}% de custo cadastrado foi identificada nos itens faturados comercialmente!
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-black text-neutral-500 uppercase tracking-widest">
                          Divergências Encontradas ({activeAuditAlerts.length})
                        </h3>
                        {activeAuditAlerts.length > 1 && (
                          <button
                            onClick={() => handleIgnoreAllProducts(activeAuditAlerts)}
                            className="text-[10px] font-bold text-neutral-400 hover:text-neutral-600 flex items-center gap-1"
                          >
                            <EyeOff size={12} />
                            Ignorar Todos os Alertas
                          </button>
                        )}
                      </div>

                      <div className="border border-neutral-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-neutral-50 text-[10px] uppercase font-bold text-neutral-500 border-b border-neutral-200">
                              <th className="px-4 py-3">Produto</th>
                              <th className="px-4 py-3 text-right">Qtd</th>
                              <th className="px-4 py-3 text-right">Faturado Und (ERP)</th>
                              <th className="px-4 py-3 text-right">Desconto (XDT)</th>
                              <th className="px-4 py-3 text-right font-semibold">Custo Total Atual</th>
                              <th className="px-4 py-3 text-right font-bold text-orange-600">Custo Total Calculado</th>
                              <th className="px-4 py-3 text-right">Diferença %</th>
                              <th className="px-4 py-3 text-right">Diferença R$</th>
                              <th className="px-4 py-3 text-right bg-neutral-50/50">Novo Custo Un.</th>
                              <th className="px-4 py-3 text-center">Ações</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-neutral-100 font-medium text-neutral-700">
                            {activeAuditAlerts.map((item) => {
                              const isPositive = item.diferencaMonetaria > 0;
                              const isBonif = item.status === 'ALERTA_BONIF';
                              
                              return (
                                <tr key={item.produtoId} className="hover:bg-neutral-50 transition-colors">
                                  <td className="px-4 py-3 font-bold text-neutral-900">
                                    <div className="flex flex-col gap-0.5">
                                      <span>{item.produtoNome}</span>
                                      {isBonif && (
                                        <span className="text-[9px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full w-max uppercase tracking-wider font-extrabold">
                                          Bonificação Comercial
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono text-neutral-500">{item.qtdImportada}</td>
                                  <td className="px-4 py-3 text-right font-mono text-neutral-600">
                                    R$ {item.valorRealUnitImportado.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono text-red-600">
                                    {item.descontoAplicado > 0 ? `${item.descontoAplicado}%` : '0%'}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono text-neutral-500">
                                    R$ {item.custoTotalAtual.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono font-black text-neutral-900 bg-orange-50/20">
                                    R$ {item.custoCaculadoTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <span className={cn(
                                      "inline-flex items-center gap-0.5 font-bold text-xs px-1.5 py-0.5 rounded-md",
                                      isPositive 
                                        ? "text-red-700 bg-red-50" 
                                        : "text-blue-700 bg-blue-50"
                                    )}>
                                      {isPositive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                                      {isPositive ? '+' : ''}{item.diferencaPercentual.toFixed(1)}%
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono">
                                    <span className={isPositive ? "text-red-600" : "text-blue-600"}>
                                      {isPositive ? '+' : ''}R$ {item.diferencaMonetaria.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-right font-mono text-neutral-900 font-bold bg-neutral-50/50">
                                    R$ {item.custoCalculadoUnd.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}
                                    <div className="text-[10px] text-neutral-400 font-normal">emb: {item.quantEmbalagem} un</div>
                                  </td>
                                  <td className="px-4 py-3">
                                    <div className="flex items-center justify-center gap-1 text-[11px]">
                                      <button
                                        onClick={() => handleUpdateCost(item)}
                                        disabled={updatingProducts.has(item.produtoId)}
                                        className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg font-bold flex items-center gap-1 transition-all disabled:opacity-50 inline-block w-full max-w-max"
                                        title="Atualizar custo atual do produto no banco"
                                      >
                                        {updatingProducts.has(item.produtoId) ? (
                                          <Loader2 className="animate-spin text-amber-700" size={11} />
                                        ) : (
                                          <Sparkles size={11} />
                                        )}
                                        Corrigir Cadastro
                                      </button>
                                      
                                      <button
                                        onClick={() => handleIgnoreProduct(item.produtoId)}
                                        className="px-2 py-1 bg-neutral-50 hover:bg-neutral-100 text-neutral-500 border border-neutral-200 rounded-lg hover:text-neutral-700 transition-all font-bold"
                                        title="Descartar este alerta pra recomeçar import"
                                      >
                                        Ignorar
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
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
                type="button"
                onClick={() => setShowConfirmSave(false)}
                disabled={saving || statusImportacao === 'PROCESSANDO'}
                className="flex-1 py-2.5 bg-neutral-100 text-neutral-700 rounded-xl font-bold hover:bg-neutral-200 transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmSave}
                disabled={saving || statusImportacao === 'PROCESSANDO'}
                className="flex-1 py-2.5 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-200 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {statusImportacao === 'PROCESSANDO' ? (
                  <>
                    <Loader2 className="animate-spin" size={16} />
                    <span>Importando faturamento...</span>
                  </>
                ) : (
                  <span>Confirmar</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Product Modal */}
      {showNewProductModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-6 max-w-lg w-full shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-orange-600">
                <Package size={24} />
                <h3 className="font-black text-xl">Novo Produto</h3>
              </div>
              <button onClick={() => setShowNewProductModal(false)} className="p-2 hover:bg-neutral-100 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-1">Nome do Produto</label>
                <input
                  type="text"
                  value={newProductData.produto}
                  onChange={(e) => setNewProductData(prev => ({ ...prev, produto: e.target.value }))}
                  className="w-full p-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-bold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-1">Família do Produto</label>
                <select
                  value={newProductData.familia}
                  onChange={(e) => handleFamilyChange(e.target.value)}
                  className="w-full p-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-bold"
                >
                  <option value="">Selecione a Família</option>
                  {families.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-1">Custo Total</label>
                  <input
                    type="number"
                    value={newProductData.custo_total}
                    onChange={(e) => setNewProductData(prev => ({ ...prev, custo_total: parseFloat(e.target.value) }))}
                    className="w-full p-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-1">Custo Unitário</label>
                  <input
                    type="number"
                    value={newProductData.custo_und}
                    onChange={(e) => setNewProductData(prev => ({ ...prev, custo_und: parseFloat(e.target.value) }))}
                    className="w-full p-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-1">Sugestão</label>
                  <input
                    type="number"
                    value={newProductData.sugestao}
                    onChange={(e) => setNewProductData(prev => ({ ...prev, sugestao: parseFloat(e.target.value) }))}
                    className="w-full p-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-1">Peso Emb.</label>
                  <input
                    type="number"
                    value={newProductData.peso_embalagem}
                    onChange={(e) => setNewProductData(prev => ({ ...prev, peso_embalagem: parseFloat(e.target.value) }))}
                    className="w-full p-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-widest mb-1">Qtd Emb.</label>
                  <input
                    type="number"
                    value={newProductData.quant_embalagem}
                    onChange={(e) => setNewProductData(prev => ({ ...prev, quant_embalagem: parseInt(e.target.value) }))}
                    className="w-full p-3 bg-neutral-50 border border-neutral-200 rounded-xl focus:ring-2 focus:ring-orange-500 outline-none transition-all font-bold"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                onClick={() => setShowNewProductModal(false)}
                className="flex-1 py-3 bg-neutral-100 text-neutral-700 rounded-xl font-bold hover:bg-neutral-200 transition-all"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveNewProduct}
                disabled={savingNewProduct}
                className="flex-1 py-3 bg-orange-600 text-white rounded-xl font-bold hover:bg-orange-700 transition-all shadow-lg shadow-orange-200 flex items-center justify-center gap-2"
              >
                {savingNewProduct ? <Loader2 className="animate-spin" size={20} /> : <Save size={20} />}
                Salvar e Continuar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
