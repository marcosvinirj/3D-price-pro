/** Montagem do app Express (rotas + middlewares). */
import express from 'express';
import cors from 'cors';
import { errorHandler } from './http/errors.js';
import { autenticar, exigirAdminParaEscrita } from './auth/middleware.js';
import { authRouter } from './auth/routes.js';
import { materiaisRouter } from './modules/materiais/routes.js';
import { impressorasRouter } from './modules/impressoras/routes.js';
import { custosFixosRouter } from './modules/custosFixos/routes.js';
import { custosVariaveisRouter } from './modules/custosVariaveis/routes.js';
import { configuracaoRouter } from './modules/configuracao/routes.js';
import { orcamentosRouter } from './modules/orcamentos/routes.js';
import { dashboardRouter } from './modules/dashboard/routes.js';
import { moedasRouter } from './modules/moedas/routes.js';

export function criarApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Rotas publicas
  app.use('/auth', authRouter);

  // Rotas de configuracao de negocio: leitura para qualquer autenticado,
  // escrita (criar/editar/remover) restrita a admin.
  app.use('/materiais', autenticar, exigirAdminParaEscrita, materiaisRouter);
  app.use('/impressoras', autenticar, exigirAdminParaEscrita, impressorasRouter);
  app.use('/custos-fixos', autenticar, exigirAdminParaEscrita, custosFixosRouter);
  app.use('/custos-variaveis', autenticar, exigirAdminParaEscrita, custosVariaveisRouter);
  app.use('/configuracao', autenticar, exigirAdminParaEscrita, configuracaoRouter);
  app.use('/moedas', autenticar, exigirAdminParaEscrita, moedasRouter);

  // Trabalho operacional do dia a dia: acessivel a qualquer usuario autenticado.
  app.use('/orcamentos', autenticar, orcamentosRouter);
  app.use('/dashboard', autenticar, dashboardRouter);

  app.use(errorHandler);
  return app;
}
