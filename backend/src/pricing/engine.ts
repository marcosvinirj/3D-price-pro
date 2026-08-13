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
 *   Custo Insumos      = soma(insumo.valorUnitario * insumo.quantidade)
 *   Custo Total        = soma dos acima
 *   Custo c/ Falha     = Custo Total * (1 + taxaFalha)
 *   Preco (bruto)      = Custo c/ Falha * (1 + margemLucro)
 *   Preco Final        = arredondamento(Preco bruto)
 *   Preco Cobrado      = Preco Final - desconto (desconto so sobre o final)
 *
 * `quantidade` e' o numero de unidades identicas que uma peca representa
 * (ex.: 25 canudos impressos juntos na mesma leva). E' puramente
 * INFORMATIVA — aparece no PDF/WhatsApp, mas NAO multiplica nada aqui.
 * `insumo.quantidade` ja' e' o total direto usado na peca (nao "por
 * unidade"): se o usuario quer 15 argolas nesta peca, digita 15 ali — nao
 * ha' um segundo multiplicador, pra nao duplicar a mesma conta de dois
 * jeitos (15 argolas x quantidade=1 ou 1 argola x quantidade=15 davam o
 * mesmo resultado, o que confundia). Peso/consumo de filamento tambem e' o
 * total gasto informado para a peca — calculo por grama de filamento
 * gasto. Tempo de impressao/pos-processamento (e por consequencia energia,
 * depreciacao, custo fixo rateado e mao de obra) sao do LOTE inteiro.
 */
import { z } from 'zod';
import { arredondarN, aplicarArredondamento, type EstrategiaArredondamento } from './money.js';
import {
  entradaPrecificacaoSchema,
  entradaPrecificacaoMultiplaSchema,
  type EntradaPrecificacao,
  type EntradaPrecificacaoInput,
  type EntradaPrecificacaoMultipla,
  type EntradaPrecificacaoMultiplaInput,
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
  /** Soma dos insumos usados (por unidade * quantidade) de todas as pecas. */
  custoInsumos: number;
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

/** Os 6 componentes de custo LINEARES de uma peca (sem markup, sem arredondar). */
interface ComponentesCustoPeca {
  custoMaterial: number;
  custoEnergia: number;
  depreciacao: number;
  maoDeObra: number;
  custoFixoRateado: number;
  custoInsumos: number;
}

type PecaEntrada = EntradaPrecificacao['peca'];
type MaterialEntrada = EntradaPrecificacao['material'];
type ImpressoraEntrada = EntradaPrecificacao['impressora'];
type CustosEntrada = EntradaPrecificacao['custos'];
type ParametrosEntrada = EntradaPrecificacao['parametros'];

/**
 * Calcula os componentes de custo de UMA peca (linha do orcamento). Todos sao
 * funcoes lineares dos dados de entrada — por isso somar os componentes de
 * varias pecas e so' entao aplicar taxaFalha/margemLucro (uma vez) da o mesmo
 * resultado que aplicar por peca e somar depois. E' o que permite
 * `calcularMultiplo` reaproveitar esta funcao sem duplicar a matematica.
 *
 * `peca.quantidade` NAO entra em nenhuma conta aqui — e' so' um registro de
 * quantas unidades essa peca representa (mostrado no PDF/WhatsApp). Peso/
 * consumo de filamento e' o total gasto informado para a peca (calculo por
 * grama de filamento gasto). `insumo.quantidade` ja' e' o total direto
 * usado na peca. Tempo de impressao/pos-processamento — e por consequencia
 * energia, depreciacao, custo fixo rateado e mao de obra — sao do LOTE
 * inteiro.
 */
function calcularComponentesPeca(
  peca: PecaEntrada,
  material: MaterialEntrada,
  impressora: ImpressoraEntrada,
  custos: Pick<CustosEntrada, 'precoKwh' | 'valorHoraTrabalho' | 'custosFixosMensais' | 'horasProdutivasMes'>,
): ComponentesCustoPeca {
  const custoMaterial = ((peca.pesoG * material.precoKg) / 1000) * (1 + material.taxaDesperdicio);
  const custoEnergia = (impressora.potenciaW / 1000) * peca.tempoImpressaoH * custos.precoKwh;
  const depreciacao = (impressora.valorAquisicao / impressora.vidaUtilH) * peca.tempoImpressaoH;
  const maoDeObra = peca.tempoPosProcessamentoH * custos.valorHoraTrabalho;
  // Rateio profissional: custos fixos por HORA produtiva da impressora,
  // multiplicado pelo tempo de impressao da peca (nao por peca/mes).
  const custoFixoPorHora = custos.custosFixosMensais / custos.horasProdutivasMes;
  const custoFixoRateado = custoFixoPorHora * peca.tempoImpressaoH;
  // insumo.quantidade ja' e' o total direto usado na peca (nao "por
  // unidade") — nao multiplica por peca.quantidade (ver doc acima).
  const custoInsumos = peca.insumos.reduce((s, i) => s + i.valorUnitario * i.quantidade, 0);

  return { custoMaterial, custoEnergia, depreciacao, maoDeObra, custoFixoRateado, custoInsumos };
}

/**
 * Parte final do calculo: recebe um custo total ja somado (de uma ou varias
 * pecas) e aplica provisao de falha, margem, arredondamento, desconto e
 * detalhamento de margem. Compartilhada por `calcular` e `calcularMultiplo`.
 */
function finalizarPreco(
  custoTotal: number,
  custoVariavel: number,
  parametros: ParametrosEntrada,
  desconto: EntradaPrecificacao['desconto'],
  arredondamento: EstrategiaArredondamento,
): Omit<ResultadoPrecificacao, 'custos'> & { custoComFalha: number } {
  const custoComFalha = custoTotal * (1 + parametros.taxaFalha);
  const precoBruto = custoComFalha * (1 + parametros.margemLucro);
  const precoFinal = aplicarArredondamento(precoBruto, arredondamento);

  // Desconto incide APENAS sobre o preco final, nunca sobre os custos (regra 7).
  let desconto_: DetalhamentoDesconto | null = null;
  let precoCobrado = precoFinal;
  if (desconto) {
    const valorDescontadoBruto =
      desconto.tipo === 'percentual'
        ? precoFinal * desconto.valor
        : Math.min(desconto.valor, precoFinal); // nunca deixa preco negativo
    // Arredonda o desconto primeiro para que preco + desconto batam ao centavo.
    const valorDescontado = arredondarN(valorDescontadoBruto, 2);
    precoCobrado = arredondarN(precoFinal - valorDescontado, 2);
    desconto_ = {
      tipo: desconto.tipo,
      valorDescontado,
      precoComDesconto: precoCobrado,
    };
  }

  // Margem real: lucro sobre o custo (com provisao de falha) apos o que foi cobrado.
  const lucro = precoCobrado - custoComFalha;
  const margemReal = custoComFalha > 0 ? lucro / custoComFalha : 0;

  // Margem do preco de tabela (antes do desconto) — usada para a regra 2,
  // pois o arredondamento pode ter reduzido a margem planejada.
  const margemAposArredondamento = custoComFalha > 0 ? precoFinal / custoComFalha - 1 : 0;
  const atingeMinima = margemAposArredondamento >= parametros.margemMinima - 1e-9;

  return {
    precoBruto: arredondarN(precoBruto, 4),
    precoFinal,
    precoCobrado,
    desconto: desconto_,
    margem: {
      planejada: parametros.margemLucro,
      minima: parametros.margemMinima,
      real: arredondarN(margemReal, 4),
      aposArredondamento: arredondarN(margemAposArredondamento, 4),
      atingeMinima,
      lucro: arredondarN(lucro, 2),
    },
    custoComFalha: arredondarN(custoComFalha, 4),
  };
}

/**
 * Calcula a precificacao a partir de uma entrada JA VALIDADA.
 * Use `precificar` para validar e calcular em um passo so.
 */
export function calcular(entrada: EntradaPrecificacao): ResultadoPrecificacao {
  const { peca, material, impressora, custos, parametros } = entrada;
  const c = calcularComponentesPeca(peca, material, impressora, custos);
  const custoVariavel = custos.custoVariavel;
  const custoTotal =
    c.custoMaterial +
    c.custoEnergia +
    c.depreciacao +
    c.maoDeObra +
    c.custoFixoRateado +
    c.custoInsumos +
    custoVariavel;

  const { custoComFalha, ...resto } = finalizarPreco(
    custoTotal,
    custoVariavel,
    parametros,
    entrada.desconto,
    entrada.arredondamento,
  );

  return {
    ...resto,
    custos: {
      custoMaterial: arredondarN(c.custoMaterial, 4),
      custoEnergia: arredondarN(c.custoEnergia, 4),
      depreciacao: arredondarN(c.depreciacao, 4),
      maoDeObra: arredondarN(c.maoDeObra, 4),
      custoFixoRateado: arredondarN(c.custoFixoRateado, 4),
      custoVariavel: arredondarN(custoVariavel, 4),
      custoInsumos: arredondarN(c.custoInsumos, 4),
      custoTotal: arredondarN(custoTotal, 4),
      custoComFalha,
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

/** Detalhamento de custo de UMA peca dentro de um orcamento multi-peca. */
export interface DetalhamentoItemCusto {
  nome?: string;
  pesoG: number;
  /** Unidades identicas que esta peca representa (ver `calcularComponentesPeca`). */
  quantidade: number;
  custoMaterial: number;
  custoEnergia: number;
  depreciacao: number;
  maoDeObra: number;
  custoFixoRateado: number;
  custoInsumos: number;
  /** Soma dos componentes acima (sem custo variavel do orcamento, sem markup). */
  custoItemTotal: number;
}

/** Resultado de um orcamento com multiplas pecas — mesmo formato agregado de sempre, mais o detalhamento por peca. */
export interface ResultadoPrecificacaoMultipla extends ResultadoPrecificacao {
  itens: DetalhamentoItemCusto[];
}

/**
 * Calcula a precificacao de um orcamento com VARIAS pecas (cada uma com seu
 * proprio material), compartilhando impressora/custos/parametros. Soma os
 * componentes lineares de cada peca e aplica a provisao de falha/margem uma
 * unica vez sobre o total — matematicamente equivalente a aplicar por peca e
 * somar depois (ver `calcularComponentesPeca`).
 */
export function calcularMultiplo(entrada: EntradaPrecificacaoMultipla): ResultadoPrecificacaoMultipla {
  const itens: DetalhamentoItemCusto[] = entrada.itens.map((it) => {
    const c = calcularComponentesPeca(it.peca, it.material, entrada.impressora, entrada.custos);
    const custoItemTotal =
      c.custoMaterial + c.custoEnergia + c.depreciacao + c.maoDeObra + c.custoFixoRateado + c.custoInsumos;
    return {
      ...(it.nome ? { nome: it.nome } : {}),
      pesoG: it.peca.pesoG,
      quantidade: it.peca.quantidade,
      custoMaterial: arredondarN(c.custoMaterial, 4),
      custoEnergia: arredondarN(c.custoEnergia, 4),
      depreciacao: arredondarN(c.depreciacao, 4),
      maoDeObra: arredondarN(c.maoDeObra, 4),
      custoFixoRateado: arredondarN(c.custoFixoRateado, 4),
      custoInsumos: arredondarN(c.custoInsumos, 4),
      custoItemTotal: arredondarN(custoItemTotal, 4),
    };
  });

  const custoVariavel = entrada.custos.custoVariavel;
  // Soma os totais JA arredondados de cada peca — o que e' exibido por peca
  // sempre bate com o que entra na soma (por isso o resultado nao e'
  // bit-a-bit identico a `calcular` para o "mesmo" input de peca unica,
  // ainda que a diferenca seja sub-centavo e irrelevante na pratica).
  const somaItens = itens.reduce((s, i) => s + i.custoItemTotal, 0);
  const custoTotal = somaItens + custoVariavel;

  const { custoComFalha, ...resto } = finalizarPreco(
    custoTotal,
    custoVariavel,
    entrada.parametros,
    entrada.desconto,
    entrada.arredondamento,
  );

  const custosAgregados: DetalhamentoCustos = {
    custoMaterial: arredondarN(itens.reduce((s, i) => s + i.custoMaterial, 0), 4),
    custoEnergia: arredondarN(itens.reduce((s, i) => s + i.custoEnergia, 0), 4),
    depreciacao: arredondarN(itens.reduce((s, i) => s + i.depreciacao, 0), 4),
    maoDeObra: arredondarN(itens.reduce((s, i) => s + i.maoDeObra, 0), 4),
    custoFixoRateado: arredondarN(itens.reduce((s, i) => s + i.custoFixoRateado, 0), 4),
    custoVariavel: arredondarN(custoVariavel, 4),
    custoInsumos: arredondarN(itens.reduce((s, i) => s + i.custoInsumos, 0), 4),
    custoTotal: arredondarN(custoTotal, 4),
    custoComFalha,
  };

  return { ...resto, custos: custosAgregados, itens };
}

/**
 * Valida a entrada crua (multiplas pecas) e calcula a precificacao.
 * Lanca `ErroValidacaoPrecificacao` se a entrada for invalida.
 */
export function precificarMultiplo(
  entrada: EntradaPrecificacaoMultiplaInput,
): ResultadoPrecificacaoMultipla {
  const parsed = entradaPrecificacaoMultiplaSchema.safeParse(entrada);
  if (!parsed.success) {
    throw new ErroValidacaoPrecificacao(
      'Entrada de precificacao invalida',
      parsed.error.issues,
    );
  }
  return calcularMultiplo(parsed.data);
}
