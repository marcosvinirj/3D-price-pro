/**
 * Rotas PUBLICAS (sem autenticacao) — calculadora de demonstracao do site.
 *
 * Isolada de proposito do resto da API: NAO toca no banco, NAO recebe ids de
 * material/impressora/custo e NAO conhece usuario nenhum. Recebe numeros
 * crus, chama o motor puro (`precificar`) e devolve o resultado. Assim um
 * visitante anonimo nunca consegue enxergar (nem inferir) o catalogo, os
 * custos ou os orcamentos de nenhuma conta real.
 *
 * O preco final chega inteiro na resposta: o "embaçado" da tela e' efeito
 * visual de conversao (cadastre-se pra ver), nao segredo — nao ha' nada
 * sensivel aqui, so' o resultado da conta que o proprio visitante pediu.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../http/errors.js';
import { validarBody } from '../../http/validate.js';
import { precificar } from '../../pricing/index.js';

export const publicoRouter = Router();

/**
 * Premissas fixas da demonstracao. A calculadora publica pede so' o essencial
 * (peso, preco do filamento, tempo); o resto usa valores medios conservadores
 * — a conta com os custos REAIS (energia, depreciacao, mao de obra, custo
 * fixo, insumos, embalagem, frete) e' justamente o que a conta cadastrada faz.
 */
export const PREMISSAS_DEMO = {
  taxaDesperdicio: 0.05, // 5% de purga/suporte
  taxaFalha: 0.1, // 10% de provisao de falha (so' sobre o custo nucleo)
  potenciaMediaW: 150, // consumo medio tipico de uma FDM durante a impressao
  precoKwh: 0.2,
  valorHoraTrabalho: 10,
  tempoPosProcessamentoH: 0.25, // 15 min de pos-processamento
  valorAquisicao: 1500,
  vidaUtilH: 3000, // => depreciacao de 0,50/h
} as const;

/**
 * Entrada da calculadora publica. Limites bem mais apertados que os do motor
 * — e' formulario aberto na internet, entao nao aceita numero absurdo que so'
 * serviria pra poluir/abusar.
 */
const entradaPublicaSchema = z.object({
  pesoG: z.number().finite().positive().max(50_000, 'Peso acima do suportado pela demonstração'),
  precoKg: z.number().finite().nonnegative().max(10_000, 'Preço por kg fora do razoável'),
  tempoImpressaoH: z.number().finite().nonnegative().max(1_000, 'Tempo de impressão fora do razoável'),
  margemLucro: z.number().finite().min(0).lt(1).default(0.6),
});

publicoRouter.post(
  '/simular',
  validarBody(entradaPublicaSchema),
  asyncHandler(async (req, res) => {
    const { pesoG, precoKg, tempoImpressaoH, margemLucro } = req.body as z.infer<typeof entradaPublicaSchema>;

    const resultado = precificar({
      peca: {
        pesoG,
        tempoImpressaoH,
        tempoPosProcessamentoH: PREMISSAS_DEMO.tempoPosProcessamentoH,
      },
      material: { precoKg, taxaDesperdicio: PREMISSAS_DEMO.taxaDesperdicio },
      impressora: {
        potenciaMediaW: PREMISSAS_DEMO.potenciaMediaW,
        valorAquisicao: PREMISSAS_DEMO.valorAquisicao,
        vidaUtilH: PREMISSAS_DEMO.vidaUtilH,
      },
      custos: {
        precoKwh: PREMISSAS_DEMO.precoKwh,
        valorHoraTrabalho: PREMISSAS_DEMO.valorHoraTrabalho,
        custosFixosMensais: 0, // nao da' pra saber o custo fixo de quem nem tem conta
        horasProdutivasMes: 160,
      },
      parametros: { taxaFalha: PREMISSAS_DEMO.taxaFalha, margemLucro, margemMinima: 0 },
      arredondamento: { modo: 'nenhum' },
    });

    res.json({ resultado, premissas: PREMISSAS_DEMO });
  }),
);
