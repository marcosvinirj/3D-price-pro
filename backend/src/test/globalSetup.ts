/**
 * Setup global dos testes: garante que o banco de teste existe (cria na
 * primeira vez) e recria o schema nele antes de rodar a suite. `--force-reset`
 * garante um banco limpo e deterministico a cada execucao. Roda contra um
 * Postgres de teste separado (mesmo projeto Neon, banco "<nome>_test") —
 * nunca toca no banco de producao.
 */
import { execSync } from 'node:child_process';
import { garantirBancoDeTeste, obterUrlBancoTeste } from './dbTeste.js';

export default async function setup() {
  const urlTeste = obterUrlBancoTeste();
  await garantirBancoDeTeste(urlTeste);
  execSync('npx prisma db push --skip-generate --force-reset', {
    env: { ...process.env, DATABASE_URL: urlTeste },
    stdio: 'inherit',
  });
}
