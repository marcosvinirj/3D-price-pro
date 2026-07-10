/** CRUD de custos variaveis por peca (cola, embalagem, etiqueta, frete...). */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, naoEncontrado } from '../../http/errors.js';
import { validarBody, obterId } from '../../http/validate.js';

export const custosVariaveisRouter = Router();

const custoVariavelSchema = z.object({
  nome: z.string().min(1),
  valorUnitario: z.number().nonnegative(),
  ativo: z.boolean().optional(),
});

custosVariaveisRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const itens = await prisma.custoVariavel.findMany({ orderBy: { nome: 'asc' } });
    res.json(itens);
  }),
);

custosVariaveisRouter.post(
  '/',
  validarBody(custoVariavelSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await prisma.custoVariavel.create({ data: req.body }));
  }),
);

custosVariaveisRouter.patch(
  '/:id',
  validarBody(custoVariavelSchema.partial()),
  asyncHandler(async (req, res) => {
    const id = obterId(req);
    if (!(await prisma.custoVariavel.findUnique({ where: { id } })))
      throw naoEncontrado('Custo variavel');
    res.json(await prisma.custoVariavel.update({ where: { id }, data: req.body }));
  }),
);

custosVariaveisRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = obterId(req);
    if (!(await prisma.custoVariavel.findUnique({ where: { id } })))
      throw naoEncontrado('Custo variavel');
    await prisma.custoVariavel.delete({ where: { id } });
    res.status(204).end();
  }),
);
