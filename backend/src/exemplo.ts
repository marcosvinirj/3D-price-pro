/**
 * Exemplo executavel do motor de precificacao.
 * Rode com:  npx tsx src/exemplo.ts   (ou compile e rode com node)
 */
import { precificar } from './pricing/index.js';

const resultado = precificar({
  peca: { pesoG: 50, tempoImpressaoH: 4, tempoPosProcessamentoH: 0.5 },
  material: { precoKg: 120, taxaDesperdicio: 0.05 },
  impressora: { potenciaW: 200, valorAquisicao: 2000, vidaUtilH: 2000 },
  custos: {
    precoKwh: 0.95,
    valorHoraTrabalho: 20,
    custosFixosMensais: 1000,
    horasProdutivasMes: 160,
  },
  parametros: { taxaFalha: 0.1, margemLucro: 0.5, margemMinima: 0.2 },
  desconto: { tipo: 'percentual', valor: 0.1 },
  arredondamento: { modo: 'psicologico', terminacao: 0.9 },
});

console.log(JSON.stringify(resultado, null, 2));
