import { describe, it, expect } from 'vitest';
import {
  precificar,
  precificarMultiplo,
  ErroValidacaoPrecificacao,
  type EntradaPrecificacaoInput,
  type EntradaPrecificacaoMultiplaInput,
} from './index.js';

/**
 * Entrada base valida e reutilizavel. Cada teste sobrescreve so o que precisa.
 *
 * Custos esperados desta base:
 *   material     = (50 * 120 / 1000) * 1.05 = 6.30
 *   energia      = (200 / 1000) * 4 * 0.95  = 0.76
 *   depreciacao  = (2000 / 2000) * 4        = 4.00
 *   mao de obra  = 0.5 * 20                 = 10.00
 *   fixo rateado = (1000 / 400) * 4         = 10.00  (custo fixo/hora * tempoImpressaoH)
 *   custoTotal   = 31.06
 *   custoComFalha= 31.06 * 1.10             = 34.166
 *   precoBruto   = 34.166 * 1.50            = 51.249
 */
function entradaBase(
  over: Partial<EntradaPrecificacaoInput> = {},
): EntradaPrecificacaoInput {
  return {
    peca: { pesoG: 50, tempoImpressaoH: 4, tempoPosProcessamentoH: 0.5 },
    material: { precoKg: 120, taxaDesperdicio: 0.05 },
    impressora: { potenciaW: 200, valorAquisicao: 2000, vidaUtilH: 2000 },
    custos: {
      precoKwh: 0.95,
      valorHoraTrabalho: 20,
      custosFixosMensais: 1000,
      horasProdutivasMes: 400,
    },
    parametros: { taxaFalha: 0.1, margemLucro: 0.5, margemMinima: 0.2 },
    ...over,
  };
}

describe('componentes de custo', () => {
  const r = precificar(entradaBase());

  it('custo de material inclui desperdicio', () => {
    expect(r.custos.custoMaterial).toBeCloseTo(6.3, 4);
  });
  it('custo de energia usa potencia, tempo e kWh', () => {
    expect(r.custos.custoEnergia).toBeCloseTo(0.76, 4);
  });
  it('depreciacao rateia o valor da impressora pela vida util', () => {
    expect(r.custos.depreciacao).toBeCloseTo(4, 4);
  });
  it('mao de obra usa tempo de pos-processamento', () => {
    expect(r.custos.maoDeObra).toBeCloseTo(10, 4);
  });
  it('custo fixo e rateado por hora produtiva x tempo de impressao', () => {
    // (1000 / 400) * 4 = 10.00
    expect(r.custos.custoFixoRateado).toBeCloseTo(10, 4);
  });

  it('custo fixo rateado escala com o tempo de impressao', () => {
    // Dobrar o tempo de impressao dobra o custo fixo rateado (2.50/h * 8 = 20).
    const r8 = precificar(
      entradaBase({ peca: { pesoG: 50, tempoImpressaoH: 8, tempoPosProcessamentoH: 0.5 } }),
    );
    expect(r8.custos.custoFixoRateado).toBeCloseTo(20, 4);
  });
  it('custo total soma todos os componentes', () => {
    expect(r.custos.custoTotal).toBeCloseTo(31.06, 4);
  });

  it('custo variavel e zero por padrao', () => {
    expect(r.custos.custoVariavel).toBe(0);
  });
});

describe('custos variaveis (soma dos itens selecionados)', () => {
  it('soma o custo variavel ao custo total', () => {
    // base custoTotal = 31.06; + 2.50 de variaveis = 33.56
    const r = precificar(
      entradaBase({
        custos: {
          precoKwh: 0.95,
          valorHoraTrabalho: 20,
          custosFixosMensais: 1000,
          horasProdutivasMes: 400,
          custoVariavel: 2.5,
        },
      }),
    );
    expect(r.custos.custoVariavel).toBeCloseTo(2.5, 4);
    expect(r.custos.custoTotal).toBeCloseTo(33.56, 4);
  });

  it('rejeita custo variavel negativo', () => {
    expect(() =>
      precificar(
        entradaBase({
          custos: {
            precoKwh: 0.95,
            valorHoraTrabalho: 20,
            custosFixosMensais: 1000,
            horasProdutivasMes: 400,
            custoVariavel: -1,
          },
        }),
      ),
    ).toThrow(ErroValidacaoPrecificacao);
  });
});

