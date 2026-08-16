/**
 * Webhook do Stripe. Monta-se no app.ts ANTES do `express.json()` global,
 * com `express.raw()` so' nessa rota — a verificacao de assinatura do Stripe
 * precisa do corpo cru (Buffer), nao do JSON ja parseado.
 */
import { Router } from 'express';
import type Stripe from 'stripe';
import { stripe } from '../../lib/stripe.js';
import { env } from '../../config/env.js';
import { processarEventoStripe } from './service.js';

export const stripeWebhookRouter = Router();

stripeWebhookRouter.post('/', async (req, res) => {
  const assinatura = req.headers['stripe-signature'];
  if (!assinatura || typeof assinatura !== 'string') {
    res.status(400).json({ codigo: 'WEBHOOK_INVALIDO', mensagem: 'Assinatura ausente' });
    return;
  }

  let event: Stripe.Event;
  try {
    // req.body e' um Buffer aqui (express.raw), nao um objeto — obrigatorio
    // pra construeEvent recalcular o HMAC e confirmar que veio do Stripe de
    // verdade (sem isso, qualquer um poderia forjar um evento de pagamento).
    event = stripe.webhooks.constructEvent(req.body, assinatura, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook Stripe: assinatura invalida', err);
    res.status(400).json({ codigo: 'WEBHOOK_INVALIDO', mensagem: 'Assinatura invalida' });
    return;
  }

  try {
    await processarEventoStripe(event);
    res.json({ recebido: true });
  } catch (err) {
    console.error('Webhook Stripe: erro ao processar evento', event.type, err);
    // 500 faz o Stripe tentar reenviar depois — processarEventoStripe e'
    // idempotente, entao um reenvio e' seguro.
    res.status(500).json({ codigo: 'ERRO_INTERNO', mensagem: 'Erro ao processar evento' });
  }
});
