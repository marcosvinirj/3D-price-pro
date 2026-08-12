/**
 * Servico de orcamentos: orquestra o motor de precificacao com os dados
 * cadastrados (materiais, impressora, custos, config) e aplica as regras de
 * negocio que dependem de persistencia (2, 4, 5, 6).
 *
 * Um orcamento pode ter VARIAS pecas (ex.: "Cauda", "Torso" de um modelo
 * impresso em partes), cada uma com seu proprio material/cor. Impressora e
 * parametros (falha, margem, desconto, custos variaveis) sao compartilhados
 * por todas as pecas do orcamento.
 */
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { naoEncontrado, conflito, regraDeNegocio } from '../../http/errors.js';
import { precificarMultiplo, type ResultadoPrecificacaoMultipla } from '../../pricing/index.js';
import { arredondamentoSchema, descontoSchema } from '../../pricing/schema.js';
import { obterConfiguracao } from '../configuracao/service.js';

/** Um insumo usado nesta peca, com a quantidade usada POR UNIDADE (ex.: 1 argola por canudo). */
const itemInsumoInputSchema = z.object({
  insumoId: z.number().int().positive(),
  quantidade: z.number().int().positive(),
});

const itemInputSchema = z.object({
  nome: z.string().trim().min(1).max(120).optional(),
  materialId: z.number().int().positive(),
  pesoG: z.number().positive(),
  tempoImpressaoH: z.number().nonnegative(),
  tempoPosProcessamentoH: z.number().nonnegative(),
  /** Unidades identicas que esta peca representa (25 canudos = 25). Peso e
   *  insumos escalam por ela; tempo de impressao/pos-processamento NAO. */
  quantidade: z.number().int().positive().default(1),
  insumos: z.array(itemInsumoInputSchema).optional(),
});

/** Entrada de um calculo/orcamento vinda da API. */
export const orcamentoInputSchema = z.object({
  impressoraId: z.number().int().positive(),
  itens: z.array(itemInputSchema).min(1, 'Pelo menos uma peca e obrigatoria'),
  parametros: z.object({
    taxaFalha: z.number().min(0).max(1),
    margemLucro: z.number().min(0).max(100),
  }),
  desconto: descontoSchema.optional(),
  arredondamento: arredondamentoSchema.optional(),
  /** IDs dos custos variaveis (embalagem, frete...) selecionados para o orcamento inteiro. */
  custosVariaveisIds: z.array(z.number().int().positive()).optional(),
  cliente: z.string().optional(),
  telefone: z.string().optional(),
  descricaoPeca: z.string().optional(),
});

export type OrcamentoInput = z.infer<typeof orcamentoInputSchema>;

/** Uso de um insumo dentro de uma peca calculada, ja com o total (por peca * quantidade). */
interface InsumoUsadoCalculado {
  insumoId: number;
  insumoNome: string;
  quantidadePorPeca: number;
  valorUnitarioSnapshot: number;
  /** quantidadePorPeca * quantidade do item — o que efetivamente sai do estoque. */
  totalUnidades: number;
  estoqueUnidades: number;
}

interface ItemCalculado {
  nome: string | null;
  materialId: number;
  pesoG: number;
  tempoImpressaoH: number;
  tempoPosProcessamentoH: number;
  quantidade: number;
  consumoG: number;
  custoItem: number;
  materialEstoqueG: number;
  materialNome: string;
  insumosUsados: InsumoUsadoCalculado[];
}

