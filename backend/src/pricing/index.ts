/** Ponto de entrada publico do motor de precificacao. */
export {
  precificar,
  calcular,
  precificarMultiplo,
  calcularMultiplo,
  ErroValidacaoPrecificacao,
  type ResultadoPrecificacao,
  type ResultadoPrecificacaoMultipla,
  type DetalhamentoCustos,
  type DetalhamentoDesconto,
  type DetalhamentoMargem,
  type DetalhamentoItemCusto,
} from './engine.js';

export {
  entradaPrecificacaoSchema,
  entradaPrecificacaoMultiplaSchema,
  type EntradaPrecificacao,
  type EntradaPrecificacaoInput,
  type EntradaPrecificacaoMultipla,
  type EntradaPrecificacaoMultiplaInput,
} from './schema.js';

export {
  aplicarArredondamento,
  arredondar2,
  arredondarN,
  type EstrategiaArredondamento,
} from './money.js';
