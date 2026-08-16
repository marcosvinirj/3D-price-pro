/**
 * Cria (ou reaproveita, se ja existir) os Products/Prices no Stripe para a
 * assinatura mensal e o pacote avulso de creditos. Idempotente — roda de
 * novo sem duplicar (usa `lookup_key` pra achar precos ja criados).
 *
 *   npx tsx src/scripts/stripeSetup.ts
 *
 * Imprime as env vars STRIPE_PRICE_* pra colar no .env.
 */
import Stripe from 'stripe';
import { env } from '../config/env.js';

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

const ASSINATURA_LOOKUP_KEY = 'price3d_assinatura_pro_mensal';
const PACOTE_LOOKUP_KEY = 'price3d_pacote_300';

async function obterOuCriarPrecoAssinatura(): Promise<string> {
  const existentes = await stripe.prices.list({ lookup_keys: [ASSINATURA_LOOKUP_KEY], limit: 1 });
  if (existentes.data[0]) {
    console.log(`Assinatura ja existia: ${existentes.data[0].id}`);
    return existentes.data[0].id;
  }

  const produto = await stripe.products.create({
    name: 'Price 3D Pro',
    description: '600 creditos por mes — criar orcamento custa 20cr, gerar PDF custa 10cr.',
  });
  const preco = await stripe.prices.create({
    product: produto.id,
    currency: 'eur',
    unit_amount: 990, // EUR 9,90 (Stripe usa centavos)
    recurring: { interval: 'month' },
    lookup_key: ASSINATURA_LOOKUP_KEY,
    metadata: { creditos: '600' },
  });
  console.log(`Assinatura criada: ${preco.id}`);
  return preco.id;
}

async function obterOuCriarPrecoPacote(): Promise<string> {
  const existentes = await stripe.prices.list({ lookup_keys: [PACOTE_LOOKUP_KEY], limit: 1 });
  if (existentes.data[0]) {
    console.log(`Pacote ja existia: ${existentes.data[0].id}`);
    return existentes.data[0].id;
  }

  const produto = await stripe.products.create({
    name: 'Price 3D — Pacote de 300 créditos',
    description: '300 créditos avulsos, sem expirar — criar orçamento custa 20cr, gerar PDF custa 10cr.',
  });
  const preco = await stripe.prices.create({
    product: produto.id,
    currency: 'eur',
    unit_amount: 690, // EUR 6,90
    lookup_key: PACOTE_LOOKUP_KEY,
    metadata: { creditos: '300' },
  });
  console.log(`Pacote criado: ${preco.id}`);
  return preco.id;
}

const idAssinatura = await obterOuCriarPrecoAssinatura();
const idPacote = await obterOuCriarPrecoPacote();

console.log('\nCole isto no backend/.env (e no Render, nas env vars do backend):\n');
console.log(`STRIPE_PRICE_ASSINATURA="${idAssinatura}"`);
console.log(`STRIPE_PRICE_PACOTE="${idPacote}"`);
