import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import type { Material } from '../lib/types';
import { Alerta, eur, Button, Card, Field, Input, pct, Select } from '../components/ui';

type FormMat = {
  nome: string;
  tipo: string;
  precoKg: string;
  densidade: string;
  cor: string;
  estoqueG: string;
  estoqueMinimoG: string;
  taxaDesperdicioPct: string;
};

const vazio: FormMat = {
  nome: '',
  tipo: 'PLA',
  precoKg: '',
  densidade: '',
  cor: '',
  estoqueG: '0',
  estoqueMinimoG: '0',
  taxaDesperdicioPct: '5',
};

const TIPOS = ['PLA', 'PETG', 'ABS', 'TPU', 'Resina', 'Outro'];

export function MateriaisPage() {
  const [itens, setItens] = useState<Material[]>([]);
  const [form, setForm] = useState<FormMat>(vazio);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    try {
      setItens(await api.get<Material[]>('/materiais'));
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

  function editar(m: Material) {
    setForm({
      nome: m.nome,
      tipo: m.tipo,
      precoKg: String(m.precoKg),
      densidade: m.densidade != null ? String(m.densidade) : '',
      cor: m.cor ?? '',
      estoqueG: String(m.estoqueG),
      estoqueMinimoG: String(m.estoqueMinimoG),
      taxaDesperdicioPct: String(m.taxaDesperdicio * 100),
    });
    setEditandoId(m.id);
    setAberto(true);
    setErro(null);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const payload = {
      nome: form.nome,
      tipo: form.tipo,
      precoKg: Number(form.precoKg),
      ...(form.densidade ? { densidade: Number(form.densidade) } : {}),
      ...(form.cor ? { cor: form.cor } : {}),
      estoqueG: Number(form.estoqueG),
      estoqueMinimoG: Number(form.estoqueMinimoG),
      taxaDesperdicio: Number(form.taxaDesperdicioPct) / 100,
    };
    try {
      if (editandoId) await api.patch(`/materiais/${editandoId}`, payload);
      else await api.post('/materiais', payload);
      setAberto(false);
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Erro ao salvar');
    }
  }

  async function remover(id: number) {
    if (!confirm('Remover este material? (mantém histórico de orçamentos)')) return;
    try {
      await api.del(`/materiais/${id}`);
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Erro ao remover');
    }
  }

  function set<K extends keyof FormMat>(c: K, v: FormMat[K]) {
    setForm((f) => ({ ...f, [c]: v }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Materiais</h1>
        <Button onClick={novo}>Novo material</Button>
      </div>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}

      {aberto && (
        <Card titulo={editandoId ? 'Editar material' : 'Novo material'}>
          <form onSubmit={salvar} className="grid grid-cols-2 gap-4 md:grid-cols-3">
            <Field label="Nome">
              <Input value={form.nome} onChange={(e) => set('nome', e.target.value)} required />
            </Field>
            <Field label="Tipo">
              <Select value={form.tipo} onChange={(e) => set('tipo', e.target.value)}>
                {TIPOS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Cor">
              <Input value={form.cor} onChange={(e) => set('cor', e.target.value)} placeholder="Ex.: Azul" />
            </Field>
            <Field label="Preço por kg (€)">
              <Input type="number" min="0" step="0.01" value={form.precoKg} onChange={(e) => set('precoKg', e.target.value)} required />
            </Field>
            <Field label="Densidade (kg/g)">
              <Input type="number" min="0" step="0.01" value={form.densidade} onChange={(e) => set('densidade', e.target.value)} />
            </Field>
            <Field label="Desperdício/purga (%)">
              <Input type="number" min="0" max="100" step="1" value={form.taxaDesperdicioPct} onChange={(e) => set('taxaDesperdicioPct', e.target.value)} />
            </Field>
            <Field label="Estoque (g)">
              <Input type="number" min="0" step="1" value={form.estoqueG} onChange={(e) => set('estoqueG', e.target.value)} />
            </Field>
            <Field label="Estoque mínimo (g)">
              <Input type="number" min="0" step="1" value={form.estoqueMinimoG} onChange={(e) => set('estoqueMinimoG', e.target.value)} />
            </Field>
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
                <th className="py-2 pr-4">Tipo</th>
                <th className="py-2 pr-4">Cor</th>
                <th className="py-2 pr-4">Preço/kg</th>
                <th className="py-2 pr-4">Desperdício</th>
                <th className="py-2 pr-4">Estoque</th>
                <th className="py-2 pr-4">Ações</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((m) => (
                <tr key={m.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-4 font-medium text-slate-700 dark:text-slate-200">{m.nome}</td>
                  <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">{m.tipo}</td>
                  <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">{m.cor || '—'}</td>
                  <td className="py-2 pr-4">{eur(m.precoKg)}</td>
                  <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">{pct(m.taxaDesperdicio)}</td>
                  <td className="py-2 pr-4">
                    <span className={m.estoqueBaixo ? 'font-medium text-amber-600' : 'text-slate-700 dark:text-slate-200'}>
                      {m.estoqueG.toFixed(0)} g
                    </span>
                    {m.estoqueBaixo && <span className="ml-1 text-xs text-amber-500">(baixo)</span>}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex gap-2">
                      <Button variante="secundario" className="px-2 py-1" onClick={() => editar(m)}>
                        Editar
                      </Button>
                      <Button variante="perigo" className="px-2 py-1" onClick={() => remover(m.id)}>
                        Remover
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {itens.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-slate-400 dark:text-slate-500">
                    Nenhum material cadastrado.
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
