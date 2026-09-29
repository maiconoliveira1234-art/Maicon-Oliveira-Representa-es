export function buildRepurchaseReminderMessage(contactName?: string | null): string {
  const hour = new Date().getHours();
  const greeting = hour >= 5 && hour < 12
    ? 'Bom dia'
    : hour >= 12 && hour < 18
      ? 'Boa tarde'
      : 'Boa noite';

  const normalizedName = (contactName ?? '').replace(/\s+/g, ' ').trim();
  const name = /^(undefined|null)$/i.test(normalizedName) ? '' : normalizedName;
  const introduction = name ? `${greeting}, ${name}, tudo bem?` : `${greeting}, tudo bem?`;

  return `${introduction}\n\nSó passando para lembrar que esta é a última semana do período de recompra garantida. Se precisar fazer alguma reposição mantendo a mesma tabela do último pedido, temos até quarta-feira para enviar o pedido.\n\nSe precisar, me avise que passo na loja.`;
}
