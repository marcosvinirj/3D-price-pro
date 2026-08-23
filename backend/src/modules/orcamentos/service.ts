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
import { debitar, CUSTO_ORCAMENTO } from '../creditos/service.js';

/** Um insumo usado nesta peca. `quantidade` e' o TOTAL direto usado nela
 *  (nao "por unidade") — nao ha' outro multiplicador em cima. */
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
  /** Unidades identicas que esta peca representa (25 canudos = 25).
   *  Puramente INFORMATIVA (aparece no PDF/WhatsApp) — nao entra em nenhuma
   *  conta. Peso/consumo de filamento e' o total gasto na peca; a
   *  quantidade de cada insumo (abaixo) ja' e' o total direto usado. */
  quantidade: z.number().int().positive().default(1),
  insumos: z.array(itemInsumoInputSchema).optional(),
});

/** Entrada de um calculo/orcamento vinda da API. */
export const orcamentoInputSchema = z.object({
  impressoraId: z.number().int().positive(),
  itens: z.array(itemInputSchema).min(1, 'Pelo menos uma peca e obrigatoria'),
  parametros: z.object({
    taxaFalha: z.number().min(0).max(1),
    // Margem DESEJADA sobre o PRECO de venda: precisa ser < 100% (a formula
    // preco = custo / (1 - margem) diverge em 100% ou mais — ver pricing/schema.ts).
    margemLucro: z.number().min(0).lt(1),
  }),
  desconto: descontoSchema.optional(),
  arredondamento: arredondamentoSchema.optional(),
  /** IDs dos custos variaveis (embalagem, frete...) selecionados para o orcamento inteiro. */
  custosVariaveisIds: z.array(z.number().int().positive()).optional(),
  /**
   * Quantos produtos/conjuntos COMPLETOS esta encomenda representa — pode
   * ser diferente do numero de pecas (ex.: 3 pecas diferentes que formam 1
   * chaveiro = 1, nao 3). Puramente informativa/exibicao ("Preco por
   * produto" no Simulador) — NAO entra em `montarCalculo`/no motor de
   * precificacao, nunca influencia custo, margem, lucro ou preco final.
   */
  quantidadeProdutosFinais: z.number().int().positive().default(1),
  cliente: z.string().optional(),
  telefone: z.string().optional(),
  descricaoPeca: z.string().optional(),
});

export type OrcamentoInput = z.infer<typeof orcamentoInputSchema>;

