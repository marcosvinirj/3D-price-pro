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

/** Uma movimentacao de creditos (ganho ou gasto) — extrato/historico. */
export interface CreditoTransacao {
  id: number;
  quantidade: number; // positivo = ganho, negativo = gasto
  tipo: 'bonus_cadastro' | 'assinatura_mensal' | 'pacote_avulso' | 'consumo_orcamento' | 'consumo_pdf';
  referencia: string | null;
  criadoEm: string;
}

export interface Assinatura {
  status: string; // active | past_due | canceled | ...
  periodoAtualFim: string;
}

export interface SaldoCreditos {
  creditos: number;
  /** Conta isenta (administrativa/interna) — nunca debita, independente do numero em `creditos`. */
  ilimitado: boolean;
  assinaturaAtiva: boolean;
  assinatura: Assinatura | null;
  historico: CreditoTransacao[];
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

/** Insumo consumido POR PECA (argola, escovinha, saco zip...). Ao contrario
 *  de CustoVariavel (cobrado uma vez por orcamento), o consumo escala com a
 *  quantidade de pecas do item que o usa — tem estoque proprio em unidades. */
export interface Insumo {
  id: number;
  nome: string;
  valorUnitario: number;
  estoqueUnidades: number;
  estoqueMinimoUnidades: number;
  estoqueBaixo: boolean;
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
  custoInsumos: number;
  custoTotal: number;
  custoComFalha: number;
}

/** Detalhamento de custo de UMA peca dentro de um orcamento multi-peca. */
export interface DetalhamentoItemCusto {
  nome?: string;
  pesoG: number;
  quantidade: number;
  custoMaterial: number;
  custoEnergia: number;
  depreciacao: number;
  maoDeObra: number;
  custoFixoRateado: number;
  custoInsumos: number;
  custoItemTotal: number;
}

export interface ResultadoPrecificacao {
  custos: DetalhamentoCustos;
  /** Detalhamento por peca (orcamentos multi-peca). */
  itens: DetalhamentoItemCusto[];
  precoBruto: number;
  precoFinal: number;
  precoCobrado: number;
  desconto: { tipo: string; valorDescontado: number; precoComDesconto: number } | null;
  margem: {
    /** Margem desejada SOBRE O PRECO de venda (fracao: lucro / preco). */
    planejada: number;
    /** Margem minima SOBRE O PRECO, configurada em Configuração. */
    minima: number;
    /** Margem real sobre o preço cobrado (após desconto). */
    real: number;
    aposArredondamento: number;
    atingeMinima: boolean;
    lucro: number;
    /** Markup SOBRE O CUSTO (fracao: lucro / custoComFalha) — nao confundir com margem (sobre o preço). */
    markupSobreCusto: number;
  };
}

export interface RespostaSimulacao {
  resultado: ResultadoPrecificacao;
  /** Consumo/estoque por peca (mesma ordem dos itens enviados). */
  itens: {
    materialId: number;
    consumoG: number;
    estoqueSuficiente: boolean;
    insumos: { insumoId: number; totalUnidades: number; estoqueSuficiente: boolean }[];
  }[];
  estoqueSuficiente: boolean;
}

export type ModoArredondamento = 'nenhum' | 'maisProximo' | 'paraCima' | 'psicologico';

/** Um insumo usado numa peca; `quantidade` é o TOTAL direto usado nela (não "por unidade"). */
export interface OrcamentoItemInsumoInput {
  insumoId: number;
  quantidade: number;
}

export interface OrcamentoItemInput {
  nome?: string;
  materialId: number;
  pesoG: number;
  tempoImpressaoH: number;
  tempoPosProcessamentoH: number;
  /** Unidades identicas que esta peca representa (25 canudos = 25). */
  quantidade: number;
  insumos?: OrcamentoItemInsumoInput[];
}

export interface OrcamentoInput {
  impressoraId: number;
  itens: OrcamentoItemInput[];
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

/** Um insumo usado numa peca ja salva (como devolvido pela API). */
export interface OrcamentoItemInsumoSalvo {
  id: number;
  insumoId: number;
  quantidadePorPeca: number;
  valorUnitarioSnapshot: number;
  insumo: { nome: string };
}

/** Uma peca de um orcamento ja salvo (como devolvido pela API). */
export interface OrcamentoItemSalvo {
  id: number;
  nome: string | null;
  pesoG: number;
  tempoImpressaoH: number;
  tempoPosProcessamentoH: number;
  quantidade: number;
  consumoG: number;
  custoItem: number;
  materialId: number;
  material: { nome: string; cor: string | null; tipo?: string };
  insumos: OrcamentoItemInsumoSalvo[];
}

/** Um custo variavel selecionado num orcamento ja salvo (como devolvido pela API). */
export interface OrcamentoCustoVariavelSalvo {
  id: number;
  custoVariavelId: number;
  valorUnitarioSnapshot: number;
  custoVariavel: { nome: string };
}

/** Orcamento completo, como devolvido por GET /orcamentos/:id. */
export interface OrcamentoDetalhado {
  id: number;
  cliente: string | null;
  telefone: string | null;
  descricaoPeca: string | null;
  status: 'pendente' | 'aprovado' | 'recusado';
  precoFinal: number;
  precoCobrado: number;
  impressoraId: number;
  impressora: { id: number; nome: string };
  itens: OrcamentoItemSalvo[];
  custosVariaveisSelecionados: OrcamentoCustoVariavelSalvo[];
  resultado: ResultadoPrecificacao;
}
