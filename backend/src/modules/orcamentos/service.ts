/**
 * Servico de orcamentos: orquestra o motor de precificacao com os dados
 * cadastrados (material, impressora, custos, config) e aplica as regras de
 * negocio que dependem de persistencia (2, 4, 5, 6).
 */
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { naoEncontrado, conflito, regraDeNegocio } from '../../http/errors.js';
import { precificar, type ResultadoPrecificacao } from '../../pricing/index.js';
import { arredondamentoSchema, descontoSchema } from '../../pricing/schema.js';
import { obterConfiguracao } from '../configuracao/service.js';

/** Entrada de um calculo/orcamento vinda da API. */
export const orcamentoInputSchema = z.object({
  materialId: z.number().int().positive(),
  impressoraId: z.number().int().positive(),
  peca: z.object({
    pesoG: z.number().positive(),
    tempoImpressaoH: z.number().nonnegative(),
    tempoPosProcessamentoH: z.number().nonnegative(),
  }),
  parametros: z.object({
    taxaFalha: z.number().min(0).max(1),
    margemLucro: z.number().min(0).max(100),
  }),
  desconto: descontoSchema.optional(),
  arredondamento: arredondamentoSchema.optional(),
  /** IDs dos custos variaveis por peca selecionados para este orcamento. */
  custosVariaveisIds: z.array(z.number().int().positive()).optional(),
  cliente: z.string().optional(),
  telefone: z.string().optional(),
  descricaoPeca: z.string().optional(),
});

export type OrcamentoInput = z.infer<typeof orcamentoInputSchema>;

/** Carrega dependencias (do usuario dono) e monta a entrada do motor de precificacao. */
async function montarCalculo(input: OrcamentoInput, usuarioId: number) {
  const idsVariaveis = input.custosVariaveisIds ?? [];
  const [material, impressora, config, custosFixos, custosVariaveis] = await Promise.all([
    prisma.material.findFirst({ where: { id: input.materialId, usuarioId } }),
    prisma.impressora.findFirst({ where: { id: input.impressoraId, usuarioId } }),
    obterConfiguracao(usuarioId),
    prisma.custoFixo.findMany({ where: { usuarioId } }),
    idsVariaveis.length
      ? prisma.custoVariavel.findMany({ where: { id: { in: idsVariaveis }, usuarioId } })
      : Promise.resolve([]),
  ]);

  if (!material) throw naoEncontrado('Material');
  if (!impressora) throw naoEncontrado('Impressora');

  const custosFixosMensais = custosFixos.reduce((s, c) => s + c.valorMensal, 0);
  // Soma apenas dos custos variaveis efetivamente selecionados para a peca.
  const custoVariavel = custosVariaveis.reduce((s, c) => s + c.valorUnitario, 0);

  const entradaMotor = {
    peca: input.peca,
    material: { precoKg: material.precoKg, taxaDesperdicio: material.taxaDesperdicio },
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

  const resultado = precificar(entradaMotor);
  // Consumo real de filamento inclui a purga/desperdicio.
  const consumoG = input.peca.pesoG * (1 + material.taxaDesperdicio);

  return { material, impressora, entradaMotor, resultado, consumoG };
}

/** Simulador "e se": calcula sem persistir. */
export async function simular(
  input: OrcamentoInput,
  usuarioId: number,
): Promise<{
  resultado: ResultadoPrecificacao;
  consumoG: number;
  estoqueSuficiente: boolean;
}> {
  const { material, resultado, consumoG } = await montarCalculo(input, usuarioId);
  return { resultado, consumoG, estoqueSuficiente: material.estoqueG >= consumoG };
}

/**
 * Cria um orcamento (status pendente), gravando snapshots imutaveis (regras
 * 5 e 6). Bloqueia se a margem do preco de tabela furar a minima (regra 2).
 * NAO baixa estoque aqui — a baixa ocorre na aprovacao (regra 4).
 */
export async function criarOrcamento(input: OrcamentoInput, usuarioId: number) {
  const { entradaMotor, resultado, consumoG, material } = await montarCalculo(input, usuarioId);

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
      pesoG: input.peca.pesoG,
      materialId: input.materialId,
      impressoraId: input.impressoraId,
      usuarioId,
    },
  });

  return {
    orcamento,
    resultado,
    aviso:
      material.estoqueG < consumoG
        ? `Estoque insuficiente para aprovar: precisa de ${consumoG.toFixed(
            1,
          )}g, ha ${material.estoqueG.toFixed(1)}g.`
        : null,
  };
}

/**
 * Aprova um orcamento: baixa o estoque do material (regra 4 — nunca negativo)
 * e torna o registro imutavel (regra 5). Idempotencia protegida por status.
 */
export async function aprovarOrcamento(id: number, usuarioId: number) {
  const orcamento = await prisma.orcamento.findFirst({ where: { id, usuarioId } });
  if (!orcamento) throw naoEncontrado('Orcamento');
  if (orcamento.status === 'aprovado') throw conflito('Orcamento ja aprovado (imutavel)');
  if (orcamento.status === 'recusado') throw conflito('Orcamento recusado nao pode ser aprovado');

  const material = await prisma.material.findUnique({ where: { id: orcamento.materialId } });
  if (!material) throw naoEncontrado('Material');

  const entrada = JSON.parse(orcamento.entradaJson) as {
    material: { taxaDesperdicio: number };
  };
  const consumoG = orcamento.pesoG * (1 + entrada.material.taxaDesperdicio);

  // Regra 4: estoque nao pode ficar negativo.
  if (material.estoqueG < consumoG) {
    throw regraDeNegocio(
      `Estoque insuficiente: precisa de ${consumoG.toFixed(1)}g, ha ${material.estoqueG.toFixed(
        1,
      )}g.`,
    );
  }

  // Transacao: baixa de estoque + mudanca de status sao atomicas.
  const [, aprovado] = await prisma.$transaction([
    prisma.material.update({
      where: { id: material.id },
      data: { estoqueG: { decrement: consumoG } },
    }),
    prisma.orcamento.update({
      where: { id },
      data: { status: 'aprovado', estoqueBaixado: true, aprovadoEm: new Date() },
    }),
  ]);

  return aprovado;
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
    include: { material: { select: { nome: true } }, impressora: { select: { nome: true } } },
  });
}

export async function obterOrcamento(id: number, usuarioId: number) {
  const orcamento = await prisma.orcamento.findFirst({
    where: { id, usuarioId },
    include: { material: true, impressora: true },
  });
  if (!orcamento) throw naoEncontrado('Orcamento');
  return { ...orcamento, resultado: JSON.parse(orcamento.resultadoJson) };
}
