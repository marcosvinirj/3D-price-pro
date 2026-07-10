/**
 * Motor de calculo de precificacao para impressao 3D.
 *
 * Camada de servico PURA: sem I/O, sem banco, sem estado. Recebe uma entrada,
 * valida, e devolve um detalhamento completo e determinista. E o "coracao" do
 * sistema, isolado para ser testado exaustivamente.
 *
 * Formulas (ver especificacao, secao 3):
 *   Custo Material     = (pesoG * precoKg / 1000) * (1 + taxaDesperdicio)
 *   Custo Energia      = (potenciaW / 1000) * tempoImpressaoH * precoKwh
 *   Depreciacao        = (valorAquisicao / vidaUtilH) * tempoImpressaoH
 *   Mao de Obra        = tempoPosProcessamentoH * valorHoraTrabalho
 *   Custo Fixo/Hora    = custosFixosMensais / horasProdutivasMes
 *   Custo Fixo Rateado = Custo Fixo/Hora * tempoImpressaoH
 *   Custo Total        = soma dos acima
 *   Custo c/ Falha     = Custo Total * (1 + taxaFalha)
 *   Preco (bruto)      = Custo c/ Falha * (1 + margemLucro)
 *   Preco Final        = arredondamento(Preco bruto)
 *   Preco Cobrado      = Preco Final - desconto (desconto so sobre o final)
 */
import { z } from 'zod';
import { arredondarN, aplicarArredondamento } from './money.js';
import {
  entradaPrecificacaoSchema,
  type EntradaPrecificacao,
  type EntradaPrecificacaoInput,
} from './schema.js';

/** Detalhamento de cada componente de custo (valores brutos, sem arredondar). */
export interface DetalhamentoCustos {
  custoMaterial: number;
  custoEnergia: number;
  depreciacao: number;
  maoDeObra: number;
  custoFixoRateado: number;
  /** Soma dos custos variaveis por peca selecionados (embalagem, frete...). */
  custoVariavel: number;
  /** Soma dos componentes acima. */
  custoTotal: number;
  /** Custo total ja acrescido da provisao de falha. */
  custoComFalha: number;
}

/** Informacoes de desconto (regra 7: registrado separado, sobre o preco final). */
export interface DetalhamentoDesconto {
  tipo: 'percentual' | 'valor';
  /** Valor absoluto na moeda base efetivamente descontado. */
  valorDescontado: number;
  /** Preco final apos o desconto (o que o cliente paga). */
  precoComDesconto: number;
}

export interface DetalhamentoMargem {
  /** Margem que o usuario pediu (fracao). */
  planejada: number;
  /** Margem minima configurada (fracao). */
  minima: number;
  /** Margem real sobre o preco cobrado apos arredondamento e desconto (fracao). */
  real: number;
  /**
   * Margem do preco de tabela (precoFinal), ANTES de desconto promocional.
   * Pode diferir da planejada quando o arredondamento arredonda para baixo.
   */
  aposArredondamento: number;
  /**
   * `false` se o arredondamento derrubou a margem do preco de tabela abaixo
   * da minima (regra 2). A camada de API deve bloquear o salvamento nesse caso.
   * Desconto promocional (regra 7) NAO afeta esta verificacao.
   */
  atingeMinima: boolean;
  /** Lucro absoluto na moeda base = precoCobrado - custoComFalha. */
  lucro: number;
}

/** Resultado completo do calculo de precificacao. */
export interface ResultadoPrecificacao {
  custos: DetalhamentoCustos;
  /** Preco antes de qualquer arredondamento. */
  precoBruto: number;
  /** Preco apos aplicar a estrategia de arredondamento. */
  precoFinal: number;
  /** Preco efetivamente cobrado (precoFinal menos desconto, se houver). */
  precoCobrado: number;
  desconto: DetalhamentoDesconto | null;
  margem: DetalhamentoMargem;
}

/** Erro lancado quando a entrada nao passa na validacao. */
export class ErroValidacaoPrecificacao extends Error {
  constructor(
    message: string,
    readonly issues: z.ZodIssue[],
  ) {
    super(message);
    this.name = 'ErroValidacaoPrecificacao';
  }
}

/**
 * Calcula a precificacao a partir de uma entrada JA VALIDADA.
 * Use `precificar` para validar e calcular em um passo so.
 */
