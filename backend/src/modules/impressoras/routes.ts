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
  /** Potencia MAXIMA/nominal informada pelo fabricante — informativa, nao entra no calculo. */
  potenciaW: z.number().nonnegative(),
  /** Consumo MEDIO durante a impressao — e' o unico valor usado no custo de energia. */
  potenciaMediaW: z.number().positive('Consumo medio deve ser maior que zero'),
  valorAquisicao: z.number().nonnegative(),
  vidaUtilH: z.number().positive(),
  custoManutencaoAnual: z.number().min(0).default(0),
  taxaManutencao: z.number().min(0).default(0),
  taxaFalhaPadrao: z.number().min(0).max(1).default(0.1),
});

const impressoraUpdateSchema = impressoraSchema.partial();

impressorasRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(
      await prisma.impressora.findMany({
        where: { ativo: true, usuarioId: req.usuario!.sub },
        orderBy: { nome: 'asc' },
      }),
    );
  }),
);

impressorasRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const item = await prisma.impressora.findFirst({
      where: { id: obterId(req), usuarioId: req.usuario!.sub },
    });
    if (!item) throw naoEncontrado('Impressora');
    res.json(item);
  }),
);

impressorasRouter.post(
  '/',
  validarBody(impressoraSchema),
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(await prisma.impressora.create({ data: { ...req.body, usuarioId: req.usuario!.sub } }));
  }),
);

impressorasRouter.patch(
  '/:id',
  validarBody(impressoraUpdateSchema),
  asyncHandler(async (req, res) => {
    const id = obterId(req);
    if (!(await prisma.impressora.findFirst({ where: { id, usuarioId: req.usuario!.sub } })))
      throw naoEncontrado('Impressora');
    res.json(await prisma.impressora.update({ where: { id }, data: req.body }));
  }),
);

impressorasRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = obterId(req);
    if (!(await prisma.impressora.findFirst({ where: { id, usuarioId: req.usuario!.sub } })))
      throw naoEncontrado('Impressora');
    await prisma.impressora.update({ where: { id }, data: { ativo: false } });
    res.status(204).end();
  }),
);
