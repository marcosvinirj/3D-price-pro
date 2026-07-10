import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import type { CustoVariavel } from '../lib/types';
import { Alerta, eur, Button, Card, Field, Input } from '../components/ui';

export function CustosVariaveisPage() {
  const [itens, setItens] = useState<CustoVariavel[]>([]);
  const [nome, setNome] = useState('');
  const [valor, setValor] = useState('');
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar() {
    try {
      setItens(await api.get<CustoVariavel[]>('/custos-variaveis'));
      setErro(null);
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Erro ao carregar');
    }
  }
  useEffect(() => {
    carregar();
  }, []);

  function limpar() {
    setNome('');
    setValor('');
    setEditandoId(null);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const payload = { nome, valorUnitario: Number(valor) };
    try {
      if (editandoId) await api.patch(`/custos-variaveis/${editandoId}`, payload);
      else await api.post('/custos-variaveis', payload);
      limpar();
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Erro ao salvar');
    }
  }

  async function remover(id: number) {
    if (!confirm('Remover este custo variável?')) return;
    try {
      await api.del(`/custos-variaveis/${id}`);
      if (editandoId === id) limpar();
      await carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Erro ao remover');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Custos variáveis</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Consumíveis por peça (cola, embalagem, etiqueta, frete…). Selecione-os em cada orçamento.
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-slate-500 dark:text-slate-400">Itens cadastrados</div>
          <div className="text-xl font-bold text-slate-800 dark:text-slate-100">{itens.length}</div>
        </div>
      </div>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}

      <Card titulo={editandoId ? 'Editar custo variável' : 'Novo custo variável'}>
        <form onSubmit={salvar} className="flex flex-wrap items-end gap-4">
          <div className="min-w-[200px] flex-1">
            <Field label="Descrição">
              <Input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Embalagem, etiqueta, frete..."
                required
              />
            </Field>
          </div>
          <div className="w-40">
            <Field label="Custo por peça (€)">
              <Input
                type="number"
                min="0"
                step="0.01"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                required
              />
            </Field>
          </div>
          <Button type="submit">{editandoId ? 'Salvar' : 'Adicionar'}</Button>
          {editandoId && (
            <Button type="button" variante="secundario" onClick={limpar}>
              Cancelar
            </Button>
          )}
        </form>
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
              <th className="py-2 pr-4">Descrição</th>
              <th className="py-2 pr-4">Custo por peça</th>
              <th className="py-2 pr-4">Ações</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((c) => (
              <tr key={c.id} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2 pr-4 font-medium text-slate-700 dark:text-slate-200">{c.nome}</td>
                <td className="py-2 pr-4">{eur(c.valorUnitario)}</td>
                <td className="py-2 pr-4">
                  <div className="flex gap-2">
                    <Button
                      variante="secundario"
                      className="px-2 py-1"
                      onClick={() => {
                        setNome(c.nome);
                        setValor(String(c.valorUnitario));
                        setEditandoId(c.id);
                      }}
                    >
                      Editar
                    </Button>
                    <Button variante="perigo" className="px-2 py-1" onClick={() => remover(c.id)}>
                      Remover
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {itens.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-center text-slate-400 dark:text-slate-500">
                  Nenhum custo variável cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