describe('custo repassado (custos variaveis e insumos) NAO leva provisao de falha nem margem', () => {
  it('custo variavel (ex.: frete) aumenta o preco final pelo seu valor EXATO, sem markup', () => {
    const semFrete = precificar(entradaBase());
    const comFrete = precificar(
      entradaBase({
        custos: {
          precoKwh: 0.95,
          valorHoraTrabalho: 20,
          custosFixosMensais: 1000,
          horasProdutivasMes: 400,
          custoVariavel: 3.5,
        },
      }),
    );
    // taxaFalha=10% e margemLucro=50% da entradaBase NAO incidem sobre os
    // 3.50 de frete — o preco bruto sobe exatamente 3.50, nao 3.50*1.1*1.5=5.775.
    expect(comFrete.precoBruto - semFrete.precoBruto).toBeCloseTo(3.5, 4);
  });

  it('custoTotal (exibicao) soma tudo; custoComFalha e nucleo-com-falha + repasse cheio (sem markup no repasse)', () => {
    const r = precificar(
      entradaBase({
        custos: {
          precoKwh: 0.95,
          valorHoraTrabalho: 20,
          custosFixosMensais: 1000,
          horasProdutivasMes: 400,
          custoVariavel: 3.5,
        },
      }),
    );
    expect(r.custos.custoTotal).toBeCloseTo(34.56, 4); // 31.06 (nucleo) + 3.5
    expect(r.custos.custoComFalha).toBeCloseTo(37.666, 4); // 31.06*1.1 + 3.5
  });

  it('insumo (ex.: argola) tambem aumenta o preco final pelo valor exato, sem markup', () => {
    const semInsumo = precificarMultiplo(entradaMultiplaBase());
    const comInsumo = precificarMultiplo(
      entradaMultiplaBase({
        itens: [
          {
            peca: {
              pesoG: 50,
              tempoImpressaoH: 4,
              tempoPosProcessamentoH: 0.5,
              quantidade: 1,
              insumos: [{ valorUnitario: 0.07, quantidade: 1 }],
            },
            material: { precoKg: 120, taxaDesperdicio: 0.05 },
          },
        ],
      }),
    );
    expect(comInsumo.precoBruto - semInsumo.precoBruto).toBeCloseTo(0.07, 4);
  });
});

describe('aplicacao de falha e margem', () => {
  it('aplica taxa de falha e margem sobre o custo total', () => {
    const r = precificar(entradaBase());
    expect(r.custos.custoComFalha).toBeCloseTo(34.166, 4);
    expect(r.precoBruto).toBeCloseTo(51.249, 4);
  });

  it('sem arredondamento, o preco final apenas normaliza para 2 casas', () => {
    const r = precificar(entradaBase());
    expect(r.precoFinal).toBe(51.25);
  });

  it('margem real bate com a planejada quando nao ha desconto', () => {
    const r = precificar(entradaBase());
    expect(r.margem.planejada).toBe(0.5);
    expect(r.margem.real).toBeCloseTo(0.5, 2);
  });
});

describe('arredondamento', () => {
  it('psicologico forca terminacao em ,90 para cima', () => {
    const r = precificar(entradaBase({ arredondamento: { modo: 'psicologico', terminacao: 0.9 } }));
    expect(r.precoFinal).toBe(51.9);
  });

  it('psicologico sobe para o proximo inteiro quando ja passou da terminacao', () => {
    // precoBruto ~91.5 => deve virar 91.90 (nao 90.90)
    const r = precificar(
      entradaBase({ parametros: { taxaFalha: 0.1, margemLucro: 1.68, margemMinima: 0.2 }, arredondamento: { modo: 'psicologico', terminacao: 0.9 } }),
    );
    expect(r.precoFinal.toFixed(2).endsWith('.90')).toBe(true);
    expect(r.precoFinal).toBeGreaterThanOrEqual(r.precoBruto);
  });

  it('paraCima nunca reduz o preco (protege margem)', () => {
    const r = precificar(entradaBase({ arredondamento: { modo: 'paraCima', passo: 1 } }));
    expect(r.precoFinal).toBe(52);
    expect(r.precoFinal).toBeGreaterThanOrEqual(r.precoBruto);
  });

  it('maisProximo arredonda ao multiplo do passo', () => {
    const r = precificar(entradaBase({ arredondamento: { modo: 'maisProximo', passo: 0.5 } }));
    expect(r.precoFinal).toBe(51);
  });
});

