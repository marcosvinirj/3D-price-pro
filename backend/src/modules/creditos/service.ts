/**
 * Servico de creditos: saldo, debito/credito atomicos, checkout e portal do
 * Stripe, e processamento dos webhooks.
 *
 * Regra de negocio (decidida com o usuario):
 *   - Cadastro novo ganha BONUS_CADASTRO creditos de bonus.
 *   - Criar orcamento custa CUSTO_ORCAMENTO creditos; gerar PDF custa CUSTO_PDF.
 *   - Assinatura mensal "Pro" (Stripe) credita CREDITOS_ASSINATURA todo ciclo
 *     — SOMA ao saldo existente (nao reseta o que sobrou do mes anterior).
 *   - Pacote avulso (pagamento unico) credita CREDITOS_PACOTE, sem expirar.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type Stripe from 'stripe';
import { prisma } from '../../db/prisma.js';
import { creditosInsuficientes } from '../../http/errors.js';
import { env } from '../../config/env.js';
import { stripe } from '../../lib/stripe.js';

export const BONUS_CADASTRO = 100;
export const CUSTO_ORCAMENTO = 20;
export const CUSTO_PDF = 10;
export const CREDITOS_ASSINATURA = 600;
export const CREDITOS_PACOTE = 300;

/** Cliente Prisma "normal" ou dentro de uma transacao interativa — mesmas operacoes. */
type Cliente = PrismaClient | Prisma.TransactionClient;

/**
 * Debita creditos de forma ATOMICA: o `WHERE creditos >= quantidade` faz o
 * banco checar-e-descontar numa unica operacao — fecha a mesma brecha de
 * corrida (duplo clique, duas requisicoes simultaneas) ja corrigida na baixa
 * de estoque. Lanca `creditosInsuficientes` (402) se o saldo nao cobrir.
 *
 * Contas com `creditosIlimitados` (isencao manual, administrativa — sem rota
 * publica pra ligar isso) nunca sao debitadas nem geram historico: nada foi
 * "gasto" de verdade.
 */
export async function debitar(
  usuarioId: number,
  quantidade: number,
  tipo: 'consumo_orcamento' | 'consumo_pdf',
  referencia?: string,
  cliente: Cliente = prisma,
): Promise<void> {
  const user = await cliente.user.findUniqueOrThrow({
    where: { id: usuarioId },
    select: { creditos: true, creditosIlimitados: true },
  });
  if (user.creditosIlimitados) return;

  const upd = await cliente.user.updateMany({
    where: { id: usuarioId, creditos: { gte: quantidade } },
    data: { creditos: { decrement: quantidade } },
  });
  if (upd.count === 0) {
    throw creditosInsuficientes(quantidade, user.creditos);
  }
  await cliente.creditoTransacao.create({
    data: { usuarioId, quantidade: -quantidade, tipo, referencia: referencia ?? null },
  });
}

/** Credita creditos (bonus, assinatura, pacote) — sempre sucede, sem guarda. */
export async function creditar(
  usuarioId: number,
  quantidade: number,
  tipo: 'bonus_cadastro' | 'assinatura_mensal' | 'pacote_avulso',
  referencia?: string,
  cliente: Cliente = prisma,
): Promise<void> {
  await cliente.user.update({ where: { id: usuarioId }, data: { creditos: { increment: quantidade } } });
  await cliente.creditoTransacao.create({
    data: { usuarioId, quantidade, tipo, referencia: referencia ?? null },
  });
}

/** Saldo atual + assinatura + ultimas movimentacoes, pra tela de creditos. */
export async function saldoAtual(usuarioId: number) {
  const [user, assinatura, historico] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: usuarioId }, select: { creditos: true, creditosIlimitados: true } }),
    prisma.assinatura.findUnique({ where: { usuarioId } }),
    prisma.creditoTransacao.findMany({
      where: { usuarioId },
      orderBy: { criadoEm: 'desc' },
      take: 20,
    }),
  ]);
  return {
    creditos: user.creditos,
    ilimitado: user.creditosIlimitados,
    assinaturaAtiva: assinatura?.status === 'active',
    assinatura,
    historico,
  };
}

/** Devolve o Stripe Customer do usuario, criando na Stripe (e salvando o id) se ainda nao existir. */
async function obterOuCriarStripeCustomer(usuarioId: number): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: usuarioId } });
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: user.email,
    metadata: { usuarioId: String(usuarioId) },
  });
  await prisma.user.update({ where: { id: usuarioId }, data: { stripeCustomerId: customer.id } });
  return customer.id;
}