/** Carrega dependencias (do usuario dono) e monta a entrada do motor de precificacao. */
async function montarCalculo(input: OrcamentoInput, usuarioId: number) {
  const idsVariaveis = input.custosVariaveisIds ?? [];
  const idsMateriais = [...new Set(input.itens.map((i) => i.materialId))];
  const idsInsumos = [...new Set(input.itens.flatMap((i) => (i.insumos ?? []).map((x) => x.insumoId)))];

  const [materiais, impressora, config, custosFixos, custosVariaveis, insumos] = await Promise.all([
    prisma.material.findMany({ where: { id: { in: idsMateriais }, usuarioId } }),
    prisma.impressora.findFirst({ where: { id: input.impressoraId, usuarioId } }),
    obterConfiguracao(usuarioId),
    prisma.custoFixo.findMany({ where: { usuarioId } }),
    idsVariaveis.length
      ? prisma.custoVariavel.findMany({ where: { id: { in: idsVariaveis }, usuarioId } })
      : Promise.resolve([]),
    idsInsumos.length
      ? prisma.insumo.findMany({ where: { id: { in: idsInsumos }, usuarioId } })
      : Promise.resolve([]),
  ]);

  if (!impressora) throw naoEncontrado('Impressora');

  // Mapa id->material/insumo; a ordem de exibicao/calculo segue SEMPRE
  // input.itens, nunca a ordem devolvida pelo findMany (que nao e' garantida).
  const materiaisPorId = new Map(materiais.map((m) => [m.id, m]));
  const insumosPorId = new Map(insumos.map((i) => [i.id, i]));
  for (const it of input.itens) {
    if (!materiaisPorId.has(it.materialId)) throw naoEncontrado(`Material (id ${it.materialId})`);
    for (const iu of it.insumos ?? []) {
      if (!insumosPorId.has(iu.insumoId)) throw naoEncontrado(`Insumo (id ${iu.insumoId})`);
    }
  }

  const custosFixosMensais = custosFixos.reduce((s, c) => s + c.valorMensal, 0);
  const custoVariavel = custosVariaveis.reduce((s, c) => s + c.valorUnitario, 0);

  const entradaMotor = {
    itens: input.itens.map((it) => {
      const m = materiaisPorId.get(it.materialId)!;
      return {
        ...(it.nome ? { nome: it.nome } : {}),
        peca: {
          pesoG: it.pesoG,
          tempoImpressaoH: it.tempoImpressaoH,
          tempoPosProcessamentoH: it.tempoPosProcessamentoH,
          quantidade: it.quantidade,
          insumos: (it.insumos ?? []).map((iu) => {
            const ins = insumosPorId.get(iu.insumoId)!;
            return { valorUnitario: ins.valorUnitario, quantidade: iu.quantidade };
          }),
        },
        material: { precoKg: m.precoKg, taxaDesperdicio: m.taxaDesperdicio },
      };
    }),
    impressora: {
      potenciaW: impressora.potenciaW,
      valorAquisicao: impressora.valorAquisicao,
      vidaUtilH: impressora.vidaUtilH,
    },
    custos: {
      precoKwh: config.precoKwh,
      valorHoraTrabalho: config.valorHoraTrabalho,
      custosFixosMensais,
      horasProdutivasMes: config.horasProdutivasMes,
      custoVariavel,
    },
    parametros: {
      taxaFalha: input.parametros.taxaFalha,
      margemLucro: input.parametros.margemLucro,
      margemMinima: config.margemMinima,
    },
    ...(input.desconto ? { desconto: input.desconto } : {}),
    ...(input.arredondamento ? { arredondamento: input.arredondamento } : {}),
  };

  const resultado = precificarMultiplo(entradaMotor);

  const itensCalculados: ItemCalculado[] = input.itens.map((it, idx) => {
    const m = materiaisPorId.get(it.materialId)!;
    // Consumo de material tambem escala pela quantidade — cada unidade da
    // peca gasta seu proprio material.
    const consumoG = it.pesoG * (1 + m.taxaDesperdicio) * it.quantidade;
    const insumosUsados: InsumoUsadoCalculado[] = (it.insumos ?? []).map((iu) => {
      const ins = insumosPorId.get(iu.insumoId)!;
      return {
        insumoId: iu.insumoId,
        insumoNome: ins.nome,
        quantidadePorPeca: iu.quantidade,
        valorUnitarioSnapshot: ins.valorUnitario,
        totalUnidades: iu.quantidade * it.quantidade,
        estoqueUnidades: ins.estoqueUnidades,
      };
    });
    return {
      nome: it.nome ?? null,
      materialId: it.materialId,
      pesoG: it.pesoG,
      tempoImpressaoH: it.tempoImpressaoH,
      tempoPosProcessamentoH: it.tempoPosProcessamentoH,
      quantidade: it.quantidade,
      consumoG,
      custoItem: resultado.itens[idx]!.custoItemTotal,
      materialEstoqueG: m.estoqueG,
      materialNome: m.nome,
      insumosUsados,
    };
  });

  return { impressora, entradaMotor, resultado, itensCalculados };
}

