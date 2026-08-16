/** Carrega e valida variaveis de ambiente uma unica vez. */
import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET deve ter ao menos 16 caracteres'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  PORT: z.coerce.number().int().positive().default(3333),
  STRIPE_SECRET_KEY: z.string().min(1, 'STRIPE_SECRET_KEY e obrigatoria'),
  // Preenchidos depois (script de setup / Dashboard do Stripe) — string vazia
  // permite o app subir antes de tudo estar configurado; os modulos que
  // dependem disso checam e avisam com erro claro na hora do uso.
  STRIPE_PRICE_ASSINATURA: z.string().default(''),
  STRIPE_PRICE_PACOTE: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  // Pra onde o Stripe Checkout/Portal volta depois do pagamento.
  FRONTEND_URL: z.string().default('http://localhost:5173'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Variaveis de ambiente invalidas:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
