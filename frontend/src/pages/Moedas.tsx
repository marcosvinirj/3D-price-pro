import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import { useMoeda, type Moeda } from '../lib/moeda';
import { Alerta, Button, Card, Field, Input } from '../components/ui';

export function MoedasPage() {
  const { moedas, recarregar } = useMoeda();
  const [codigo, setCodigo] = useState('');
  const [nome, setNome] = useState('');
  const [simbolo, setSimbolo] = useState('');
  const [taxa, setTaxa] = useState('');
  const [editando, setEditando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function limpar() {
    setCodigo('');
    setNome('');
    setSimbolo('');
    setTaxa('');
    setEditando(null);
    setErro(null);
  }

  function editar(m: Moeda) {
    setCodigo(m.codigo);
    setNome(m.nome);
    setSimbolo(m.simbolo);
    setTaxa(String(m.taxaParaBase));
    setEditando(m.codigo);
    setErro(null);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      if (editando) {
        await api.patch(`/moedas/${editando}`, {
          nome,
          simbolo,
          taxaParaBase: Number(taxa),
        });
      } else {
        await api.post('/moedas', {
          codigo,
          nome,
          simbolo,
          taxaParaBase: Number(taxa),
        });
      }
      limpar();
      recarregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Erro ao salvar');
    }
  }

  async function remover(cod: string) {
    if (!confirm(`Remover a moeda ${cod}?`)) return;
    try {
      await api.del(`/moedas/${cod}`);
      if (editando === cod) limpar();
      recarregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : 'Erro ao remover');
    }
  }

  const ehBase = editando ? moedas.find((m) => m.codigo === editando)?.base : false;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Moedas de exibição</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          O cálculo é sempre em € (moeda base); estas taxas apenas convertem os valores mostrados na
          tela e no PDF. Taxa = quanto vale <strong>1 unidade</strong> da moeda em euros.
        </p>
      </div>

      {erro && <Alerta tipo="erro">{erro}</Alerta>}

      <Card titulo={editando ? `Editar ${editando}` : 'Nova moeda'}>
        <form onSubmit={salvar} className="flex flex-wrap items-end gap-4">
          <div className="w-24">
            <Field label="Código">
              <Input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                maxLength={3}
                placeholder="USD"
                disabled={!!editando}
                required
              />
            </Field>
          </div>
          <div className="min-w-[160px] flex-1">
            <Field label="Nome">
              <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Dólar americano" required />
            </Field>
          </div>
          <div className="w-24">
            <Field label="Símbolo">
              <Input value={simbolo} onChange={(e) => setSimbolo(e.target.value)} placeholder="US$" maxLength={4} required />
            </Field>
          </div>
          <div className="w-40">
            <Field label="Taxa (€ por unidade)">
              <Input
                type="number"
                min="0"
                step="0.0001"
                value={taxa}
                onChange={(e) => setTaxa(e.target.value)}
                disabled={ehBase}
                required
              />
            </Field>
          </div>
          <Button type="submit">{editando ? 'Salvar' : 'Adicionar'}</Button>
          {editando && (
            <Button type="button" variante="secundario" onClick={limpar}>
              Cancelar
            </Button>
          )}
        </form>
        {ehBase && <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">A moeda base (EUR) sempre tem taxa 1.</p>}
      </Card>

      <Card>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-700 text-left text-slate-500 dark:text-slate-400">
              <th className="py-2 pr-4">Código</th>
              <th className="py-2 pr-4">Nome</th>
              <th className="py-2 pr-4">Símbolo</th>
              <th className="py-2 pr-4">Taxa (€)</th>
              <th className="py-2 pr-4">Ações</th>
            </tr>
          </thead>
          <tbody>
            {moedas.map((m) => (
              <tr key={m.codigo} className="border-b border-slate-100 dark:border-slate-800">
                <td className="py-2 pr-4 font-medium text-slate-700 dark:text-slate-200">
                  {m.codigo}
                  {m.base && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700 dark:text-brand-300">base</span>}
                </td>
                <td className="py-2 pr-4 text-slate-600 dark:text-slate-300">{m.nome}</td>
                <td className="py-2 pr-4">{m.simbolo}</td>
                <td className="py-2 pr-4 tabular-nums">{m.taxaParaBase.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                <td className="py-2 pr-4">
                  <div className="flex gap-2">
                    <Button variante="secundario" className="px-2 py-1" onClick={() => editar(m)}>
                      Editar
                    </Button>
                    {!m.base && (
                      <Button variante="perigo" className="px-2 py-1" onClick={() => remover(m.codigo)}>
                        Remover
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
