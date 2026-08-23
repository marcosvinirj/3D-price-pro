import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import type { Impressora } from '../lib/types';
import { Alerta, Button, Card, Field, Input } from '../components/ui';
import { useMoeda } from '../lib/moeda';

type FormImp = {
  nome: string;
  marca: string;
  modelo: string;
  dataCompra: string;
  potenciaW: string;
  potenciaMediaW: string;
  valorAquisicao: string;
  vidaUtilH: string;
  custoManutencaoAnual: string;
  taxaFalhaPct: string;
};

const vazio: FormImp = {
  nome: '',
  marca: '',
  modelo: '',
  dataCompra: '',
  potenciaW: '',
  potenciaMediaW: '',
  valorAquisicao: '',
  vidaUtilH: '',
  custoManutencaoAnual: '0',
  taxaFalhaPct: '10',
};

export function ImpressorasPage() {
  const { fmt } = useMoeda();
  const [itens, setItens] = useState<Impressora[]>([]);
  const [form, setForm] = useState<FormImp>(vazio);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    try {
      setItens(await api.get<Impressora[]>('/impressoras'));
      setErro(null);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Erro ao carregar');
    }
  }
  useEffect(() => {
    carregar();
  }, []);

  function novo() {
    setForm(vazio);
    setEditandoId(null);
    setAberto(true);
    setErro(null);
  }

  function editar(i: Impressora) {
    setForm({
      nome: i.nome,
      marca: i.marca ?? '',
      modelo: i.modelo ?? '',
      dataCompra: i.dataCompra ?? '',
      potenciaW: String(i.potenciaW),
      potenciaMediaW: String(i.potenciaMediaW),
      valorAquisicao: String(i.valorAquisicao),
      vidaUtilH: String(i.vidaUtilH),
      custoManutencaoAnual: String(i.custoManutencaoAnual),
      taxaFalhaPct: String(Math.round(i.taxaFalhaPadrao * 100)),
    });
    setEditandoId(i.id);
    setAberto(true);
    setErro(null);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const payload = {
      nome: form.nome,
      marca: form.marca.trim() || undefined,
      modelo: form.modelo.trim() || undefined,
      dataCompra: form.dataCompra || undefined,
      potenciaW: Number(form.potenciaW),
      potenciaMediaW: Number(form.potenciaMediaW),
      valorAquisicao: Number(form.valorAquisicao),
      vidaUtilH: Number(form.vidaUtilH),
      custoManutencaoAnual: Number(form.custoManutencaoAnual),
      taxaFalhaPadrao: Number(form.taxaFalhaPct) / 100,
    };
    try {
      if (editandoId) await api.patch(`/impressoras/${editandoId}`, payload);
      else await api.post('/impressoras', payload);
      setAberto(false);
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Erro ao salvar');
    }
  }

  async function remover(id: number) {
    if (!confirm('Remover esta impressora?')) return;
    try {
      await api.del(`/impressoras/${id}`);
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Erro ao remover');
    }
  }

  function set<K extends keyof FormImp>(c: K, v: FormImp[K]) {
    setForm((f) => ({ ...f, [c]: v }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Impressoras</h1>
        <Button onClick={novo}>Nova impressora</Button>
      </div>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}

      {aberto && (
        <Card titulo={editandoId ? 'Editar impressora' : 'Nova impressora'}>
          <form onSubmit={salvar} className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Field label="Nome">
              <Input value={form.nome} onChange={(e) => set('nome', e.target.value)} required />
            </Field>
            <Field label="Marca">
              <Input value={form.marca} onChange={(e) => set('marca', e.target.value)} placeholder="Ex.: Creality" />
            </Field>
            <Field label="Modelo">
              <Input value={form.modelo} onChange={(e) => set('modelo', e.target.value)} placeholder="Ex.: Ender 3 V3" />
            </Field>
            <Field label="Data de compra">
              <Input type="date" value={form.dataCompra} onChange={(e) => set('dataCompra', e.target.value)} />
            </Field>
            <Field label="Potência máxima (W)">
              <Input type="number" min="0" step="1" value={form.potenciaW} onChange={(e) => set('potenciaW', e.target.value)} required />
              <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
                Potência máxima/nominal informada pelo fabricante.
              </span>
            </Field>
            <Field label="Consumo médio (W)">
              <Input type="number" min="0.1" step="1" value={form.potenciaMediaW} onChange={(e) => set('potenciaMediaW', e.target.value)} required />
              <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
                Consumo médio estimado/medido durante a impressão. Este é o valor utilizado para calcular o custo de eletricidade.
              </span>
            </Field>
            <Field label="Valor de aquisição (€)">
              <Input type="number" min="0" step="0.01" value={form.valorAquisicao} onChange={(e) => set('valorAquisicao', e.target.value)} required />
            </Field>
            <Field label="Vida útil (horas)">
              <Input type="number" min="1" step="1" value={form.vidaUtilH} onChange={(e) => set('vidaUtilH', e.target.value)} required />
            </Field>
            <Field label="Custo anual de manutenção (€)">
              <Input type="number" min="0" step="0.01" value={form.custoManutencaoAnual} onChange={(e) => set('custoManutencaoAnual', e.target.value)} />
              <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">
                só registro por enquanto — ainda não entra no cálculo do preço
              </span>
            </Field>
            <Field label="Taxa média de falha (%)">
              <Input type="number" min="0" max="100" step="1" value={form.taxaFalhaPct} onChange={(e) => set('taxaFalhaPct', e.target.value)} />
            </Field>
            {Number(form.valorAquisicao) > 0 && Number(form.vidaUtilH) > 0 && (
              <div className="col-span-2 self-end rounded-xl border border-brand-200 bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300 md:col-span-1">
                Depreciação/hora:{' '}
                <strong>{fmt(Number(form.valorAquisicao) / Number(form.vidaUtilH))}</strong>
              </div>
            )}
            <div className="col-span-2 flex items-end gap-2 md:col-span-3">
              <Button type="submit">{editandoId ? 'Salvar alterações' : 'Cadastrar'}</Button>
              <Button type="button" variante="secundario" onClick={() => setAberto(false)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
                <th className="py-2 pr-4">Nome</th>
                <th className="py-2 pr-4">Marca / Modelo</th>
                <th className="py-2 pr-4">Potência máx.</th>
                <th className="py-2 pr-4">Consumo médio</th>
                <th className="py-2 pr-4">Valor</th>
                <th className="py-2 pr-4">Vida útil</th>
                <th className="py-2 pr-4">Deprec./h</th>
                <th className="py-2 pr-4">Ações</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-4 font-medium text-slate-700 dark:text-slate-200">{i.nome}</td>
                  <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">
                    {[i.marca, i.modelo].filter(Boolean).join(' ') || '—'}
                  </td>
                  <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">{i.potenciaW} W</td>
                  <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">{i.potenciaMediaW} W</td>
                  <td className="py-2 pr-4">{fmt(i.valorAquisicao)}</td>
                  <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">{i.vidaUtilH} h</td>
                  <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">
                    {i.vidaUtilH > 0 ? fmt(i.valorAquisicao / i.vidaUtilH) : '—'}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex gap-2">
                      <Button variante="secundario" className="px-2 py-1" onClick={() => editar(i)}>
                        Editar
                      </Button>
                      <Button variante="perigo" className="px-2 py-1" onClick={() => remover(i.id)}>
                        Remover
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {itens.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-slate-400 dark:text-slate-500">
                    Nenhuma impressora cadastrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
