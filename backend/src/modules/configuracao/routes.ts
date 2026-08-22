/** Leitura e atualizacao dos parametros globais de precificacao. */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler } from '../../http/errors.js';
import { validarBody } from '../../http/validate.js';
import { obterConfiguracao } from './service.js';

export const configuracaoRouter = Router();

const configSchema = z
  .object({
    precoKwh: z.number().nonnegative(),
    valorHoraTrabalho: z.number().nonnegative(),
    horasProdutivasMes: z.number().positive(),
    // Margem MINIMA sobre o PRECO de venda: precisa ser < 100% (a formula
    // preco = custo / (1 - margem) diverge em 100% ou mais — ver pricing/schema.ts).
    margemMinima: z.number().min(0).lt(1),
  })
  .partial();

configuracaoRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await obterConfiguracao(req.usuario!.sub));
  }),
);

configuracaoRouter.patch(
  '/',
  validarBody(configSchema),
  asyncHandler(async (req, res) => {
    const usuarioId = req.usuario!.sub;
    await obterConfiguracao(usuarioId); // garante que a linha existe
    const atualizada = await prisma.configuracao.update({ where: { usuarioId }, data: req.body });
    res.json(atualizada);
  }),
);
