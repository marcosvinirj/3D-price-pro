/**
 * Utilitarios de dinheiro e arredondamento.
 *
 * Todo o dinheiro e representado como `number` na moeda base (ex.: 19.90).
 * Para evitar erros de ponto flutuante (0.1 + 0.2 !== 0.3), o valor final
 * cobrado do cliente e sempre normalizado para 2 casas com `arredondar2`.
 */

/** Arredonda para 2 casas decimais de forma estavel (meio-para-cima). */
export function arredondar2(valor: number): number {
  // Number.EPSILON corrige casos como 1.005 que em float e 1.00499999...
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

/** Arredonda para N casas decimais (usado no detalhamento de custos). */
export function arredondarN(valor: number, casas: number): number {
  const fator = 10 ** casas;
  return Math.round((valor + Number.EPSILON) * fator) / fator;
}

/**
 * Estrategia de arredondamento do preco final, configuravel pelo usuario.
 *
 * - `nenhum`: mantem o valor com 2 casas, sem forcar terminacao.
 * - `maisProximo`: arredonda para o multiplo de `passo` mais proximo (ex.: 0.50).
 * - `paraCima`: arredonda para cima ate o multiplo de `passo` (protege a margem).
 * - `psicologico`: forca a terminacao em `.terminacao` (ex.: 0.90 => 19.90),
 *    sempre para cima para nunca reduzir a margem planejada.
 */
export type EstrategiaArredondamento =
  | { modo: 'nenhum' }
  | { modo: 'maisProximo'; passo: number }
  | { modo: 'paraCima'; passo: number }
  | { modo: 'psicologico'; terminacao: number };

/** Aplica a estrategia de arredondamento a um preco. */
export function aplicarArredondamento(
  preco: number,
  estrategia: EstrategiaArredondamento,
): number {
  switch (estrategia.modo) {
    case 'nenhum':
      return arredondar2(preco);

    case 'maisProximo':
      return arredondar2(Math.round(preco / estrategia.passo) * estrategia.passo);

    case 'paraCima':
      return arredondar2(Math.ceil(preco / estrategia.passo) * estrategia.passo);

    case 'psicologico': {
      const { terminacao } = estrategia; // ex.: 0.90
      const inteiro = Math.floor(preco);
      let candidato = inteiro + terminacao;
      // Se a terminacao ficaria abaixo do preco, sobe para o proximo inteiro.
      if (candidato < preco - 1e-9) {
        candidato = inteiro + 1 + terminacao;
      }
      return arredondar2(candidato);
    }
  }
}
