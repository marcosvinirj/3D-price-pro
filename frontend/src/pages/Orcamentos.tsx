import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { Alerta, Button, Card } from '../components/ui';
import { useMoeda } from '../lib/moeda';

interface OrcamentoLista {
  id: number;
  cliente: string | null;
  telefone: string | null;
  descricaoPeca: string | null;
  status: 'pendente' | 'aprovado' | 'recusado';
  precoFinal: number;
  precoCobrado: number;
  criadoEm: string;
  material: { nome: string };
  impressora: { nome: string };
}

const badge: Record<string, string> = {
  pendente: 'bg-amber-100 text-amber-800',
  aprovado: 'bg-emerald-100 text-emerald-800',
  recusado: 'bg-slate-200 text-slate-600 dark:text-slate-300',
};

export function OrcamentosPage() {
  const { fmt, codigoAtual } = useMoeda();
  const [itens, setItens] = useState<OrcamentoLista[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    setCarregando(true);
    try {
      setItens(await api.get<OrcamentoLista[]>('/orcamentos'));
      setErro(null);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Erro ao carregar');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
  }, []);

  async function agir(id: number, acao: 'aprovar' | 'recusar') {
    try {
      await api.post(`/orcamentos/${id}/${acao}`);
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Erro na ação');
    }
  }

  async function baixarPdf(id: number) {
    try {
      const q = codigoAtual !== 'EUR' ? `?moeda=${codigoAtual}` : '';
      await api.baixar(`/orcamentos/${id}/pdf${q}`, `orcamento-${String(id).padStart(4, '0')}.pdf`);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Erro ao gerar PDF');
    }
  }

  /**
   * Abre o WhatsApp com um resumo do orçamento pronto para enviar. Como o link
   * wa.me só carrega texto (não anexa arquivos), baixamos o PDF antes para o
   * usuário anexar manualmente na conversa, se quiser.
   */
  async function enviarWhatsApp(o: OrcamentoLista) {
    // Usa o telefone salvo no orçamento; só pergunta se não houver.
    const tel = (
      o.telefone || prompt('WhatsApp do cliente (com DDI, só números):') || ''
    ).replace(/\D/g, '');
    const linhas = [
      `*Orçamento Nº ${String(o.id).padStart(4, '0')}*`,
      o.cliente ? `Cliente: ${o.cliente}` : null,
      o.descricaoPeca ? `Peça: ${o.descricaoPeca}` : null,
      `Material: ${o.material.nome}`,
      `Valor: ${fmt(o.precoCobrado)}`,
      '',
      'Segue o orçamento em anexo (PDF). Validade: 15 dias.',
    ].filter(Boolean);
    const texto = encodeURIComponent(linhas.join('\n'));
    // Baixa o PDF para facilitar o anexo manual na conversa.
    try {
      await baixarPdf(o.id);
    } catch {
      /* ignora: o resumo em texto já segue mesmo sem o PDF */
    }
    const base = tel ? `https://wa.me/${tel}` : 'https://wa.me/';
    window.open(`${base}?text=${texto}`, '_blank', 'noopener');
  }

  async function exportarCsv() {
    try {
      await api.baixar('/orcamentos/export/csv', 'orcamentos.csv');
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Erro ao exportar');
    }
  }

  async function exportarExcel() {
    try {
      await api.baixar('/orcamentos/export/xlsx', 'orcamentos.xls');
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Erro ao exportar');
    }
  }

  return (
    <Card
      titulo="Orçamentos"
      acoes={
        <div className="flex gap-2">
          <Button variante="secundario" onClick={exportarExcel} disabled={itens.length === 0}>
            Exportar Excel
          </Button>
          <Button variante="secundario" onClick={exportarCsv} disabled={itens.length === 0}>
            Exportar CSV
          </Button>
        </div>
      }
    >
      {erro && <div className="mb-3"><Alerta tipo="erro">{erro}</Alerta></div>}
      {carregando ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Carregando...</p>
      ) : itens.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Nenhum orçamento ainda. Crie um no Simulador.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-4">#</th>
                <th className="py-2 pr-4">Cliente / Peça</th>
                <th className="py-2 pr-4">Material</th>
                <th className="py-2 pr-4">Preço</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Ações</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((o) => (
                <tr key={o.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-4 text-slate-500 dark:text-slate-400">{o.id}</td>
                  <td className="py-2 pr-4">{o.cliente ?? o.descricaoPeca ?? '—'}</td>
                  <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">{o.material.nome}</td>
                  <td className="py-2 pr-4 font-medium">{fmt(o.precoCobrado)}</td>
                  <td className="py-2 pr-4">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge[o.status]}`}>
                      {o.status}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap gap-2">
                      {o.status === 'pendente' && (
                        <>
                          <Button className="px-2 py-1" onClick={() => agir(o.id, 'aprovar')}>
                            Aprovar
                          </Button>
                          <Button variante="secundario" className="px-2 py-1" onClick={() => agir(o.id, 'recusar')}>
                            Recusar
                          </Button>
                        </>
                      )}
                      <Button variante="secundario" className="px-2 py-1" onClick={() => baixarPdf(o.id)}>
                        PDF
                      </Button>
                      <Button variante="secundario" className="px-2 py-1" onClick={() => enviarWhatsApp(o)}>
                        WhatsApp
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