/** Uso de um insumo dentro de uma peca calculada. */
interface InsumoUsadoCalculado {
  insumoId: number;
  insumoNome: string;
  /** Nome de coluna historico no banco — o valor e' o TOTAL direto usado na
   *  peca (nao "por peca"/unidade; ver comentario em `itemInsumoInputSchema`). */
  quantidadePorPeca: number;
  valorUnitarioSnapshot: number;
  /** = quantidadePorPeca (mesmo numero) — o que efetivamente sai do estoque. */
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
      // Custo de energia usa SO' o consumo medio (potenciaMediaW) — a
      // potencia maxima/nominal (potenciaW) e' so' informativa no cadastro,
      // nao entra em nenhum calculo (ver doc do topo de engine.ts).
      potenciaMediaW: impressora.potenciaMediaW,
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
    // Consumo de material e' o total gasto informado para a peca — calculo
    // por grama de filamento gasto. `it.quantidade` (da peca) e' puramente
    // informativa e nao entra em NENHUMA conta aqui (nem material nem
    // insumo) — so' aparece no PDF/WhatsApp.
    const consumoG = it.pesoG * (1 + m.taxaDesperdicio);
    const insumosUsados: InsumoUsadoCalculado[] = (it.insumos ?? []).map((iu) => {
      const ins = insumosPorId.get(iu.insumoId)!;
      return {
        insumoId: iu.insumoId,
        insumoNome: ins.nome,
        quantidadePorPeca: iu.quantidade,
        valorUnitarioSnapshot: ins.valorUnitario,
        // iu.quantidade ja' e' o total direto — nao multiplica por it.quantidade.
        totalUnidades: iu.quantidade,
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

  return { impressora, entradaMotor, resultado, itensCalculados, custosVariaveis };
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
  const { entradaMotor, resultado, itensCalculados, custosVariaveis } = await montarCalculo(input, usuarioId);

  // Regra 2: nao permitir salvar preco com margem abaixo da minima.
  if (!resultado.margem.atingeMinima) {
    throw regraDeNegocio(
      `Margem do preco de tabela (${(resultado.margem.aposArredondamento * 100).toFixed(
        1,
      )}%) abaixo da minima (${(resultado.margem.minima * 100).toFixed(1)}%).`,
      { margem: resultado.margem },
    );
  }

  // Debita os creditos e cria o orcamento na MESMA transacao: se o saldo nao
  // cobrir (creditosInsuficientes), nada e' criado; se a criacao falhar por
  // qualquer outro motivo, o debito e' desfeito junto (nao cobra por um
  // orcamento que nao foi salvo).
  const orcamento = await prisma.$transaction(async (tx) => {
    await debitar(usuarioId, CUSTO_ORCAMENTO, 'consumo_orcamento', undefined, tx);
    return tx.orcamento.create({
      data: {
        cliente: input.cliente ?? null,
        telefone: input.telefone ?? null,
        descricaoPeca: input.descricaoPeca ?? null,
        status: 'pendente',
        quantidadeProdutosFinais: input.quantidadeProdutosFinais,
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
        custosVariaveisSelecionados: {
          create: custosVariaveis.map((cv) => ({
            custoVariavelId: cv.id,
            valorUnitarioSnapshot: cv.valorUnitario,
          })),
        },
      },
      include: {
        itens: { include: { material: true, insumos: { include: { insumo: true } } }, orderBy: { ordem: 'asc' } },
        custosVariaveisSelecionados: { include: { custoVariavel: true } },
      },
    });
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

  const { entradaMotor, resultado, itensCalculados, custosVariaveis } = await montarCalculo(input, usuarioId);

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
  // update abaixo recria as pecas via `itens: { create: [...] }`. Custos
  // variaveis selecionados sao filhos diretos do orcamento (nao de um item),
  // entao precisam do proprio deleteMany antes de recriar.
  const [, , orcamento] = await prisma.$transaction([
    prisma.orcamentoItem.deleteMany({ where: { orcamentoId: id } }),
    prisma.orcamentoCustoVariavel.deleteMany({ where: { orcamentoId: id } }),
    prisma.orcamento.update({
      where: { id },
      data: {
        cliente: input.cliente ?? null,
        telefone: input.telefone ?? null,
        descricaoPeca: input.descricaoPeca ?? null,
        impressoraId: input.impressoraId,
        quantidadeProdutosFinais: input.quantidadeProdutosFinais,
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
        custosVariaveisSelecionados: {
          create: custosVariaveis.map((cv) => ({
            custoVariavelId: cv.id,
            valorUnitarioSnapshot: cv.valorUnitario,
          })),
        },
      },
      include: {
        itens: { include: { material: true, insumos: { include: { insumo: true } } }, orderBy: { ordem: 'asc' } },
        custosVariaveisSelecionados: { include: { custoVariavel: true } },
      },
    }),
  ]);

  return { orcamento, resultado, aviso: avisoEstoque(itensCalculados) };
}

/**
 * Aprova um orcamento: baixa o estoque de CADA peca (regra 4 — nunca
 * negativo) e torna o registro imutavel (regra 5).
 *
 * Tudo roda dentro de UMA transacao interativa, e cada baixa usa
 * `updateMany` com o estoque minimo exigido no proprio WHERE — o banco faz a
 * checagem-e-baixa como uma operacao so' (`UPDATE ... WHERE estoque >= X`),
 * sem a brecha de "ler, decidir, escrever" em passos separados que existia
 * antes (duplo clique em "Aprovar", ou duas aprovacoes simultaneas
 * disputando o mesmo material/insumo, podiam ambas passar na checagem antes
 * de qualquer uma escrever). Se qualquer passo falhar, a transacao inteira
 * desfaz — nada fica parcialmente baixado.
 */
export async function aprovarOrcamento(id: number, usuarioId: number) {
  const orcamento = await prisma.orcamento.findFirst({
    where: { id, usuarioId },
    include: { itens: { include: { insumos: true } } },
  });
  if (!orcamento) throw naoEncontrado('Orcamento');
  // Checagem rapida (boa mensagem no caso comum, sem corrida); a checagem
  // AUTORITATIVA — que realmente impede dupla aprovacao — e' a de dentro da
  // transacao abaixo.
  if (orcamento.status === 'aprovado') throw conflito('Orcamento ja aprovado (imutavel)');
  if (orcamento.status === 'recusado') throw conflito('Orcamento recusado nao pode ser aprovado');

  // Um mesmo insumo pode ser usado em varias pecas do orcamento — soma antes
  // de baixar, para decrementar cada insumo uma unica vez.
  const decrementosInsumo = new Map<number, number>();
  for (const it of orcamento.itens) {
    for (const iu of it.insumos) {
      decrementosInsumo.set(iu.insumoId, (decrementosInsumo.get(iu.insumoId) ?? 0) + iu.quantidadePorPeca);
    }
  }

  await prisma.$transaction(async (tx) => {
    // Regra 5, de verdade: so' aprova se AINDA estiver pendente. Se duas
    // requisicoes chegarem juntas, so' uma consegue trocar o status — a
    // outra ve count=0 aqui e nunca chega a tocar em estoque nenhum.
    const statusAtualizado = await tx.orcamento.updateMany({
      where: { id, usuarioId, status: 'pendente' },
      data: { status: 'aprovado', estoqueBaixado: true, aprovadoEm: new Date() },
    });
    if (statusAtualizado.count === 0) {
      throw conflito('Orcamento nao esta mais pendente (aprovado/recusado nesse meio-tempo).');
    }

    // Regra 4: material nunca fica negativo — WHERE com estoqueG >= consumoG
    // faz a checagem-e-baixa atomicamente, por peca.
    for (const it of orcamento.itens) {
      const upd = await tx.material.updateMany({
        where: { id: it.materialId, estoqueG: { gte: it.consumoG } },
        data: { estoqueG: { decrement: it.consumoG } },
      });
      if (upd.count === 0) {
        const m = await tx.material.findUnique({ where: { id: it.materialId } });
        throw regraDeNegocio(
          `Estoque insuficiente para "${it.nome ?? m?.nome ?? 'peça'}": precisa de ${it.consumoG.toFixed(
            1,
          )}g, ha ${(m?.estoqueG ?? 0).toFixed(1)}g.`,
        );
      }
    }

    // Insumos — mesmo padrao de checagem-e-baixa atomica.
    for (const [insumoId, qtd] of decrementosInsumo) {
      const upd = await tx.insumo.updateMany({
        where: { id: insumoId, estoqueUnidades: { gte: qtd } },
        data: { estoqueUnidades: { decrement: qtd } },
      });
      if (upd.count === 0) {
        const ins = await tx.insumo.findUnique({ where: { id: insumoId } });
        throw regraDeNegocio(
          `Estoque insuficiente de "${ins?.nome ?? 'insumo'}": precisa de ${qtd}, ha ${ins?.estoqueUnidades ?? 0}.`,
        );
      }
    }
  });

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
        const total = iu.quantidadePorPeca; // ja' e' o total direto
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
      custosVariaveisSelecionados: { include: { custoVariavel: true } },
    },
  });
  if (!orcamento) throw naoEncontrado('Orcamento');
  return { ...orcamento, resultado: JSON.parse(orcamento.resultadoJson) };
}
