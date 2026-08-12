/**
 * CRUD de insumos + alerta de estoque baixo.
 *
 * Insumo = consumivel usado POR PECA (argola, escovinha, saco zip...).
 * Diferente de Custo Variavel (cobrado uma vez por orcamento inteiro), o
 * consumo de um insumo escala com a quantidade de pecas do item que o usa —
 * por isso tem estoque proprio em UNIDADES, com o mesmo padrao de alerta de
 * estoque baixo do Material (ver modules/materiais/routes.ts).
 */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, naoEncontrado } from '../../http/errors.js';
import { validarBody, obterId } from '../../http/validate.js';

export const insumosRouter = Router();

const insumoSchema = z.object({
  nome: z.string().min(1),
  valorUnitario: z.number().nonnegative(),
  estoqueUnidades: z.number().int().nonnegative().default(0),
  estoqueMinimoUnidades: z.number().int().nonnegative().default(0),
});

const insumoUpdateSchema = insumoSchema.partial();

/** Acrescenta flag de estoque baixo ao insumo. */
function comAlerta<T extends { estoqueUnidades: number; estoqueMinimoUnidades: number }>(i: T) {
  return { ...i, estoqueBaixo: i.estoqueUnidades <= i.estoqueMinimoUnidades };
}

insumosRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const itens = await prisma.insumo.findMany({
      where: { ativo: true, usuarioId: req.usuario!.sub },
      orderBy: { nome: 'asc' },
    });
    res.json(itens.map(comAlerta));
  }),
);

insumosRouter.get(
  '/alertas/estoque-baixo',
  asyncHandler(async (req, res) => {
    const todos = await prisma.insumo.findMany({
      where: { ativo: true, usuarioId: req.usuario!.sub },
    });
    res.json(todos.filter((i) => i.estoqueUnidades <= i.estoqueMinimoUnidades).map(comAlerta));
  }),
);

insumosRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const insumo = await prisma.insumo.findFirst({
      where: { id: obterId(req), usuarioId: req.usuario!.sub },
    });
    if (!insumo) throw naoEncontrado('Insumo');
    res.json(comAlerta(insumo));
  }),
);

insumosRouter.post(
  '/',
  validarBody(insumoSchema),
  asyncHandler(async (req, res) => {
    const insumo = await prisma.insumo.create({
      data: { ...req.body, usuarioId: req.usuario!.sub },
    });
    res.status(201).json(comAlerta(insumo));
  }),
);

insumosRouter.patch(
  '/:id',
  validarBody(insumoUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = obterId(req);
    const existe = await prisma.insumo.findFirst({ where: { id, usuarioId: req.usuario!.sub } });
    if (!existe) throw naoEncontrado('Insumo');
    const insumo = await prisma.insumo.update({ where: { id }, data: req.body });
    res.json(comAlerta(insumo));
  }),
);

insumosRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = obterId(req);
    const existe = await prisma.insumo.findFirst({ where: { id, usuarioId: req.usuario!.sub } });
    if (!existe) throw naoEncontrado('Insumo');
    // Soft-delete: preserva integridade dos orcamentos historicos (regra 6).
    await prisma.insumo.update({ where: { id }, data: { ativo: false } });
    res.status(204).end();
  }),
);
