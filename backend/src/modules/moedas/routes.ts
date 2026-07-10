/** CRUD de moedas de exibicao (a base EUR nao pode ser removida/retaxada). */
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma.js';
import { asyncHandler, naoEncontrado, regraDeNegocio, conflito } from '../../http/errors.js';
import { validarBody } from '../../http/validate.js';
import { listarMoedas } from './service.js';

export const moedasRouter = Router();

const moedaSchema = z.object({
  codigo: z.string().trim().regex(/^[A-Za-z]{3}$/, 'Use o código ISO de 3 letras (ex.: USD)'),
  nome: z.string().min(1),
  simbolo: z.string().min(1).max(4),
  taxaParaBase: z.number().positive('A taxa deve ser maior que zero'),
});

const moedaUpdateSchema = moedaSchema.omit({ codigo: true }).partial();

moedasRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await listarMoedas());
  }),
);

moedasRouter.post(
  '/',
  validarBody(moedaSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof moedaSchema>;
    const codigo = body.codigo.toUpperCase();
    if (await prisma.moeda.findUnique({ where: { codigo } })) throw conflito('Moeda já cadastrada');
    const moeda = await prisma.moeda.create({
      data: { codigo, nome: body.nome, simbolo: body.simbolo, taxaParaBase: body.taxaParaBase },
    });
    res.status(201).json(moeda);
  }),
);

moedasRouter.patch(
  '/:codigo',
  validarBody(moedaUpdateSchema),
  asyncHandler(async (req, res) => {
    const codigo = req.params.codigo!.toUpperCase();
    const moeda = await prisma.moeda.findUnique({ where: { codigo } });
    if (!moeda) throw naoEncontrado('Moeda');
    const body = req.body as z.infer<typeof moedaUpdateSchema>;
    if (moeda.base && body.taxaParaBase !== undefined && body.taxaParaBase !== 1) {
      throw regraDeNegocio('A moeda base (EUR) sempre tem taxa 1.');
    }
    // req.body (any) evita atrito com exactOptionalPropertyTypes no Prisma.
    res.json(await prisma.moeda.update({ where: { codigo }, data: req.body }));
  }),
);

moedasRouter.delete(
  '/:codigo',
  asyncHandler(async (req, res) => {
    const codigo = req.params.codigo!.toUpperCase();
    const moeda = await prisma.moeda.findUnique({ where: { codigo } });
    if (!moeda) throw naoEncontrado('Moeda');
    if (moeda.base) throw regraDeNegocio('A moeda base (EUR) não pode ser removida.');
    await prisma.moeda.delete({ where: { codigo } });
    res.status(204).end();
  }),
);
