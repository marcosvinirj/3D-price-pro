import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError } from '../lib/api';
import type { Configuracao } from '../lib/types';
import { Alerta, Button, Card, Field, Input } from '../components/ui';

type FormCfg = {
  precoKwh: string;
  valorHoraTrabalho: string;
  horasProdutivasMes: string;
  margemMinimaPct: string;
};

export function ConfiguracaoPage() {
  const [form, setForm] = useState<FormCfg | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Configuracao>('/configuracao')
      .then((c) =>
        setForm({
          precoKwh: String(c.precoKwh),
          valorHoraTrabalho: String(c.valorHoraTrabalho),
          horasProdutivasMes: String(c.horasProdutivasMes),
          margemMinimaPct: String(c.margemMinima * 100),
        }),
      )
      .catch((e) => setErro(e instanceof ApiError ? e.message : 'Erro ao carregar'));
  }, []);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setMsg(null);
    setErro(null);
    try {
      await api.patch('/configuracao', {
        precoKwh: Number(form.precoKwh),
        valorHoraTrabalho: Number(form.valorHoraTrabalho),
        horasProdutivasMes: Number(form.horasProdutivasMes),
        margemMinima: Number(form.margemMinimaPct) / 100,
      });
      setMsg('Configuração salva.');
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Erro ao salvar');
    }
  }

  function set<K extends keyof FormCfg>(c: K, v: FormCfg[K]) {
    setForm((f) => (f ? { ...f, [c]: v } : f));
    setMsg(null);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Configuração de precificação</h1>
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
      {msg && <Alerta tipo="sucesso">{msg}</Alerta>}

      {form && (
        <Card>
          <form onSubmit={salvar} className="grid grid-cols-2 gap-4">
            <Field label="Preço da energia (€/kWh)">
              <Input type="number" min="0" step="0.01" value={form.precoKwh} onChange={(e) => set('precoKwh', e.target.value)} required />
            </Field>
            <Field label="Valor da hora de trabalho (€)">
              <Input type="number" min="0" step="0.01" value={form.valorHoraTrabalho} onChange={(e) => set('valorHoraTrabalho', e.target.value)} required />
            </Field>
            <Field label="Horas produtivas por mês">
              <Input type="number" min="1" step="1" value={form.horasProdutivasMes} onChange={(e) => set('horasProdutivasMes', e.target.value)} required />
            </Field>
            <Field label="Margem mínima sobre o preço (%)">
              <Input type="number" min="0" max="99" step="1" value={form.margemMinimaPct} onChange={(e) => set('margemMinimaPct', e.target.value)} required />
            </Field>
            <p className="col-span-2 text-xs text-slate-500 dark:text-slate-400">
              A margem mínima bloqueia salvar orçamentos com lucro abaixo dela — é a fatia do{' '}
              <strong>preço de venda</strong> que fica de lucro (não um % somado sobre o custo), por
              isso precisa ser menor que 100%. O custo fixo é rateado por hora produtiva (custos
              fixos ÷ horas produtivas no mês) e multiplicado pelo tempo de impressão da peça.
            </p>
            <div className="col-span-2">
              <Button type="submit">Salvar configuração</Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
