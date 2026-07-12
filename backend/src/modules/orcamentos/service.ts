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

const itemInputSchema = z.object({
  nome: z.string().trim().min(1).max(120).optional(),
  materialId: z.number().int().positive(),
  pesoG: z.number().positive(),
  tempoImpressaoH: z.number().nonnegative(),
  tempoPosProcessamentoH: z.number().nonnegative(),
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

interface ItemCalculado {
  nome: string | null;
  materialId: number;
  pesoG: number;
  tempoImpressaoH: number;
  tempoPosProcessamentoH: number;
  consumoG: number;
  custoItem: number;
  materialEstoqueG: number;
  materialNome: string;
}

/** Carrega dependencias (do usuario dono) e monta a entrada do motor de precificacao. */
async function montarCalculo(input: OrcamentoInput, usuarioId: number) {
  const idsVariaveis = input.custosVariaveisIds ?? [];
  const idsMateriais = [...new Set(input.itens.map((i) => i.materialId))];

  const [materiais, impressora, config, custosFixos, custosVariaveis] = await Promise.all([
    prisma.material.findMany({ where: { id: { in: idsMateriais }, usuarioId } }),
    prisma.impressora.findFirst({ where: { id: input.impressoraId, usuarioId } }),
    obterConfiguracao(usuarioId),
    prisma.custoFixo.findMany({ where: { usuarioId } }),
    idsVariaveis.length
      ? prisma.custoVariavel.findMany({ where: { id: { in: idsVariaveis }, usuarioId } })
      : Promise.resolve([]),
  ]);

  if (!impressora) throw naoEncontrado('Impressora');

  // Mapa id->material; a ordem de exibicao/calculo segue SEMPRE input.itens,
  // nunca a ordem devolvida pelo findMany (que nao e' garantida).
  const materiaisPorId = new Map(materiais.map((m) => [m.id, m]));
  for (const it of input.itens) {
    if (!materiaisPorId.has(it.materialId)) throw naoEncontrado(`Material (id ${it.materialId})`);
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
    const consumoG = it.pesoG * (1 + m.taxaDesperdicio);
    return {
      nome: it.nome ?? null,
      materialId: it.materialId,
      pesoG: it.pesoG,
      tempoImpressaoH: it.tempoImpressaoH,
      tempoPosProcessamentoH: it.tempoPosProcessamentoH,
      consumoG,
      custoItem: resultado.itens[idx]!.custoItemTotal,
      materialEstoqueG: m.estoqueG,
      materialNome: m.nome,
    };
  });

  return { impressora, entradaMotor, resultado, itensCalculados };
}

/** Monta a mensagem de aviso de estoque insuficiente (ou null se tudo ok). */
function avisoEstoque(itensCalculados: ItemCalculado[]): string | null {
  const insuficientes = itensCalculados.filter((it) => it.materialEstoqueG < it.consumoG);
  if (!insuficientes.length) return null;
  return `Estoque insuficiente para aprovar: ${insuficientes
    .map(
      (it) =>
        `${it.nome ?? it.materialNome} (precisa de ${it.consumoG.toFixed(1)}g, ha ${it.materialEstoqueG.toFixed(1)}g)`,
    )
    .join('; ')}.`;
}

/** Simulador "e se": calcula sem persistir. */
export async function simular(
  input: OrcamentoInput,
  usuarioId: number,
): Promise<{
  resultado: ResultadoPrecificacaoMultipla;
  itens: { materialId: number; consumoG: number; estoqueSuficiente: boolean }[];
  estoqueSuficiente: boolean;
}> {
  const { resultado, itensCalculados } = await montarCalculo(input, usuarioId);
  const itens = itensCalculados.map((it) => ({
    materialId: it.materialId,
    consumoG: it.consumoG,
    estoqueSuficiente: it.materialEstoqueG >= it.consumoG,
  }));
  return { resultado, itens, estoqueSuficiente: itens.every((i) => i.estoqueSuficiente) };
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
          consumoG: it.consumoG,
          custoItem: it.custoItem,
          ordem: idx,
        })),
      },
    },
    include: { itens: { include: { material: true }, orderBy: { ordem: 'asc' } } },
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

  const [, , orcamento] = await prisma.$transaction([
    prisma.orcamentoItem.deleteMany({ where: { orcamentoId: id } }),
    prisma.orcamentoItem.createMany({
      data: itensCalculados.map((it, idx) => ({
        orcamentoId: id,
        nome: it.nome,
        materialId: it.materialId,
        pesoG: it.pesoG,
        tempoImpressaoH: it.tempoImpressaoH,
        tempoPosProcessamentoH: it.tempoPosProcessamentoH,
        consumoG: it.consumoG,
        custoItem: it.custoItem,
        ordem: idx,
      })),
    }),
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
      },
      include: { itens: { include: { material: true }, orderBy: { ordem: 'asc' } } },
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
    include: { itens: true },
  });
  if (!orcamento) throw naoEncontrado('Orcamento');
  if (orcamento.status === 'aprovado') throw conflito('Orcamento ja aprovado (imutavel)');
  if (orcamento.status === 'recusado') throw conflito('Orcamento recusado nao pode ser aprovado');

  const materiais = await prisma.material.findMany({
    where: { id: { in: orcamento.itens.map((i) => i.materialId) } },
  });
  const materiaisPorId = new Map(materiais.map((m) => [m.id, m]));

  // Regra 4: verifica TODAS as pecas antes de baixar qualquer uma.
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
  }

  // Transacao: baixa de estoque de cada material + mudanca de status sao atomicas.
  await prisma.$transaction([
    ...orcamento.itens.map((it) =>
      prisma.material.update({
        where: { id: it.materialId },
        data: { estoqueG: { decrement: it.consumoG } },
      }),
    ),
    prisma.orcamento.update({
      where: { id },
      data: { status: 'aprovado', estoqueBaixado: true, aprovadoEm: new Date() },
    }),
  ]);

  return prisma.orcamento.findFirstOrThrow({
    where: { id },
    include: { itens: { include: { material: true }, orderBy: { ordem: 'asc' } }, impressora: true },
  });
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
    include: { itens: { include: { material: true }, orderBy: { ordem: 'asc' } }, impressora: true },
  });
  if (!orcamento) throw naoEncontrado('Orcamento');
  return { ...orcamento, resultado: JSON.parse(orcamento.resultadoJson) };
}
