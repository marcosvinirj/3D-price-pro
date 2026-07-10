/**
 * Setup global dos testes: recria o schema no banco de teste (prisma/test.db)
 * antes de rodar a suite. `--force-reset` garante um banco limpo e deterministico.
 */
import { execSync } from 'node:child_process';

const DATABASE_URL_TESTE = 'file:./test.db';

export default function setup() {
  execSync('npx prisma db push --skip-generate --force-reset', {
    env: { ...process.env, DATABASE_URL: DATABASE_URL_TESTE },
    stdio: 'inherit',
  });
}
