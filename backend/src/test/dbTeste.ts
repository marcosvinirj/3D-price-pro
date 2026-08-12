/**
 * Deriva a URL do banco de TESTE a partir do DATABASE_URL real (backend/.env):
 * mesmo host/credenciais, banco com sufixo "_test" — testa contra um Postgres
 * de verdade (o mesmo motor de producao), isolado do banco real. Nunca le
 * DATABASE_URL de `process.env` (o vitest.config.ts sobrescreve isso para o
 * valor de teste antes de qualquer arquivo de teste rodar) — sempre rele o
 * `.env` do disco, para ter certeza de que parte do valor real.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const raizBackend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** URL completa do banco de teste (mesmo host/credenciais, banco "<nome>_test"). */
export function obterUrlBancoTeste(): string {
  const env = parse(readFileSync(path.join(raizBackend, '.env')));
  const urlProducao = env.DATABASE_URL;
  if (!urlProducao) {
    throw new Error('DATABASE_URL nao encontrada em backend/.env — necessaria para derivar o banco de teste.');
  }
  return paraNomeDeTeste(urlProducao);
}

/** Troca so' o nome do banco na connection string por um com sufixo "_test". */
function paraNomeDeTeste(url: string): string {
  const u = new URL(url);
  const nome = u.pathname.replace(/^\//, '');
  u.pathname = `/${nome.endsWith('_test') ? nome : `${nome}_test`}`;
  return u.toString();
}

/** URL do banco "postgres" de manutencao (sempre existe), mesmo host/credenciais. */
function urlBancoAdmin(urlTeste: string): string {
  const u = new URL(urlTeste);
  u.pathname = '/postgres';
  return u.toString();
}

/**
 * Cria o banco de teste se ainda nao existir (bootstrap automatico — nenhum
 * passo manual necessario alem de ter um DATABASE_URL valido em .env com
 * permissao para criar bancos). Idempotente: ignora erro de "ja existe".
 */
export async function garantirBancoDeTeste(urlTeste: string): Promise<void> {
  const nome = new URL(urlTeste).pathname.replace(/^\//, '');
  const { PrismaClient } = await import('@prisma/client');
  const admin = new PrismaClient({ datasources: { db: { url: urlBancoAdmin(urlTeste) } } });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${nome}"`);
    console.log(`[globalSetup] Banco de teste "${nome}" criado.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('already exists')) throw e;
  } finally {
    await admin.$disconnect();
  }
}