/** Monta a mensagem de aviso de estoque insuficiente — material e insumos (ou null se tudo ok). */
function avisoEstoque(itensCalculados: ItemCalculado[]): string | null {
  const avisos: string[] = [];

  const materiaisInsuficientes = itensCalculados.filter((it) => it.materialEstoqueG < it.consumoG);
  if (materiaisInsuficientes.length) {
    avisos.push(
      materiaisInsuficientes
        .map(
          (it) =>
            `${it.nome ?? it.materialNome} (precisa de ${it.consumoG.toFixed(1)}g, ha ${it.materialEstoqueG.toFixed(1)}g)`,
        )
        .join('; '),
    );
  }

  const insumosInsuficientes = itensCalculados.flatMap((it) =>
    it.insumosUsados
      .filter((iu) => iu.estoqueUnidades < iu.totalUnidades)
      .map(
        (iu) =>
          `${iu.insumoNome} p/ ${it.nome ?? 'peça'} (precisa de ${iu.totalUnidades}, ha ${iu.estoqueUnidades})`,
      ),
  );
  if (insumosInsuficientes.length) avisos.push(insumosInsuficientes.join('; '));

  if (!avisos.length) return null;
  return `Estoque insuficiente para aprovar: ${avisos.join('; ')}.`;
}

/** Simulador "e se": calcula sem persistir. */
export async function simular(
  input: OrcamentoInput,
  usuarioId: number,
): Promise<{
  resultado: ResultadoPrecificacaoMultipla;
  itens: {
    materialId: number;
    consumoG: number;
    estoqueSuficiente: boolean;
    insumos: { insumoId: number; totalUnidades: number; estoqueSuficiente: boolean }[];
  }[];
  estoqueSuficiente: boolean;
}> {
  const { resultado, itensCalculados } = await montarCalculo(input, usuarioId);
  const itens = itensCalculados.map((it) => ({
    materialId: it.materialId,
    consumoG: it.consumoG,
    estoqueSuficiente: it.materialEstoqueG >= it.consumoG,
    insumos: it.insumosUsados.map((iu) => ({
      insumoId: iu.insumoId,
      totalUnidades: iu.totalUnidades,
      estoqueSuficiente: iu.estoqueUnidades >= iu.totalUnidades,
    })),
  }));
  const estoqueSuficiente = itens.every(
    (i) => i.estoqueSuficiente && i.insumos.every((x) => x.estoqueSuficiente),
  );
  return { resultado, itens, estoqueSuficiente };
}

/**
 * Cria um orcamento (status pendente), gravando snapshots imutaveis (regras
 * 5 e 6). Bloqueia se a margem do preco de tabela furar a minima (regra 2).
 * NAO baixa estoque aqui — a baixa ocorre na aprovacao (regra 4).
 */
export async function criarOrcamento(input: OrcamentoInput, usuarioId: number) {
  const { entradaMotor, resultado, itensCalculados } = await montarCalculo(input, usuarioId);

  // Regra 2: nao permitir salvar preco com margem abaixo da minima.
  if (!resultado.margem.atingeMinima) {
    throw regraDeNegocio(
      `Margem do preco de tabela (${(resultado.margem.aposArredondamento * 100).toFixed(
        1,
      )}%) abaixo da minima (${(resultado.margem.minima * 100).toFixed(1)}%).`,
      { margem: resultado.margem },
    );
  }

  const orcamento = await prisma.orcamento.create({
    data: {
      cliente: input.cliente ?? null,
      telefone: input.telefone ?? null,
      descricaoPeca: input.descricaoPeca ?? null,
      status: 'pendente',
      entradaJson: JSON.stringify(entradaMotor),
      resultadoJson: JSON.stringify(resultado),
      precoFinal: resultado.precoFinal,
      precoCobrado: resultado.precoCobrado,
      impressoraId: input.impressoraId,
      usuarioId,
      itens: {
        create: itensCalculados.map((it, idx) => ({
          nome: it.nome,
          materialId: it.materialId,
          pesoG: it.pesoG,
          tempoImpressaoH: it.tempoImpressaoH,
          tempoPosProcessamentoH: it.tempoPosProcessamentoH,
          quantidade: it.quantidade,
          consumoG: it.consumoG,
          custoItem: it.custoItem,
          ordem: idx,
          insumos: {
            create: it.insumosUsados.map((iu) => ({
              insumoId: iu.insumoId,
              quantidadePorPeca: iu.quantidadePorPeca,
              valorUnitarioSnapshot: iu.valorUnitarioSnapshot,
            })),
          },
        })),
      },
    },
    include: {
      itens: { include: { material: true, insumos: { include: { insumo: true } } }, orderBy: { ordem: 'asc' } },
    },
  });

  return { orcamento, resultado, aviso: avisoEstoque(itensCalculados) };
}

/**
 * Edita um orcamento PENDENTE: recalcula tudo com a nova entrada (mesmas
 * checagens de `criarOrcamento`) e substitui as pecas antigas pelas novas
 * numa transacao. Orcamentos aprovados/recusados nunca podem ser editados
 * (regra 5 — imutabilidade do aprovado).
 */
