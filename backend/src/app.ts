/** Montagem do app Express (rotas + middlewares). */
import express from 'express';
import cors from 'cors';
import { errorHandler } from './http/errors.js';
import { autenticar } from './auth/middleware.js';
import { authRouter } from './auth/routes.js';
import { materiaisRouter } from './modules/materiais/routes.js';
import { impressorasRouter } from './modules/impressoras/routes.js';
import { custosFixosRouter } from './modules/custosFixos/routes.js';
import { custosVariaveisRouter } from './modules/custosVariaveis/routes.js';
import { insumosRouter } from './modules/insumos/routes.js';
import { configuracaoRouter } from './modules/configuracao/routes.js';
import { orcamentosRouter } from './modules/orcamentos/routes.js';
import { dashboardRouter } from './modules/dashboard/routes.js';
import { moedasRouter } from './modules/moedas/routes.js';
import { creditosRouter } from './modules/creditos/routes.js';
import { stripeWebhookRouter } from './modules/creditos/webhookRoutes.js';

export function criarApp() {
  const app = express();

  app.use(cors());

  // Webhook do Stripe PRECISA do corpo cru (Buffer) pra verificar a
  // assinatura — tem que vir ANTES do express.json() global, que consome/
  // parseia o corpo pra todo o resto do app.
  app.use('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRouter);

  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Rotas publicas
  app.use('/auth', authRouter);

  // Multi-tenant: cada usuario autenticado tem acesso total (leitura e
  // escrita), mas apenas aos proprios dados — o filtro por dono acontece
  // dentro de cada modulo (service/routes), a partir de req.usuario.sub.
  app.use('/materiais', autenticar, materiaisRouter);
  app.use('/impressoras', autenticar, impressorasRouter);
  app.use('/custos-fixos', autenticar, custosFixosRouter);
  app.use('/custos-variaveis', autenticar, custosVariaveisRouter);
  app.use('/insumos', autenticar, insumosRouter);
  app.use('/configuracao', autenticar, configuracaoRouter);
  app.use('/moedas', autenticar, moedasRouter);
  app.use('/orcamentos', autenticar, orcamentosRouter);
  app.use('/dashboard', autenticar, dashboardRouter);
  app.use('/creditos', autenticar, creditosRouter);

  app.use(errorHandler);
  return app;
}
