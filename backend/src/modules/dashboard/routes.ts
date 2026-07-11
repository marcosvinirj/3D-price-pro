/** Rota de metricas do dashboard. */
import { Router } from 'express';
import { asyncHandler } from '../../http/errors.js';
import { obterMetricas } from './service.js';

export const dashboardRouter = Router();

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await obterMetricas(req.usuario!.sub));
  }),
);
