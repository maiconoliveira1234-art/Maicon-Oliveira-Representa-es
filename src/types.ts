export type Cliente = {
  id: string;
  cliente: string;
  dia_visita: number;
  cidade: string;
  ativo: boolean;
  ultima_compra?: string;
  meta_kg: number;
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
};

export type ItemPedido = {
  id: string;
  pedido_id: string;
  produto_id: string;
  quantidade: number;
  peso_total: number;
  valor_unitario: number;
  valor_total: number;
};

export type PrecoFaixa = 'livre' | '200kg' | '500kg' | '1000kg' | '2000kg' | '4000kg';