export function calcular(entrada: EntradaPrecificacao): ResultadoPrecificacao {
  const { peca, material, impressora, custos, parametros } = entrada;

  const custoMaterial =
    ((peca.pesoG * material.precoKg) / 1000) * (1 + material.taxaDesperdicio);

  const custoEnergia =
    (impressora.potenciaW / 1000) * peca.tempoImpressaoH * custos.precoKwh;

  const depreciacao =
    (impressora.valorAquisicao / impressora.vidaUtilH) * peca.tempoImpressaoH;

  const maoDeObra = peca.tempoPosProcessamentoH * custos.valorHoraTrabalho;

  // Rateio profissional: custos fixos por HORA produtiva da impressora,
  // multiplicado pelo tempo de impressao da peca (nao por peca/mes).
  const custoFixoPorHora = custos.custosFixosMensais / custos.horasProdutivasMes;
  const custoFixoRateado = custoFixoPorHora * peca.tempoImpressaoH;

  // Custos variaveis por peca (soma dos itens selecionados no orcamento).
  const custoVariavel = custos.custoVariavel;

  const custoTotal =
    custoMaterial +
    custoEnergia +
    depreciacao +
    maoDeObra +
    custoFixoRateado +
    custoVariavel;

  const custoComFalha = custoTotal * (1 + parametros.taxaFalha);
  const precoBruto = custoComFalha * (1 + parametros.margemLucro);
  const precoFinal = aplicarArredondamento(precoBruto, entrada.arredondamento);

  // Desconto incide APENAS sobre o preco final, nunca sobre os custos (regra 7).
  let desconto: DetalhamentoDesconto | null = null;
  let precoCobrado = precoFinal;
  if (entrada.desconto) {
    const valorDescontadoBruto =
      entrada.desconto.tipo === 'percentual'
        ? precoFinal * entrada.desconto.valor
        : Math.min(entrada.desconto.valor, precoFinal); // nunca deixa preco negativo
    // Arredonda o desconto primeiro para que preco + desconto batam ao centavo.
    const valorDescontado = arredondarN(valorDescontadoBruto, 2);
    precoCobrado = arredondarN(precoFinal - valorDescontado, 2);
    desconto = {
      tipo: entrada.desconto.tipo,
      valorDescontado,
      precoComDesconto: precoCobrado,
    };
  }

  // Margem real: lucro sobre o custo (com provisao de falha) apos o que foi cobrado.
  const lucro = precoCobrado - custoComFalha;
  const margemReal = custoComFalha > 0 ? lucro / custoComFalha : 0;

  // Margem do preco de tabela (antes do desconto) — usada para a regra 2,
  // pois o arredondamento pode ter reduzido a margem planejada.
  const margemAposArredondamento =
    custoComFalha > 0 ? precoFinal / custoComFalha - 1 : 0;
  const atingeMinima =
    margemAposArredondamento >= parametros.margemMinima - 1e-9;

  return {
    custos: {
      custoMaterial: arredondarN(custoMaterial, 4),
      custoEnergia: arredondarN(custoEnergia, 4),
      depreciacao: arredondarN(depreciacao, 4),
      maoDeObra: arredondarN(maoDeObra, 4),
      custoFixoRateado: arredondarN(custoFixoRateado, 4),
      custoVariavel: arredondarN(custoVariavel, 4),
      custoTotal: arredondarN(custoTotal, 4),
      custoComFalha: arredondarN(custoComFalha, 4),
    },
    precoBruto: arredondarN(precoBruto, 4),
    precoFinal,
    precoCobrado,
    desconto,
    margem: {
      planejada: parametros.margemLucro,
      minima: parametros.margemMinima,
      real: arredondarN(margemReal, 4),
      aposArredondamento: arredondarN(margemAposArredondamento, 4),
      atingeMinima,
      lucro: arredondarN(lucro, 2),
    },
  };
}

/**
 * Valida a entrada crua e calcula a precificacao.
 * Lanca `ErroValidacaoPrecificacao` se a entrada for invalida
 * (ex.: margem abaixo da minima, peso negativo, pecas/mes = 0).
 */
export function precificar(
  entrada: EntradaPrecificacaoInput,
): ResultadoPrecificacao {
  const parsed = entradaPrecificacaoSchema.safeParse(entrada);
  if (!parsed.success) {
    throw new ErroValidacaoPrecificacao(
      'Entrada de precificacao invalida',
      parsed.error.issues,
    );
  }
  return calcular(parsed.data);
}
