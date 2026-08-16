import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useCreditos, CUSTO_ORCAMENTO, CUSTO_PDF } from '../lib/creditos';
import { Alerta, Button, Card } from '../components/ui';
import { IconBolt } from '../components/icons';

const TIPO_LABEL: Record<string, string> = {
  bonus_cadastro: 'Bônus de cadastro',
  assinatura_mensal: 'Assinatura mensal',
  pacote_avulso: 'Pacote avulso',
  consumo_orcamento: 'Orçamento criado',
  consumo_pdf: 'PDF gerado',
};

export function CreditosPage() {
  const { saldo, carregando, recarregar } = useCreditos();
  const [searchParams, setSearchParams] = useSearchParams();
  const [erro, setErro] = useState<string | null>(null);
  const [processando, setProcessando] = useState<'assinatura' | 'pacote' | 'portal' | null>(null);

  const checkout = searchParams.get('checkout');

  useEffect(() => {
    if (checkout === 'sucesso') recarregar();
    if (checkout) {
      // Limpa o parametro da URL pra nao reexibir o aviso num F5.
      const novo = new URLSearchParams(searchParams);
      novo.delete('checkout');
      setSearchParams(novo, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function irParaCheckout(tipo: 'assinatura' | 'pacote') {
    setProcessando(tipo);
    setErro(null);
    try {
      const { url } = await api.post<{ url: string }>(`/creditos/checkout/${tipo}`);
      window.location.href = url;
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Erro ao iniciar checkout');
      setProcessando(null);
    }
  }

  async function abrirPortal() {
    setProcessando('portal');
    setErro(null);
    try {
      const { url } = await api.post<{ url: string }>('/creditos/portal');
      window.location.href = url;
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Erro ao abrir o portal');
      setProcessando(null);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Créditos</h1>

      {checkout === 'sucesso' && (
        <Alerta tipo="sucesso">Pagamento confirmado! Seu saldo foi atualizado.</Alerta>
      )}
      {checkout === 'cancelado' && <Alerta tipo="aviso">Checkout cancelado — nada foi cobrado.</Alerta>}
      {erro && <Alerta tipo="erro">{erro}</Alerta>}

      <Card>
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-gradient text-white shadow-glow">
            <IconBolt />
          </div>
          <div>
            <div className="text-sm text-slate-500 dark:text-slate-400">Saldo atual</div>
            <div className="text-3xl font-bold text-slate-800 dark:text-slate-100">
              {carregando ? '…' : saldo?.ilimitado ? '∞' : (saldo?.creditos ?? 0).toLocaleString('pt-BR')}
              {!saldo?.ilimitado && (
                <span className="ml-1 text-base font-medium text-slate-400 dark:text-slate-500">créditos</span>
              )}
            </div>
            {saldo?.ilimitado && (
              <div className="text-xs text-slate-400 dark:text-slate-500">Conta isenta — nunca debita.</div>
            )}
          </div>
        </div>
        {!saldo?.ilimitado && (
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-500 dark:text-slate-400 sm:grid-cols-3">
            <div>Criar orçamento: <strong className="text-slate-700 dark:text-slate-200">{CUSTO_ORCAMENTO} créditos</strong></div>
            <div>Gerar PDF: <strong className="text-slate-700 dark:text-slate-200">{CUSTO_PDF} créditos</strong></div>
          </div>
        )}
        {saldo?.assinaturaAtiva && (
          <div className="mt-4 flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 dark:border-brand-500/30 dark:bg-brand-500/10">
            <span className="text-sm text-brand-700 dark:text-brand-300">
              Assinatura Pro ativa — renova{' '}
              {saldo.assinatura?.periodoAtualFim
                ? new Date(saldo.assinatura.periodoAtualFim).toLocaleDateString('pt-BR')
                : 'em breve'}
              .
            </span>
            <Button variante="secundario" onClick={abrirPortal} disabled={processando !== null}>
              {processando === 'portal' ? 'Abrindo...' : 'Gerenciar assinatura'}
            </Button>
          </div>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card titulo="Assinatura Price 3D Pro">
          <div className="text-3xl font-bold text-slate-800 dark:text-slate-100">
            €9,90<span className="text-base font-medium text-slate-400 dark:text-slate-500">/mês</span>
          </div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            600 créditos todo mês (renovação automática) — dá pra ~20 orçamentos completos com PDF.
          </p>
          {!saldo?.assinaturaAtiva && (
            <Button className="mt-4 w-full" onClick={() => irParaCheckout('assinatura')} disabled={processando !== null}>
              {processando === 'assinatura' ? 'Redirecionando...' : 'Assinar'}
            </Button>
          )}
        </Card>

        <Card titulo="Pacote avulso">
          <div className="text-3xl font-bold text-slate-800 dark:text-slate-100">€6,90</div>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            300 créditos, pagamento único, sem expirar — dá pra ~10 orçamentos completos com PDF.
          </p>
          <Button
            variante="secundario"
            className="mt-4 w-full"
            onClick={() => irParaCheckout('pacote')}
            disabled={processando !== null}
          >
            {processando === 'pacote' ? 'Redirecionando...' : 'Comprar créditos'}
          </Button>
        </Card>
      </div>

      <Card titulo="Histórico">
        {!saldo?.historico.length ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma movimentação ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-4">Data</th>
                  <th className="py-2 pr-4">Tipo</th>
                  <th className="py-2 pr-4">Créditos</th>
                </tr>
              </thead>
              <tbody>
                {saldo.historico.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">
                      {new Date(t.criadoEm).toLocaleString('pt-BR')}
                    </td>
                    <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">{TIPO_LABEL[t.tipo] ?? t.tipo}</td>
                    <td className={`py-2 pr-4 font-medium ${t.quantidade > 0 ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-200'}`}>
                      {t.quantidade > 0 ? '+' : ''}
                      {t.quantidade}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