describe('margem minima vs arredondamento (regra 2)', () => {
  it('atingeMinima e true quando o arredondamento nao derruba a margem', () => {
    const r = precificar(entradaBase());
    expect(r.margem.atingeMinima).toBe(true);
    expect(r.margem.minima).toBe(0.2);
  });

  it('atingeMinima fica false quando arredondar para baixo fura o piso', () => {
    // margem planejada exatamente na minima (20%); arredondar para baixo
    // com passo grande derruba a margem do preco de tabela abaixo de 20%.
    const r = precificar(
      entradaBase({
        parametros: { taxaFalha: 0.1, margemLucro: 0.2, margemMinima: 0.2 },
        arredondamento: { modo: 'maisProximo', passo: 10 },
      }),
    );
    // custoComFalha ~34.166, precoBruto ~41.0 => maisProximo(10) => 40 (abaixo)
    expect(r.precoFinal).toBe(40);
    expect(r.margem.aposArredondamento).toBeLessThan(0.2);
    expect(r.margem.atingeMinima).toBe(false);
  });

  it('desconto promocional nao afeta atingeMinima (regra 7)', () => {
    const r = precificar(entradaBase({ desconto: { tipo: 'percentual', valor: 0.5 } }));
    // desconto pesado derruba a margem REAL, mas o preco de tabela segue ok
    expect(r.margem.real).toBeLessThan(0.2);
    expect(r.margem.atingeMinima).toBe(true);
  });
});

describe('desconto (regra 7: so sobre o preco final)', () => {
  it('desconto percentual nao altera os custos e preco + desconto batem ao centavo', () => {
    const r = precificar(entradaBase({ desconto: { tipo: 'percentual', valor: 0.1 } }));
    expect(r.custos.custoTotal).toBeCloseTo(31.06, 4); // custos intactos
    expect(r.desconto).not.toBeNull();
    expect(r.precoCobrado + r.desconto!.valorDescontado).toBeCloseTo(r.precoFinal, 2);
    expect(r.precoCobrado).toBeLessThan(r.precoFinal);
  });

  it('desconto reduz a margem real, mas nao a planejada', () => {
    const r = precificar(entradaBase({ desconto: { tipo: 'percentual', valor: 0.2 } }));
    expect(r.margem.planejada).toBe(0.5);
    expect(r.margem.real).toBeLessThan(0.5);
  });

  it('desconto em valor nunca deixa o preco cobrado negativo', () => {
    const r = precificar(entradaBase({ desconto: { tipo: 'valor', valor: 9999 } }));
    expect(r.precoCobrado).toBe(0);
    expect(r.desconto!.valorDescontado).toBe(r.precoFinal);
  });
});

describe('validacao de entrada', () => {
  it('bloqueia margem abaixo da minima (regra 2)', () => {
    expect(() =>
      precificar(entradaBase({ parametros: { taxaFalha: 0.1, margemLucro: 0.1, margemMinima: 0.2 } })),
    ).toThrow(ErroValidacaoPrecificacao);
  });

  it('rejeita peso negativo', () => {
    expect(() =>
      precificar(entradaBase({ peca: { pesoG: -5, tempoImpressaoH: 4, tempoPosProcessamentoH: 0.5 } })),
    ).toThrow(ErroValidacaoPrecificacao);
  });

  it('rejeita horas produtivas por mes igual a zero (divisao por zero)', () => {
    expect(() =>
      precificar(
        entradaBase({ custos: { precoKwh: 0.95, valorHoraTrabalho: 20, custosFixosMensais: 1000, horasProdutivasMes: 0 } }),
      ),
    ).toThrow(ErroValidacaoPrecificacao);
  });

  it('rejeita taxa de falha fora da faixa 0..1', () => {
    expect(() =>
      precificar(entradaBase({ parametros: { taxaFalha: 1.5, margemLucro: 0.5, margemMinima: 0.2 } })),
    ).toThrow(ErroValidacaoPrecificacao);
  });

  it('a margem minima tem default de 20% quando omitida', () => {
    // margemLucro 0.1 < default 0.2 => deve falhar mesmo sem informar margemMinima
    expect(() =>
      // margemMinima omitida de proposito: cai no default de 0.2
      precificar(entradaBase({ parametros: { taxaFalha: 0.1, margemLucro: 0.1 } })),
    ).toThrow(ErroValidacaoPrecificacao);
  });

  it('erro de validacao carrega os issues do Zod', () => {
    try {
      precificar(entradaBase({ peca: { pesoG: -1, tempoImpressaoH: 4, tempoPosProcessamentoH: 0.5 } }));
      expect.fail('deveria ter lancado');
    } catch (e) {
      expect(e).toBeInstanceOf(ErroValidacaoPrecificacao);
      expect((e as ErroValidacaoPrecificacao).issues.length).toBeGreaterThan(0);
    }
  });
});

