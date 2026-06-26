export type Cliente = {
  id: string;
  cliente: string;
  cidade: string;
  ativo: boolean;
  ultima_compra?: string;
  meta?: number;
  contato?: string;
  telefone?: string;
  endereco?: string;
  latitude?: number;
  longitude?: number;
  flex_saldo?: number;
  agenda_fixa?: boolean;
};

export type Produto = {
  id: string;
  produto: string;
  ativo: boolean;
  familia: string;
  livre: number;
  "200kg": number;
  "500kg": number;
  "1000kg": number;
  "2000kg": number;
  "4000kg": number;
  custo_total: number;
  custo_und: number;
  sugestao: number;
  comissao: number;
  peso_embalagem: number;
  quant_embalagem: number;
};

export type HistVenda = {
  id: string;
  cliente: string;
  tabela: string;
  produtos: string;
  qtd: number;
  "r$_total": number;
  vendas: string;
  xdt: number;
  "acresc.": number;
  faturamento: string;
  data?: string;
  cliente_id: string;
  produto_id: string;
};

export type EstoqueCliente = {
  id: string;
  cliente_id: string;
  produto_id: string;
  quantidade_atual: number;
  ultima_contagem: string;
};

export type Pedido = {
  id: string;
  cliente_id: string;
  data: string;
  peso_total: number;
  valor_total: number;
  prazo?: string;
};

export type ItemPedido = {
  id: string;
  pedido_id: string;
  produto_id: string;
  quantidade: number;
  peso_total: number;
  valor_unitario: number;
  valor_total: number;
  tipo_operacao?: 'VENDA' | 'BONIFICACAO_COMERCIAL' | 'MERCHANDISING';
};

export type PrecoFaixa = 'livre' | '200kg' | '500kg' | '1000kg' | '2000kg' | '4000kg';

export type Emprestimo = {
  id: string;
  data_emprestimo: string;
  cliente_origem_id: string;
  cliente_destino_id: string;
  produto_id: string;
  quantidade: number;
  status: 'pendente' | 'pago';
  data_devolucao?: string;
  cliente_origem_nome?: string;
  cliente_destino_nome?: string;
  produto_nome?: string;
};
