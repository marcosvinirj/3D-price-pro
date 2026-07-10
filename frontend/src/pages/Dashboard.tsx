import { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { api, ApiError } from '../lib/api';
import type { Metricas } from '../lib/types';
import { Alerta, Card, gramas, pct, StatTile } from '../components/ui';
import { useMoeda } from '../lib/moeda';
import { useTema } from '../lib/theme';

// Paleta validada (dataviz): duas series categoricas (azul/verde) + tinta recessiva.
const AZUL = '#4f77ff';
const VERDE = '#12b886';
const ROXO = '#8b5cf6';
// Status (fixo, nunca tematizado): acompanha rotulo/valor, nunca cor sozinha.
const STATUS = { aprovado: '#0ca30c', pendente: '#fab219', recusado: '#898781' };

export function DashboardPage() {
  const { fmt } = useMoeda();
  const { tema } = useTema();
  const escuro = tema === 'escuro';
  // Tokens de grade/eixo que acompanham o tema (recessivos em ambos).
  const GRID = escuro ? '#232a3d' : '#e1e0d9';
  const EIXO = escuro ? '#3a4258' : '#c3c2b7';
  const MUTED = escuro ? '#8a93a6' : '#898781';
  const eixoTick = { fill: MUTED, fontSize: 12 };
  const [m, setM] = useState<Metricas | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Metricas>('/dashboard')
      .then(setM)
      .catch((e) => setErro(e instanceof ApiError ? e.message : 'Erro ao carregar métricas'));
  }, []);

  if (erro) return <Alerta tipo="erro">{erro}</Alerta>;
  if (!m) return <p className="text-sm text-slate-500 dark:text-slate-400">Carregando métricas...</p>;

  const deltaMargem = m.margem.realMedia - m.margem.planejadaMedia;

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Dashboard</h1>

      {/* Indicadores financeiros */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile rotulo="Faturamento (aprovados)" valor={fmt(m.financeiro.faturamentoAprovado)} detalhe={`Lucro ${fmt(m.financeiro.lucroAprovado)}`} />
        <StatTile rotulo="Custo médio / peça" valor={fmt(m.financeiro.custoMedioPorPeca)} detalhe={`Preço médio ${fmt(m.financeiro.precoMedio)}`} />
        <StatTile
          rotulo="Margem real média"
          valor={pct(m.margem.realMedia)}
          detalhe={`Planejada ${pct(m.margem.planejadaMedia)} · ${deltaMargem >= 0 ? '+' : ''}${(deltaMargem * 100).toFixed(1)} p.p.`}
          acento={deltaMargem >= -0.0001 ? STATUS.aprovado : STATUS.recusado}
        />
        <StatTile rotulo="Consumo no mês" valor={gramas(m.consumoMesG)} detalhe="Material baixado (aprovados)" />
      </div>

      {/* Status dos orçamentos */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatTile rotulo="Total orçamentos" valor={String(m.totais.orcamentos)} />
        <StatTile rotulo="Pendentes" valor={String(m.totais.pendentes)} acento={STATUS.pendente} />
        <StatTile rotulo="Aprovados" valor={String(m.totais.aprovados)} acento={STATUS.aprovado} />
        <StatTile rotulo="Recusados" valor={String(m.totais.recusados)} acento={STATUS.recusado} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Consumo por material — barras horizontais (magnitude por identidade) */}
        <Card titulo="Consumo por material (g)">
          {m.consumoPorMaterial.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">Sem consumo registrado ainda.</p>
          ) : (
            <div style={{ height: Math.max(120, m.consumoPorMaterial.length * 48) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={m.consumoPorMaterial} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis type="number" tick={eixoTick} tickLine={false} axisLine={{ stroke: EIXO }} />
                  <YAxis type="category" dataKey="material" tick={eixoTick} tickLine={false} axisLine={{ stroke: EIXO }} width={100} />
                  <Tooltip cursor={{ fill: 'rgba(42,120,214,0.06)' }} content={<TipConsumo />} />
                  <Bar dataKey="gramas" fill={AZUL} radius={[0, 4, 4, 0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Faturamento e lucro por mês — barras agrupadas (mudança no tempo) */}
        <Card titulo="Faturamento e lucro por mês (últimos 6)">
          <div className="mb-2 flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: AZUL }} /> Faturamento
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: VERDE }} /> Lucro
            </span>
          </div>
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={m.porMes} margin={{ left: 8, right: 8 }}>
                <CartesianGrid vertical={false} stroke={GRID} />
                <XAxis dataKey="mes" tick={eixoTick} tickLine={false} axisLine={{ stroke: EIXO }} />
                <YAxis tick={eixoTick} tickLine={false} axisLine={{ stroke: EIXO }} width={72} tickFormatter={(v) => fmt(v)} />
                <Tooltip cursor={{ fill: 'rgba(79,119,255,0.06)' }} content={<TipMes fmt={fmt} />} />
                <Bar dataKey="faturamento" fill={AZUL} radius={[4, 4, 0, 0]} barSize={16} />
                <Bar dataKey="lucro" fill={VERDE} radius={[4, 4, 0, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Custos por categoria — barras horizontais */}
        <Card titulo="Custos por categoria">
          {m.custosPorCategoria.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">Sem custos registrados ainda.</p>
          ) : (
            <div style={{ height: Math.max(140, m.custosPorCategoria.length * 40) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={m.custosPorCategoria} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis type="number" tick={eixoTick} tickLine={false} axisLine={{ stroke: EIXO }} tickFormatter={(v) => fmt(v)} />
                  <YAxis type="category" dataKey="categoria" tick={eixoTick} tickLine={false} axisLine={{ stroke: EIXO }} width={92} />
                  <Tooltip cursor={{ fill: 'rgba(139,92,246,0.06)' }} content={<TipCategoria fmt={fmt} />} />
                  <Bar dataKey="valor" fill={ROXO} radius={[0, 4, 4, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Produção por impressora — barras horizontais (peças) */}
        <Card titulo="Produção por impressora (peças)">
          {m.producaoPorImpressora.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400 dark:text-slate-500">Sem produção registrada ainda.</p>
          ) : (
            <div style={{ height: Math.max(140, m.producaoPorImpressora.length * 44) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={m.producaoPorImpressora} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid horizontal={false} stroke={GRID} />
                  <XAxis type="number" allowDecimals={false} tick={eixoTick} tickLine={false} axisLine={{ stroke: EIXO }} />
                  <YAxis type="category" dataKey="impressora" tick={eixoTick} tickLine={false} axisLine={{ stroke: EIXO }} width={100} />
                  <Tooltip cursor={{ fill: 'rgba(18,184,134,0.06)' }} content={<TipImpressora fmt={fmt} />} />
                  <Bar dataKey="pecas" fill={VERDE} radius={[0, 4, 4, 0]} barSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Tooltips: texto nos tokens de tinta, cor do valor apenas como referência da série. */
function caixa(children: React.ReactNode) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm shadow-md">
      {children}
    </div>
  );
}

function TipConsumo({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload as { material: string; gramas: number };
  return caixa(
    <>
      <div className="font-medium text-slate-700 dark:text-slate-200">{p.material}</div>
      <div className="text-slate-500 dark:text-slate-400">{gramas(p.gramas)}</div>
    </>,
  );
}

function TipMes({ active, payload, label, fmt }: TooltipProps<number, string> & { fmt: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload as { faturamento: number; lucro: number; emitidos: number };
  return caixa(
    <>
      <div className="font-medium text-slate-700 dark:text-slate-200">{label}</div>
      <div className="text-slate-500 dark:text-slate-400">Faturamento: {fmt(p.faturamento)}</div>
      <div className="text-slate-500 dark:text-slate-400">Lucro: {fmt(p.lucro)}</div>
      <div className="text-slate-400 dark:text-slate-500">{p.emitidos} orçamento(s) emitido(s)</div>
    </>,
  );
}

function TipCategoria({ active, payload, fmt }: TooltipProps<number, string> & { fmt: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload as { categoria: string; valor: number };
  return caixa(
    <>
      <div className="font-medium text-slate-700 dark:text-slate-200">{p.categoria}</div>
      <div className="text-slate-500 dark:text-slate-400">{fmt(p.valor)}</div>
    </>,
  );
}

function TipImpressora({ active, payload, fmt }: TooltipProps<number, string> & { fmt: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload as { impressora: string; pecas: number; faturamento: number };
  return caixa(
    <>
      <div className="font-medium text-slate-700 dark:text-slate-200">{p.impressora}</div>
      <div className="text-slate-500 dark:text-slate-400">{p.pecas} orçamento(s)</div>
      <div className="text-slate-400 dark:text-slate-500">Faturamento {fmt(p.faturamento)}</div>
    </>,
  );
}