/** Uma peca com a mesma economia da `entradaBase` de cima (custoTotal = 31.06). */
function pecaBase(nome?: string) {
  return {
    ...(nome ? { nome } : {}),
    peca: { pesoG: 50, tempoImpressaoH: 4, tempoPosProcessamentoH: 0.5 },
    material: { precoKg: 120, taxaDesperdicio: 0.05 },
  };
}

function entradaMultiplaBase(
  over: Partial<EntradaPrecificacaoMultiplaInput> = {},
): EntradaPrecificacaoMultiplaInput {
  return {
    itens: [pecaBase()],
    impressora: { potenciaW: 200, valorAquisicao: 2000, vidaUtilH: 2000 },
    custos: { precoKwh: 0.95, valorHoraTrabalho: 20, custosFixosMensais: 1000, horasProdutivasMes: 400 },
    parametros: { taxaFalha: 0.1, margemLucro: 0.5, margemMinima: 0.2 },
    ...over,
  };
}

describe('calcularMultiplo (orcamento com varias pecas)', () => {
  it('com 1 peca, bate exatamente com calcular() para a mesma entrada', () => {
    const r = precificarMultiplo(entradaMultiplaBase());
    expect(r.custos.custoTotal).toBeCloseTo(31.06, 4);
    expect(r.precoBruto).toBeCloseTo(51.249, 4);
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]!.custoItemTotal).toBeCloseTo(31.06, 4);
  });

  it('soma os componentes lineares de varias pecas antes de aplicar falha/margem', () => {
    // 2 pecas identicas a entradaBase => todo componente linear dobra.
    const r = precificarMultiplo(entradaMultiplaBase({ itens: [pecaBase('Cauda'), pecaBase('Torso')] }));
    expect(r.custos.custoMaterial).toBeCloseTo(6.3 * 2, 4);
    expect(r.custos.custoTotal).toBeCloseTo(31.06 * 2, 4);
    // falha/margem aplicadas UMA vez sobre o total agregado, nao por peca.
    expect(r.custos.custoComFalha).toBeCloseTo(31.06 * 2 * 1.1, 4);
    expect(r.precoBruto).toBeCloseTo(31.06 * 2 * 1.1 * 1.5, 4);
    expect(r.itens.map((i) => i.nome)).toEqual(['Cauda', 'Torso']);
  });

  it('custo variavel entra uma vez no agregado, nao por peca', () => {
    const umaPeca = precificarMultiplo(
      entradaMultiplaBase({
        custos: { precoKwh: 0.95, valorHoraTrabalho: 20, custosFixosMensais: 1000, horasProdutivasMes: 400, custoVariavel: 5 },
      }),
    );
    const duasPecas = precificarMultiplo(
      entradaMultiplaBase({
        itens: [pecaBase(), pecaBase()],
        custos: { precoKwh: 0.95, valorHoraTrabalho: 20, custosFixosMensais: 1000, horasProdutivasMes: 400, custoVariavel: 5 },
      }),
    );
    expect(umaPeca.custos.custoVariavel).toBeCloseTo(5, 4);
    expect(duasPecas.custos.custoVariavel).toBeCloseTo(5, 4); // nao 10
    // a diferenca entre 2 pecas e 1 peca e' exatamente o custo linear da 2a peca.
    expect(duasPecas.custos.custoTotal - umaPeca.custos.custoTotal).toBeCloseTo(31.06, 4);
  });

  it('margem minima bloqueia no agregado (regra 2)', () => {
    expect(() =>
      precificarMultiplo(
        entradaMultiplaBase({ parametros: { taxaFalha: 0.1, margemLucro: 0.1, margemMinima: 0.2 } }),
      ),
    ).toThrow(ErroValidacaoPrecificacao);
  });

  it('desconto aplica uma vez sobre o preco final agregado', () => {
    const r = precificarMultiplo(
      entradaMultiplaBase({
        itens: [pecaBase(), pecaBase()],
        desconto: { tipo: 'percentual', valor: 0.1 },
      }),
    );
    expect(r.desconto).not.toBeNull();
    expect(r.precoCobrado + r.desconto!.valorDescontado).toBeCloseTo(r.precoFinal, 2);
  });

  it('rejeita orcamento sem nenhuma peca', () => {
    expect(() => precificarMultiplo(entradaMultiplaBase({ itens: [] }))).toThrow(ErroValidacaoPrecificacao);
  });
});