export async function editarOrcamento(id: number, input: OrcamentoInput, usuarioId: number) {
  const existente = await prisma.orcamento.findFirst({ where: { id, usuarioId } });
  if (!existente) throw naoEncontrado('Orcamento');
  if (existente.status !== 'pendente') {
    throw conflito('Somente orcamentos pendentes podem ser editados');
  }

  const { entradaMotor, resultado, itensCalculados } = await montarCalculo(input, usuarioId);

  if (!resultado.margem.atingeMinima) {
    throw regraDeNegocio(
      `Margem do preco de tabela (${(resultado.margem.aposArredondamento * 100).toFixed(
        1,
      )}%) abaixo da minima (${(resultado.margem.minima * 100).toFixed(1)}%).`,
      { margem: resultado.margem },
    );
  }

  // deleteMany cascata para OrcamentoItemInsumo (onDelete: Cascade no schema).
  // createMany nao suporta relacoes aninhadas (insumos por peca), por isso o
  // update abaixo recria as pecas via `itens: { create: [...] }`.
  const [, orcamento] = await prisma.$transaction([
    prisma.orcamentoItem.deleteMany({ where: { orcamentoId: id } }),
    prisma.orcamento.update({
      where: { id },
      data: {
        cliente: input.cliente ?? null,
        telefone: input.telefone ?? null,
        descricaoPeca: input.descricaoPeca ?? null,
        impressoraId: input.impressoraId,
        entradaJson: JSON.stringify(entradaMotor),
        resultadoJson: JSON.stringify(resultado),
        precoFinal: resultado.precoFinal,
        precoCobrado: resultado.precoCobrado,
        itens: {
          create: itensCalculados.map((it, idx) => ({
            nome: it.nome,
            materialId: it.materialId,
            pesoG: it.pesoG,
            tempoImpressaoH: it.tempoImpressaoH,
            tempoPosProcessamentoH: it.tempoPosProcessamentoH,
            quantidade: it.quantidade,
            consumoG: it.consumoG,
            custoItem: it.custoItem,
            ordem: idx,
            insumos: {
              create: it.insumosUsados.map((iu) => ({
                insumoId: iu.insumoId,
                quantidadePorPeca: iu.quantidadePorPeca,
                valorUnitarioSnapshot: iu.valorUnitarioSnapshot,
              })),
            },
          })),
        },
      },
      include: {
        itens: { include: { material: true, insumos: { include: { insumo: true } } }, orderBy: { ordem: 'asc' } },
      },
    }),
  ]);

  return { orcamento, resultado, aviso: avisoEstoque(itensCalculados) };
}

/**
 * Aprova um orcamento: baixa o estoque de CADA peca (regra 4 — nunca
 * negativo; verifica todas antes de baixar qualquer uma) e torna o registro
 * imutavel (regra 5). Idempotencia protegida por status.
 */
export async function aprovarOrcamento(id: number, usuarioId: number) {
  const orcamento = await prisma.orcamento.findFirst({
    where: { id, usuarioId },
    include: { itens: { include: { insumos: true } } },
  });
  if (!orcamento) throw naoEncontrado('Orcamento');
  if (orcamento.status === 'aprovado') throw conflito('Orcamento ja aprovado (imutavel)');
  if (orcamento.status === 'recusado') throw conflito('Orcamento recusado nao pode ser aprovado');

  const materiais = await prisma.material.findMany({
    where: { id: { in: orcamento.itens.map((i) => i.materialId) } },
  });
  const materiaisPorId = new Map(materiais.map((m) => [m.id, m]));

  const idsInsumos = [...new Set(orcamento.itens.flatMap((it) => it.insumos.map((iu) => iu.insumoId)))];
  const insumosAtuais = idsInsumos.length ? await prisma.insumo.findMany({ where: { id: { in: idsInsumos } } }) : [];
  const insumosPorId = new Map(insumosAtuais.map((i) => [i.id, i]));

  // Regra 4: verifica TODAS as pecas (material E insumos) antes de baixar qualquer uma.
  for (const it of orcamento.itens) {
    const m = materiaisPorId.get(it.materialId);
    if (!m) throw naoEncontrado('Material');
    if (m.estoqueG < it.consumoG) {
      throw regraDeNegocio(
        `Estoque insuficiente para "${it.nome ?? m.nome}": precisa de ${it.consumoG.toFixed(
          1,
        )}g, ha ${m.estoqueG.toFixed(1)}g.`,
      );
    }
    for (const iu of it.insumos) {
      const ins = insumosPorId.get(iu.insumoId);
      if (!ins) throw naoEncontrado('Insumo');
      const totalUnidades = iu.quantidadePorPeca * it.quantidade;
      if (ins.estoqueUnidades < totalUnidades) {
        throw regraDeNegocio(
          `Estoque insuficiente de "${ins.nome}" para "${it.nome ?? m.nome}": precisa de ${totalUnidades}, ha ${ins.estoqueUnidades}.`,
        );
      }
    }
  }

  // Um mesmo insumo pode ser usado em varias pecas do orcamento — soma antes
  // de baixar, para decrementar cada insumo uma unica vez.
  const decrementosInsumo = new Map<number, number>();
  for (const it of orcamento.itens) {
    for (const iu of it.insumos) {
      const total = iu.quantidadePorPeca * it.quantidade;
      decrementosInsumo.set(iu.insumoId, (decrementosInsumo.get(iu.insumoId) ?? 0) + total);
    }
  }

  // Transacao: baixa de estoque de materiais + insumos + mudanca de status sao atomicas.
  await prisma.$transaction([
    ...orcamento.itens.map((it) =>
      prisma.material.update({
        where: { id: it.materialId },
        data: { estoqueG: { decrement: it.consumoG } },
      }),
    ),
    ...[...decrementosInsumo.entries()].map(([insumoId, qtd]) =>
      prisma.insumo.update({ where: { id: insumoId }, data: { estoqueUnidades: { decrement: qtd } } }),
    ),
    prisma.orcamento.update({
      where: { id },
      data: { status: 'aprovado', estoqueBaixado: true, aprovadoEm: new Date() },
    }),
  ]);

  return prisma.orcamento.findFirstOrThrow({
    where: { id },
    include: {
      itens: { include: { material: true, insumos: { include: { insumo: true } } }, orderBy: { ordem: 'asc' } },
      impressora: true,
    },
  });
}

