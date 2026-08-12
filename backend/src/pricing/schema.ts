/**
 * Schema de validacao da entrada do motor de calculo (Zod).
 *
 * Toda entrada e validada ANTES de qualquer calculo, garantindo que dados
 * malformados (peso negativo, taxa fora de faixa, divisao por zero em
 * "pecas por mes") nunca cheguem a produzir um preco incorreto.
 */
import { z } from 'zod';

/** Numero finito e >= 0. */
export const naoNegativo = z
  .number({ invalid_type_error: 'Deve ser um numero' })
  .finite('Deve ser um numero finito')
  .nonnegative('Nao pode ser negativo');

/** Numero finito e > 0 (para divisores). */
export const positivo = z
  .number({ invalid_type_error: 'Deve ser um numero' })
  .finite('Deve ser um numero finito')
  .positive('Deve ser maior que zero');

/** Fracao entre 0 e 1 (ex.: 0.20 = 20%). Para taxas limitadas a 100%. */
export const fracao = z
  .number({ invalid_type_error: 'Deve ser um numero' })
  .finite()
  .min(0, 'Percentual nao pode ser negativo')
  .max(1, 'Use fracao entre 0 e 1 (ex.: 0.2 para 20%)');

/**
 * Fracao sem teto de 100% (ex.: margem de lucro pode passar de 1 = 100%).
 * Limitada a um teto sanitario para pegar erros grosseiros de digitacao.
 */
export const fracaoAberta = z
  .number({ invalid_type_error: 'Deve ser um numero' })
  .finite()
  .min(0, 'Percentual nao pode ser negativo')
  .max(100, 'Percentual absurdamente alto (>10000%) — verifique a entrada');

export const arredondamentoSchema = z.discriminatedUnion('modo', [
  z.object({ modo: z.literal('nenhum') }),
  z.object({ modo: z.literal('maisProximo'), passo: positivo }),
  z.object({ modo: z.literal('paraCima'), passo: positivo }),
  z.object({ modo: z.literal('psicologico'), terminacao: fracao }),
]);

export const descontoSchema = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('percentual'), valor: fracao }),
  z.object({ tipo: z.literal('valor'), valor: naoNegativo }),
]);

/** Inteiro >= 1 (quantidade de unidades). */
export const inteiroPositivo = z
  .number({ invalid_type_error: 'Deve ser um numero' })
  .int('Deve ser um numero inteiro')
  .positive('Deve ser maior que zero');

/**
 * Um insumo consumido POR UNIDADE da peca (ex.: 1 argola por canudo). O
 * consumo total no orcamento e' `quantidade` (deste insumo, por peca) vezes a
 * quantidade de pecas do item — ver `calcularComponentesPeca`.
 */
export const insumoUsadoSchema = z.object({
  valorUnitario: naoNegativo,
  quantidade: inteiroPositivo,
});

