-- Corrige o unico SKU bonificado em campanhas ativas com preco-base zerado.
-- Referencia: outros sete SACHES ORIGENS 18X85G possuem custo_und=2.57, custo_total=46.26.
-- Historico deste SKU confirma faturamento em 37.47 por caixa na faixa de 19%.
-- Nao muda itens ja faturados, tabelas de desconto nem quantidade bonificada.
UPDATE public.produtos
SET custo_und = 2.57,
    custo_total = 46.26
WHERE id = '24b7ee90-6b17-4041-ad36-8d59014977a0'::uuid
  AND produto = 'SACHE ORIGENS CAO PP FRAN 18X85G'
  AND quant_embalagem = 18
  AND coalesce(custo_und,0) = 0
  AND coalesce(custo_total,0) = 0;
