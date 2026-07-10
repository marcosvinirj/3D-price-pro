/** Ponto de entrada publico do motor de precificacao. */
export {
  precificar,
  calcular,
  ErroValidacaoPrecificacao,
  type ResultadoPrecificacao,
  type DetalhamentoCustos,
  type DetalhamentoDesconto,
  type DetalhamentoMargem,
} from './engine.js';

export {
  entradaPrecificacaoSchema,
  type EntradaPrecificacao,
  type EntradaPrecificacaoInput,
} from './schema.js';

export {
  aplicarArredondamento,
  arredondar2,
  arredondarN,
  type EstrategiaArredondamento,
} from './money.js';
