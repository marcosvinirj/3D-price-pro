/** CRUD de materiais + alerta de estoque baixo. */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, naoEncontrado } from '../../http/errors.js';
import { validarBody, obterId } from '../../http/validate.js';

export const materiaisRouter = Router();

const materialSchema = z.object({
  nome: z.string().min(1),
  tipo: z.string().min(1),
  precoKg: z.number().nonnegative(),
  densidade: z.number().positive().optional(),
  cor: z.string().optional(),
  estoqueG: z.number().nonnegative().default(0),
  estoqueMinimoG: z.number().nonnegative().default(0),
  taxaDesperdicio: z.number().min(0).max(1).default(0.05),
});

const materialUpdateSchema = materialSchema.partial();

/** Acrescenta flag de estoque baixo ao material. */
function comAlerta<T extends { estoqueG: number; estoqueMinimoG: number }>(m: T) {
  return { ...m, estoqueBaixo: m.estoqueG <= m.estoqueMinimoG };
}

materiaisRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const itens = await prisma.material.findMany({
      where: { ativo: true },
      orderBy: { nome: 'asc' },
    });
    res.json(itens.map(comAlerta));
  }),
);

materiaisRouter.get(
  '/alertas/estoque-baixo',
  asyncHandler(async (_req, res) => {
    const todos = await prisma.material.findMany({ where: { ativo: true } });
    res.json(todos.filter((m) => m.estoqueG <= m.estoqueMinimoG).map(comAlerta));
  }),
);

materiaisRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const material = await prisma.material.findUnique({ where: { id: obterId(req) } });
    if (!material) throw naoEncontrado('Material');
    res.json(comAlerta(material));
  }),
);

materiaisRouter.post(
  '/',
  validarBody(materialSchema),
  asyncHandler(async (req, res) => {
    const material = await prisma.material.create({ data: req.body });
    res.status(201).json(comAlerta(material));
  }),
);

materiaisRouter.patch(
  '/:id',
  validarBody(materialUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = obterId(req);
    const existe = await prisma.material.findUnique({ where: { id } });
    if (!existe) throw naoEncontrado('Material');
    const material = await prisma.material.update({ where: { id }, data: req.body });
    res.json(comAlerta(material));
  }),
);

materiaisRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = obterId(req);
    const existe = await prisma.material.findUnique({ where: { id } });
    if (!existe) throw naoEncontrado('Material');
    // Soft-delete: preserva integridade dos orcamentos historicos (regra 6).
    await prisma.material.update({ where: { id }, data: { ativo: false } });
    res.status(204).end();
  }),
);
