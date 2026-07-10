/** Ponto de entrada do servidor HTTP. */
import { env } from './config/env.js';
import { criarApp } from './app.js';

const app = criarApp();

app.listen(env.PORT, () => {
  console.log(`API de precificacao ouvindo em http://localhost:${env.PORT}`);
});