describe('quantidade e insumos por peca', () => {
  it('quantidade default e 1 quando omitida (compatibilidade retroativa)', () => {
    const r = precificarMultiplo(entradaMultiplaBase());
    expect(r.itens[0]!.quantidade).toBe(1);
    expect(r.custos.custoInsumos).toBe(0);
  });

  it('peca.quantidade e puramente informativa — NAO multiplica material nem insumos', () => {
    // 5g de filamento GASTO NO TOTAL (calculo por grama de filamento gasto),
    // sem desperdicio, com 1 argola (0.07) e 1 escovinha (0.05) — os numeros
    // de insumo ja' sao o TOTAL direto, nao "por unidade". Tempo de
    // impressao/pos-processamento e' do LOTE inteiro (nao escala nunca).
    const montar = (quantidadeDaPeca: number) =>
      entradaMultiplaBase({
        itens: [
          {
            nome: 'Canudo',
            peca: {
              pesoG: 5,
              tempoImpressaoH: 2,
              tempoPosProcessamentoH: 1,
              quantidade: quantidadeDaPeca,
              insumos: [
                { valorUnitario: 0.07, quantidade: 1 },
                { valorUnitario: 0.05, quantidade: 1 },
              ],
            },
            material: { precoKg: 100, taxaDesperdicio: 0 },
          },
        ],
        custos: { precoKwh: 1, valorHoraTrabalho: 20, custosFixosMensais: 0, horasProdutivasMes: 160 },
        parametros: { taxaFalha: 0, margemLucro: 0, margemMinima: 0 },
      });

    const item1 = precificarMultiplo(montar(1)).itens[0]!;
    const item25 = precificarMultiplo(montar(25)).itens[0]!;

    // Mudar SO a quantidade da peca nao muda nenhum custo.
    expect(item25.custoMaterial).toBeCloseTo(item1.custoMaterial, 4);
    expect(item25.custoInsumos).toBeCloseTo(item1.custoInsumos, 4);
    expect(item25.custoItemTotal).toBeCloseTo(item1.custoItemTotal, 4);

    expect(item1.custoMaterial).toBeCloseTo(0.5, 4); // (5*100/1000)
    expect(item1.custoInsumos).toBeCloseTo(0.12, 4); // 0.07 + 0.05 (total direto, sem multiplicar)
    expect(item1.custoEnergia).toBeCloseTo(0.4, 4);
    expect(item1.depreciacao).toBeCloseTo(2, 4);
    expect(item1.maoDeObra).toBeCloseTo(20, 4);
    expect(item1.custoItemTotal).toBeCloseTo(23.02, 4);

    // quantidade continua guardada/exibida (usada no PDF), so' nao entra na conta.
    expect(item1.quantidade).toBe(1);
    expect(item25.quantidade).toBe(25);
  });

  it('quantidade do insumo e o total direto — nao "por unidade" (evita duplicar o mesmo multiplicador de dois jeitos)', () => {
    // 15 argolas nesta peca, digitado direto no insumo — nao ha' um segundo
    // multiplicador via peca.quantidade (1x15 e 15x1 dao o mesmo resultado
    // hoje, o que confundia; agora so' o numero do insumo conta).
    const r = precificarMultiplo(
      entradaMultiplaBase({
        itens: [
          {
            peca: {
              pesoG: 5,
              tempoImpressaoH: 1,
              tempoPosProcessamentoH: 0,
              quantidade: 1,
              insumos: [{ valorUnitario: 0.1, quantidade: 15 }],
            },
            material: { precoKg: 100, taxaDesperdicio: 0 },
          },
        ],
        custos: { precoKwh: 0, valorHoraTrabalho: 0, custosFixosMensais: 0, horasProdutivasMes: 160 },
        parametros: { taxaFalha: 0, margemLucro: 0, margemMinima: 0 },
      }),
    );
    expect(r.custos.custoInsumos).toBeCloseTo(1.5, 4); // 0.10 * 15
  });

  it('insumos de varias pecas somam no custoInsumos agregado', () => {
    const peca = (qtd: number) => ({
      peca: {
        pesoG: 5,
        tempoImpressaoH: 1,
        tempoPosProcessamentoH: 0,
        quantidade: 1,
        insumos: [{ valorUnitario: 0.1, quantidade: qtd }],
      },
      material: { precoKg: 100, taxaDesperdicio: 0 },
    });
    const r = precificarMultiplo(
      entradaMultiplaBase({
        itens: [peca(10), peca(5)],
        custos: { precoKwh: 0, valorHoraTrabalho: 0, custosFixosMensais: 0, horasProdutivasMes: 160 },
        parametros: { taxaFalha: 0, margemLucro: 0, margemMinima: 0 },
      }),
    );
    // 10 unidades * 0.10 + 5 unidades * 0.10 = 1.50
    expect(r.custos.custoInsumos).toBeCloseTo(1.5, 4);
  });
});
