/** Tipos compartilhados com a API (espelham o backend). */

export interface Usuario {
  id: number;
  email: string;
  role: string;
}

export interface RespostaAuth {
  token: string;
  usuario: Usuario;
}

export interface Material {
  id: number;
  nome: string;
  tipo: string;
  precoKg: number;
  densidade: number | null;
  cor: string | null;
  estoqueG: number;
  estoqueMinimoG: number;
  taxaDesperdicio: number;
  estoqueBaixo: boolean;
}

export interface Impressora {
  id: number;
  nome: string;
  marca: string | null;
  modelo: string | null;
  dataCompra: string | null;
  potenciaW: number;
  valorAquisicao: number;
  vidaUtilH: number;
  custoManutencaoAnual: number;
  taxaManutencao: number;
  taxaFalhaPadrao: number;
}

export interface CustoFixo {
  id: number;
  nome: string;
  valorMensal: number;
}

export interface RespostaCustosFixos {
  itens: CustoFixo[];
  totalMensal: number;
}

export interface CustoVariavel {
  id: number;
  nome: string;
  valorUnitario: number;
  ativo: boolean;
}

export interface Configuracao {
  id: number;
  precoKwh: number;
  valorHoraTrabalho: number;
  horasProdutivasMes: number;
  margemMinima: number;
}

export interface Metricas {
  totais: { orcamentos: number; pendentes: number; aprovados: number; recusados: number };
  financeiro: {
    faturamentoAprovado: number;
    lucroAprovado: number;
    custoMedioPorPeca: number;
    precoMedio: number;
  };
  margem: { realMedia: number; planejadaMedia: number };
  consumoMesG: number;
  consumoPorMaterial: { material: string; gramas: number }[];
  custosPorCategoria: { categoria: string; valor: number }[];
  producaoPorImpressora: { impressora: string; pecas: number; faturamento: number }[];
  porMes: { mes: string; emitidos: number; faturamento: number; lucro: number }[];
}

export interface DetalhamentoCustos {
  custoMaterial: number;
  custoEnergia: number;
  depreciacao: number;
  maoDeObra: number;
  custoFixoRateado: number;
  custoVariavel: number;
  custoTotal: number;
  custoComFalha: number;
}

export interface ResultadoPrecificacao {
  custos: DetalhamentoCustos;
  precoBruto: number;
  precoFinal: number;
  precoCobrado: number;
  desconto: { tipo: string; valorDescontado: number; precoComDesconto: number } | null;
  margem: {
    planejada: number;
    minima: number;
    real: number;
    aposArredondamento: number;
    atingeMinima: boolean;
    lucro: number;
  };
}

export interface RespostaSimulacao {
  resultado: ResultadoPrecificacao;
  consumoG: number;
  estoqueSuficiente: boolean;
}

export type ModoArredondamento = 'nenhum' | 'maisProximo' | 'paraCima' | 'psicologico';

export interface OrcamentoInput {
  materialId: number;
  impressoraId: number;
  peca: { pesoG: number; tempoImpressaoH: number; tempoPosProcessamentoH: number };
  parametros: { taxaFalha: number; margemLucro: number };
  custosVariaveisIds?: number[];
  desconto?: { tipo: 'percentual' | 'valor'; valor: number };
  arredondamento?:
    | { modo: 'nenhum' }
    | { modo: 'maisProximo'; passo: number }
    | { modo: 'paraCima'; passo: number }
    | { modo: 'psicologico'; terminacao: number };
  cliente?: string;
  telefone?: string;
  descricaoPeca?: string;
}