export const entradaPrecificacaoSchema = z
  .object({
    peca: z.object({
      pesoG: positivo,
      tempoImpressaoH: naoNegativo,
      tempoPosProcessamentoH: naoNegativo,
      /** Unidades identicas que esta peca representa (25 canudos = 25). Peso
       *  e insumos escalam por ela; tempo de impressao/pos-processamento NAO
       *  (sao do lote inteiro). */
      quantidade: inteiroPositivo.default(1),
      /** Insumos usados por unidade da peca (argola, escovinha, saco zip...). */
      insumos: z.array(insumoUsadoSchema).default([]),
    }),
    material: z.object({
      precoKg: naoNegativo,
      /** Desperdicio/purga como fracao (0.05 = 5%). */
      taxaDesperdicio: fracao,
    }),
    impressora: z.object({
      potenciaW: naoNegativo,
      valorAquisicao: naoNegativo,
      vidaUtilH: positivo,
    }),
    custos: z.object({
      precoKwh: naoNegativo,
      valorHoraTrabalho: naoNegativo,
      custosFixosMensais: naoNegativo,
      /** Horas produtivas da impressora no mes; divisor do rateio (nao pode ser zero). */
      horasProdutivasMes: positivo,
      /** Soma dos custos variaveis por peca selecionados. Default 0. */
      custoVariavel: naoNegativo.default(0),
    }),
    parametros: z.object({
      /** Taxa de falha como fracao (0.10 = 10%). */
      taxaFalha: fracao,
      /** Margem de lucro desejada como fracao (0.30 = 30%, 1.5 = 150%). */
      margemLucro: fracaoAberta,
      /** Margem minima permitida; salvar abaixo disso e bloqueado. */
      margemMinima: fracaoAberta.default(0.2),
    }),
    /** Desconto aplicado APENAS sobre o preco final (regra 7). Opcional. */
    desconto: descontoSchema.optional(),
    /** Estrategia de arredondamento do preco final. */
    arredondamento: arredondamentoSchema.default({ modo: 'nenhum' }),
  })
  .superRefine((dados, ctx) => {
    if (dados.parametros.margemLucro < dados.parametros.margemMinima) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parametros', 'margemLucro'],
        message: `Margem de lucro (${(dados.parametros.margemLucro * 100).toFixed(
          1,
        )}%) abaixo da margem minima permitida (${(
          dados.parametros.margemMinima * 100
        ).toFixed(1)}%).`,
      });
    }
  });

/** Entrada ja parseada e validada (com defaults aplicados). */
export type EntradaPrecificacao = z.infer<typeof entradaPrecificacaoSchema>;

/** Entrada crua aceita pelo usuario (antes dos defaults). */
export type EntradaPrecificacaoInput = z.input<typeof entradaPrecificacaoSchema>;

/** Uma peca dentro de um orcamento multi-peca (ex.: "Cauda", "Torso"...). */
const itemPrecificacaoSchema = z.object({
  nome: z.string().trim().min(1).optional(),
  peca: z.object({
    pesoG: positivo,
    tempoImpressaoH: naoNegativo,
    tempoPosProcessamentoH: naoNegativo,
    quantidade: inteiroPositivo.default(1),
    insumos: z.array(insumoUsadoSchema).default([]),
  }),
  material: z.object({
    precoKg: naoNegativo,
    taxaDesperdicio: fracao,
  }),
});

/**
 * Entrada de um orcamento com MULTIPLAS pecas, cada uma com seu proprio
 * material. Impressora, custos e parametros sao compartilhados por todas as
 * pecas do orcamento (mesma impressora, mesmo lote de custos fixos/variaveis).
 */
export const entradaPrecificacaoMultiplaSchema = z
  .object({
    itens: z.array(itemPrecificacaoSchema).min(1, 'Pelo menos uma peca e obrigatoria'),
    impressora: z.object({
      potenciaW: naoNegativo,
      valorAquisicao: naoNegativo,
      vidaUtilH: positivo,
    }),
    custos: z.object({
      precoKwh: naoNegativo,
      valorHoraTrabalho: naoNegativo,
      custosFixosMensais: naoNegativo,
      horasProdutivasMes: positivo,
      custoVariavel: naoNegativo.default(0),
    }),
    parametros: z.object({
      taxaFalha: fracao,
      margemLucro: fracaoAberta,
      margemMinima: fracaoAberta.default(0.2),
    }),
    desconto: descontoSchema.optional(),
    arredondamento: arredondamentoSchema.default({ modo: 'nenhum' }),
  })
  .superRefine((dados, ctx) => {
    if (dados.parametros.margemLucro < dados.parametros.margemMinima) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parametros', 'margemLucro'],
        message: `Margem de lucro (${(dados.parametros.margemLucro * 100).toFixed(
          1,
        )}%) abaixo da margem minima permitida (${(
          dados.parametros.margemMinima * 100
        ).toFixed(1)}%).`,
      });
    }
  });

export type EntradaPrecificacaoMultipla = z.infer<typeof entradaPrecificacaoMultiplaSchema>;
export type EntradaPrecificacaoMultiplaInput = z.input<typeof entradaPrecificacaoMultiplaSchema>;
