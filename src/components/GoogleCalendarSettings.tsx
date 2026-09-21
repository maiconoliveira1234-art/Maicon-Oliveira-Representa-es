import { useEffect, useState } from 'react';

const ENDPOINT = 'https://ljrzmbxposgfxcymamwk.supabase.co/functions/v1/google-calendar';
type Status = { connected: boolean; lastSync: string | null; error: string | null };

export function GoogleCalendarSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(ENDPOINT + '/status', { signal: controller.signal })
      .then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error === 'configuration_missing' ? 'A conexão precisa ser configurada pelo responsável pelo app.' : 'Não foi possível consultar a conexão.'); return data; })
      .then(setStatus).catch(e => { if (!controller.signal.aborted) setError(e.message || 'Não foi possível consultar a conexão.'); });
    return () => controller.abort();
  }, []);
  return <section className="rounded-xl border border-neutral-200 bg-white p-5 space-y-3">
    <h2 className="font-bold text-neutral-900">Google Calendar</h2>
    <p className="text-sm text-neutral-600">Hoje e os próximos 15 dias no calendário Pro Max. Atualização diária às 3h (Brasília). Visitas extras, retornos e tarefas aparecem como dia todo.</p>
    <p className="text-sm" role="status">{error ? error : !status ? 'Consultando conexão…' : status.connected ? 'Conta conectada' : 'Conta ainda não conectada'}</p>
    {status?.lastSync && <p className="text-xs text-neutral-500">Último envio: {new Date(status.lastSync).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} (Brasília)</p>}
    {status?.error && <p className="text-sm text-amber-700">{status.error}</p>}
    {status && (!status.connected || status.error) && <a className="inline-flex rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white" href={ENDPOINT + '/authorize'}>{status.connected ? 'Reconectar Google' : 'Conectar Google Calendar'}</a>}
    {status && !status.connected && <p className="text-xs text-neutral-500">Ao conectar, os atendimentos de hoje e dos próximos 15 dias serão enviados para testar a integração.</p>}
  </section>;
}

const messages: Record<string, string> = {
  sent: 'Google Calendar conectado. Os atendimentos de hoje e dos próximos 15 dias foram enviados.',
  empty: 'Google Calendar conectado. Não há atendimentos programados para hoje nem para os próximos 15 dias. O envio diário está configurado para as 3h.',
  connected: 'Google Calendar conectado. Há um envio em andamento; confira o resultado em Configurações.',
  sync_failed: 'A conta foi conectada, mas o envio não foi concluído. Confira a conexão em Configurações.',
  wrong_account: 'Conecte a conta Google do responsável pelo Pro Max.',
  cancelled: 'A conexão com o Google foi cancelada.',
  busy: 'Há outra operação em andamento. Tente conectar novamente em alguns minutos.',
  permission_missing: 'É necessário autorizar o acesso ao calendário criado pelo Pro Max. Tente conectar novamente.',
};
export function GoogleCalendarResult() {
  const [result, setResult] = useState(() => new URLSearchParams(window.location.search).get('google_calendar'));
  if (!result) return null;
  return <div role="status" className="m-4 rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-neutral-800">
    {messages[result] || 'Não foi possível concluir a conexão. Tente novamente em Configurações.'}
    <button className="ml-3 underline" onClick={() => {
      const url = new URL(window.location.href); url.searchParams.delete('google_calendar');
      window.history.replaceState(window.history.state, '', url); setResult(null);
    }}>Fechar</button>
  </div>;
}
