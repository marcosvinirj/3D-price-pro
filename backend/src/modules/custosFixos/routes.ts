/** CRUD de custos fixos mensais (aluguel, internet, marketing...). */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, naoEncontrado } from '../../http/errors.js';
import { validarBody, obterId } from '../../http/validate.js';

export const custosFixosRouter = Router();

const custoFixoSchema = z.object({
  nome: z.string().min(1),
  valorMensal: z.number().nonnegative(),
});

custosFixosRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const itens = await prisma.custoFixo.findMany({ orderBy: { nome: 'asc' } });
    const total = itens.reduce((s, c) => s + c.valorMensal, 0);
    res.json({ itens, totalMensal: total });
  }),
);

custosFixosRouter.post(
  '/',
  validarBody(custoFixoSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await prisma.custoFixo.create({ data: req.body }));
  }),
);

custosFixosRouter.patch(
  '/:id',
  validarBody(custoFixoSchema.partial()),
  asyncHandler(async (req, res) => {
    const id = obterId(req);
    if (!(await prisma.custoFixo.findUnique({ where: { id } }))) throw naoEncontrado('Custo fixo');
    res.json(await prisma.custoFixo.update({ where: { id }, data: req.body }));
  }),
);

custosFixosRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = obterId(req);
    if (!(await prisma.custoFixo.findUnique({ where: { id } }))) throw naoEncontrado('Custo fixo');
    await prisma.custoFixo.delete({ where: { id } });
    res.status(204).end();
  }),
);
