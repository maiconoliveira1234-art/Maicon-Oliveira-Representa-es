export type CreditTitle = { id: string; vencimento: string; valor: number };

export function titleStatus(title: Pick<CreditTitle, 'vencimento'>, today: string): string {
  if (title.vencimento <= today) return 'Pagamento presumido';
  return 'A vencer';
}

export function adjustedCredit(raw: string, oldLimit: number, oldAvailable: number) {
  const cleaned = raw.trim().replace(/R\$/gi, '').replace(/\s/g, '');
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(cleaned)) {
    throw new Error('Informe um valor em reais, como 15.000,00, com até duas casas decimais.');
  }
  const limit = Number(cleaned.replace(/\./g, '').replace(',', '.'));
  if (!Number.isSafeInteger(Math.round(limit * 100)) || limit < 0 ||
      !Number.isFinite(oldLimit) || !Number.isFinite(oldAvailable)) throw new Error('Limite inválido.');
  const available = Math.round((oldAvailable + limit - oldLimit) * 100) / 100;
  if (available < 0) throw new Error('Este limite é inferior ao valor comprometido no levantamento. Confira os saldos no ERP antes de reduzir.');
  return { limit, available };
}
