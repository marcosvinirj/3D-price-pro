/** Rotas de creditos: saldo, checkout (Stripe) e portal de gerenciamento da assinatura. */
import { Router } from 'express';
import { asyncHandler } from '../../http/errors.js';
import {
  saldoAtual,
  criarCheckoutAssinatura,
  criarCheckoutPacote,
  criarCheckoutIlimitado,
  criarPortalSessao,
  debitar,
  CUSTO_ORCAMENTO,
} from './service.js';

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

/** Cria a sessao de Checkout da assinatura ILIMITADA e devolve a URL. */
creditosRouter.post(
  '/checkout/ilimitado',
  asyncHandler(async (req, res) => {
    res.json({ url: await criarCheckoutIlimitado(req.usuario!.sub) });
  }),
);

/**
 * Libera o preco final de uma simulacao feita na calculadora PUBLICA, depois
 * que o visitante se cadastrou. Cobra o MESMO custo de um orcamento
 * (CUSTO_ORCAMENTO) pelo MESMO mecanismo de sempre (`debitar`): mesma
 * protecao contra saldo negativo, mesma isencao de conta ilimitada, mesmo
 * historico. Nao persiste orcamento — a simulacao publica usa premissas de
 * demonstracao, nao o catalogo do usuario.
 */
creditosRouter.post(
  '/revelar',
  asyncHandler(async (req, res) => {
    await debitar(req.usuario!.sub, CUSTO_ORCAMENTO, 'consumo_orcamento', 'simulacao_publica');
    res.json(await saldoAtual(req.usuario!.sub));
  }),
);

/** Portal do Cliente Stripe — gerenciar/cancelar assinatura, ver faturas. */
creditosRouter.post(
  '/portal',
  asyncHandler(async (req, res) => {
    res.json({ url: await criarPortalSessao(req.usuario!.sub) });
  }),
);