/** Cria uma sessao de Checkout (Stripe) e devolve a URL pra redirecionar o usuario. */
async function criarCheckout(
  usuarioId: number,
  priceId: string,
  modo: 'subscription' | 'payment',
): Promise<string> {
  if (!priceId) throw new Error(`Price do Stripe nao configurado (modo ${modo}).`);
  const customerId = await obterOuCriarStripeCustomer(usuarioId);
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: modo,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${env.FRONTEND_URL}/creditos?checkout=sucesso`,
    cancel_url: `${env.FRONTEND_URL}/creditos?checkout=cancelado`,
    client_reference_id: String(usuarioId),
  });
  if (!session.url) throw new Error('Stripe nao devolveu url de checkout.');
  return session.url;
}

export const criarCheckoutAssinatura = (usuarioId: number) =>
  criarCheckout(usuarioId, env.STRIPE_PRICE_ASSINATURA, 'subscription');

export const criarCheckoutPacote = (usuarioId: number) =>
  criarCheckout(usuarioId, env.STRIPE_PRICE_PACOTE, 'payment');

/** Sessao do Portal do Cliente Stripe — gerenciar/cancelar assinatura, ver faturas. */
export async function criarPortalSessao(usuarioId: number): Promise<string> {
  const customerId = await obterOuCriarStripeCustomer(usuarioId);
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${env.FRONTEND_URL}/creditos`,
  });
  return session.url;
}

/** Acha o usuario dono de um Stripe Customer ID (null se nao achar). */
async function usuarioIdPorCustomer(customerId: string | null): Promise<number | null> {
  if (!customerId) return null;
  const user = await prisma.user.findFirst({ where: { stripeCustomerId: customerId }, select: { id: true } });
  return user?.id ?? null;
}

/** Grava/atualiza o estado local da assinatura a partir do objeto do Stripe. */
async function sincronizarAssinatura(usuarioId: number, sub: Stripe.Subscription): Promise<void> {
  const item = sub.items.data[0];
  const periodoAtualFim = new Date((item?.current_period_end ?? 0) * 1000);
  await prisma.assinatura.upsert({
    where: { usuarioId },
    create: {
      usuarioId,
      stripeSubscriptionId: sub.id,
      stripePriceId: item?.price.id ?? '',
      status: sub.status,
      periodoAtualFim,
    },
    update: {
      stripeSubscriptionId: sub.id,
      stripePriceId: item?.price.id ?? '',
      status: sub.status,
      periodoAtualFim,
    },
  });
}

/**
 * Processa UM evento do webhook do Stripe. Idempotente: se o mesmo evento
 * (mesmo `event.id`) ja foi processado antes (o Stripe reenvia em caso de
 * timeout/retry), ignora silenciosamente na segunda vez.
 */
export async function processarEventoStripe(event: Stripe.Event): Promise<void> {
  const jaProcessado = await prisma.stripeEventoProcessado.findUnique({ where: { id: event.id } });
  if (jaProcessado) return;

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      // So' credita aqui o PACOTE avulso (pagamento unico). Assinatura nova
      // credita via invoice.payment_succeeded (mesmo caminho das renovacoes
      // — evita creditar duas vezes na primeira cobranca).
      if (session.mode === 'payment') {
        const usuarioId =
          (await usuarioIdPorCustomer(session.customer as string | null)) ??
          (session.client_reference_id ? Number(session.client_reference_id) : null);
        if (usuarioId) {
          await creditar(usuarioId, CREDITOS_PACOTE, 'pacote_avulso', session.id);
        }
      }
      break;
    }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const usuarioId = await usuarioIdPorCustomer(sub.customer as string);
      if (usuarioId) await sincronizarAssinatura(usuarioId, sub);
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as Stripe.Invoice;
      // @ts-expect-error -- campo existe no payload real da Stripe (subscription id), tipagem da lib as vezes fica defasada
      const subscriptionId = invoice.subscription as string | null;
      if (!subscriptionId) break; // fatura avulsa nao ligada a assinatura
      const usuarioId = await usuarioIdPorCustomer(invoice.customer as string | null);
      if (usuarioId) {
        // Cobre tanto a 1a cobranca da assinatura quanto cada renovacao mensal.
        await creditar(usuarioId, CREDITOS_ASSINATURA, 'assinatura_mensal', invoice.id);
      }
      break;
    }

    default:
      break;
  }

  await prisma.stripeEventoProcessado.create({ data: { id: event.id, tipo: event.type } });
}
