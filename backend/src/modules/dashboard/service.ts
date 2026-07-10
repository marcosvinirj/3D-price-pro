/**
 * Metricas agregadas para o dashboard. Le os snapshots dos orcamentos
 * (resultadoJson/entradaJson) e resume — sem recalcular precos.
 */
import { prisma } from '../../db/prisma.js';
import type { ResultadoPrecificacao } from '../../pricing/index.js';

interface EntradaSnapshot {
  material: { taxaDesperdicio: number };
}

const media = (ns: number[]) => (ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : 0);

/** Chave "AAAA-MM" e rotulo curto de um mes. */
function chaveMes(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function obterMetricas() {
  const orcamentos = await prisma.orcamento.findMany({
    include: {
      material: { select: { nome: true } },
      impressora: { select: { nome: true } },
    },
    orderBy: { criadoEm: 'asc' },
  });

  const aprovados = orcamentos.filter((o) => o.status === 'aprovado');

  // Snapshots parseados uma vez.
  const parsed = orcamentos.map((o) => ({
    o,
    resultado: JSON.parse(o.resultadoJson) as ResultadoPrecificacao,
    entrada: JSON.parse(o.entradaJson) as EntradaSnapshot,
  }));
  const parsedAprovados = parsed.filter((p) => p.o.status === 'aprovado');

  const consumoDe = (p: (typeof parsed)[number]) =>
    p.o.pesoG * (1 + p.entrada.material.taxaDesperdicio);

  // Consumo do mes corrente (apenas aprovados, pela data de aprovacao).
  const agora = new Date();
  const mesAtual = chaveMes(agora);
  const consumoMesG = parsedAprovados
    .filter((p) => p.o.aprovadoEm && chaveMes(new Date(p.o.aprovadoEm)) === mesAtual)
    .reduce((s, p) => s + consumoDe(p), 0);

  // Consumo por material (aprovados).
  const porMaterial = new Map<string, number>();
  for (const p of parsedAprovados) {
    const nome = p.o.material.nome;
    porMaterial.set(nome, (porMaterial.get(nome) ?? 0) + consumoDe(p));
  }
  const consumoPorMaterial = [...porMaterial.entries()]
    .map(([material, gramas]) => ({ material, gramas: Math.round(gramas * 10) / 10 }))
    .sort((a, b) => b.gramas - a.gramas);

  // Serie dos ultimos 6 meses: emitidos, faturamento e lucro (aprovados).
  const meses: { mes: string; emitidos: number; faturamento: number; lucro: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    const chave = chaveMes(d);
    const doMes = parsed.filter((p) => chaveMes(new Date(p.o.criadoEm)) === chave);
    const aprovadosMes = doMes.filter((p) => p.o.status === 'aprovado');
    const faturamento = aprovadosMes.reduce((s, p) => s + p.o.precoCobrado, 0);
    const lucro = aprovadosMes.reduce((s, p) => s + p.resultado.margem.lucro, 0);
    meses.push({
      mes: d.toLocaleDateString('pt-BR', { month: 'short' }),
      emitidos: doMes.length,
      faturamento: Math.round(faturamento * 100) / 100,
      lucro: Math.round(lucro * 100) / 100,
    });
  }

  // Custos por categoria (soma sobre todos os orcamentos, dos snapshots).
  const catAcc = { material: 0, energia: 0, depreciacao: 0, maoDeObra: 0, custoFixo: 0, variavel: 0 };
  for (const p of parsed) {
    const c = p.resultado.custos;
    catAcc.material += c.custoMaterial;
    catAcc.energia += c.custoEnergia;
    catAcc.depreciacao += c.depreciacao;
    catAcc.maoDeObra += c.maoDeObra;
    catAcc.custoFixo += c.custoFixoRateado;
    catAcc.variavel += c.custoVariavel ?? 0;
  }
  const custosPorCategoria = [
    { categoria: 'Material', valor: catAcc.material },
    { categoria: 'Energia', valor: catAcc.energia },
    { categoria: 'Depreciação', valor: catAcc.depreciacao },
    { categoria: 'Mão de obra', valor: catAcc.maoDeObra },
    { categoria: 'Custo fixo', valor: catAcc.custoFixo },
    { categoria: 'Variáveis', valor: catAcc.variavel },
  ]
    .map((x) => ({ categoria: x.categoria, valor: Math.round(x.valor * 100) / 100 }))
    .filter((x) => x.valor > 0)
    .sort((a, b) => b.valor - a.valor);

  // Producao por impressora: quantidade emitida e faturamento aprovado.
  const porImp = new Map<string, { pecas: number; faturamento: number }>();
  for (const p of parsed) {
    const nome = p.o.impressora.nome;
    const cur = porImp.get(nome) ?? { pecas: 0, faturamento: 0 };
    cur.pecas += 1;
    if (p.o.status === 'aprovado') cur.faturamento += p.o.precoCobrado;
    porImp.set(nome, cur);
  }
  const producaoPorImpressora = [...porImp.entries()]
    .map(([impressora, v]) => ({
      impressora,
      pecas: v.pecas,
      faturamento: Math.round(v.faturamento * 100) / 100,
    }))
    .sort((a, b) => b.pecas - a.pecas);

  return {
    totais: {
      orcamentos: orcamentos.length,
      pendentes: orcamentos.filter((o) => o.status === 'pendente').length,
      aprovados: aprovados.length,
      recusados: orcamentos.filter((o) => o.status === 'recusado').length,
    },
    financeiro: {
      faturamentoAprovado:
        Math.round(aprovados.reduce((s, o) => s + o.precoCobrado, 0) * 100) / 100,
      lucroAprovado:
        Math.round(parsedAprovados.reduce((s, p) => s + p.resultado.margem.lucro, 0) * 100) / 100,
      custoMedioPorPeca:
        Math.round(media(parsed.map((p) => p.resultado.custos.custoComFalha)) * 100) / 100,
      precoMedio: Math.round(media(parsed.map((p) => p.o.precoFinal)) * 100) / 100,
    },
    margem: {
      realMedia: Math.round(media(parsed.map((p) => p.resultado.margem.real)) * 1000) / 1000,
      planejadaMedia:
        Math.round(media(parsed.map((p) => p.resultado.margem.planejada)) * 1000) / 1000,
    },
    consumoMesG: Math.round(consumoMesG * 10) / 10,
    consumoPorMaterial,
    custosPorCategoria,
    producaoPorImpressora,
    porMes: meses,
  };
}

export type Metricas = Awaited<ReturnType<typeof obterMetricas>>;
