import { Cliente, Produto, HistVenda } from '../types';

export const MOCK_CLIENTES: Cliente[] = [
  {
    id: '1',
    cliente: 'Supermercado Alvorada',
    cidade: 'São Paulo',
    ativo: true,
    meta: 5000,
    ultima_compra: '2026-03-15T10:00:00Z',
  },
  {
    id: '2',
    cliente: 'Mercearia do João',
    cidade: 'Campinas',
    ativo: true,
    meta: 1200,
    ultima_compra: '2026-02-10T14:30:00Z',
  },
];

export const MOCK_PRODUTOS: Produto[] = [
  {
    id: 'p1',
    produto: 'Arroz Agulhinha T1 5kg',
    ativo: true,
    familia: 'Grãos',
    livre: 25.50,
    "200kg": 24.80,
    "500kg": 24.00,
    "1000kg": 23.20,
    "2000kg": 22.50,
    "4000kg": 21.80,
    custo_total: 15.00,
    custo_und: 15.00,
    sugestao: 10,
    comissao: 0.05,
    peso_embalagem: 5,
    quant_embalagem: 30,
  },
];

export const MOCK_HISTORICO: HistVenda[] = [
  {
    id: 'h1',
    cliente: 'Supermercado Alvorada',
    tabela: 'Livre',
    produtos: 'Arroz Agulhinha T1 5kg',
    qtd: 40,
    "r$_total": 960.00,
    vendas: 'Venda Normal',
    xdt: 0,
    "acresc.": 0,
    faturamento: '2026-03-15',
    cliente_id: '1',
    produto_id: 'p1',
  },
  {
    id: 'h2',
    cliente: 'Supermercado Alvorada',
    tabela: 'Livre',
    produtos: 'Arroz Agulhinha T1 5kg',
    qtd: 20,
    "r$_total": 480.00,
    vendas: 'Venda Normal',
    xdt: 0,
    "acresc.": 0,
    faturamento: '2026-04-01',
    cliente_id: '1',
    produto_id: 'p1',
  },
];
