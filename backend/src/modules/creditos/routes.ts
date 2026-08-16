/** Rotas de creditos: saldo, checkout (Stripe) e portal de gerenciamento da assinatura. */
import { Router } from 'express';
import { asyncHandler } from '../../http/errors.js';
import { saldoAtual, criarCheckoutAssinatura, criarCheckoutPacote, criarPortalSessao } from './service.js';

export const creditosRouter = Router();

creditosRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await saldoAtual(req.usuario!.sub));
  }),
);

/** Cria a sessao de Checkout da assinatura mensal e devolve a URL pra redirecionar. */
creditosRouter.post(
  '/checkout/assinatura',
  asyncHandler(async (req, res) => {
    res.json({ url: await criarCheckoutAssinatura(req.usuario!.sub) });
  }),
);

/** Cria a sessao de Checkout do pacote avulso e devolve a URL pra redirecionar. */
creditosRouter.post(
  '/checkout/pacote',
  asyncHandler(async (req, res) => {
    res.json({ url: await criarCheckoutPacote(req.usuario!.sub) });
  }),
);

/** Portal do Cliente Stripe — gerenciar/cancelar assinatura, ver faturas. */
creditosRouter.post(
  '/portal',
  asyncHandler(async (req, res) => {
    res.json({ url: await criarPortalSessao(req.usuario!.sub) });
  }),
);
