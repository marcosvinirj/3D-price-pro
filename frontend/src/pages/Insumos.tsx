import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import type { Insumo } from '../lib/types';
import { Alerta, eur, Button, Card, Field, Input } from '../components/ui';

type FormInsumo = {
  nome: string;
  valorUnitario: string;
  estoqueUnidades: string;
  estoqueMinimoUnidades: string;
};

const vazio: FormInsumo = {
  nome: '',
  valorUnitario: '',
  estoqueUnidades: '0',
  estoqueMinimoUnidades: '0',
};

export function InsumosPage() {
  const [itens, setItens] = useState<Insumo[]>([]);
  const [form, setForm] = useState<FormInsumo>(vazio);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    try {
      setItens(await api.get<Insumo[]>('/insumos'));
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

  function editar(i: Insumo) {
    setForm({
      nome: i.nome,
      valorUnitario: String(i.valorUnitario),
      estoqueUnidades: String(i.estoqueUnidades),
      estoqueMinimoUnidades: String(i.estoqueMinimoUnidades),
    });
    setEditandoId(i.id);
    setAberto(true);
    setErro(null);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const payload = {
      nome: form.nome,
      valorUnitario: Number(form.valorUnitario),
      estoqueUnidades: Number(form.estoqueUnidades),
      estoqueMinimoUnidades: Number(form.estoqueMinimoUnidades),
    };
    try {
      if (editandoId) await api.patch(`/insumos/${editandoId}`, payload);
      else await api.post('/insumos', payload);
      setAberto(false);
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Erro ao salvar');
    }
  }

  async function remover(id: number) {
    if (!confirm('Remover este insumo? (mantém histórico de orçamentos)')) return;
    try {
      await api.del(`/insumos/${id}`);
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Erro ao remover');
    }
  }

  function set<K extends keyof FormInsumo>(c: K, v: FormInsumo[K]) {
    setForm((f) => ({ ...f, [c]: v }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Insumos</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Consumíveis por peça (argola, escovinha, saco zip...). Ao contrário de Custos Variáveis, o
            consumo de um insumo multiplica pela quantidade de peças que o usam no orçamento.
          </p>
        </div>
        <Button onClick={novo}>Novo insumo</Button>
      </div>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}

      {aberto && (
        <Card titulo={editandoId ? 'Editar insumo' : 'Novo insumo'}>
          <form onSubmit={salvar} className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="col-span-2 md:col-span-1">
              <Field label="Nome">
                <Input value={form.nome} onChange={(e) => set('nome', e.target.value)} placeholder="Ex.: Argola" required />
              </Field>
            </div>
            <Field label="Custo por unidade (€)">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.valorUnitario}
                onChange={(e) => set('valorUnitario', e.target.value)}
                required
              />
            </Field>
            <Field label="Estoque (unidades)">
              <Input
                type="number"
                min="0"
                step="1"
                value={form.estoqueUnidades}
                onChange={(e) => set('estoqueUnidades', e.target.value)}
              />
            </Field>
            <Field label="Estoque mínimo (unidades)">
              <Input
                type="number"
                min="0"
                step="1"
                value={form.estoqueMinimoUnidades}
                onChange={(e) => set('estoqueMinimoUnidades', e.target.value)}
              />
            </Field>
            <div className="col-span-2 flex items-end gap-2 md:col-span-4">
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
                <th className="py-2 pr-4">Custo/unidade</th>
                <th className="py-2 pr-4">Estoque</th>
                <th className="py-2 pr-4">Ações</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-2 pr-4 font-medium text-slate-700 dark:text-slate-200">{i.nome}</td>
                  <td className="py-2 pr-4">{eur(i.valorUnitario)}</td>
                  <td className="py-2 pr-4">
                    <span className={i.estoqueBaixo ? 'font-medium text-amber-600' : 'text-slate-700 dark:text-slate-200'}>
                      {i.estoqueUnidades.toLocaleString('pt-BR')} un.
                    </span>
                    {i.estoqueBaixo && <span className="ml-1 text-xs text-amber-500">(baixo)</span>}
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
                  <td colSpan={4} className="py-4 text-center text-slate-400 dark:text-slate-500">
                    Nenhum insumo cadastrado.
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
