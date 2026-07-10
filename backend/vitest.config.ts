import { defineConfig } from 'vitest/config';

/**
 * Config do Vitest. Os testes de INTEGRACAO usam um banco SQLite proprio
 * (prisma/test.db), recriado do zero a cada execucao pelo globalSetup — nunca
 * tocam no dev.db. As variaveis abaixo sao aplicadas antes de qualquer import,
 * entao o `dotenv` (que nao sobrescreve) mantem estes valores de teste.
 */
export default defineConfig({
  test: {
    env: {
      DATABASE_URL: 'file:./test.db',
      JWT_SECRET: 'segredo-de-teste-com-mais-de-16-caracteres',
      JWT_EXPIRES_IN: '1h',
    },
    globalSetup: ['./src/test/globalSetup.ts'],
    // Um unico arquivo toca no banco; rodar sem paralelismo de arquivos evita
    // qualquer contencao de escrita no SQLite compartilhado.
    fileParallelism: false,
  },
});
