import { defineConfig } from 'vitest/config';
import { obterUrlBancoTeste } from './src/test/dbTeste.js';

/**
 * Config do Vitest. Os testes de INTEGRACAO rodam contra um banco Postgres de
 * TESTE separado (mesmo projeto Neon do DATABASE_URL em .env, banco com
 * sufixo "_test"), recriado do zero a cada execucao pelo globalSetup — nunca
 * toca no banco de producao. Usa Postgres de verdade (nao SQLite) porque e' o
 * motor que roda em producao. As variaveis abaixo sao aplicadas antes de
 * qualquer import, entao o `dotenv` (que nao sobrescreve) mantem estes
 * valores de teste.
 */
export default defineConfig({
  test: {
    env: {
      DATABASE_URL: obterUrlBancoTeste(),
      JWT_SECRET: 'segredo-de-teste-com-mais-de-16-caracteres',
      JWT_EXPIRES_IN: '1h',
    },
    globalSetup: ['./src/test/globalSetup.ts'],
    // Um unico arquivo toca no banco; rodar sem paralelismo de arquivos evita
    // qualquer contencao de escrita no Postgres de teste compartilhado.
    fileParallelism: false,
    // Testes de integracao fazem varios round-trips de rede ate o Neon (nao
    // e' banco local) — o "cold start" do compute autosuspenso pode levar
    // alguns segundos na primeira query. 5s (default) e' curto demais.
    testTimeout: 20000,
  },
});
