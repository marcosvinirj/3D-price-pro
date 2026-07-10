/** CRUD de impressoras. */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, naoEncontrado } from '../../http/errors.js';
import { validarBody, obterId } from '../../http/validate.js';

export const impressorasRouter = Router();

const impressoraSchema = z.object({
  nome: z.string().min(1),
  marca: z.string().optional(),
  modelo: z.string().optional(),
  dataCompra: z.string().optional(),
  potenciaW: z.number().nonnegative(),
  valorAquisicao: z.number().nonnegative(),
  vidaUtilH: z.number().positive(),
  custoManutencaoAnual: z.number().min(0).default(0),
  taxaManutencao: z.number().min(0).default(0),
  taxaFalhaPadrao: z.number().min(0).max(1).default(0.1),
});

const impressoraUpdateSchema = impressoraSchema.partial();

impressorasRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await prisma.impressora.findMany({ where: { ativo: true }, orderBy: { nome: 'asc' } }));
  }),
);

impressorasRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const item = await prisma.impressora.findUnique({ where: { id: obterId(req) } });
    if (!item) throw naoEncontrado('Impressora');
    res.json(item);
  }),
);

impressorasRouter.post(
  '/',
  validarBody(impressoraSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await prisma.impressora.create({ data: req.body }));
  }),
);

impressorasRouter.patch(
  '/:id',
  validarBody(impressoraUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = obterId(req);
    if (!(await prisma.impressora.findUnique({ where: { id } }))) throw naoEncontrado('Impressora');
    res.json(await prisma.impressora.update({ where: { id }, data: req.body }));
  }),
);

impressorasRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = obterId(req);
    if (!(await prisma.impressora.findUnique({ where: { id } }))) throw naoEncontrado('Impressora');
    await prisma.impressora.update({ where: { id }, data: { ativo: false } });
    res.status(204).end();
  }),
);
