/** Montagem do app Express (rotas + middlewares). */
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
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
import { publicoRouter } from './modules/publico/routes.js';

/**
 * Limites de requisicao nas superficies expostas a quem nao tem conta.
 * `/auth` protege contra forca bruta de senha e criacao em massa de contas;
 * `/publico` protege a calculadora de demonstracao (formulario aberto na
 * internet) de ser usada como CPU gratis. Rotas autenticadas nao entram aqui:
 * ja exigem um JWT valido, e limitar o uso normal do app atrapalharia o
 * recalculo em tempo real do simulador.
 */
/** Testes de integracao fazem dezenas de cadastros/logins de proposito —
 *  o limite so' faria a suite falhar sem testar nada de util. */
const emTeste = () => process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

const limiteAuth = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30, // por IP, por 15 min
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: emTeste,
  message: { codigo: 'MUITAS_TENTATIVAS', mensagem: 'Muitas tentativas. Tente de novo em alguns minutos.' },
});

const limitePublico = rateLimit({
  windowMs: 60 * 1000,
  limit: 60, // por IP, por minuto — folgado pro recalculo ao digitar
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: emTeste,
  message: { codigo: 'MUITAS_TENTATIVAS', mensagem: 'Muitas requisições. Aguarde alguns segundos.' },
});

export function criarApp() {
  const app = express();

  // O Render fica atras de proxy: sem isso o express-rate-limit veria o IP do
  // proxy pra todo mundo (limitaria todos juntos) em vez do IP real do cliente.
  app.set('trust proxy', 1);

  app.use(cors());

  // Webhook do Stripe PRECISA do corpo cru (Buffer) pra verificar a
  // assinatura — tem que vir ANTES do express.json() global, que consome/
  // parseia o corpo pra todo o resto do app.
  app.use('/webhooks/stripe', express.raw({ type: 'application/json' }), stripeWebhookRouter);

  app.use(express.json());

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Rotas publicas
  app.use('/auth', limiteAuth, authRouter);
  // Calculadora de demonstracao do site (sem conta). Nao toca no banco.
  app.use('/publico', limitePublico, publicoRouter);

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
