/**
 * Cria (ou reaproveita, se ja existir) o endpoint de webhook no Stripe
 * apontando pro backend de PRODUCAO. Idempotente — procura por URL antes de
 * criar. O "signing secret" so' e' devolvido pelo Stripe no momento da
 * CRIACAO — se o endpoint ja existir, e' preciso pegar o secret manualmente
 * no Dashboard (Developers > Webhooks) e colar no .env/Render.
 *
 *   npx tsx src/scripts/stripeWebhookSetup.ts <url-do-backend>
 *   npx tsx src/scripts/stripeWebhookSetup.ts https://precificacao3d-backend.onrender.com/webhooks/stripe
 */
import Stripe from 'stripe';
import { env } from '../config/env.js';

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

const url = process.argv[2];
if (!url) {
  console.error('Uso: npx tsx src/scripts/stripeWebhookSetup.ts <url-completa-do-webhook>');
  process.exit(1);
}

const EVENTOS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_succeeded',
] as const;

const existentes = await stripe.webhookEndpoints.list({ limit: 100 });
const jaExiste = existentes.data.find((e) => e.url === url);

if (jaExiste) {
  console.log(`Endpoint ja existe: ${jaExiste.id} (${jaExiste.url})`);
  console.log('O signing secret so aparece na CRIACAO — pegue no Dashboard: Developers > Webhooks > esse endpoint > "Reveal" (ou "Roll secret" se precisar de um novo).');
  process.exit(0);
}

const endpoint = await stripe.webhookEndpoints.create({
  url,
  enabled_events: [...EVENTOS],
  description: 'Price 3D — creditos (checkout + assinatura)',
});

console.log(`Endpoint criado: ${endpoint.id}`);
console.log('\nCole isto no .env (local) e nas env vars do backend no Render:\n');
console.log(`STRIPE_WEBHOOK_SECRET="${endpoint.secret}"`);