/**
 * Exclui um orcamento definitivamente. Se ja estava aprovado (estoque
 * baixado), devolve o consumo de cada peca ao estoque do respectivo
 * material antes de apagar — reverte por completo o efeito do orcamento.
 */
export async function excluirOrcamento(id: number, usuarioId: number) {
  const orcamento = await prisma.orcamento.findFirst({
    where: { id, usuarioId },
    include: { itens: { include: { insumos: true } } },
  });
  if (!orcamento) throw naoEncontrado('Orcamento');

  if (orcamento.estoqueBaixado) {
    const incrementosInsumo = new Map<number, number>();
    for (const it of orcamento.itens) {
      for (const iu of it.insumos) {
        const total = iu.quantidadePorPeca * it.quantidade;
        incrementosInsumo.set(iu.insumoId, (incrementosInsumo.get(iu.insumoId) ?? 0) + total);
      }
    }
    await prisma.$transaction([
      ...orcamento.itens.map((it) =>
        prisma.material.update({
          where: { id: it.materialId },
          data: { estoqueG: { increment: it.consumoG } },
        }),
      ),
      ...[...incrementosInsumo.entries()].map(([insumoId, qtd]) =>
        prisma.insumo.update({ where: { id: insumoId }, data: { estoqueUnidades: { increment: qtd } } }),
      ),
      prisma.orcamento.delete({ where: { id } }),
    ]);
  } else {
    await prisma.orcamento.delete({ where: { id } });
  }
}

/** Recusa um orcamento pendente. */
export async function recusarOrcamento(id: number, usuarioId: number) {
  const orcamento = await prisma.orcamento.findFirst({ where: { id, usuarioId } });
  if (!orcamento) throw naoEncontrado('Orcamento');
  if (orcamento.status === 'aprovado') throw conflito('Orcamento aprovado nao pode ser recusado');
  return prisma.orcamento.update({ where: { id }, data: { status: 'recusado' } });
}

export async function listarOrcamentos(usuarioId: number, status?: string) {
  return prisma.orcamento.findMany({
    where: status ? { usuarioId, status } : { usuarioId },
    orderBy: { criadoEm: 'desc' },
    include: {
      itens: { include: { material: { select: { nome: true, cor: true } } }, orderBy: { ordem: 'asc' } },
      impressora: { select: { nome: true } },
    },
  });
}

export async function obterOrcamento(id: number, usuarioId: number) {
  const orcamento = await prisma.orcamento.findFirst({
    where: { id, usuarioId },
    include: {
      itens: { include: { material: true, insumos: { include: { insumo: true } } }, orderBy: { ordem: 'asc' } },
      impressora: true,
    },
  });
  if (!orcamento) throw naoEncontrado('Orcamento');
  return { ...orcamento, resultado: JSON.parse(orcamento.resultadoJson) };
}
