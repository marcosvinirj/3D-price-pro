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
    margemMinima: z.number().min(0).max(100),
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
